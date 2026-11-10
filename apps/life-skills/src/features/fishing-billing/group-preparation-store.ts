import 'server-only';
import { z } from 'zod';
import { AppError, type ErrorCode } from '../../lib/errors.ts';
import { requirePractitioner } from '../cases/policy.ts';
import { canonical } from '../contact-ops/core/validation.ts';
import { privateDigest } from '../contact-ops/server/digests.ts';
import { demoAccountBatch } from '../demo/provenance.ts';
import { seal, unseal, type Keyring } from '../identity/crypto.ts';
import { freshActor, lockWorkspace } from '../identity/data.ts';
import { one, type IdentityStore, type SqlSession } from '../identity/store.ts';
import { systemClock, type AccountId, type Actor, type IdentityClock, type WorkspaceId } from '../identity/types.ts';
import {
  GROUP_PREPARATION_CLASS, GROUP_PREPARATION_PROGRAM, GROUP_PREPARATION_VERSION,
  groupPreparationCommand, groupPreparationFields, groupPreparationId, groupPreparationRecord, groupPreparationRevision,
  type GroupPreparationCommand, type GroupPreparationRecord,
} from './group-preparation-contract.ts';

type Action = GroupPreparationCommand['action'] | 'read';
type OwnerScope = Readonly<{
  workspaceId: WorkspaceId; accountId: AccountId; groupId: string;
  programKey: typeof GROUP_PREPARATION_PROGRAM; action: Action;
}>;

/** Supplied by trusted server composition. Check the current owner in the supplied transaction
 * and lock the evidence that grants access through commit. No default owner or request-body grant. */
export interface GroupPreparationOwnerAuthority {
  isCurrentOwner(tx: SqlSession, scope: OwnerScope): Promise<boolean>;
}

type Frozen<T> = T extends object ? { readonly [K in keyof T]: Frozen<T[K]> } : T;
function freeze<T>(value: T): Frozen<T> {
  if (value !== null && typeof value === 'object') {
    for (const part of Object.values(value)) freeze(part);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}
function fail(code: ErrorCode): never { throw new AppError(code); }

type RevisionRow = {
  workspaceId: string; groupId: string; revision: number; version: string; programKey: string;
  state: string; action: string; operationId: string; createdBy: string; createdAt: Date;
  recordedBy: string; recordedAt: Date; requestDigest: string; recordDigest: string;
  previousRevision: number | null; previousDigest: string | null; ciphertext: string;
};
type Stored = { record: GroupPreparationRecord; command: GroupPreparationCommand; digest: string };
type Head = { revision: number; digest: string };
const columns = 'workspace_id AS "workspaceId", group_id AS "groupId", revision, contract_version AS version, ' +
  'program_key AS "programKey", state, action, operation_id AS "operationId", created_by AS "createdBy", ' +
  'created_at AS "createdAt", recorded_by AS "recordedBy", recorded_at AS "recordedAt", request_digest AS "requestDigest", ' +
  'record_digest AS "recordDigest", previous_revision AS "previousRevision", previous_digest AS "previousDigest", payload_ciphertext AS ciphertext';
const selectVersions = 'SELECT ' + columns + ' FROM ls_fishing_billing.group_preparation_versions ';
const aad = (workspace: string, group: string, revision: number) => 'ls_fishing_billing/group-preparation/v1/' + workspace + '/' + group + '/' + revision;

const envelope = z.object({ record: groupPreparationRecord, command: groupPreparationCommand }).strict();

export class FishingGroupPreparationStore {
  private readonly checkOwner: GroupPreparationOwnerAuthority['isCurrentOwner'] | undefined;

  constructor(
    private readonly db: IdentityStore, private readonly workspaceId: WorkspaceId, private readonly keyring: Keyring,
    private readonly integrityKey: string, authority: GroupPreparationOwnerAuthority | null,
    private readonly clock: IdentityClock = systemClock,
  ) {
    if (!groupPreparationId.safeParse(workspaceId).success || integrityKey.length < 32) fail('UNAVAILABLE');
    this.checkOwner = authority?.isCurrentOwner?.bind(authority);
  }

  private now(): Date {
    const value = this.clock.now();
    return value instanceof Date && Number.isFinite(value.getTime()) ? new Date(value.getTime()) : fail('UNAVAILABLE');
  }
  private requestDigest(actorId: string, command: GroupPreparationCommand) {
    return privateDigest({ domain: 'fishing-group-preparation-command/v1', workspaceId: this.workspaceId, actorId, command }, this.integrityKey);
  }
  private recordDigest(record: GroupPreparationRecord) {
    return privateDigest({ domain: 'fishing-group-preparation-revision/v1', record }, this.integrityKey);
  }

  private async authorize(tx: SqlSession, actor: Actor, scope: OwnerScope) {
    if (!this.checkOwner) fail('UNAVAILABLE');
    const current = await freshActor(tx, actor, this.now());
    requirePractitioner(current);
    if (current.workspaceId !== this.workspaceId || current.id !== actor.id || current.personId !== actor.personId ||
        await demoAccountBatch(tx, this.workspaceId, current.id) !== null) fail('FORBIDDEN');
    if (await this.checkOwner(tx, scope) !== true) fail('FORBIDDEN');

    // Recheck after the authority callback, including database time. The account lock also
    // conflicts with inserting a demo marker that references this account. Pin this session and subject.
    const now = this.now();
    if (!Number.isFinite(actor.expiresAt) || actor.expiresAt <= now.getTime()) fail('UNAUTHENTICATED');
    const valid = await one(tx, 'SELECT a.id FROM ls_identity.accounts a ' +
      'JOIN ls_identity.sessions s ON s.workspace_id=a.workspace_id AND s.account_id=a.id ' +
      'JOIN ls_identity.account_subjects sub ON sub.workspace_id=a.workspace_id AND sub.account_id=a.id ' +
      "WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='active' AND a.role='practitioner' AND sub.person_id=$3 " +
      'AND s.token_digest=$4 AND s.revoked_at IS NULL AND s.expires_at>GREATEST($5::timestamptz,clock_timestamp()) ' +
      'AND NOT EXISTS (SELECT 1 FROM ls_demo.accounts d WHERE d.workspace_id=a.workspace_id AND d.account_id=a.id) ' +
      'FOR UPDATE OF a FOR SHARE OF s,sub', [this.workspaceId, actor.id, actor.personId, actor.sessionDigest, now]);
    if (!valid) fail('FORBIDDEN');
  }

  private async transaction<T>(actor: Actor, groupId: string, action: Action, work: (tx: SqlSession, actorId: AccountId) => Promise<T>): Promise<T> {
    const principal = Object.freeze({ ...actor });
    if (principal.workspaceId !== this.workspaceId) fail('FORBIDDEN');
    if (!this.checkOwner) fail('UNAVAILABLE');
    const scope = Object.freeze({ workspaceId: this.workspaceId, accountId: principal.id, groupId, programKey: GROUP_PREPARATION_PROGRAM, action });
    let callbackFailure: unknown;
    try {
      return await this.db.transaction(async session => {
        callbackFailure = undefined;
        try {
          const tx: SqlSession = Object.freeze({ query: session.query.bind(session) });
          if (action !== 'read') await lockWorkspace(tx, this.workspaceId);
          await this.authorize(tx, principal, scope);
          let result: T;
          try { result = await work(tx, principal.id); }
          catch (error) {
            // Existence and stale-version results are private, too. A failed SQL transaction can only roll back.
            if (error instanceof AppError && ['NOT_FOUND', 'CONFLICT', 'INVALID_REQUEST'].includes(error.code)) {
              await this.authorize(tx, principal, scope);
            }
            throw error;
          }
          await this.authorize(tx, principal, scope);
          return result;
        } catch (error) {
          callbackFailure = error;
          throw error;
        }
      });
    } catch (error) {
      // A driver error can arrive after COMMIT. Only the callback's own rejection is definitive.
      if (error instanceof AppError && error === callbackFailure) throw error;
      return fail('UNAVAILABLE');
    }
  }

  private decode(row: RevisionRow): Stored {
    try {
      const { record, command } = envelope.parse(JSON.parse(unseal(row.ciphertext, aad(this.workspaceId, row.groupId, row.revision), this.keyring)));
      if (row.workspaceId !== this.workspaceId || record.workspaceId !== this.workspaceId || record.groupId !== row.groupId ||
          record.revision !== row.revision || record.version !== row.version || record.programKey !== row.programKey ||
          record.state !== row.state || record.action !== row.action || record.operationId !== row.operationId ||
          record.createdBy !== row.createdBy || record.createdAt !== row.createdAt.toISOString() ||
          record.recordedBy !== row.recordedBy || record.recordedAt !== row.recordedAt.toISOString() ||
          record.previousDigest !== row.previousDigest || row.previousRevision !== (record.revision === 1 ? null : record.revision - 1) ||
          command.action !== record.action || command.groupId !== record.groupId || command.operationId !== record.operationId ||
          command.expectedRevision !== record.revision - 1 || record.requestDigest !== row.requestDigest ||
          this.requestDigest(record.recordedBy, command) !== row.requestDigest ||
          this.recordDigest(record) !== row.recordDigest) fail('UNAVAILABLE');
      return { record, command, digest: row.recordDigest };
    } catch { return fail('UNAVAILABLE'); }
  }

  /** Verify the head and its immutable chain in pages, retaining only the latest and requested revisions. */
  private async history(tx: SqlSession, groupId: string, requested?: number) {
    const head = await one<Head>(tx, 'SELECT revision, record_digest AS digest FROM ls_fishing_billing.group_preparation_heads ' +
      'WHERE workspace_id=$1 AND group_id=$2 FOR SHARE', [this.workspaceId, groupId]);
    let latest: Stored | null = null, selected: Stored | null = null;
    for (;;) {
      const rows: RevisionRow[] = await tx.query<RevisionRow>(selectVersions +
        'WHERE workspace_id=$1 AND group_id=$2 AND revision>$3 ORDER BY revision LIMIT 32', [this.workspaceId, groupId, latest?.record.revision ?? 0]);
      for (const row of rows) {
        const item = this.decode(row), r = item.record;
        if (!head || r.groupId !== groupId || r.revision > head.revision || r.revision !== (latest?.record.revision ?? 0) + 1 ||
            r.previousDigest !== (latest?.digest ?? null)) fail('UNAVAILABLE');
        if (latest && (latest.record.state !== 'draft' || r.createdBy !== latest.record.createdBy || r.createdAt !== latest.record.createdAt ||
            r.recordedAt < latest.record.recordedAt)) {
          fail('UNAVAILABLE');
        }
        const previousFields = latest?.record.fields;
        const intended = item.command.action === 'cancel' ? previousFields : { ...previousFields, ...item.command.fields };
        if (!intended || canonical(intended) !== canonical(r.fields)) fail('UNAVAILABLE');
        if (r.revision === requested) selected = item;
        latest = item;
      }
      if (rows.length < 32) break;
    }
    if (latest?.record.revision !== head?.revision || latest?.digest !== head?.digest) fail('UNAVAILABLE');
    return { latest, selected };
  }

  async read(actor: Actor, groupId: string, revision?: number): Promise<Frozen<GroupPreparationRecord>> {
    if (!groupPreparationId.safeParse(groupId).success || (revision !== undefined && !groupPreparationRevision.safeParse(revision).success)) fail('INVALID_REQUEST');
    return this.transaction(actor, groupId, 'read', async tx => {
      const history = await this.history(tx, groupId, revision);
      const item = revision === undefined ? history.latest : history.selected;
      return item ? freeze(item.record) : fail('NOT_FOUND');
    });
  }

  async save(actor: Actor, raw: unknown): Promise<Readonly<{ replayed: boolean; record: Frozen<GroupPreparationRecord> }>> {
    const parsed = groupPreparationCommand.safeParse(raw);
    if (!parsed.success) fail('INVALID_REQUEST');
    const command = parsed.data;
    return this.transaction(actor, command.groupId, command.action, async (tx, actorId) => {
      const requestDigest = this.requestDigest(actorId, command);
      const oldOperation = await one<RevisionRow>(tx, selectVersions + 'WHERE workspace_id=$1 AND operation_id=$2', [this.workspaceId, command.operationId]);
      if (oldOperation) {
        const prior = this.decode(oldOperation), r = prior.record;
        if (r.operationId !== command.operationId) fail('UNAVAILABLE');
        if (r.groupId !== command.groupId || r.recordedBy !== actorId || r.requestDigest !== requestDigest) fail('CONFLICT');
        const { selected } = await this.history(tx, command.groupId, r.revision);
        if (!selected || prior.digest !== selected.digest) fail('UNAVAILABLE');
        return Object.freeze({ replayed: true, record: freeze(selected.record) });
      }
      const { latest } = await this.history(tx, command.groupId);
      if (!latest && command.action !== 'create') fail('NOT_FOUND');
      if (command.expectedRevision !== (latest?.record.revision ?? 0) || latest?.record.state === 'cancelled') fail('CONFLICT');

      const recordedAt = this.now().toISOString();
      if (latest && recordedAt < latest.record.recordedAt) fail('UNAVAILABLE');
      const fields = groupPreparationFields.safeParse(command.action === 'cancel' ? latest?.record.fields : { ...latest?.record.fields, ...command.fields });
      if (!fields.success) fail('INVALID_REQUEST');
      const record = groupPreparationRecord.parse({
        version: GROUP_PREPARATION_VERSION, classification: GROUP_PREPARATION_CLASS, programKey: GROUP_PREPARATION_PROGRAM,
        workspaceId: this.workspaceId, groupId: command.groupId, revision: command.expectedRevision + 1,
        state: command.action === 'cancel' ? 'cancelled' : 'draft', action: command.action, operationId: command.operationId,
        createdBy: latest?.record.createdBy ?? actorId, createdAt: latest?.record.createdAt ?? recordedAt,
        recordedBy: actorId, recordedAt, previousDigest: latest?.digest ?? null, requestDigest,
        fields: fields.data,
      });
      const digest = this.recordDigest(record);
      const cipher = seal(JSON.stringify({ record, command }), aad(this.workspaceId, record.groupId, record.revision), this.keyring);
      const inserted = await one<RevisionRow>(tx, 'INSERT INTO ls_fishing_billing.group_preparation_versions ' +
        '(workspace_id,group_id,revision,contract_version,program_key,state,action,operation_id,created_by,created_at,recorded_by,recorded_at,request_digest,record_digest,previous_digest,payload_ciphertext) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING RETURNING ' + columns,
        [this.workspaceId, record.groupId, record.revision, record.version, record.programKey, record.state, record.action,
          record.operationId, record.createdBy, record.createdAt, actorId, recordedAt, requestDigest, digest, record.previousDigest, cipher]);
      if (!inserted) fail('CONFLICT');
      const saved = this.decode(inserted);
      if (saved.digest !== digest) fail('UNAVAILABLE');

      const values = [this.workspaceId, record.groupId, record.revision, digest];
      const head = latest
        ? await one<Head>(tx, 'UPDATE ls_fishing_billing.group_preparation_heads SET revision=$3,record_digest=$4 ' +
          'WHERE workspace_id=$1 AND group_id=$2 AND revision=$5 AND record_digest=$6 RETURNING revision,record_digest AS digest',
          [...values, latest.record.revision, latest.digest])
        : await one<Head>(tx, 'INSERT INTO ls_fishing_billing.group_preparation_heads(workspace_id,group_id,revision,record_digest) ' +
          'VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING revision,record_digest AS digest', values);
      if (!head) fail('CONFLICT');
      if (head.revision !== record.revision || head.digest !== saved.digest) fail('UNAVAILABLE');
      return Object.freeze({ replayed: false, record: freeze(saved.record) });
    });
  }
}
