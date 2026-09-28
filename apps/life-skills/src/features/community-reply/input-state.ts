export type CommunitySourceInput = { question: string; originalUrl: string };

/** Only the authenticated API's explicit limit response warrants a limit-specific message. */
export function replyFailureKind(status: number, code?: string): "limited" | "unconfirmed" {
  return status === 429 && code === "RATE_LIMITED" ? "limited" : "unconfirmed";
}

/** A previous draft stays editable, but must not be copied or revised under changed source input. */
export function matchesSubmittedInput(current: CommunitySourceInput, submitted: CommunitySourceInput | null): boolean {
  return !!submitted && current.question.trim() === submitted.question && current.originalUrl.trim() === submitted.originalUrl;
}

/** Restoring a correction must not silently replace another question, edit or generated reply. */
export function ruleDraftPromotionNeedsConfirmation(current: CommunitySourceInput, restored: CommunitySourceInput, editedDraft = false,
  activeOperationId?: string, restoredOperationId?: string): boolean {
  return editedDraft || (!!activeOperationId && activeOperationId !== restoredOperationId) ||
    ((current.question.trim().length > 0 || current.originalUrl.trim().length > 0) &&
    !matchesSubmittedInput(current, restored));
}

/** Validation-only results have no stored command to resume. Conflicts need fresh source review. */
export function canResumeRuleOperation(status: string): boolean {
  return ["pending", "permission_denied", "unknown", "saved", "draft_pending"].includes(status);
}

/** A fresh generation never inherits a proposal from an earlier revision. */
export function proposalForResult(mode: "generate" | "revise_once", suggestedRule: string, scope: "" | "community" | "general") {
  return mode === "revise_once" ? { rule: suggestedRule, scope: scope === "general" ? "general" as const : "community" as const } : { rule: "", scope: "community" as const };
}
