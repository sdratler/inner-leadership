import { createHmac } from "node:crypto";
import { AppError } from "../errors.ts";
export interface RateLimitStore {
  /** Must be an atomic distributed counter with expiry; not process memory in production. */
  consume(key: string, windowMs: number): Promise<{ count: number; retryAfterMs: number }>;
}
export function opaqueRateLimitKey(subject: string, privateSalt: string): string {
  if (privateSalt.length < 32 || subject.length > 512 || subject.length < 1) throw new AppError("INTERNAL");
  return createHmac("sha256", privateSalt).update(subject).digest("hex");
}
export async function enforceRateLimit(store: RateLimitStore, key: string, limit: number, windowMs: number): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new AppError("INTERNAL");
  let result: Awaited<ReturnType<RateLimitStore["consume"]>>;
  try { result = await store.consume(key, windowMs); } catch { throw new AppError("UNAVAILABLE"); }
  if (!Number.isSafeInteger(result.count) || result.count < 1 || !Number.isFinite(result.retryAfterMs) || result.retryAfterMs < 0) throw new AppError("UNAVAILABLE");
  if (result.count > limit) throw new AppError("RATE_LIMITED");
}
