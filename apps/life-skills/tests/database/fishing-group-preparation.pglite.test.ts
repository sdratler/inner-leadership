import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppError, type ErrorCode } from '../../src/lib/errors.ts';
import { asId } from '../../src/lib/ids.ts';
import type { Actor, WorkspaceId } from '../../src/features/identity/types.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import {
  GROUP_PREPARATION_CLASS, GROUP_PREPARATION_VERSION, type GroupPreparationCommand, type GroupPreparationFields,
} from '../../src/features/fishing-billing/group-preparation-contract.ts';
import { FishingGroupPreparationStore, type GroupPreparationOwnerAuthority } from '../../src/features/fishing-billing/group-preparation-store.ts';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';

vi.mock('server-only', () => ({}));

let engine: PGlite;
const now = new Date('2035-01-10T15:00:00.000Z');
const ring = { activeKeyId: 'fixture', keys: { fixture: Buffer.alloc(32, 22) } };
const integrityKey = 'synthetic-group-preparation-integrity-key-only';
const clock = { now: () => new Date(now) };
const noNetwork = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); });
const binder: IdentityStore = {
  transaction: work => engine.transaction(tx => work({
    query: async <T extends object>(sql: string, args: readonly unknown[] = []) => (await tx.query<T>(sql, [...args])).rows,
  })),
};
// Synthetic substitute for the still-unmounted current-owner authority. Identity/session/demo checks in the actual store run unchanged.
const syntheticAuthority: GroupPreparationOwnerAuthority = {
  async isCurrentOwner(tx, scope) {
    const rows = await tx.query('SELECT 1 FROM synthetic_group_preparation.owner_grant WHERE workspace_id=$1 AND account_id=$2 FOR SHARE',
      [scope.workspaceId, scope.accountId]);
    return rows.length === 1 && scope.programKey === 'fishing_monthly_club';
  },
};

beforeAll(async () => {
  requirePgliteMemoryEnvironment(process.env);
  vi.stubGlobal('fetch', noNetwork);
  engine = new PGlite();
  await engine.exec('CREATE SCHEMA ls_control');
  const manifest = JSON.parse(await readFile('migrations/manifest.json', 'utf8')) as { name: string; sha256: string }[];
  for (const name of ['0001_ls_foundation.sql', '0010_ls_identity_cases_20260906.sql', '0030_ls_calendar_attendance_20260907.sql', '0097_ls_demo_provenance.sql']) {
    const sql = await readFile('migrations/' + name, 'utf8');
    expect(createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')).toBe(manifest.find(entry => entry.name === name)?.sha256);
    await engine.exec(sql);
  }
  await engine.exec(await readFile('tests/fixtures/fishing-group-preparation-schema.sql', 'utf8'));
  await engine.exec('CREATE SCHEMA synthetic_group_preparation; CREATE TABLE synthetic_group_preparation.owner_grant ' +
    '(workspace_id uuid PRIMARY KEY, account_id uuid NOT NULL, FOREIGN KEY (workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id))');
}, 30000);
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); });
afterAll(async () => { try { await engine?.close(); } finally { vi.unstubAllGlobals(); } });

async function actor(workspaceId: WorkspaceId, role: Actor['role'] = 'practitioner'): Promise<Actor> {
  const id = asId(randomUUID(), 'account'), personId = asId(randomUUID(), 'person');
  const sessionDigest = createHash('sha256').update(randomUUID()).digest('hex');
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)", [personId, workspaceId, now]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) " +
    "VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)", [id, workspaceId, role, sessionDigest, now]);
  await engine.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)', [workspaceId, id, personId]);
  const expires = new Date('2036-01-01T00:00:00Z');
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
    [sessionDigest, workspaceId, id, now, expires]);
  return { workspaceId, id, personId, role, state: 'active', locale: 'en', sessionDigest, expiresAt: expires.getTime() };
}
function fields(): GroupPreparationFields {
  return { label: 'Synthetic Tuesday planning', timeZone: 'America/New_York', period: null, firstClassAt: null,
    firstClassLocalDate: null, venueSource: null, proposedCapacity: null };
}
const version = GROUP_PREPARATION_VERSION;
function create(groupId = randomUUID() as string) {
  return { version, action: 'create' as const, expectedRevision: 0 as const, operationId: randomUUID(), groupId, fields: fields() };
}
function edit(groupId: string, expectedRevision: number, proposed: Partial<GroupPreparationFields> = fields()): GroupPreparationCommand {
  return { version, action: 'edit', expectedRevision, operationId: randomUUID(), groupId, fields: proposed };
}
function makeStore(ws: WorkspaceId, authority: GroupPreparationOwnerAuthority | null = syntheticAuthority, db = binder) {
  return new FishingGroupPreparationStore(db, ws, ring, integrityKey, authority, clock);
}
async function fixture() {
  const ws = asId(randomUUID(), 'workspace');
  await engine.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)', [ws, now]);
  const owner = await actor(ws);
  await engine.query('INSERT INTO synthetic_group_preparation.owner_grant VALUES($1,$2)', [ws, owner.id]);
  return { ws, owner, store: makeStore(ws), cmd: create() };
}
async function counts(ws: string, group: string) {
  const { rows } = await engine.query<{ heads: number; versions: number; operations: number }>('SELECT ' +
    '(SELECT COUNT(*)::int FROM ls_fishing_billing.group_preparation_heads WHERE workspace_id=$1 AND group_id=$2) AS heads,' +
    'COUNT(*)::int AS versions,COUNT(DISTINCT operation_id)::int AS operations FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1 AND group_id=$2', [ws, group]);
  return rows[0];
}

describe('owner group preparation in isolated PGlite', () => {
  it('saves and reloads a partial encrypted draft with no invented scheduling or occupancy', async () => {
    const { ws, owner, cmd, store } = await fixture();
    const saved = await store.save(owner, cmd);
    expect(saved).toMatchObject({ replayed: false, record: { version, classification: GROUP_PREPARATION_CLASS, programKey: 'fishing_monthly_club',
      state: 'draft', revision: 1, createdBy: owner.id, recordedBy: owner.id, createdAt: now.toISOString(), previousDigest: null, fields: fields() } });
    cmd.fields.label = 'client-mutated';
    const reloaded = await makeStore(ws).read(owner, cmd.groupId);
    expect(reloaded).toEqual(saved.record);
    expect(Object.isFrozen(saved) && Object.isFrozen(reloaded) && Object.isFrozen(reloaded.fields)).toBe(true);
    expect(Reflect.set(reloaded.fields, 'proposedCapacity', 123)).toBe(false);
    const { rows } = await engine.query<{ material: string }>('SELECT to_jsonb(v)::text AS material FROM ls_fishing_billing.group_preparation_versions v WHERE workspace_id=$1', [ws]);
    expect(rows).toHaveLength(1); expect(rows[0]!.material).not.toContain(fields().label);
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 1, operations: 1 });
  });

  it('preserves exact versions on edit and cancel, replays the original result, and rejects stale CAS', async () => {
    const { ws, owner, store, cmd } = await fixture();
    const initial = await store.save(owner, cmd);
    const proposed = { ...fields(), proposedCapacity: 0, firstClassLocalDate: '2035-01-31', venueSource: { id: 'fixture-venue', sha256: 'c'.repeat(64) } };
    const change = edit(cmd.groupId, 1, proposed), revised = await store.save(owner, change);
    expect(revised.record).toMatchObject({ action: 'edit', revision: 2, state: 'draft', fields: { ...proposed, firstClassAt: null } });
    await expect(store.save(owner, edit(cmd.groupId, 1))).rejects.toMatchObject({ code: 'CONFLICT' });
    const cancel = { version, action: 'cancel', operationId: randomUUID(), groupId: cmd.groupId, expectedRevision: 2 };
    const last = await store.save(owner, cancel);
    expect(last.record).toMatchObject({ action: 'cancel', revision: 3, state: 'cancelled', fields: proposed });
    expect((await store.save(owner, cancel)).replayed).toBe(true);
    expect(await makeStore(ws).read(owner, cmd.groupId, 1)).toEqual(initial.record);
    expect(await makeStore(ws).read(owner, cmd.groupId)).toEqual(last.record);
    expect(await makeStore(ws).save(owner, change)).toEqual({ replayed: true, record: revised.record });
    await expect(store.save(owner, edit(cmd.groupId, 3))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(store.read(owner, cmd.groupId, 4)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 3, operations: 3 });
  });

  it('defaults omitted proposals to null on create, retains omitted edit fields and allows an explicit clear', async () => {
    const { ws, owner, cmd, store } = await fixture();
    const sparse = { ...cmd, fields: { label: 'Partial', timeZone: 'America/New_York' } };
    expect((await store.save(owner, sparse)).record.fields).toEqual({ ...fields(), label: 'Partial' });
    const first = { ...edit(cmd.groupId, 1), fields: { proposedCapacity: 6, firstClassLocalDate: '2035-04-02' } };
    const second = { ...edit(cmd.groupId, 2), fields: { label: 'Updated' } };
    await store.save(owner, first);
    const labelOnly = (await store.save(owner, second)).record;
    expect(labelOnly.fields).toMatchObject({ label: 'Updated', proposedCapacity: 6, firstClassLocalDate: '2035-04-02', firstClassAt: null });
    await expect(store.save(owner, { ...second, fields: { ...second.fields, firstClassAt: null } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(store.save(owner, { ...edit(cmd.groupId, 3), fields: { firstClassAt: '2035-04-02T00:30:00Z' } }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const cleared = await store.save(owner, { ...edit(cmd.groupId, 3), fields: { proposedCapacity: null } });
    expect(cleared.record.fields).toMatchObject({ proposedCapacity: null, firstClassLocalDate: '2035-04-02' });
    expect((await store.read(owner, cmd.groupId, 3)).fields.proposedCapacity).toBe(6);
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 4, operations: 4 });
  });

  it('recovers a committed operation after losing its response and binds actor, group and payload', async () => {
    const { ws, owner, cmd, store } = await fixture();
    const losesResponse: IdentityStore = { async transaction(work) { await binder.transaction(work); throw Error('synthetic lost response'); } };
    await expect(makeStore(ws, syntheticAuthority, losesResponse).save(owner, cmd)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await store.save(owner, cmd)).toMatchObject({ replayed: true, record: { revision: 1, operationId: cmd.operationId } });
    for (const changed of [{ ...cmd, fields: { ...cmd.fields, proposedCapacity: 0 } }, { ...cmd, groupId: randomUUID() }]) {
      await expect(store.save(owner, changed)).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    // The real schema permits only one practitioner per workspace, including on a synthetic handover.
    await engine.query("UPDATE ls_identity.accounts SET role='adult_client' WHERE id=$1", [owner.id]);
    const successor = await actor(ws);
    await engine.query('UPDATE synthetic_group_preparation.owner_grant SET account_id=$2 WHERE workspace_id=$1', [ws, successor.id]);
    await expect(store.save(successor, cmd)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(store.save(owner, cmd)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 1, operations: 1 });
  });

  async function verifyCommittedCreate(ws: WorkspaceId, owner: Actor, cmd: ReturnType<typeof create>) {
    const reopened = makeStore(ws);
    const original = await reopened.read(owner, cmd.groupId);
    expect(original).toMatchObject({ revision: 1, operationId: cmd.operationId, fields: cmd.fields });
    expect(await reopened.save(owner, cmd)).toEqual({ replayed: true, record: original });
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 1, operations: 1 });
  }

  it.each(['CONFLICT', 'INVALID_REQUEST', 'FORBIDDEN', 'NOT_FOUND'] as const)(
    'keeps the save outcome uncertain when the driver reports %s after commit', async code => {
      const { ws, owner, cmd } = await fixture();
      const driver: IdentityStore = { async transaction(work) {
        await binder.transaction(work);
        throw new AppError(code);
      } };
      const outcome = await makeStore(ws, syntheticAuthority, driver).save(owner, cmd).catch((error: unknown) => error);
      await verifyCommittedCreate(ws, owner, cmd);
      expect(outcome).toBeInstanceOf(AppError);
      expect(outcome).toMatchObject({ code: 'UNAVAILABLE' });
    });

  it('retains the exact callback error for genuine authorization, revision and validation failures', async () => {
    const { ws, owner, cmd, store } = await fixture();
    await store.save(owner, { ...cmd, fields: { ...cmd.fields, firstClassLocalDate: '2035-04-03' } });
    let callbackFailure: unknown;
    const observing: IdentityStore = { transaction: work => binder.transaction(async tx => {
      try { return await work(tx); } catch (error) { callbackFailure = error; throw error; }
    }) };
    const checked = makeStore(ws, syntheticAuthority, observing);
    async function expectCallbackFailure(command: GroupPreparationCommand, code: ErrorCode) {
      callbackFailure = undefined;
      const outcome = await checked.save(owner, command).catch((error: unknown) => error);
      expect(callbackFailure).toBeInstanceOf(AppError);
      expect(callbackFailure).toMatchObject({ code });
      expect(outcome).toBe(callbackFailure);
    }
    await expectCallbackFailure(edit(cmd.groupId, 2), 'CONFLICT');
    await expectCallbackFailure(edit(cmd.groupId, 1, { firstClassAt: '2035-04-02T15:00:00Z' }), 'INVALID_REQUEST');
    await engine.query('DELETE FROM synthetic_group_preparation.owner_grant WHERE workspace_id=$1', [ws]);
    await expectCallbackFailure(edit(cmd.groupId, 1), 'FORBIDDEN');
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 1, operations: 1 });
  });

  it('treats a replacement driver error as uncertain even when its code matches a real rollback', async () => {
    const { ws, owner, cmd, store } = await fixture();
    await store.save(owner, cmd);
    const driver: IdentityStore = { async transaction(work) {
      try { return await binder.transaction(work); } catch (error) {
        if (error instanceof AppError) throw new AppError(error.code);
        throw error;
      }
    } };
    await expect(makeStore(ws, syntheticAuthority, driver).save(owner, edit(cmd.groupId, 2)))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 1, operations: 1 });
  });

  it('forgets a prior callback error when the driver invokes the callback again and commits', async () => {
    const { ws, owner, cmd } = await fixture();
    const authority = { isCurrentOwner: vi.fn(syntheticAuthority.isCurrentOwner).mockResolvedValueOnce(false) };
    const driver: IdentityStore = { async transaction(work) {
      // Only this fault-injection adapter reenters. Each invocation uses its own real transaction.
      const denied = await binder.transaction(work).catch((error: unknown) => error);
      expect(denied).toMatchObject({ code: 'FORBIDDEN' });
      await binder.transaction(work);
      throw denied;
    } };
    const outcome = await makeStore(ws, authority, driver).save(owner, cmd).catch((error: unknown) => error);
    await verifyCommittedCreate(ws, owner, cmd);
    expect(outcome).toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('requires the current owner port and genuine session independently of a claimed role or ID', async () => {
    const { ws, owner, cmd, store } = await fixture(); await store.save(owner, cmd);
    const parent = await actor(ws, 'parent'), other = await fixture();
    await engine.query('DELETE FROM synthetic_group_preparation.owner_grant WHERE workspace_id=$1', [ws]);
    for (const id of [cmd.groupId, randomUUID()]) {
      await expect(makeStore(ws, null).read(owner, id)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      await expect(store.read(owner, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(store.read({ ...parent, role: 'practitioner' }, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(store.read(other.owner, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(other.store.read(other.owner, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(makeStore(ws, null).save(owner, create())).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(store.save(owner, create())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.save(owner, { ...create(), isOwner: true })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [owner.sessionDigest, now]);
    await expect(store.read(owner, cmd.groupId)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('denies disabled and marked demo owners even with an approving permission port', async () => {
    const { ws, owner, cmd, store } = await fixture();
    await engine.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1", [owner.id]);
    await expect(store.save(owner, cmd)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await engine.query("UPDATE ls_identity.accounts SET state='active' WHERE id=$1", [owner.id]);
    await engine.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,'ls-owner-20350110',$2)", [ws, owner.id]);
    await engine.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,'ls-owner-20350110','test-only')", [ws, owner.id]);
    await expect(store.save(owner, cmd)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 0, versions: 0, operations: 0 });
  });

  it.each(['owner', 'session'] as const)('rolls back edits, history and the operation on terminal %s revocation', async mode => {
    const { ws, owner, cmd, store } = await fixture(); const initial = await store.save(owner, cmd);
    let checks = 0;
    const authority: GroupPreparationOwnerAuthority = { async isCurrentOwner(tx, scope) {
      const eligible = await syntheticAuthority.isCurrentOwner(tx, scope);
      if (++checks === 2) {
        if (mode === 'owner') return false;
        await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [owner.sessionDigest, now]);
      }
      return eligible;
    } };
    const change = edit(cmd.groupId, 1);
    await expect(makeStore(ws, authority).save(owner, change)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(checks).toBe(2); expect(await store.read(owner, cmd.groupId)).toEqual(initial.record);
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 1, versions: 1, operations: 1 });
    expect(await store.save(owner, change)).toMatchObject({ replayed: false, record: { revision: 2 } });
  });

  it('rechecks permission before returning an existing record, replay, or existence-sensitive error', async () => {
    const { ws, owner, cmd, store } = await fixture(); await store.save(owner, cmd);
    for (const path of ['read', 'replay', 'not-found', 'conflict']) {
      let checks = 0;
      const oneUse = makeStore(ws, { isCurrentOwner: async (tx, scope) =>
        await syntheticAuthority.isCurrentOwner(tx, scope) && ++checks === 1 });
      const result = path === 'read' ? oneUse.read(owner, cmd.groupId) : path === 'replay' ? oneUse.save(owner, cmd) :
        path === 'not-found' ? oneUse.read(owner, randomUUID()) : oneUse.save(owner, { ...cmd, fields: { ...cmd.fields, label: 'changed' } });
      await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(checks).toBe(2);
    }
  });

  it('rolls back the inserted journal when the PostgreSQL head write fails', async () => {
    const { ws, owner, cmd, store } = await fixture();
    // Deliberate fault in this in-memory database only.
    await engine.exec("ALTER TABLE ls_fishing_billing.group_preparation_heads ADD CONSTRAINT synthetic_head_failure CHECK (group_id <> '" + cmd.groupId + "'::uuid)");
    try { await expect(store.save(owner, cmd)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); }
    finally { await engine.exec('ALTER TABLE ls_fishing_billing.group_preparation_heads DROP CONSTRAINT synthetic_head_failure'); }
    expect(await counts(ws, cmd.groupId)).toEqual({ heads: 0, versions: 0, operations: 0 });
    expect((await store.save(owner, cmd)).replayed).toBe(false);
  });

  it('checks New York partial dates, offsets and half-open periods without supplying a missing time', async () => {
    const { owner, store, cmd } = await fixture();
    const period = { id: randomUUID(), timeZone: 'America/New_York' as const, startsAt: '2035-03-01T05:00:00Z', endsAt: '2035-04-01T04:00:00Z' };
    const good = { ...fields(), period, firstClassLocalDate: '2035-03-14', firstClassAt: '2035-03-15T00:30:00Z' };
    for (const values of [
      { ...good, firstClassLocalDate: '2035-03-15' }, { ...good, firstClassLocalDate: '2035-02-28', firstClassAt: null },
      { ...good, firstClassLocalDate: '2035-04-01', firstClassAt: null }, { ...good, firstClassAt: period.endsAt },
      { ...good, venueSource: { id: ' ', sha256: 'a'.repeat(64) } },
      ...[-1, 1.5, '8', Number.MAX_SAFE_INTEGER + 1, Infinity].map(proposedCapacity => ({ ...good, proposedCapacity })),
    ]) {
      await expect(store.save(owner, { ...cmd, fields: values })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    const saved = await store.save(owner, { ...cmd, fields: { ...good, firstClassAt: null } });
    expect(saved.record.fields.firstClassAt).toBeNull();
    const result = await store.save(owner, edit(cmd.groupId, 1, good));
    expect(result.record.fields).toEqual(good);
    expect(result.record.classification).toBe('preparation_only_not_authority');
  });

  it('prevents changing or deleting immutable versions and detects actual ciphertext swaps anywhere in history', async () => {
    const { ws, owner, cmd, store } = await fixture(); await store.save(owner, cmd);
    await store.save(owner, edit(cmd.groupId, 1));
    const cancel = { version, action: 'cancel', operationId: randomUUID(), groupId: cmd.groupId, expectedRevision: 2 };
    await store.save(owner, cancel);
    await expect(engine.query('UPDATE ls_fishing_billing.group_preparation_versions SET payload_ciphertext=payload_ciphertext WHERE workspace_id=$1', [ws]))
      .rejects.toThrow(/GROUP_PREPARATION_HISTORY_IMMUTABLE/);
    await expect(engine.query('DELETE FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1', [ws]))
      .rejects.toThrow(/GROUP_PREPARATION_HISTORY_IMMUTABLE/);
    // Simulate stored tampering as fixture administrator, including a valid ciphertext from a different revision.
    await engine.transaction(async tx => {
      await tx.exec('ALTER TABLE ls_fishing_billing.group_preparation_versions DISABLE TRIGGER immutable_group_preparation_version');
      await tx.query('UPDATE ls_fishing_billing.group_preparation_versions r SET payload_ciphertext=other.payload_ciphertext ' +
        'FROM ls_fishing_billing.group_preparation_versions other WHERE r.workspace_id=$1 AND r.group_id=$2 AND r.revision=1 ' +
        'AND other.workspace_id=r.workspace_id AND other.group_id=r.group_id AND other.revision=2', [ws, cmd.groupId]);
      await tx.exec('ALTER TABLE ls_fishing_billing.group_preparation_versions ENABLE TRIGGER immutable_group_preparation_version');
    });
    for (const read of [() => store.read(owner, cmd.groupId), () => store.save(owner, cmd), () => store.save(owner, cancel)]) {
      await expect(read()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
  });

  it('authenticates indexed metadata on both history and operation lookup and refuses a mismatched head', async () => {
    const { ws, owner, cmd, store } = await fixture(); await store.save(owner, cmd);
    const substitutions = {
      workspaceId: randomUUID(), groupId: randomUUID(), revision: 2, version: 'other', programKey: 'other', state: 'cancelled', action: 'edit',
      operationId: randomUUID(), createdBy: randomUUID(), createdAt: new Date(0), recordedBy: randomUUID(), recordedAt: new Date(0),
      requestDigest: '1'.repeat(64), recordDigest: '2'.repeat(64), previousRevision: 0, previousDigest: '3'.repeat(64),
    };
    for (const [name, value] of Object.entries(substitutions)) {
      // The wrapped driver returns a corrupt field on the actual SQL result from the in-memory test database.
      const db: IdentityStore = { transaction: work => binder.transaction(real => work({
        async query<T extends object>(sql: string, args?: readonly unknown[]): Promise<T[]> {
          const rows = await real.query<T>(sql, args);
          return sql.startsWith('SELECT workspace_id AS "workspaceId"') ? rows.map(r => ({ ...r, [name]: value })) : rows;
        },
      })) };
      const broken = makeStore(ws, syntheticAuthority, db);
      await expect(broken.read(owner, cmd.groupId)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      await expect(broken.save(owner, cmd)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
    const corruptHead: IdentityStore = { transaction: work => binder.transaction(real => work({
      async query<T extends object>(sql: string, args?: readonly unknown[]) {
        const rows = await real.query<T>(sql, args);
        return sql.startsWith('SELECT revision, record_digest AS digest') ? rows.map(r => ({ ...r, digest: 'f'.repeat(64) })) : rows;
      },
    })) };
    const broken = makeStore(ws, syntheticAuthority, corruptHead);
    await expect(broken.read(owner, cmd.groupId)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(broken.save(owner, cmd)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
