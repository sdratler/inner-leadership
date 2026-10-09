import "server-only";
import { asId } from "../../../lib/ids.ts";
import type { IdentityStore, SqlSession } from "../../identity/store.ts";
import type { Actor, IdentityClock } from "../../identity/types.ts";
import type { IdentityConfig } from "../../identity/config.ts";
import { seal, unseal } from "../../identity/crypto.ts";
import { loadCase } from "../../cases/data.ts";
import { caseAccess } from "../../cases/policy.ts";
import { authorize, lockOwner, commandDigest, replay, saveReceipt, audit, iso, type IndexGate } from "../../provider-index/server/shared.ts";
import { ProviderProblem, type WriteReceipt } from "../../provider-index/core.ts";
import { parseReferral, parseReferralCommand, type ReferralRecord } from "../core.ts";
type Stored = { id: string; providerId: string; caseId: string | null; ciphertext: string; version: number; createdAt: string | Date; updatedAt: string | Date; };
const select = `SELECT id,provider_id AS "providerId",case_id AS "caseId",payload_ciphertext AS ciphertext,version,created_at AS "createdAt",updated_at AS "updatedAt"
  FROM ls_provider_referrals.contexts WHERE workspace_id=$1 AND owner_account_id=$2`;
const aad = (a: Actor, id: string) => `r35/referral/v1/${a.workspaceId}/${a.id}/${id}`;
export class ProviderReferralStore {
  constructor(private readonly db: IdentityStore, private readonly config: IdentityConfig, private readonly gate: IndexGate, private readonly clock: IdentityClock) {}
  private async caseScope(tx: SqlSession, actor: Actor, caseId: string | null): Promise<void> {
    if (caseId) {
      // A case-specific log requires the existing practitioner/case ownership check.
      // No family record, name, clinical body or contact field is copied here.
      caseAccess(actor, await loadCase(tx, actor.workspaceId, asId(caseId, "case")), [], "write");
    }
  }
  private decode(actor: Actor, row: Stored): ReferralRecord {
    try { const detail = parseReferral(JSON.parse(unseal(row.ciphertext, aad(actor, row.id), this.config.keyring)));
      if (detail.caseId !== row.caseId || detail.providerId !== row.providerId) throw new Error();
      return { id: row.id, version: row.version, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), detail };
    } catch { throw new ProviderProblem("UNAVAILABLE", "RECORD_UNAVAILABLE"); }
  }
  async execute(actor: Actor, raw: unknown, requestId: string): Promise<ReferralRecord[] | WriteReceipt> {
    const c = parseReferralCommand(raw);
    return this.db.transaction(async tx => {
      await authorize(tx, actor, this.gate, this.clock);
      const caseId = c.action === "list" ? c.caseId : c.detail.caseId;
      await this.caseScope(tx, actor, caseId);
      if (c.action === "list") {
        // Null explicitly means GENERAL coordination only, never "all cases".
        const rows = await tx.query<Stored>(select + ` AND case_id IS NOT DISTINCT FROM $3::uuid
          AND ($4::uuid IS NULL OR provider_id=$4::uuid) ORDER BY created_at DESC,id LIMIT 501`, [actor.workspaceId, actor.id, caseId, c.providerId]);
        if (rows.length > 500) throw new ProviderProblem("UNAVAILABLE", "REFERRAL_VIEW_LIMIT");
        const records = rows.map(r => this.decode(actor, r));
        await audit(tx, actor, requestId, "referral_read", c.providerId); return records;
      }
      await lockOwner(tx, actor); await authorize(tx, actor, this.gate, this.clock);
      await this.caseScope(tx, actor, caseId);
      const kind = `referral_${c.action}`, digest = commandDigest(c, this.config), previous = await replay(tx, actor, c.operationId, kind, digest);
      if (previous) return previous;
      const providers = await tx.query<{ archived: boolean }>(`SELECT (archived_at IS NOT NULL) AS archived FROM ls_provider_index.entries
        WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3 FOR SHARE`, [actor.workspaceId, actor.id, c.detail.providerId]);
      if (providers.length !== 1) throw new ProviderProblem("NOT_FOUND");
      if (c.action === "create" && providers[0]!.archived) throw new ProviderProblem("CONFLICT", "PROVIDER_ARCHIVED");
      const encrypted = seal(JSON.stringify(c.detail), aad(actor, c.id), this.config.keyring);
      let rows: { version: number }[];
      if (c.action === "create") {
        const count = await tx.query<{ count: number }>(`SELECT count(*)::integer AS count FROM ls_provider_referrals.contexts
          WHERE workspace_id=$1 AND owner_account_id=$2 AND case_id IS NOT DISTINCT FROM $3::uuid`, [actor.workspaceId, actor.id, caseId]);
        if (!count[0] || count[0].count >= 500) throw new ProviderProblem("CONFLICT", "REFERRAL_VIEW_LIMIT");
        rows = await tx.query<{ version: number }>(`INSERT INTO ls_provider_referrals.contexts
          (workspace_id,id,owner_account_id,provider_id,case_id,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT (workspace_id,id) DO NOTHING RETURNING version`, [actor.workspaceId, c.id, actor.id, c.detail.providerId, caseId, encrypted]);
      } else {
        const current = await tx.query<Stored>(select + " AND id=$3 FOR UPDATE", [actor.workspaceId, actor.id, c.id]);
        if (current.length !== 1) throw new ProviderProblem("NOT_FOUND");
        if (current[0]!.caseId !== caseId || current[0]!.providerId !== c.detail.providerId) throw new ProviderProblem("CONFLICT", "REFERRAL_SCOPE_IMMUTABLE");
        if (current[0]!.version !== c.expectedVersion) throw new ProviderProblem("CONFLICT", "STALE_VERSION");
        rows = await tx.query<{ version: number }>(`UPDATE ls_provider_referrals.contexts SET payload_ciphertext=$4,version=version+1,updated_at=clock_timestamp()
          WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3 AND version=$5 RETURNING version`, [actor.workspaceId, actor.id, c.id, encrypted, c.expectedVersion]);
      }
      if (rows.length !== 1) throw new ProviderProblem("CONFLICT");
      const result: WriteReceipt = { id: c.id, version: rows[0]!.version, replayed: false };
      await saveReceipt(tx, actor, c.operationId, kind, digest, result); await audit(tx, actor, requestId, kind, c.id); return result;
    });
  }
}
