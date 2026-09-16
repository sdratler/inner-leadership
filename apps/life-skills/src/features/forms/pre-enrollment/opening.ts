import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../../lib/errors.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const stableLeadRef = z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/);
const configSchema = z.array(z.strictObject({ tokenDigest: digest, stableLeadRef, message: z.string().trim().min(1).max(4_000) })).min(1).max(100);
export type PrivateIntakeOpening = Readonly<{ message: string }>;

/** Private runtime configuration only: each entry is bound to both the opaque token
 * digest and the invitation's stable reference. Raw links and openings never enter URLs. */
export function runtimeIntakeOpening(tokenDigest: string, leadRef: string, raw = process.env.LS_INTAKE_PRIVATE_OPENINGS_JSON): PrivateIntakeOpening {
  if (!raw || !/^[a-f0-9]{64}$/.test(tokenDigest) || !stableLeadRef.safeParse(leadRef).success) throw new AppError("NOT_FOUND");
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new AppError("NOT_FOUND"); }
  const result = configSchema.safeParse(parsed); if (!result.success) throw new AppError("NOT_FOUND");
  const matched = result.data.filter(item => timingSafeEqual(Buffer.from(item.tokenDigest, "utf8"), Buffer.from(tokenDigest, "utf8")) && item.stableLeadRef === leadRef);
  if (matched.length !== 1) throw new AppError("NOT_FOUND");
  return Object.freeze({ message: matched[0]!.message });
}
