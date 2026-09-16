import { createHash } from "node:crypto";
import { z } from "zod";

/** P1's private, parent-first intake contract. Contact preference is deliberately
 * independent from CP01 and never implies an invitation or access grant. */
export const cp01Values = ["joint", "separate", "not_now", "discuss_privately"] as const;
export const contactValues = ["yes", "no"] as const;
export const languages = ["he", "en"] as const;

const nonBlank = (max: number) => z.string().trim().min(1).max(max);
const childSchema = z.strictObject({
  stableChildId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/),
  firstName: nonBlank(120),
  age: z.number().int().min(0).max(25),
});

export const preEnrollmentSchema = z.strictObject({
  parentName: nonBlank(160),
  contactNumber: nonBlank(64),
  preferredLanguage: z.enum(languages),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  children: z.array(childSchema).min(1).max(8),
  locationPreference: nonBlank(500),
  arrivalAvailability: nonBlank(500),
  availability: nonBlank(1_000),
  privateContext: z.string().trim().max(4_000).optional().or(z.literal("")),
  cp01: z.enum(cp01Values),
  willingToBeContacted: z.enum(contactValues),
  accessSupportNeeded: z.enum(contactValues),
  consentPolicyVersion: nonBlank(80),
  consentPolicyHash: z.string().trim().regex(/^[a-f0-9]{64}$/),
  consentAcknowledged: z.literal(true),
  signerName: nonBlank(160),
});
export type PreEnrollmentInput = z.infer<typeof preEnrollmentSchema>;

export const policyTextHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export function parsePreEnrollment(value: unknown): PreEnrollmentInput {
  return preEnrollmentSchema.parse(value);
}

export function digestPreEnrollment(value: PreEnrollmentInput): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
