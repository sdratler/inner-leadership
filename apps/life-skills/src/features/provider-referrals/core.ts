/** PRIVATE coordination only. Never embed these records in directory responses. */
import { dateOnly, object, requireValue, text, uuid, version, ProviderProblem } from "../provider-index/core.ts";
export const referralStates = ["considering", "discussed", "referred", "follow_up", "closed"] as const;
export type ReferralState = (typeof referralStates)[number];
export interface ReferralInput {
  providerId: string; caseId: string | null; happenedOn: string; status: ReferralState;
  context: string; nextAction: string; nextOn: string;
}
export interface ReferralRecord { id: string; version: number; createdAt: string; updatedAt: string; detail: ReferralInput; }
export function parseReferral(value: unknown): ReferralInput {
  const v = object(value, ["providerId", "caseId", "happenedOn", "status", "context", "nextAction", "nextOn"]);
  requireValue(referralStates.includes(v.status as ReferralState));
  return { providerId: uuid(v.providerId), caseId: v.caseId === null ? null : uuid(v.caseId), happenedOn: dateOnly(v.happenedOn),
    status: v.status as ReferralState, context: text(v.context, 1000), nextAction: text(v.nextAction, 500), nextOn: dateOnly(v.nextOn) };
}
export type ReferralCommand =
  | { action: "list"; caseId: string | null; providerId: string | null }
  | { action: "create"; operationId: string; id: string; detail: ReferralInput }
  | { action: "update"; operationId: string; id: string; expectedVersion: number; detail: ReferralInput };
export function parseReferralCommand(value: unknown): ReferralCommand {
  requireValue(value && typeof value === "object" && !Array.isArray(value)); const a = (value as Record<string, unknown>).action;
  if (a === "list") { const v = object(value, ["action", "caseId", "providerId"]);
    const caseId = v.caseId === null ? null : uuid(v.caseId), providerId = v.providerId === null ? null : uuid(v.providerId);
    requireValue(caseId || providerId, "SCOPE_REQUIRED"); return { action: a, caseId, providerId }; }
  if (a === "create" || a === "update") { const v = object(value, ["action", "operationId", "id", "detail", ...(a === "update" ? ["expectedVersion"] : [])]);
    const common = { operationId: uuid(v.operationId), id: uuid(v.id), detail: parseReferral(v.detail) };
    return a === "create" ? { action: a, ...common } : { action: a, ...common, expectedVersion: version(v.expectedVersion) }; }
  throw new ProviderProblem("INVALID_REQUEST", "UNKNOWN_ACTION");
}

