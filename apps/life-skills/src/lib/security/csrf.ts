import { timingSafeEqual } from "node:crypto";
import { AppError } from "../errors.ts";
/** Identity provides a secret per session. No double-submit cookie shortcut. */
export function verifyMutationOrigin(request: Request, expectedOrigin: string): void {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) throw new AppError("INVALID_REQUEST");
  const origin = request.headers.get("origin");
  if (origin !== new URL(expectedOrigin).origin) throw new AppError("FORBIDDEN");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new AppError("FORBIDDEN");
}
export function verifyCsrfToken(supplied: string | null, expected: string): void {
  const valid = /^[A-Za-z0-9_-]{43}$/;
  if (!supplied || !valid.test(supplied) || !valid.test(expected)) throw new AppError("FORBIDDEN");
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new AppError("FORBIDDEN");
}
