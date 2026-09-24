export type CommunitySourceInput = { question: string; originalUrl: string };

/** A previous draft stays editable, but must not be copied or revised under changed source input. */
export function matchesSubmittedInput(current: CommunitySourceInput, submitted: CommunitySourceInput | null): boolean {
  return !!submitted && current.question.trim() === submitted.question && current.originalUrl.trim() === submitted.originalUrl;
}

/** A fresh generation never inherits a proposal from an earlier revision. */
export function proposalForResult(mode: "generate" | "revise_once", suggestedRule: string, scope: "" | "community" | "general") {
  return mode === "revise_once" ? { rule: suggestedRule, scope: scope === "general" ? "general" as const : "community" as const } : { rule: "", scope: "community" as const };
}
