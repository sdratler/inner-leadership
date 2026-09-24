import { describe, expect, it } from "vitest";
import { matchesSubmittedInput, proposalForResult, replyFailureKind } from "../../../src/features/community-reply/input-state.ts";

describe("manual drafting limit feedback", () => {
  it("identifies only the API's confirmed manual limit", () => {
    expect(replyFailureKind(429, "RATE_LIMITED")).toBe("limited");
    expect(replyFailureKind(429, "UNAVAILABLE")).toBe("unconfirmed");
    expect(replyFailureKind(503, "RATE_LIMITED")).toBe("unconfirmed");
    expect(replyFailureKind(409, "CONFLICT")).toBe("unconfirmed");
  });
});

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

describe("reusable proposal display", () => {
  it("preserves a returned general scope for a revision", () => {
    expect(proposalForResult("revise_once", "Use a shorter opening.", "general")).toEqual({ rule: "Use a shorter opening.", scope: "general" });
  });
  it("clears an earlier proposal when a new reply is generated", () => {
    expect(proposalForResult("generate", "Old proposal", "general")).toEqual({ rule: "", scope: "community" });
  });
});
