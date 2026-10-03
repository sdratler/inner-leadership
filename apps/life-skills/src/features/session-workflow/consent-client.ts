import { sessionCommand, sessionRead } from "./client.ts";
import { consentVersionSchema, consentSaveResultSchema, consentWithdrawalResultSchema, consentRecordReadback, type ConsentVersion, type ConsentRecordInput } from "./consent-contract.ts";
import type { CommandOutcome, CommandPort } from "../../ui/revamp/use-command.ts";
type Scope = { workspaceId: string; caseId: string; sessionId: string };
export async function readConsentVersion(scope: Scope, consentId: string, version: number, signal?: AbortSignal): Promise<ConsentVersion> {
  const raw = await sessionRead<unknown>(`/${scope.sessionId}/consent?` + new URLSearchParams({ consentId, version: String(version) }), signal), parsed = consentVersionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.workspaceId !== scope.workspaceId || parsed.data.caseId !== scope.caseId || parsed.data.sessionId !== scope.sessionId || parsed.data.consentId !== consentId || parsed.data.version !== version) throw new Error("UNAVAILABLE");
  return parsed.data;
}
/** Retain the exact command key/body in memory until protected readback confirms it.
 * A lost read after a committed write retries the read, not another consent version. */
function verifiedPort<I>(scope: Scope, mode: "record" | "withdraw"): CommandPort<I, ConsentVersion> {
  const command = sessionCommand<I, unknown>(`/${scope.sessionId}/consent${mode === "withdraw" ? "/withdraw" : ""}`), attempts = new Map<string, { input: I; receipt: unknown; committed: boolean }>();
  async function settle(key: string, result: CommandOutcome<unknown>): Promise<CommandOutcome<ConsentVersion>> {
    const attempt = attempts.get(key); if (!attempt) return { state: "rejected", message: "INVALID_REQUEST" };
    if (result.state === "rejected") { attempts.delete(key); return result; }
    if (result.state === "unknown") return result;
    attempt.receipt = result.value;
    attempt.committed = (mode === "record" ? consentSaveResultSchema : consentWithdrawalResultSchema).safeParse(result.value).success;
    try {
      const receipt = mode === "record" ? consentSaveResultSchema.parse(result.value) : consentWithdrawalResultSchema.parse(result.value);
      const saved = await readConsentVersion(scope, receipt.consentId, receipt.version);
      if (mode === "record") {
        if (!consentRecordReadback(saved, scope.sessionId, consentSaveResultSchema.parse(result.value), attempt.input as ConsentRecordInput)) throw new Error("UNAVAILABLE");
      } else if (saved.version !== (attempt.input as { expectedVersion: number }).expectedVersion + 1 || saved.withdrawnAt !== consentWithdrawalResultSchema.parse(result.value).withdrawnAt) throw new Error("UNAVAILABLE");
      attempts.delete(key); return { state: "accepted", value: saved };
    } catch { return { state: "unknown" }; }
  }
  return {
    async execute(input, key) {
      if (attempts.has(key)) return { state: "rejected", message: "CONFLICT" };
      const stable = structuredClone(input); attempts.set(key, { input: stable, receipt: null, committed: false });
      return settle(key, await command.execute(stable, key));
    },
    async reconcile(key) {
      const attempt = attempts.get(key); if (!attempt) return { state: "rejected", message: "INVALID_REQUEST" };
      // Explicit reconciliation only: an unidentifiable/lost write response is
      // re-read through the existing idempotent command with the identical body.
      return settle(key, attempt.committed ? { state: "accepted", value: attempt.receipt } : await command.execute(attempt.input, key));
    },
  };
}
export const consentRecordPort = (scope: Scope) => verifiedPort<ConsentRecordInput>(scope, "record");
export const consentWithdrawalPort = (scope: Scope) => verifiedPort<{ expectedVersion: number }>(scope, "withdraw");
