export class ContractError extends Error {
    constructor(readonly code: string) { super(code); this.name = "ContractError"; }
}
export function requireThat(condition: unknown, code: string): asserts condition {
    if (!condition)
        throw new ContractError(code);
}
export function isInstant(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!parts || !dateOnly(parts[1])) return false;
    const hour = Number(parts[2]), minute = Number(parts[3]), second = Number(parts[4] ?? 0);
    const zoneHour = Number(parts[6] ?? 0), zoneMinute = Number(parts[7] ?? 0);
    return hour <= 23 && minute <= 59 && second <= 59 && zoneHour <= 23 && zoneMinute <= 59 && Number.isFinite(Date.parse(value));
}
export function epoch(value: string): number { requireThat(isInstant(value), "INVALID_INSTANT"); return Date.parse(value); }
export function dateOnly(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const d = new Date(value + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function safeLocalHref(value: string): string {
    requireThat(/^\/(?:he|en)\//.test(value) && !/[\\\u0000-\u001f]/.test(value), "UNSAFE_APP_LINK");
    const u = new URL(value, "https://local.invalid");
    requireThat(u.origin === "https://local.invalid" && /^\/(?:he|en)\//.test(u.pathname), "UNSAFE_APP_LINK");
    return u.pathname + u.search + u.hash;
}
/** Stable serialization, deliberately rejecting undefined, non-finite numbers and exotic objects. */
export function canonical(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        requireThat(Number.isFinite(value), "NON_FINITE");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return "[" + value.map(canonical).join(",") + "]";
    requireThat(typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype, "NON_JSON_VALUE");
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
}
