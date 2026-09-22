import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../../lib/errors.ts";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const publicConsentSchema = z.strictObject({
  version: z.string().trim().min(1).max(200),
  sourceHashes: z.array(sha256).min(1).max(16),
  displayText: z.array(z.string().trim().min(1).max(12_000)).min(1).max(32),
  acknowledgements: z.array(z.string().trim().min(1).max(2_000)).length(3),
  translations: z.strictObject({
    en: z.strictObject({ displayText: z.array(z.string().trim().min(1).max(12_000)).min(1).max(32), acknowledgements: z.array(z.string().trim().min(1).max(2_000)).length(3) }),
  }).optional(),
});

export type PublicConsent = Readonly<{ version: string; hash: string; sourceHashes: readonly string[]; displayText: readonly string[]; acknowledgements: readonly string[]; translations?: { en: { displayText: readonly string[]; acknowledgements: readonly string[] } } | undefined }>;

/** A release operator, not a browser request, supplies all displayed facts and wording.
 * Hash the complete rendered evidence envelope so a version cannot silently change text. */
export function publicConsentHash(value: z.infer<typeof publicConsentSchema>): string {
  return createHash("sha256").update(JSON.stringify({
    version: value.version,
    sourceHashes: value.sourceHashes,
    displayText: value.displayText,
    acknowledgements: value.acknowledgements,
    ...(value.translations ? { translations: value.translations } : {}),
  }), "utf8").digest("hex");
}

export function runtimePublicConsent(raw = process.env.LS_INTAKE_PUBLIC_CONSENT_JSON): PublicConsent {
  if (!raw) throw new AppError("NOT_FOUND");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new AppError("NOT_FOUND"); }
  const result = publicConsentSchema.safeParse(parsed);
  if (!result.success) throw new AppError("NOT_FOUND");
  const value = result.data;
  return Object.freeze({ ...value, sourceHashes: Object.freeze([...value.sourceHashes]), displayText: Object.freeze([...value.displayText]), acknowledgements: Object.freeze([...value.acknowledgements]), ...(value.translations ? { translations: Object.freeze({ en: Object.freeze({ displayText: Object.freeze([...value.translations.en.displayText]), acknowledgements: Object.freeze([...value.translations.en.acknowledgements]) }) }) } : {}), hash: publicConsentHash(value) });
}
