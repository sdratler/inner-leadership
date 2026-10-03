import { z } from "zod";

export const consentHistoryKinds = ["recording", "disclosure"] as const;
export type ConsentHistoryKind = (typeof consentHistoryKinds)[number];
export const consentHistoryCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,320}$/);
const date = z.iso.datetime({ offset: true });
const recording = z.strictObject({
  kind: z.literal("recording"), id: z.uuid(), version: z.number().int().positive(),
  signedByAccountId: z.uuid(), signedAt: date, withdrawnAt: date.nullable(),
  authorityState: z.enum(["checked", "needs_review", "restricted"]),
  recordingAllowed: z.boolean(), transcriptionAllowed: z.boolean(), aiProcessingAllowed: z.boolean(),
  childInformed: z.boolean(), policyVersion: z.string().min(1).max(100), isCurrent: z.boolean(),
});
const disclosure = z.strictObject({
  kind: z.literal("disclosure"), id: z.uuid(), sessionId: z.uuid().nullable(),
  channel: z.enum(["phone", "meeting", "secure_message"]), authorizedByAccountId: z.uuid(),
  recordedByPractitionerId: z.uuid(), childDiscussionRecorded: z.boolean(),
  authorizedAt: date, expiresAt: date, revokedAt: date.nullable(), usedAt: date.nullable(),
});
export const consentHistoryPageSchema = z.strictObject({
  caseId: z.uuid(), kind: z.enum(consentHistoryKinds), observedAt: date,
  items: z.array(z.discriminatedUnion("kind", [recording, disclosure])).max(50),
  nextCursor: consentHistoryCursorSchema.nullable(), hasMore: z.boolean(),
}).superRefine((page, ctx) => {
  if (page.items.some(item => item.kind !== page.kind) || page.hasMore !== (page.nextCursor !== null) ||
    new Set(page.items.map(item => item.kind === "recording" ? `${item.id}:${item.version}` : item.id)).size !== page.items.length)
    ctx.addIssue({ code: "custom", message: "History envelope does not match its scope" });
});
export type ConsentHistoryPage = z.infer<typeof consentHistoryPageSchema>;
export type ConsentHistoryItem = ConsentHistoryPage["items"][number];

export function formSubmissionReadback(assignment: { id: string; state: string; assignedAccountId: string; submissionId?: string | null; submissionAuthorAccountId?: string | null; submittedAt?: string | null }, assignmentId: string, submissionId: string): boolean {
  return assignment.id === assignmentId && ["submitted", "reviewed"].includes(assignment.state) &&
    assignment.submissionId === submissionId && assignment.submissionAuthorAccountId === assignment.assignedAccountId &&
    typeof assignment.submittedAt === "string" && Number.isFinite(Date.parse(assignment.submittedAt));
}

/** Derived labels describe recorded facts, not a new consent or provider proof. */
export function consentHistoryState(item: ConsentHistoryItem, observedAt: string):
  "withdrawn" | "superseded" | "checked" | "needs_review" | "restricted" | "revoked" | "expired" | "recorded_use" | "recorded_authorization" {
  if (item.kind === "recording") return item.withdrawnAt ? "withdrawn" : !item.isCurrent ? "superseded" : item.authorityState;
  return item.revokedAt ? "revoked" : Date.parse(item.expiresAt) <= Date.parse(observedAt) ? "expired" : item.usedAt ? "recorded_use" : "recorded_authorization";
}
