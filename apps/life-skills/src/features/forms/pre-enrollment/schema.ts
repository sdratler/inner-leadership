import { createHash } from "node:crypto";
import { z } from "zod";

/** P1's private, parent-first intake contract. Contact preference is deliberately
 * independent from CP01 and never implies an invitation or access grant. */
export const cp01Values = ["joint", "separate", "not_now", "discuss_privately"] as const;
export const contactValues = ["yes", "no"] as const;
export const languages = ["he", "en"] as const;

const nonBlank = (max: number) => z.string().trim().min(1).max(max);
const childSchema = z.strictObject({
  /** This is an opaque slot minted on the invitation, never an administrative child id. */
  childSlotId: z.string().uuid(),
  firstName: nonBlank(120),
  // The intake UI offers half-year increments.  Keep this finite so JSON edge
  // cases (NaN/Infinity) cannot enter the encrypted response envelope.
  age: z.number().finite().min(0).max(25).refine(age => Number.isInteger(age * 2), {
    message: "Age must be a whole or half year",
  }),
});

export const preEnrollmentSchema = z.strictObject({
  parentName: nonBlank(160),
  contactNumber: nonBlank(64),
  preferredLanguage: z.enum(languages),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  children: z.array(childSchema).min(1).max(8),
  locationPreference: nonBlank(500),
  arrivalNeeds: z.string().trim().max(500).optional().or(z.literal("")),
  availableDays: z.array(z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"])).min(1).max(7),
  timeWindows: z.array(z.enum(["morning", "afternoon", "evening"])).min(1).max(3),
  availabilityNote: z.string().trim().max(1_000).optional().or(z.literal("")),
  privateContext: z.string().trim().max(4_000).optional().or(z.literal("")),
  cp01: z.enum(cp01Values),
  willingToBeContacted: z.enum(contactValues),
  accessSupportNeeded: z.enum(contactValues),
  consentAcknowledgements: z.array(z.literal(true)).length(3),
  consentVersion: nonBlank(200),
  consentHash: z.string().regex(/^[a-f0-9]{64}$/),
  signerName: nonBlank(160),
});
export type PreEnrollmentInput = z.infer<typeof preEnrollmentSchema>;

export function policyTextHash(text: string): string { return createHash("sha256").update(text, "utf8").digest("hex"); }

export function parsePreEnrollment(value: unknown): PreEnrollmentInput {
  return preEnrollmentSchema.parse(value);
}

export function digestPreEnrollment(value: PreEnrollmentInput): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
