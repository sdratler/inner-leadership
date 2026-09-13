import { describe, expect, it } from "vitest";
import {
  formAnswersSchema,
  formDefinitionSchema,
  formSubmissionInputSchema,
  formTemplateInputSchema,
  validateAnswers,
} from "../../src/features/forms/schema.ts";
import {
  assertFourWeekPeriod,
  assertSourceHonesty,
  contextualTargetInputSchema,
  qualitativeReviewInputSchema,
} from "../../src/features/progress/schema.ts";
import { resourceInputSchema } from "../../src/features/resources/schema.ts";

const definition = {
  title: "Parent reflection",
  introduction: "Describe one ordinary situation.",
  fields: [
    { key: "example", kind: "long_text" as const, label: "What happened?", required: true },
    { key: "helpful", kind: "boolean" as const, label: "Did this seem helpful?", required: false },
    { key: "context", kind: "single_choice" as const, label: "Context", required: true, options: [
      { value: "home", label: "Home" }, { value: "outside", label: "Outside" },
    ] },
  ],
};

const narrative = {
  taughtAndPractised: ["Clear requests"],
  parentReportedExamples: ["Parent described a calmer request at home."],
  practitionerObservations: ["The wording was rehearsed in the individual meeting."],
  usefulChanges: ["The child asked for a short break in one reported situation."],
  continuingDifficulty: ["Requests remain difficult during hurried transitions."],
  uncertainty: "Only one home setting was reported.",
  nextAdjustment: "Practise a shorter prompt in the next meeting.",
  informationLimits: "The parent report was not independently witnessed by the practitioner.",
};

describe("LS-050 domain contracts", () => {
  it("accepts a bounded versioned form definition", () => {
    expect(formDefinitionSchema.parse(definition).fields).toHaveLength(3);
  });

  it("requires options only for choice fields", () => {
    expect(() => formDefinitionSchema.parse({ ...definition, fields: [{ key: "bad", kind: "short_text", label: "Bad", required: false, options: [{ value: "x", label: "X" }] }] })).toThrow();
    expect(() => formDefinitionSchema.parse({ ...definition, fields: [{ key: "bad", kind: "single_choice", label: "Bad", required: false }] })).toThrow();
  });

  it("rejects duplicate form keys and choice values", () => {
    expect(() => formDefinitionSchema.parse({ ...definition, fields: [definition.fields[0], definition.fields[0]] })).toThrow();
    expect(() => formDefinitionSchema.parse({ ...definition, fields: [{ key: "bad", kind: "single_choice", label: "Bad", required: false, options: [{ value: "x", label: "X" }, { value: "x", label: "Again" }] }] })).toThrow();
  });

  it("validates answers against the immutable definition", () => {
    expect(() => validateAnswers(definition, { example: "A specific event", context: "home", helpful: true })).not.toThrow();
    expect(() => validateAnswers(definition, { context: "home" })).toThrow("REQUIRED_FORM_FIELD");
    expect(() => validateAnswers(definition, { example: "Event", context: "invented" })).toThrow("INVALID_FORM_ANSWER");
    expect(() => validateAnswers(definition, { example: "Event", context: "home", score: "10" })).toThrow("UNKNOWN_FORM_FIELD");
  });

  it("bounds answer payload shapes", () => {
    expect(formAnswersSchema.safeParse({ note: "specific", consent: true, contexts: ["home"] }).success).toBe(true);
    expect(formAnswersSchema.safeParse({ note: { nested: "not accepted" } }).success).toBe(false);
  });

  it("forbids scoring configuration on form templates", () => {
    const input = { key: "PARENT_REFLECTION", version: 1, locale: "en", targetRole: "parent", definition, provenance: "Program2.1 W04", published: true };
    expect(formTemplateInputSchema.safeParse(input).success).toBe(true);
    expect(formTemplateInputSchema.safeParse({ ...input, scoring: { points: 10 } }).success).toBe(false);
    expect(formDefinitionSchema.safeParse({ ...definition, ratingScale: [1, 2, 3] }).success).toBe(false);
  });

  it("accepts exactly the six frozen resource types", () => {
    for (const type of ["audio", "pdf", "video", "link", "text", "digital_form"] as const) {
      expect(resourceInputSchema.safeParse({ type, title: "Resource", description: "A deliberate resource", reference: { kind: "url", value: "https://example.invalid/resource" }, downloadable: false, locale: "en" }).success).toBe(true);
    }
    expect(resourceInputSchema.safeParse({ type: "worksheet", title: "Legacy", description: "", reference: { kind: "url", value: "https://example.invalid" }, downloadable: false, locale: "en" }).success).toBe(false);
  });

  it("accepts only HTTPS or traversal-safe private resource references", () => {
    const base = { type: "pdf", title: "Resource", description: "", downloadable: true, locale: "en" };
    expect(resourceInputSchema.safeParse({ ...base, reference: { kind: "url", value: "http://example.invalid/file.pdf" } }).success).toBe(false);
    expect(resourceInputSchema.safeParse({ ...base, reference: { kind: "storage_key", value: "case/../other/file.pdf" } }).success).toBe(false);
    expect(resourceInputSchema.safeParse({ ...base, reference: { kind: "storage_key", value: "resources/parent/file.pdf" } }).success).toBe(true);
  });

  it("requires an exact four-calendar-week period with an exclusive end", () => {
    expect(() => assertFourWeekPeriod("2026-01-01", "2026-01-29")).not.toThrow();
    expect(() => assertFourWeekPeriod("2026-01-01", "2026-01-28")).toThrow("REVIEW_PERIOD_MUST_BE_FOUR_WEEKS");
    expect(() => assertFourWeekPeriod("2026-02-30", "2026-03-30")).toThrow("INVALID_PERIOD");
  });

  it("rejects caller-supplied attendance, grades, ratings and automatic conclusions", () => {
    const input = {
      caseId: "10000000-0000-4000-8000-000000000001",
      audienceId: "10000000-0000-4000-8000-000000000002",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-29",
      assignmentVersionIds: [],
      parentReportIds: ["10000000-0000-4000-8000-000000000003"],
      narrative,
    };
    expect(qualitativeReviewInputSchema.safeParse(input).success).toBe(true);
    expect(qualitativeReviewInputSchema.safeParse({ ...input, attendedSessionCount: 4 }).success).toBe(false);
    expect(qualitativeReviewInputSchema.safeParse({ ...input, score: 82 }).success).toBe(false);
    expect(qualitativeReviewInputSchema.safeParse({ ...input, clinicalConclusion: "automatic" }).success).toBe(false);
    expect(qualitativeReviewInputSchema.safeParse({ ...input, narrative: { ...narrative, rating: 5 } }).success).toBe(false);
  });

  it("requires attribution before a parent-reported example can appear", () => {
    expect(() => assertSourceHonesty(1, narrative)).not.toThrow();
    expect(() => assertSourceHonesty(0, narrative)).toThrow("UNATTRIBUTED_PARENT_EXAMPLE");
    expect(() => assertSourceHonesty(0, { ...narrative, parentReportedExamples: [] })).not.toThrow();
  });

  it("keeps contextual targets descriptive rather than numeric", () => {
    const input = {
      caseId: "10000000-0000-4000-8000-000000000001",
      audienceId: "10000000-0000-4000-8000-000000000002",
      behavior: "Ask clearly for a short break",
      setting: "A hurried transition at home",
      initialDescription: "Requests often become unclear when everybody is rushing.",
      relevantExamples: ["Morning departure"],
      activeFrom: "2026-01-01",
      activeUntil: null,
      published: true,
    };
    expect(contextualTargetInputSchema.safeParse(input).success).toBe(true);
    expect(contextualTargetInputSchema.safeParse({ ...input, targetScore: 10 }).success).toBe(false);
  });

  it("keeps submission input strict and idempotent", () => {
    const input = { assignmentId: "10000000-0000-4000-8000-000000000001", answers: { example: "A specific event" }, idempotencyKey: "10000000-0000-4000-8000-000000000002" };
    expect(formSubmissionInputSchema.safeParse(input).success).toBe(true);
    expect(formSubmissionInputSchema.safeParse({ ...input, authorAccountId: "10000000-0000-4000-8000-000000000003" }).success).toBe(false);
  });
});
