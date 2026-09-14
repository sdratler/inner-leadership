import { z } from "zod";
import { asId } from "../../lib/ids.ts";

export const resourceTypes = ["audio", "pdf", "video", "link", "text", "digital_form"] as const;
export const resourceReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("url"), value: z.url().max(2_000).refine((value) => new URL(value).protocol === "https:", "HTTPS required") }),
  z.strictObject({ kind: z.literal("storage_key"), value: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,500}$/).refine((value) => value.split("/").every((part) => part !== "." && part !== ".."), "Traversal segment forbidden") }),
  z.strictObject({ kind: z.literal("inline_text"), value: z.string().min(1).max(20_000) }),
  z.strictObject({ kind: z.literal("form_template"), value: z.uuid() }),
]);
export type ResourceReference = z.infer<typeof resourceReferenceSchema>;
const uuid = <K extends string>(kind: K) => z.uuid().transform((value) => asId(value, kind));
export const resourceInputSchema = z.strictObject({
  type: z.enum(resourceTypes),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  reference: resourceReferenceSchema,
  downloadable: z.boolean(),
  locale: z.enum(["he", "en"]),
});
export const resourceAssignmentInputSchema = z.strictObject({
  resourceId: uuid("resource"),
  caseId: uuid("case"),
  audienceId: uuid("audience"),
  dueDate: z.iso.date().nullable(),
  displayDate: z.iso.date(),
  completionEnabled: z.boolean(),
});
export const resourceCompletionInputSchema = z.strictObject({
  assignmentId: uuid("resource_assignment"),
  idempotencyKey: z.uuid(),
});
