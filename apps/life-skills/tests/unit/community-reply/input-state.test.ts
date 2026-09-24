import { describe, expect, it } from "vitest";
import { matchesSubmittedInput } from "../../../src/features/community-reply/input-state.ts";

describe("manual reply source binding", () => {
  const submitted = { question: "מה יכול לעזור בבוקר?", originalUrl: "https://www.facebook.com/groups/synthetic/posts/42" };
  it("permits copy only while the question and original post remain the submitted inputs", () => {
    expect(matchesSubmittedInput(submitted, submitted)).toBe(true);
    expect(matchesSubmittedInput({ ...submitted, question: "שאלה אחרת" }, submitted)).toBe(false);
    expect(matchesSubmittedInput({ ...submitted, originalUrl: "https://www.facebook.com/groups/synthetic/posts/43" }, submitted)).toBe(false);
  });
  it("never treats a missing submitted input as a current draft", () => {
    expect(matchesSubmittedInput(submitted, null)).toBe(false);
  });
});
