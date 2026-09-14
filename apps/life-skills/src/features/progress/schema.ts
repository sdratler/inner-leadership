import { z } from "zod";
import { asId } from "../../lib/ids.ts";

const uuid = <K extends string>(kind: K) => z.uuid().transform((value) => asId(value, kind));
export const contextualTargetInputSchema = z.strictObject({
  caseId: uuid("case"),
  audienceId: uuid("audience"),
  behavior: z.string().trim().min(1).max(500),
  setting: z.string().trim().min(1).max(500),
  initialDescription: z.string().trim().min(1).max(4_000),
  relevantExamples: z.array(z.string().trim().min(1).max(1_000)).max(20),
  activeFrom: z.iso.date(),
  activeUntil: z.iso.date().nullable(),
  published: z.boolean(),
}).superRefine((input, context) => {
  if (input.activeUntil && input.activeUntil < input.activeFrom) context.addIssue({ code: "custom", message: "Active range is inverted" });
});

export const qualitativeNarrativeSchema = z.strictObject({
  taughtAndPractised: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  parentReportedExamples: z.array(z.string().trim().min(1).max(1_500)).max(30),
  practitionerObservations: z.array(z.string().trim().min(1).max(1_500)).max(30),
  usefulChanges: z.array(z.string().trim().min(1).max(1_500)).max(30),
  continuingDifficulty: z.array(z.string().trim().min(1).max(1_500)).max(30),
  uncertainty: z.string().trim().min(1).max(3_000),
  nextAdjustment: z.string().trim().min(1).max(3_000),
  informationLimits: z.string().trim().min(1).max(3_000),
});
export type QualitativeNarrative = z.infer<typeof qualitativeNarrativeSchema>;

export const qualitativeReviewInputSchema = z.strictObject({
  caseId: uuid("case"),
  audienceId: uuid("audience"),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  assignmentVersionIds: z.array(uuid("practice_version")).max(40),
  parentReportIds: z.array(uuid("parent_report")).max(80),
  narrative: qualitativeNarrativeSchema,
});
export const qualitativePublishInputSchema = z.strictObject({ reviewId: uuid("qualitative_review") });

function utcDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_PERIOD");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("INVALID_PERIOD");
  return time;
}

/** The end is exclusive: exactly 28 calendar days after the start. */
export function assertFourWeekPeriod(periodStart: string, periodEnd: string): void {
  if (utcDate(periodEnd) - utcDate(periodStart) !== 28 * 24 * 60 * 60 * 1_000) throw new Error("REVIEW_PERIOD_MUST_BE_FOUR_WEEKS");
}

export function assertSourceHonesty(parentReportCount: number, narrative: QualitativeNarrative): void {
  if (!Number.isSafeInteger(parentReportCount) || parentReportCount < 0) throw new Error("INVALID_SOURCE_COUNT");
  if (parentReportCount === 0 && narrative.parentReportedExamples.length > 0) throw new Error("UNATTRIBUTED_PARENT_EXAMPLE");
}
