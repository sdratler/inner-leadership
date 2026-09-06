import { AppError } from "../errors.ts";
import { asId, type AccountId, type WorkspaceId } from "../ids.ts";
export type SessionPrincipal = Readonly<{ accountId: AccountId; workspaceId: WorkspaceId; expiresAt: number; revoked: boolean }>;
export interface SessionAdapter {
  /** Lookup opaque token by a one-way digest; verify revocation on every request. Never log token. */
  resolve(opaqueToken: string): Promise<SessionPrincipal | null>;
}
export const unavailableSessionAdapter: SessionAdapter = Object.freeze({
  async resolve() { throw new AppError("UNAVAILABLE"); },
});
export async function requireSession(token: string | undefined, adapter: SessionAdapter = unavailableSessionAdapter, now = Date.now()): Promise<SessionPrincipal> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError("UNAUTHENTICATED");
  let principal: SessionPrincipal | null;
  try { principal = await adapter.resolve(token); } catch { throw new AppError("UNAVAILABLE"); }
  if (!principal || principal.revoked !== false || !Number.isFinite(principal.expiresAt) || principal.expiresAt <= now) throw new AppError("UNAUTHENTICATED");
  try {
    asId(principal.accountId, "account");
    asId(principal.workspaceId, "workspace");
  } catch { throw new AppError("UNAUTHENTICATED"); }
  return Object.freeze({ ...principal });
}
export const SESSION_COOKIE = "__Host-ls-session";
export function sessionCookieOptions(maxAgeSeconds: number) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0 || maxAgeSeconds > 86400) throw new Error("INVALID_COOKIE_DURATION");
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}
// No account table, login handler, cookie issuance, shared-family login or child account.
