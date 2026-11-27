import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import { asId } from '../../lib/ids.ts';
import { issueAuthToken } from '../identity/auth-mail.ts';
import type { IdentityConfig } from '../identity/config.ts';
import { blindEmail, canonicalEmail, seal } from '../identity/crypto.ts';
import { accountById, lockWorkspace, type AccountRow } from '../identity/data.ts';
import { recordAction } from '../identity/history.ts';
import { one, type IdentityStore } from '../identity/store.ts';
import type { AccountId, IdentityClock } from '../identity/types.ts';

export const INDIVIDUAL_TRIP_REGISTRATION_VERSION = 'fishing-adult-registration-v1';
export const individualTripRegistrationSchema = z.object({
  operationId: z.uuid(), email: z.string().trim().toLowerCase().max(254).email(),
  displayName: z.string().trim().min(1).max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  locale: z.enum(['en', 'he']), adultConfirmed: z.literal(true),
}).strict();
export type IndividualTripRegistrationInput = z.infer<typeof individualTripRegistrationSchema>;

/** Identity activation only. This service grants no Fishing membership, household,
 * case, family or audience. HTTP supplies existing preauth CSRF and rate limits.
 * After invitation activation the adult must use ordinary fresh login and the
 * separate, authenticated explicit Fishing enrollment operation. */
export class IndividualTripRegistrationService {
  constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig,
    private readonly clock: IdentityClock) {}

  async register(raw: IndividualTripRegistrationInput, requestId: string): Promise<{ accepted: true }> {
    const parsed = individualTripRegistrationSchema.safeParse(raw);
    if (!parsed.success || !z.uuid().safeParse(requestId).success) throw new AppError('INVALID_REQUEST');
    if (!this.config.enabled) throw new AppError('UNAVAILABLE');
    const input = parsed.data, email = canonicalEmail(input.email), now = this.clock.now();
    const digest = createHmac('sha256', this.config.lookupKey).update(JSON.stringify([
      INDIVIDUAL_TRIP_REGISTRATION_VERSION, this.config.workspaceId, email,
      input.displayName, input.locale, input.adultConfirmed,
    ])).digest('hex');
    await this.store.transaction(async tx => {
      await lockWorkspace(tx, this.config.workspaceId);
      const replay = await one<{ digest: string }>(tx, `SELECT request_digest AS digest
        FROM ls_individual_trips.registration_receipts WHERE workspace_id=$1 AND operation_id=$2 FOR UPDATE`,
      [this.config.workspaceId, input.operationId]);
      if (replay) {
        if (replay.digest !== digest) throw new AppError('CONFLICT');
        return;
      }
      // Check the account table itself, including any incomplete subject mapping.
      // Existing identities are unchanged except for explicitly requested
      // recovery of an expired invitation created by this exact signup flow.
      const existing = await one<{ id: AccountId }>(tx, 'SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND email_blind=$2',
        [this.config.workspaceId, blindEmail(email, this.config.lookupKey)]);
      let accountId: string | null = null, outboxId: string | null = null;
      let invitedAccount: AccountRow | null = null;
      if (!existing) {
        const id = asId(randomUUID(), 'account'), personId = asId(randomUUID(), 'person');
        accountId = id;
        await tx.query(`INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at)
          VALUES($1,$2,'adult',$3,$4)`, [personId, this.config.workspaceId,
          seal(JSON.stringify({ displayName: input.displayName }), `person:${this.config.workspaceId}:${personId}`, this.config.keyring), now]);
        await tx.query(`INSERT INTO ls_identity.accounts
          (id,workspace_id,role,state,locale,email_blind,email_ciphertext,created_at,updated_at)
          VALUES($1,$2,'parent','invited',$3,$4,$5,$6,$6)`, [id, this.config.workspaceId, input.locale,
          blindEmail(email, this.config.lookupKey), seal(email, `email:${this.config.workspaceId}:${id}`, this.config.keyring), now]);
        await tx.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',
          [this.config.workspaceId, id, personId]);
        invitedAccount = await accountById(tx, this.config.workspaceId, id);
        if (!invitedAccount) throw new AppError('INTERNAL');
      } else {
        // Original creation proof is distinct from current expiry eligibility:
        // older program tokens may have been revoked by an earlier safe renewal.
        // A used/revoked token at or after the eligible token is an authority
        // boundary; this route must never undo owner revocation or token use.
        const renewable = await one<{ id: AccountId }>(tx, `SELECT a.id
          FROM ls_identity.accounts a
          JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
          JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id AND p.kind='adult'
          WHERE a.workspace_id=$1 AND a.id=$2 AND a.role='parent' AND a.state='invited'
          AND EXISTS (
            SELECT 1 FROM ls_individual_trips.registration_receipts r
            JOIN ls_identity.auth_mail_outbox m ON m.workspace_id=r.workspace_id AND m.id=r.outbox_id
              AND m.account_id=r.account_id AND m.kind='invite'
            JOIN ls_identity.auth_tokens t ON t.workspace_id=m.workspace_id AND t.account_id=m.account_id
              AND t.token_digest=m.token_digest AND t.purpose='invite'
            WHERE r.workspace_id=a.workspace_id AND r.account_id=a.id AND r.version=$3
              AND r.created_at=a.created_at AND m.created_at=a.created_at AND t.created_at=a.created_at
          )
          AND EXISTS (
            SELECT 1 FROM ls_individual_trips.registration_receipts r
            JOIN ls_identity.auth_mail_outbox m ON m.workspace_id=r.workspace_id AND m.id=r.outbox_id
              AND m.account_id=r.account_id AND m.kind='invite'
            JOIN ls_identity.auth_tokens t ON t.workspace_id=m.workspace_id AND t.account_id=m.account_id
              AND t.token_digest=m.token_digest AND t.purpose='invite'
            WHERE r.workspace_id=a.workspace_id AND r.account_id=a.id AND r.version=$3
              AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at<=GREATEST($4::timestamptz,clock_timestamp())
              AND NOT EXISTS (
                SELECT 1 FROM ls_identity.auth_tokens blocked
                WHERE blocked.workspace_id=a.workspace_id AND blocked.account_id=a.id AND blocked.purpose='invite'
                  AND (blocked.used_at IS NOT NULL OR blocked.revoked_at IS NOT NULL) AND blocked.created_at>=t.created_at
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM ls_identity.auth_tokens live
            WHERE live.workspace_id=a.workspace_id AND live.account_id=a.id AND live.purpose='invite'
              AND live.used_at IS NULL AND live.revoked_at IS NULL AND live.expires_at>GREATEST($4::timestamptz,clock_timestamp())
          )`, [this.config.workspaceId, existing.id, INDIVIDUAL_TRIP_REGISTRATION_VERSION, now]);
        if (renewable) {
          invitedAccount = await accountById(tx, this.config.workspaceId, renewable.id);
          if (!invitedAccount) throw new AppError('INTERNAL');
          accountId = invitedAccount.id;
        }
      }
      if (invitedAccount) {
        await issueAuthToken(tx, this.config, invitedAccount, { requestId, now }, 'invite');
        // Both creation and admitted expiry recovery run under the same lock.
        // issueAuthToken cancels older queued invites, leaving exactly the one
        // newly issued item for this account and this accepted request.
        const queued = await one<{ id: string }>(tx, `SELECT id FROM ls_identity.auth_mail_outbox
          WHERE workspace_id=$1 AND account_id=$2 AND kind='invite' AND state='queued' AND created_at=$3 FOR UPDATE`,
        [this.config.workspaceId, invitedAccount.id, now]);
        if (!queued) throw new AppError('INTERNAL');
        outboxId = queued.id;
        await recordAction(tx, { requestId, now }, this.config.workspaceId, null, 'invite_queued');
      }
      await tx.query(`INSERT INTO ls_individual_trips.registration_receipts
        (workspace_id,operation_id,request_id,request_digest,version,account_id,outbox_id,delivery_state,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [this.config.workspaceId, input.operationId, requestId,
        digest, INDIVIDUAL_TRIP_REGISTRATION_VERSION, accountId, outboxId, outboxId ? 'queued' : 'suppressed', now]);
    });
    // Identical new/existing/replay response. No public principal or mail handle.
    return { accepted: true };
  }
}
