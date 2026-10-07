import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { freshActor } from "../../identity/data.ts";
import { requirePractitioner } from "../../cases/policy.ts";
import type { Actor, IdentityClock } from "../../identity/types.ts";
import type { SqlSession } from "../../identity/store.ts";
import type { IdentityConfig } from "../../identity/config.ts";
import { ProviderProblem, uuid, type WriteReceipt } from "../core.ts";
export interface IndexGate { enabled: boolean; ownerAccountId: string; workspaceId: string; }
export function indexGate(env: Record<string, string | undefined>, config: IdentityConfig): IndexGate {
  return { enabled: env.LS_PROVIDER_INDEX_ENABLED === "true", ownerAccountId: env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID ?? "", workspaceId: config.workspaceId };
}
export function assertGate(actor: Actor, gate: IndexGate): void {
  if (!gate.enabled || actor.workspaceId !== gate.workspaceId || actor.id !== gate.ownerAccountId) throw new ProviderProblem("NOT_FOUND");
  requirePractitioner(actor);
}
export async function authorize(tx: SqlSession, actor: Actor, gate: IndexGate, clock: IdentityClock): Promise<void> {
  assertGate(actor, gate);
  const current = await freshActor(tx, actor, clock.now());
  requirePractitioner(current);
  if (current.id !== gate.ownerAccountId || current.workspaceId !== gate.workspaceId) throw new ProviderProblem("NOT_FOUND");
}
export async function lockOwner(tx: SqlSession, actor: Actor): Promise<void> {
  // Single small owner namespace serializes mutations, duplicates and quota checks.
  // This lock does not change CRM's writer, epoch or cutover state.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`r35:${actor.workspaceId}:${actor.id}`]);
}
export function commandDigest(value: unknown, config: IdentityConfig): string {
  return createHmac("sha256", config.lookupKey).update("ls-private-provider-index/command/v1\0").update(JSON.stringify(value)).digest("hex");
}
export interface ReceiptRow { digest: string; kind: string; id: string; version: number; }
export async function replay(tx: SqlSession, actor: Actor, operationId: string, kind: string, digest: string): Promise<WriteReceipt | null> {
  const rows = await tx.query<ReceiptRow>(`SELECT payload_digest AS digest,kind,result_id AS id,result_version AS version
    FROM ls_provider_index.command_receipts WHERE workspace_id=$1 AND owner_account_id=$2 AND operation_id=$3`, [actor.workspaceId, actor.id, operationId]);
  if (rows.length > 1) throw new ProviderProblem("UNAVAILABLE");
  const previous = rows[0]; if (!previous) return null;
  if (previous.kind !== kind || previous.digest !== digest) throw new ProviderProblem("CONFLICT", "OPERATION_REUSED");
  return { id: previous.id, version: previous.version, replayed: true };
}
export async function saveReceipt(tx: SqlSession, actor: Actor, operationId: string, kind: string, digest: string, result: WriteReceipt): Promise<void> {
  await tx.query(`INSERT INTO ls_provider_index.command_receipts
    (workspace_id,owner_account_id,operation_id,kind,payload_digest,result_id,result_version)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [actor.workspaceId, actor.id, operationId, kind, digest, result.id, result.version]);
}
export async function audit(tx: SqlSession, actor: Actor, requestId: string, action: string, subjectId: string | null): Promise<void> {
  // Feature access evidence without extending the frozen identity/audit vocabulary.
  // No names, source URLs, search strings, notes, tokens or case bodies are logged.
  await tx.query(`INSERT INTO ls_provider_index.access_events
    (id,workspace_id,owner_account_id,request_id,action,subject_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), actor.workspaceId, actor.id, uuid(requestId), action, subjectId]);
}
export function iso(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) throw new ProviderProblem("UNAVAILABLE");
  return d.toISOString();
}

