import { AppError } from "../../../lib/errors.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { requirePractitioner } from "../../cases/policy.ts";
import { freshActor } from "../../identity/data.ts";
import { unseal, seal, type Keyring } from "../../identity/crypto.ts";
import type { IdentityStore } from "../../identity/store.ts";
import type { Actor } from "../../identity/types.ts";
import { digestPreEnrollment, parsePreEnrollment, type PreEnrollmentInput } from "./schema.ts";

export type IntakeListItem = Readonly<{ receiptId: string; receivedAt: string; amendmentCount: number; consentVersion: string; consentHash: string }>;
export type IntakeHistoryEntry = Readonly<{ kind: "original" | "amendment"; entryId: string; createdAt: string; actorAccountId: string | null; input: PreEnrollmentInput; consent: { version: string; hash: string; sourceHashes: readonly string[]; displayText: readonly string[]; acknowledgements: readonly string[] } | null }>;
type OriginalEnvelope = { input: PreEnrollmentInput; consent: NonNullable<IntakeHistoryEntry["consent"]> };
type HistoryRow = { payload: string; entryId: string; lead: string; createdAt: Date; actorAccountId: string | null; kind: "original" | "amendment" };

/** Practitioner-only private read/edit path. The public response remains immutable;
 * staff edits append attributed records and may not impersonate the parent. */
export class PreEnrollmentStaffService {
  constructor(private readonly store: IdentityStore, private readonly ring: Keyring, private readonly now: () => Date = () => new Date()) {}

  async list(actor: Actor): Promise<readonly IntakeListItem[]> {
    return this.store.transaction(async tx => {
      const current = await freshActor(tx, actor, this.now()); requirePractitioner(current);
      const rows = await tx.query<{ receiptId: string; receivedAt: Date; amendmentCount: number; consentVersion: string; consentHash: string }>(
        `SELECT r.receipt_id AS "receiptId",r.received_at AS "receivedAt",count(a.amendment_id)::int AS "amendmentCount",r.consent_version AS "consentVersion",r.consent_hash AS "consentHash" FROM ls_intake.pre_enrollment_receipts r LEFT JOIN ls_intake.pre_enrollment_amendments a ON a.workspace_id=r.workspace_id AND a.receipt_id=r.receipt_id WHERE r.workspace_id=$1 GROUP BY r.receipt_id,r.received_at,r.consent_version,r.consent_hash ORDER BY r.received_at DESC,r.receipt_id DESC`, [current.workspaceId]);
      return rows.map(row => ({ ...row, receivedAt: new Date(row.receivedAt).toISOString() }));
    });
  }

  async history(actor: Actor, receiptId: string): Promise<readonly IntakeHistoryEntry[]> {
    return this.store.transaction(async tx => {
      const current = await freshActor(tx, actor, this.now()); requirePractitioner(current);
      const rows = await tx.query<HistoryRow>(
        `SELECT r.payload_ciphertext AS payload,r.receipt_id AS "entryId",i.stable_lead_ref AS lead,r.received_at AS "createdAt",NULL::uuid AS "actorAccountId",'original' AS kind FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE r.workspace_id=$1 AND r.receipt_id=$2 UNION ALL SELECT a.payload_ciphertext AS payload,a.amendment_id AS "entryId",i.stable_lead_ref AS lead,a.created_at AS "createdAt",a.actor_account_id AS "actorAccountId",'amendment' AS kind FROM ls_intake.pre_enrollment_amendments a JOIN ls_intake.pre_enrollment_receipts r ON r.workspace_id=a.workspace_id AND r.receipt_id=a.receipt_id JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE a.workspace_id=$1 AND a.receipt_id=$2 ORDER BY "createdAt",kind DESC,"entryId"`, [current.workspaceId, receiptId]);
      if (!rows.length) throw new AppError("NOT_FOUND");
      return rows.map(row => {
        const aad = row.kind === "original" ? `pre-enrollment:${current.workspaceId}:${row.lead}:${receiptId}:original` : `pre-enrollment:${current.workspaceId}:${row.lead}:${receiptId}:amendment:${row.entryId}`;
        const value = JSON.parse(unseal(row.payload, aad, this.ring)) as OriginalEnvelope | { input: PreEnrollmentInput };
        const input = parsePreEnrollment(value.input);
        return { kind: row.kind, entryId: row.entryId, createdAt: new Date(row.createdAt).toISOString(), actorAccountId: row.actorAccountId, input, consent: row.kind === "original" ? (value as OriginalEnvelope).consent : null };
      });
    });
  }

  async amend(actor: Actor, receiptId: string, input: unknown): Promise<void> {
    const value = parsePreEnrollment(input);
    await this.store.transaction(async tx => {
      const current = await freshActor(tx, actor, this.now()); requirePractitioner(current);
      const originals = await tx.query<{ lead: string; payload: string }>(`SELECT i.stable_lead_ref AS lead,r.payload_ciphertext AS payload FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE r.workspace_id=$1 AND r.receipt_id=$2`, [current.workspaceId, receiptId]);
      const original = originals[0]; if (!original) throw new AppError("NOT_FOUND");
      const accepted = JSON.parse(unseal(original.payload, `pre-enrollment:${current.workspaceId}:${original.lead}:${receiptId}:original`, this.ring)) as OriginalEnvelope;
      const baseline = parsePreEnrollment(accepted.input);
      const sameSlots = baseline.children.length === value.children.length && baseline.children.every((child, index) => child.childSlotId === value.children[index]?.childSlotId);
      const sameParentEvidence = baseline.signerName === value.signerName && baseline.consentVersion === value.consentVersion && baseline.consentHash === value.consentHash && JSON.stringify(baseline.consentAcknowledgements) === JSON.stringify(value.consentAcknowledgements);
      if (!sameSlots || !sameParentEvidence) throw new AppError("INVALID_REQUEST");
      const amendmentId = randomUUID(), createdAt = this.now();
      await tx.query(`INSERT INTO ls_intake.pre_enrollment_amendments(workspace_id,amendment_id,receipt_id,actor_account_id,payload_ciphertext,payload_digest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [current.workspaceId, amendmentId, receiptId, current.id, seal(JSON.stringify({ input: value }), `pre-enrollment:${current.workspaceId}:${original.lead}:${receiptId}:amendment:${amendmentId}`, this.ring), digestPreEnrollment(value), createdAt]);
    });
  }

  async issue(actor: Actor, stableLeadRef: string, childCount: number): Promise<{ token: string; expiresAt: string }> {
    if (!/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(stableLeadRef) || !Number.isInteger(childCount) || childCount < 1 || childCount > 8) throw new AppError("INVALID_REQUEST");
    const token = randomBytes(32).toString("base64url"), tokenDigest = createHash("sha256").update(token).digest("hex"), now = this.now(), expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), slots = Array.from({ length: childCount }, () => randomUUID());
    await this.store.transaction(async tx => { const current = await freshActor(tx, actor, now); requirePractitioner(current); await tx.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`, [current.workspaceId, randomUUID(), tokenDigest, stableLeadRef, JSON.stringify(slots), expiresAt, now, current.id]); });
    return { token, expiresAt: expiresAt.toISOString() };
  }
}
