import { z } from "zod";
import { asId } from "../../lib/ids.ts";

export const formFieldKinds = ["short_text", "long_text", "single_choice", "multiple_choice", "boolean", "date"] as const;
const optionSchema = z.strictObject({ value: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(160) });
export const formFieldSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  kind: z.enum(formFieldKinds),
  label: z.string().trim().min(1).max(240),
  help: z.string().trim().max(500).optional(),
  required: z.boolean(),
  options: z.array(optionSchema).min(1).max(20).optional(),
}).superRefine((field, context) => {
  const needsOptions = field.kind === "single_choice" || field.kind === "multiple_choice";
  if (needsOptions !== Boolean(field.options)) context.addIssue({ code: "custom", message: "Choice fields require options; other fields forbid them" });
  if (field.options && new Set(field.options.map((option) => option.value)).size !== field.options.length) {
    context.addIssue({ code: "custom", message: "Option values must be unique" });
  }
});
export const formDefinitionSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  introduction: z.string().trim().max(1_500),
  fields: z.array(formFieldSchema).min(1).max(80),
}).superRefine((definition, context) => {
  if (new Set(definition.fields.map((field) => field.key)).size !== definition.fields.length) {
    context.addIssue({ code: "custom", message: "Field keys must be unique" });
  }
});

export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormAnswer = string | boolean | readonly string[];
export type FormAnswers = Readonly<Record<string, FormAnswer>>;

const formAnswerSchema = z.union([
  z.string().max(4_000),
  z.boolean(),
  z.array(z.string().max(80)).max(20),
]);
export const formAnswersSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), formAnswerSchema);

const uuid = <K extends string>(kind: K) => z.uuid().transform((value) => asId(value, kind));
export const formTemplateInputSchema = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  version: z.number().int().min(1).max(10_000),
  locale: z.enum(["he", "en"]),
  targetRole: z.enum(["parent", "adult_client"]),
  definition: formDefinitionSchema,
  provenance: z.string().trim().min(1).max(500),
  published: z.boolean(),
});
export const formAssignmentInputSchema = z.strictObject({
  caseId: uuid("case"),
  templateId: uuid("form_template"),
  assignedAccountId: uuid("account"),
  dueDate: z.iso.date().nullable(),
  postSubmissionAudienceId: uuid("audience").nullable(),
});
export const formSubmissionInputSchema = z.strictObject({
  assignmentId: uuid("form_assignment"),
  answers: formAnswersSchema,
  idempotencyKey: z.uuid(),
});
export const formReviewInputSchema = z.strictObject({ submissionId: uuid("form_submission") });

export function validateAnswers(definition: FormDefinition, answers: FormAnswers): void {
  const supplied = new Set(Object.keys(answers));
  for (const key of supplied) if (!definition.fields.some((field) => field.key === key)) throw new Error("UNKNOWN_FORM_FIELD");
  for (const field of definition.fields) {
    const answer = answers[field.key];
    if (answer === undefined) {
      if (field.required) throw new Error("REQUIRED_FORM_FIELD");
      continue;
    }
    if (typeof answer === "string" && answer.trim().length === 0 && field.required) throw new Error("REQUIRED_FORM_FIELD");
    if (field.kind === "boolean" && typeof answer !== "boolean") throw new Error("INVALID_FORM_ANSWER");
    if (["short_text", "long_text", "date", "single_choice"].includes(field.kind) && typeof answer !== "string") throw new Error("INVALID_FORM_ANSWER");
    if (field.kind === "short_text" && typeof answer === "string" && answer.length > 500) throw new Error("INVALID_FORM_ANSWER");
    if (field.kind === "date" && typeof answer === "string" && (!/^\d{4}-\d{2}-\d{2}$/.test(answer) || Number.isNaN(Date.parse(`${answer}T00:00:00Z`)) || new Date(`${answer}T00:00:00Z`).toISOString().slice(0, 10) !== answer)) throw new Error("INVALID_FORM_ANSWER");
    if (field.kind === "single_choice" && typeof answer === "string" && !field.options?.some((option) => option.value === answer)) throw new Error("INVALID_FORM_ANSWER");
    if (field.kind === "multiple_choice") {
      if (!Array.isArray(answer) || (field.required && answer.length === 0) || new Set(answer).size !== answer.length || answer.some((value) => !field.options?.some((option) => option.value === value))) throw new Error("INVALID_FORM_ANSWER");
    }
  }
}
