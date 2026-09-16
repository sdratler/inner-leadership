import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const configSchema = z.strictObject({
  expiresAt: z.string().datetime(),
  tokens: z.array(z.strictObject({ hash: z.string().regex(/^[a-f0-9]{64}$/), childCount: z.union([z.literal(1), z.literal(2)]) })).length(2),
});
export type OwnerPreviewConsent = Readonly<{ version: string; hash: string; sourceHashes: readonly string[]; displayText: readonly string[]; acknowledgements: readonly string[] }>;
export type OwnerPreviewConfig = Readonly<{ expiresAt: Date; tokenHashes: Readonly<Record<1 | 2, string>> }>;
const syntheticEvidence = Object.freeze({
  version: "owner-preview-synthetic-v1",
  sourceHashes: [createHash("sha256").update("owner-preview-synthetic-only").digest("hex")],
  displayText: ["זוהי תצוגת בדיקה בלבד. אין להזין מידע אמיתי על ילדים."],
  acknowledgements: ["אני מבין/ה שזו בדיקה טכנית בלבד.", "אין כאן הסכמה טיפולית או משפטית.", "המידע בבדיקה אינו נשלח ואינו נשמר."],
});
const evidenceHash = createHash("sha256").update(JSON.stringify(syntheticEvidence), "utf8").digest("hex");
export const ownerPreviewConsent: OwnerPreviewConsent = Object.freeze({ ...syntheticEvidence, hash: evidenceHash });

export function ownerPreviewConfig(input: Record<string, string | undefined>, now = new Date()): OwnerPreviewConfig | null {
  if (input.LS_APP_MODE !== "isolated_preview") return null;
  let origin: URL; try { origin = new URL(input.LS_APP_ORIGIN ?? ""); } catch { return null; }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return null;
  let raw: unknown; try { raw = JSON.parse(input.LS_OWNER_INTAKE_PREVIEW_CONFIG ?? ""); } catch { return null; }
  const parsed = configSchema.safeParse(raw); if (!parsed.success) return null;
  const expiresAt = new Date(parsed.data.expiresAt);
  if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return null;
  const hashes: Partial<Record<1 | 2, string>> = {};
  for (const item of parsed.data.tokens) { if (hashes[item.childCount]) return null; hashes[item.childCount] = item.hash; }
  if (!hashes[1] || !hashes[2] || hashes[1] === hashes[2]) return null;
  return Object.freeze({ expiresAt, tokenHashes: Object.freeze({ 1: hashes[1], 2: hashes[2] }) });
}
export function ownerPreviewExchange(input: Record<string, string | undefined>, token: string, now = new Date()): { childSlotIds: string[]; consent: OwnerPreviewConsent; expiresAt: string } | null {
  const config = ownerPreviewConfig(input, now); if (!config || !tokenPattern.test(token)) return null;
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  let count: 1 | 2 | null = null;
  for (const candidate of [1, 2] as const) if (timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(config.tokenHashes[candidate], "utf8"))) count = candidate;
  if (!count) return null;
  return { childSlotIds: Array.from({ length: count }, () => randomUUID()), consent: ownerPreviewConsent, expiresAt: config.expiresAt.toISOString() };
}
