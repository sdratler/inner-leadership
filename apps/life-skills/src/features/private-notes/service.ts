import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import type { CaseId } from "../../lib/ids.ts";
import { loadCase, loadGuardians } from "../cases/data.ts";
import { caseAccess, requirePractitioner } from "../cases/policy.ts";
import { seal, unseal } from "../identity/crypto.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { IdentityConfig } from "../identity/config.ts";
import type { Actor, IdentityClock } from "../identity/types.ts";
import type { IdentityStore } from "../identity/store.ts";
import { one } from "../identity/store.ts";

const aad = (workspaceId: string, caseId: string) => `practitioner-private-note:${workspaceId}:${caseId}`;
const digest = (body: string, expectedRevision: number) => createHash("sha256").update(`${expectedRevision}\n${body}`, "utf8").digest("hex");
type NoteRow = { caseId: CaseId; bodyCiphertext: string; revision: number; updatedAt: Date; updatedByAccountId: Actor["id"] };

export class PrivateNotesService {
  constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig, private readonly clock: IdentityClock) {}

  async read(actor: Actor, caseId: CaseId) {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      requirePractitioner(current);
      const item = await loadCase(tx, actor.workspaceId, caseId);
      caseAccess(current, item, await loadGuardians(tx, actor.workspaceId, caseId), "write");
      const row = await one<NoteRow>(tx, `SELECT case_id AS "caseId",body_ciphertext AS "bodyCiphertext",revision,updated_at AS "updatedAt",updated_by_account_id AS "updatedByAccountId" FROM ls_private_notes.case_notes WHERE workspace_id=$1 AND case_id=$2`, [actor.workspaceId, caseId]);
      return row ? { caseId, body: unseal(row.bodyCiphertext, aad(actor.workspaceId, caseId), this.config.keyring), revision: row.revision, updatedAt: new Date(row.updatedAt).toISOString() } : { caseId, body: "", revision: 0, updatedAt: null };
    });
  }

  async save(actor: Actor, input: { caseId: CaseId; body: string; expectedRevision: number; idempotencyKey: string }, requestId: string) {
    const body = input.body.trim();
    if (!body || body.length > 8_000 || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new AppError("INVALID_REQUEST");
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, this.clock.now());
      requirePractitioner(current);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, await loadGuardians(tx, actor.workspaceId, input.caseId), "write");
      const receipt = await one<{ revision: number; caseId: CaseId; bodyDigest: string; expectedRevision: number; actorAccountId: Actor["id"] }>(tx, `SELECT revision,case_id AS "caseId",body_digest AS "bodyDigest",expected_revision AS "expectedRevision",actor_account_id AS "actorAccountId" FROM ls_private_notes.save_receipts WHERE workspace_id=$1 AND idempotency_key=$2`, [actor.workspaceId, input.idempotencyKey]);
      if (receipt) { if (receipt.caseId !== input.caseId || receipt.bodyDigest !== digest(body, input.expectedRevision) || receipt.expectedRevision !== input.expectedRevision || receipt.actorAccountId !== actor.id) throw new AppError("CONFLICT"); return { caseId: input.caseId, revision: receipt.revision, idempotent: true }; }
      const existing = await one<NoteRow>(tx, `SELECT case_id AS "caseId",body_ciphertext AS "bodyCiphertext",revision,updated_at AS "updatedAt",updated_by_account_id AS "updatedByAccountId" FROM ls_private_notes.case_notes WHERE workspace_id=$1 AND case_id=$2 FOR UPDATE`, [actor.workspaceId, input.caseId]);
      const currentRevision = existing?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) throw new AppError("CONFLICT");
      const revision = currentRevision + 1;
      const now = this.clock.now();
      const ciphertext = seal(body, aad(actor.workspaceId, input.caseId), this.config.keyring);
      await tx.query(`INSERT INTO ls_private_notes.case_notes (workspace_id,case_id,body_ciphertext,revision,updated_by_account_id,updated_at) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (workspace_id,case_id) DO UPDATE SET body_ciphertext=EXCLUDED.body_ciphertext,revision=EXCLUDED.revision,updated_by_account_id=EXCLUDED.updated_by_account_id,updated_at=EXCLUDED.updated_at`, [actor.workspaceId, input.caseId, ciphertext, revision, actor.id, now]);
      await tx.query(`INSERT INTO ls_private_notes.save_receipts (workspace_id,idempotency_key,case_id,revision,created_at,body_digest,expected_revision,actor_account_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [actor.workspaceId, input.idempotencyKey, input.caseId, revision, now, digest(body, input.expectedRevision), input.expectedRevision, actor.id]);
      await tx.query(`INSERT INTO ls_identity.action_history (id,workspace_id,actor_account_id,request_id,action,occurred_at) VALUES ($1,$2,$3,$4,'practitioner_private_note_saved',$5)`, [randomUUID(), actor.workspaceId, actor.id, requestId, now]);
      return { caseId: input.caseId, revision, idempotent: false };
    });
  }
}
