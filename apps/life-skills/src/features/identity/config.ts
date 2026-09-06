import { AppError } from "../../lib/errors.ts";
import type { Keyring } from "./crypto.ts";
import { asId, type WorkspaceId } from "../../lib/ids.ts";
export interface IdentityConfig {
  enabled: boolean; origin: string; workspaceId: WorkspaceId;
  csrfKey: Buffer; lookupKey: Buffer; rateLimitKey: string; keyring: Keyring;
  sessionSeconds: number;
}
function key(raw: string | undefined): Buffer {
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new AppError("UNAVAILABLE");
  const b = Buffer.from(raw, "base64url"); if (b.length !== 32 || b.toString("base64url") !== raw) throw new AppError("UNAVAILABLE"); return b;
}
export function identityEnabled(env: Record<string, string | undefined>): boolean { return env.LS_IDENTITY_ENABLED === "true"; }
export function parseIdentityConfig(env: Record<string, string | undefined>): IdentityConfig {
  try {
    if (!identityEnabled(env)) throw new Error();
    const origin = new URL(env.LS_APP_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
    const keysInput: unknown = JSON.parse(env.LS_IDENTITY_DATA_KEYS ?? "");
    if (!keysInput || typeof keysInput !== "object" || Array.isArray(keysInput)) throw new Error();
    const keys = Object.create(null) as Record<string, Buffer>;
    for (const [id, value] of Object.entries(keysInput)) {
      if (['__proto__','constructor','prototype'].includes(id) || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof value !== "string") throw new Error(); keys[id] = key(value);
    }
    const activeKeyId = env.LS_IDENTITY_ACTIVE_KEY_ID ?? "";
    if (!keys[activeKeyId] || Object.keys(keys).length > 8) throw new Error();
    const csrfKey = key(env.LS_IDENTITY_CSRF_KEY), lookupKey = key(env.LS_IDENTITY_LOOKUP_KEY), rateKey = key(env.LS_IDENTITY_RATE_KEY);
    const all = [csrfKey, lookupKey, rateKey, ...Object.values(keys)].map(b => b.toString("hex"));
    if (new Set(all).size !== all.length) throw new Error();
    return Object.freeze({ enabled: true, origin: origin.origin, workspaceId: asId(env.LS_IDENTITY_WORKSPACE_ID ?? "", "workspace"), csrfKey, lookupKey, rateLimitKey: rateKey.toString("hex"), keyring: { activeKeyId, keys }, sessionSeconds: 8 * 3600 });
  } catch { throw new AppError("UNAVAILABLE"); }
}
