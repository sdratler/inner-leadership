export type CommunitySourceInput = { question: string; originalUrl: string };

/** A previous draft stays editable, but must not be copied or revised under changed source input. */
export function matchesSubmittedInput(current: CommunitySourceInput, submitted: CommunitySourceInput | null): boolean {
  return !!submitted && current.question.trim() === submitted.question && current.originalUrl.trim() === submitted.originalUrl;
}
