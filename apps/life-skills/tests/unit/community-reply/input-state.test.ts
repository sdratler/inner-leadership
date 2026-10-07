import { describe, expect, it } from "vitest";
import { canResumeRuleOperation, matchesSubmittedInput, proposalForResult, replyFailureKind, ruleDraftPromotionNeedsConfirmation, writingRuleDisplayText } from "../../../src/features/community-reply/input-state.ts";

describe("saved writing-rule display", () => {
  it.each(["community", "general"])("shows the concise %s preference without ledger metadata", scope => {
    for (const [language, rule] of [["en", "Use everyday words and keep each paragraph easy to read."], ["he", "לכתוב במילים יומיומיות ובפסקאות קצרות."], ["both", "Keep wording direct."]]) {
      const recorded = `**CR-12345678123441238123123456789abc — scope: ${scope}; language: ${language}; created: 2026-10-05T11:00:00.000Z; updated: 2026-10-05T11:01:00.000Z** ${rule}`;
      expect(writingRuleDisplayText(recorded)).toBe(rule);
      expect(recorded).toContain("created: 2026-10-05T11:00:00.000Z");
    }
  });
  it("preserves plain rules and unrecognized or multiline evidence rather than guessing", () => {
    for (const recorded of ["Use direct words.", "**Unknown** Keep this text.",
      "**CR-12345678123441238123123456789abc — scope: general; language: en; created: unknown; updated: unknown** Keep this text.",
      "**CR-12345678123441238123123456789abc — scope: general; language: en; created: 2026-10-05T11:00:00Z; updated: 2026-10-05T11:01:00Z** First line.\nSecond line."]) expect(writingRuleDisplayText(recorded)).toBe(recorded);
  });
});

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
  it("restores a completed retry while protecting another unsaved question or edited reply", () => {
    expect(ruleDraftPromotionNeedsConfirmation({ question: "", originalUrl: "" }, submitted)).toBe(false);
    expect(ruleDraftPromotionNeedsConfirmation(submitted, submitted)).toBe(false);
    expect(ruleDraftPromotionNeedsConfirmation({ ...submitted, question: "שאלה חדשה" }, submitted)).toBe(true);
    expect(ruleDraftPromotionNeedsConfirmation(submitted, submitted, true)).toBe(true);
  });
  it("asks before replacing a different generated reply even when its question and link match", () => {
    expect(ruleDraftPromotionNeedsConfirmation(submitted, submitted, false, "new-generation", "saved-correction")).toBe(true);
    expect(ruleDraftPromotionNeedsConfirmation(submitted, submitted, false, "saved-correction", "saved-correction")).toBe(false);
    expect(ruleDraftPromotionNeedsConfirmation({ question: "", originalUrl: "" }, submitted, false, undefined, "saved-correction")).toBe(false);
  });
});

describe("correction resumption", () => {
  it("offers retries only for persisted resumable states", () => {
    for (const status of ["pending", "permission_denied", "unknown", "saved", "draft_pending"]) expect(canResumeRuleOperation(status)).toBe(true);
    for (const status of ["already_applied", "needs_review", "needs_playbook", "unsafe", "conflict", "draft_conflict", "complete", "unrecognized"]) expect(canResumeRuleOperation(status)).toBe(false);
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
