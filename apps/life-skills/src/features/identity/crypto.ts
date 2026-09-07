import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const N = 32768, R = 8, P = 3; // OWASP scrypt alternative: 32 MiB, p=3; Node 22 built-in.
export function opaqueToken(): string { return randomBytes(32).toString("base64url"); }
export function tokenDigest(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new AppError("INVALID_REQUEST");
  return createHash("sha256").update(token).digest("hex");
}
export function canonicalEmail(email: string): string { return email.trim().toLowerCase(); }
export function blindEmail(email: string, key: Buffer): string { return createHmac("sha256", key).update(canonicalEmail(email)).digest("hex"); }
export function csrfSecret(token: string, key: Buffer, purpose: "preauth" | "session"): string {
  if (!TOKEN_PATTERN.test(token)) throw new AppError("UNAUTHENTICATED");
  return createHmac("sha256", key).update(purpose + ":" + token).digest("base64url");
}
export function validatePassword(password: string): void {
  const length = [...password].length;
  if (length < 15 || length > 128 || Buffer.byteLength(password, "utf8") > 512) throw new AppError("INVALID_REQUEST");
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64,
    { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(new AppError("UNAVAILABLE")) : resolve(result)));
}
export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16), hash = await derive(password, salt);
  return ["scrypt", "v1", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== "string" || Buffer.byteLength(password) > 512) return false;
  const parts = encoded.split("$");
  if (parts.length !== 7 || parts.slice(0, 5).join("$") !== "scrypt$v1$32768$8$3" || !/^[A-Za-z0-9_-]{22}$/.test(parts[5] ?? "") || !/^[A-Za-z0-9_-]{86}$/.test(parts[6] ?? "")) return false;
  const salt = Buffer.from(parts[5]!, "base64url"), wanted = Buffer.from(parts[6]!, "base64url");
  if (salt.length !== 16 || wanted.length !== 64 || salt.toString("base64url") !== parts[5] || wanted.toString("base64url") !== parts[6]) return false;
  return timingSafeEqual(await derive(password, salt), wanted);
}
let dummy: Promise<string> | undefined;
/** Warm this once when activating identity; unknown users still pay the same KDF cost. */
export function dummyPasswordHash(): Promise<string> { return dummy ??= hashPassword(opaqueToken()); }
export interface Keyring { activeKeyId: string; keys: Readonly<Record<string, Buffer>>; }
function keyFor(ring: Keyring, id: string): Buffer {
  const key = Object.hasOwn(ring.keys, id) ? ring.keys[id] : undefined;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || !key || key.length !== 32) throw new AppError("UNAVAILABLE");
  return key;
}
export function seal(plain: string, aad: string, ring: Keyring): string {
  if (!aad || aad.length > 256 || Buffer.byteLength(plain) > 65536) throw new AppError("INVALID_REQUEST");
  const iv = randomBytes(12), key = keyFor(ring, ring.activeKeyId);
  const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, kid: ring.activeKeyId, iv: iv.toString("base64url"), body: body.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") });
}
export function unseal(encoded: string, aad: string, ring: Keyring): string {
  try {
    if (encoded.length > 100000) throw new Error();
    const v: unknown = JSON.parse(encoded);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    const e = v as Record<string, unknown>;
    if (Object.keys(e).sort().join() !== "body,iv,kid,tag,v" || e.v !== 1 || typeof e.kid !== "string" || typeof e.iv !== "string" || typeof e.body !== "string" || typeof e.tag !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(e.iv) || !/^[A-Za-z0-9_-]{22}$/.test(e.tag) || !/^[A-Za-z0-9_-]*$/.test(e.body)) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", keyFor(ring, e.kid), Buffer.from(e.iv, "base64url"));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(e.tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(e.body, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw new AppError("UNAVAILABLE"); }
}
