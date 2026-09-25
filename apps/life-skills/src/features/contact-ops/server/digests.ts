/** Server-side integrity helpers. Never expose the HMAC key or its raw inputs in logs. */
import { createHash, createHmac } from "node:crypto";
import { canonical, requireThat } from "../core/validation.js";
export function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function privateDigest(value: unknown, key: string): string {
    requireThat(key.length >= 32, "HMAC_KEY_REQUIRED");
    return createHmac("sha256", key).update(canonical(value)).digest("hex");
}
export function stableUuid(namespace: string, value: string): string {
    const a = createHash("sha256").update(namespace + "\u0000" + value).digest("hex").slice(0, 32).split("");
    a[12] = "5";
    a[16] = ((parseInt(a[16]!, 16) & 3) | 8).toString(16);
    return `${a.slice(0, 8).join("")}-${a.slice(8, 12).join("")}-${a.slice(12, 16).join("")}-${a.slice(16, 20).join("")}-${a.slice(20).join("")}`;
}
