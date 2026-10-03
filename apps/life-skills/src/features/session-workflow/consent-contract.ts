import { z } from "zod";
import { validIso } from "./policy.ts";
import { wallTimeCandidates } from "../assignment-participants/wall-time.ts";
const uuid = z.string().uuid(), instant = z.string().refine(validIso), version = z.number().int().min(1).max(2147483647);
export const consentVersionSchema = z.strictObject({ workspaceId: uuid, caseId: uuid, sessionId: uuid, consentId: uuid, version, signedByAccountId: uuid, signedAt: instant, authorityState: z.enum(["checked", "needs_review", "restricted"]), recordingAllowed: z.boolean(), transcriptionAllowed: z.boolean(), aiProcessingAllowed: z.boolean(), childInformed: z.boolean(), policyVersion: z.string().min(1).max(100), evidence: z.string().min(1).max(4000), withdrawnAt: instant.nullable() });
export type ConsentVersion = z.infer<typeof consentVersionSchema>;
export interface ConsentRecordInput { signedByAccountId: string; signedAt: string; authorityState: ConsentVersion["authorityState"]; recordingAllowed: boolean; transcriptionAllowed: boolean; aiProcessingAllowed: boolean; childInformed: boolean; policyVersion: string; evidence: string; expectedVersion: number; }
export const consentSaveResultSchema = z.strictObject({ consentId: uuid, version, permissionToRecord: z.boolean() });
export const consentWithdrawalResultSchema = z.strictObject({ consentId: uuid, version, withdrawnAt: instant });
export type ConsentSaveResult = z.infer<typeof consentSaveResultSchema>;
export type ConsentWithdrawalResult = z.infer<typeof consentWithdrawalResultSchema>;
/** A user-entered signature time, not the time the practitioner happens to press Save. */
export function consentTimeCandidates(local: string, timezone: string): readonly string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d)?$/.test(local)) return [];
  try { return wallTimeCandidates(local.slice(0, 10), local.slice(11, 16), timezone).map(value => new Date(Date.parse(value) + Number(local.slice(17) || "0") * 1000).toISOString()); } catch { return []; }
}
export function consentRecordReadback(saved: ConsentVersion, sessionId: string, result: ConsentSaveResult, input: ConsentRecordInput): boolean {
  return validIso(input.signedAt) && Number.isInteger(input.expectedVersion) && input.expectedVersion >= 0 && input.expectedVersion <= 2147483647 && result.version === input.expectedVersion + 1 && saved.sessionId === sessionId && saved.consentId === result.consentId && saved.version === result.version && saved.signedByAccountId === input.signedByAccountId && saved.signedAt === new Date(input.signedAt).toISOString() && saved.authorityState === input.authorityState && saved.recordingAllowed === input.recordingAllowed && saved.transcriptionAllowed === input.transcriptionAllowed && saved.aiProcessingAllowed === input.aiProcessingAllowed && saved.childInformed === input.childInformed && saved.policyVersion === input.policyVersion && saved.evidence === input.evidence && saved.withdrawnAt === null;
}
