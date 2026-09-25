import { requireThat } from "./validation.js";
/** Preserve +aliases and dots. This normalizes a contact endpoint, not an authentication identity. */
export function normalizeEmail(value: string): string | null {
    const v = value.trim();
    if (/[\s\r\n]/.test(v) || !/^[^@]+@[^@]+\.[^@]+$/.test(v))
        return null;
    const at = v.lastIndexOf("@");
    const local = v.slice(0, at);
    // Conservative unquoted SMTPUTF8 atoms: a malformed endpoint needs review,
    // never a guessed repair or a merge with another contact.
    const atom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~\-\p{L}\p{N}\p{M}]+$/u;
    if (new TextEncoder().encode(local).length > 64 || local.split(".").some(part => !atom.test(part)))
        return null;
    // SMTPUTF8 local parts are opaque; NFKC may change a distinct mailbox.
    const domain = v.slice(at + 1).normalize("NFKC").toLowerCase();
    const labels = domain.split(".");
    if (labels.length < 2 || labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
        return null;
    const normalized = local + "@" + domain;
    return normalized.length <= 254 ? normalized : null;
}
export function normalizePhone(value: string, defaultRegion: "IL" | null = "IL"): string | null {
    const v = value.trim();
    if (/[a-zA-Z@#]/.test(v))
        return null;
    let digits = v.replace(/[\s().-]/g, "");
    if (digits.startsWith("00"))
        digits = "+" + digits.slice(2);
    if (defaultRegion === "IL" && /^0[1-9]\d{7,8}$/.test(digits))
        digits = "+972" + digits.slice(1);
    else if (/^972[1-9]\d{7,8}$/.test(digits))
        digits = "+" + digits;
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
export interface EndpointClaim {
    personId: string;
    workspaceId: string;
    endpointKey: string;
    verified: boolean;
    shared: boolean;
    revoked: boolean;
}
export type Match = {
    kind: "matched";
    personId: string;
} | {
    kind: "new";
} | {
    kind: "ambiguous";
    candidateIds: readonly string[];
};
/** A shared mailbox/phone is a routing hint, NEVER a guardian grant or account-login identity. */
export function resolveEndpoint(workspaceId: string, endpointKey: string, claims: readonly EndpointClaim[]): Match {
    requireThat(Boolean(workspaceId && endpointKey), "MISSING_CONTEXT");
    const hit = claims.filter(c => c.workspaceId === workspaceId && c.endpointKey === endpointKey && !c.revoked);
    const ids = [...new Set(hit.map(c => c.personId))].sort();
    if (!ids.length)
        return { kind: "new" };
    if (ids.length !== 1 || hit.some(c => !c.verified || c.shared))
        return { kind: "ambiguous", candidateIds: ids };
    return { kind: "matched", personId: ids[0]! };
}
