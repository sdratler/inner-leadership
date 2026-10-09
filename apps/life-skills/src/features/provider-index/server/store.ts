import "server-only";
import type { IdentityStore, SqlSession } from "../../identity/store.ts";
import type { IdentityConfig } from "../../identity/config.ts";
import type { Actor, IdentityClock } from "../../identity/types.ts";
import { seal, unseal } from "../../identity/crypto.ts";
import { ProviderProblem, practiceDate, parseProvider, parseProviderCommand, possibleDuplicates, selectProviders,
  type ProviderRecord, type ProviderPage, type WriteReceipt } from "../core.ts";
import { authorize, lockOwner, commandDigest, replay, saveReceipt, audit, iso, type IndexGate } from "./shared.ts";
export const MAX_PROVIDER_ENTRIES = 1000;
type Stored = { id: string; version: number; archived: boolean; createdAt: Date | string; updatedAt: Date | string; ciphertext: string; };
const select = `SELECT id,version,(archived_at IS NOT NULL) AS archived,created_at AS "createdAt",updated_at AS "updatedAt",payload_ciphertext AS ciphertext
  FROM ls_provider_index.entries WHERE workspace_id=$1 AND owner_account_id=$2`;
const aad = (a: Actor, id: string) => `r35/provider/v1/${a.workspaceId}/${a.id}/${id}`;
export class ProviderIndexStore {
  constructor(private readonly db: IdentityStore, private readonly config: IdentityConfig, private readonly gate: IndexGate, private readonly clock: IdentityClock) {}
  private decode(a: Actor, row: Stored): ProviderRecord {
    try { return { id: row.id, version: row.version, archived: row.archived, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
      entry: parseProvider(JSON.parse(unseal(row.ciphertext, aad(a, row.id), this.config.keyring))) }; }
    catch { throw new ProviderProblem("UNAVAILABLE", "RECORD_UNAVAILABLE"); }
  }
  private async all(tx: SqlSession, actor: Actor): Promise<ProviderRecord[]> {
    const rows = await tx.query<Stored>(select + " ORDER BY id LIMIT $3", [actor.workspaceId, actor.id, MAX_PROVIDER_ENTRIES + 1]);
    if (rows.length > MAX_PROVIDER_ENTRIES) throw new ProviderProblem("UNAVAILABLE", "DIRECTORY_LIMIT");
    return rows.map(r => this.decode(actor, r));
  }
  async execute(actor: Actor, raw: unknown, requestId: string): Promise<ProviderPage | ProviderRecord | WriteReceipt> {
    const c = parseProviderCommand(raw);
    return this.db.transaction(async tx => {
      await authorize(tx, actor, this.gate, this.clock);
      if (c.action === "search") {
        const result = selectProviders(await this.all(tx, actor), c.query);
        await audit(tx, actor, requestId, "directory_read", null); return result;
      }
      if (c.action === "read") {
        const rows = await tx.query<Stored>(select + " AND id=$3", [actor.workspaceId, actor.id, c.id]);
        if (rows.length !== 1) throw new ProviderProblem("NOT_FOUND");
        const result = this.decode(actor, rows[0]!); await audit(tx, actor, requestId, "provider_read", c.id); return result;
      }
      await lockOwner(tx, actor);
      // Recheck after waiting for the lock; revoked/expired sessions fail before writes.
      await authorize(tx, actor, this.gate, this.clock);
      const kind = `provider_${c.action}`, digest = commandDigest(c, this.config);
      const previous = await replay(tx, actor, c.operationId, kind, digest);
      if (previous) return previous;
      if (c.action !== "archive" && c.entry.verification.checkedOn > practiceDate(this.clock.now())) throw new ProviderProblem("INVALID_REQUEST", "FUTURE_VERIFICATION");
      let writtenVersion: number;
      if (c.action === "create") {
        const rows = await this.all(tx, actor);
        if (rows.length >= MAX_PROVIDER_ENTRIES) throw new ProviderProblem("CONFLICT", "DIRECTORY_LIMIT");
        if (rows.some(r => r.id === c.id)) throw new ProviderProblem("CONFLICT", "RECORD_EXISTS");
        if (!c.allowDuplicate && possibleDuplicates(rows, c.entry).length) throw new ProviderProblem("CONFLICT", "POSSIBLE_DUPLICATE");
        const inserted = await tx.query<{ version: number }>(`INSERT INTO ls_provider_index.entries
          (workspace_id,id,owner_account_id,payload_ciphertext) VALUES($1,$2,$3,$4) RETURNING version`,
          [actor.workspaceId, c.id, actor.id, seal(JSON.stringify(c.entry), aad(actor, c.id), this.config.keyring)]);
        if (inserted.length !== 1) throw new ProviderProblem("UNAVAILABLE"); writtenVersion = inserted[0]!.version;
      } else {
        const rows = await tx.query<Stored>(select + " AND id=$3 FOR UPDATE", [actor.workspaceId, actor.id, c.id]);
        if (rows.length !== 1) throw new ProviderProblem("NOT_FOUND"); const current = rows[0]!;
        if (current.version !== c.expectedVersion) throw new ProviderProblem("CONFLICT", "STALE_VERSION");
        if (c.action === "update") {
          if (!c.allowDuplicate && possibleDuplicates(await this.all(tx, actor), c.entry, c.id).length) throw new ProviderProblem("CONFLICT", "POSSIBLE_DUPLICATE");
          const updated = await tx.query<{ version: number }>(`UPDATE ls_provider_index.entries SET payload_ciphertext=$4,version=version+1,updated_at=clock_timestamp()
            WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3 AND version=$5 RETURNING version`,
            [actor.workspaceId, actor.id, c.id, seal(JSON.stringify(c.entry), aad(actor, c.id), this.config.keyring), c.expectedVersion]);
          if (updated.length !== 1) throw new ProviderProblem("CONFLICT", "STALE_VERSION"); writtenVersion = updated[0]!.version;
        } else {
          const updated = await tx.query<{ version: number }>(`UPDATE ls_provider_index.entries SET archived_at=CASE WHEN $4::boolean THEN clock_timestamp() ELSE NULL END,
            version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3 AND version=$5 RETURNING version`,
            [actor.workspaceId, actor.id, c.id, c.archived, c.expectedVersion]);
          if (updated.length !== 1) throw new ProviderProblem("CONFLICT", "STALE_VERSION"); writtenVersion = updated[0]!.version;
        }
      }
      const result: WriteReceipt = { id: c.id, version: writtenVersion, replayed: false };
      await saveReceipt(tx, actor, c.operationId, kind, digest, result);
      await audit(tx, actor, requestId, kind, c.id); return result;
    });
  }
}
