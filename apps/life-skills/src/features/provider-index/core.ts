/** R35: private provider records are neither sales leads nor client identities.
 * This module is pure and dependency-free. All persistence/authority stays server-side.
 */
export const verificationStates = ["unverified", "self_reported", "checked", "needs_review"] as const;
export type VerificationState = (typeof verificationStates)[number];
export interface SourceRef { label: string; url: string; }
export interface ProviderInput {
  name: string;
  services: string[];
  location: string;
  phone: string;
  email: string;
  website: string;
  sources: SourceRef[];
  verification: { status: VerificationState; basis: string; checkedOn: string; };
  declaredFit: { gender: string; religiousFit: string; source: string; };
  privateNotes: string;
}
export interface ProviderRecord {
  id: string; version: number; archived: boolean;
  createdAt: string; updatedAt: string; entry: ProviderInput;
}
export interface ProviderQuery {
  search: string; service: string; location: string; verification: "all" | VerificationState;
  gender: string; religiousFit: string; archive: "active" | "archived" | "all";
  page: number; pageSize: number; locale: "he" | "en";
}
export interface ProviderPage {
  items: ProviderRecord[]; total: number; page: number; pageSize: number;
  options: { services: string[]; locations: string[]; genders: string[]; religiousFits: string[]; };
}
export type ProblemCode = "INVALID_REQUEST" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "UNAVAILABLE";
export class ProviderProblem extends Error {
  readonly code: ProblemCode;
  readonly reason: string;
  constructor(code: ProblemCode, reason = code as string) {
    super(reason); this.name = "ProviderProblem"; this.code = code; this.reason = reason;
  }
}
export function requireValue(value: unknown, reason = "INVALID_INPUT"): asserts value {
  if (!value) throw new ProviderProblem("INVALID_REQUEST", reason);
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  requireValue(Object.keys(row).every(key => keys.includes(key)), "UNKNOWN_FIELD");
  return row;
}
export function text(value: unknown, max: number, required = false): string {
  requireValue(typeof value === "string");
  // Allow ordinary newlines, not control characters or direction-override spoofing.
  requireValue(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value));
  const result = value.trim(); requireValue(result.length <= max && (!required || result.length > 0));
  return result;
}
export function uuid(value: unknown): string {
  requireValue(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
  return value.toLowerCase();
}
export function dateOnly(value: unknown): string {
  const v = text(value, 10); if (!v) return "";
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(v));
  const d = new Date(v + "T00:00:00.000Z");
  requireValue(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v);
  return v;
}
/** Date-only evidence uses the practice timezone rather than UTC midnight. */
export function practiceDate(now: Date): string {
  requireValue(Number.isFinite(now.getTime()));
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (kind: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === kind)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function webUrl(value: unknown): string {
  const v = text(value, 1024); if (!v) return "";
  try {
    requireValue(!/\s/.test(v)); const u = new URL(v);
    requireValue((u.protocol === "https:" || u.protocol === "http:") && !!u.hostname && !u.username && !u.password);
    return u.href;
  } catch { throw new ProviderProblem("INVALID_REQUEST", "INVALID_URL"); }
}
export function normalize(value: string): string {
  return value.normalize("NFKC").replace(/[\u0591-\u05C7]/g, "").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}
export function phoneKey(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.startsWith("00972")) return digits.slice(2);
  if (digits.startsWith("0") && (digits.length === 9 || digits.length === 10)) return "972" + digits.slice(1);
  return digits;
}
export function emptyProvider(): ProviderInput {
  return { name: "", services: [], location: "", phone: "", email: "", website: "", sources: [],
    verification: { status: "unverified", basis: "", checkedOn: "" },
    declaredFit: { gender: "", religiousFit: "", source: "" }, privateNotes: "" };
}
export function parseProvider(value: unknown): ProviderInput {
  const v = object(value, ["name", "services", "location", "phone", "email", "website", "sources", "verification", "declaredFit", "privateNotes"]);
  const name = text(v.name, 160, true);
  requireValue(Array.isArray(v.services) && v.services.length <= 10);
  const services = (v.services as unknown[]).map(s => text(s, 100, true));
  requireValue(new Set(services.map(normalize)).size === services.length, "DUPLICATE_SERVICE");
  const phone = text(v.phone, 40), email = text(v.email, 254);
  requireValue(!phone || (/^[+0-9(). -]+$/.test(phone) && phoneKey(phone).length >= 7 && phoneKey(phone).length <= 15), "INVALID_PHONE");
  requireValue(!email || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email), "INVALID_EMAIL");
  requireValue(Array.isArray(v.sources) && v.sources.length <= 5);
  const sources = (v.sources as unknown[]).map(x => {
    const s = object(x, ["label", "url"]), label = text(s.label, 300), url = webUrl(s.url);
    requireValue(label || url, "EMPTY_SOURCE"); return { label, url };
  });
  const verification = object(v.verification, ["status", "basis", "checkedOn"]);
  requireValue(verificationStates.includes(verification.status as VerificationState));
  const status = verification.status as VerificationState, basis = text(verification.basis, 600), checkedOn = dateOnly(verification.checkedOn);
  requireValue(status !== "checked" || (basis && checkedOn), "VERIFICATION_EVIDENCE_REQUIRED");
  requireValue(status !== "self_reported" || basis, "SOURCE_REQUIRED");
  const fit = object(v.declaredFit, ["gender", "religiousFit", "source"]);
  const declaredFit = { gender: text(fit.gender, 80), religiousFit: text(fit.religiousFit, 100), source: text(fit.source, 600) };
  requireValue((!declaredFit.gender && !declaredFit.religiousFit) || declaredFit.source, "DECLARED_FIT_SOURCE_REQUIRED");
  return { name, services, location: text(v.location, 240), phone, email, website: webUrl(v.website), sources,
    verification: { status, basis, checkedOn }, declaredFit, privateNotes: text(v.privateNotes, 2000) };
}
export function parseQuery(value: unknown): ProviderQuery {
  const q = object(value, ["search", "service", "location", "verification", "gender", "religiousFit", "archive", "page", "pageSize", "locale"]);
  const verification = q.verification ?? "all", archive = q.archive ?? "active", locale = q.locale ?? "en";
  requireValue(verification === "all" || verificationStates.includes(verification as VerificationState));
  requireValue(["active", "archived", "all"].includes(archive as string)); requireValue(locale === "he" || locale === "en");
  const page = q.page ?? 1, pageSize = q.pageSize ?? 25;
  requireValue(Number.isSafeInteger(page) && Number(page) >= 1 && Number(page) <= 1000);
  requireValue(Number.isSafeInteger(pageSize) && Number(pageSize) >= 1 && Number(pageSize) <= 50);
  return { search: text(q.search ?? "", 160), service: text(q.service ?? "", 100), location: text(q.location ?? "", 240),
    verification: verification as ProviderQuery["verification"], gender: text(q.gender ?? "", 80), religiousFit: text(q.religiousFit ?? "", 100),
    archive: archive as ProviderQuery["archive"], page: Number(page), pageSize: Number(pageSize), locale };
}
/** A duplicate hint is never an identity match or a reason to overwrite another card. */
export function possibleDuplicates(rows: readonly ProviderRecord[], entry: ProviderInput, excludeId?: string): ProviderRecord[] {
  const website = (s: string) => s ? new URL(s).href.replace(/\/$/, "") : "";
  return rows.filter(r => r.id !== excludeId && (
    (!!entry.email && normalize(r.entry.email) === normalize(entry.email)) ||
    (!!entry.phone && phoneKey(r.entry.phone) === phoneKey(entry.phone)) ||
    (!!entry.website && website(r.entry.website) === website(entry.website)) ||
    (normalize(r.entry.name) === normalize(entry.name) && normalize(r.entry.location) === normalize(entry.location))
  ));
}
export function selectProviders(rows: readonly ProviderRecord[], rawQuery: unknown): ProviderPage {
  const q = parseQuery(rawQuery), collator = new Intl.Collator(q.locale, { sensitivity: "base", numeric: true });
  const unique = (values: string[]) => [...new Map(values.filter(Boolean).map(v => [normalize(v), v])).values()].sort(collator.compare);
  const equal = (a: string, b: string) => !b || normalize(a) === normalize(b);
  const selected = rows.filter(({ entry: e, archived }) => {
    if (q.archive !== "all" && archived !== (q.archive === "archived")) return false;
    if (q.service && !e.services.some(s => equal(s, q.service))) return false;
    if (!equal(e.location, q.location) || !equal(e.declaredFit.gender, q.gender) || !equal(e.declaredFit.religiousFit, q.religiousFit)) return false;
    if (q.verification !== "all" && e.verification.status !== q.verification) return false;
    const haystack = normalize([e.name, e.location, ...e.services, e.phone, phoneKey(e.phone), e.email, e.website, e.privateNotes].join(" "));
    return !q.search || normalize(q.search).split(" ").every(term => haystack.includes(term));
  }).sort((a, b) => collator.compare(a.entry.name, b.entry.name) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(selected.length / q.pageSize)), page = Math.min(q.page, pages);
  return { items: selected.slice((page - 1) * q.pageSize, page * q.pageSize), total: selected.length, page, pageSize: q.pageSize,
    options: { services: unique(rows.flatMap(r => r.entry.services)), locations: unique(rows.map(r => r.entry.location)),
      genders: unique(rows.map(r => r.entry.declaredFit.gender)), religiousFits: unique(rows.map(r => r.entry.declaredFit.religiousFit)) } };
}
export interface WriteReceipt { id: string; version: number; replayed: boolean; }
const knownPreReceiptFailure = new Set<ProblemCode>(["INVALID_REQUEST", "CONFLICT", "FORBIDDEN", "NOT_FOUND"]);
/** Once a write has an unknown outcome, no later denial may discard its stable
 * operation ID. Only receipt plus current readback, or an explicit no-commit
 * proof, can clear that state. */
export function writeFailureIsUncertain(previouslyUncertain: boolean, receivedReceipt: boolean, code?: string): boolean {
  return previouslyUncertain || receivedReceipt || !knownPreReceiptFailure.has(code as ProblemCode);
}
export type ProviderCommand =
  | { action: "search"; query: ProviderQuery }
  | { action: "read"; id: string }
  | { action: "create"; operationId: string; id: string; entry: ProviderInput; allowDuplicate: boolean }
  | { action: "update"; operationId: string; id: string; expectedVersion: number; entry: ProviderInput; allowDuplicate: boolean }
  | { action: "archive"; operationId: string; id: string; expectedVersion: number; archived: boolean };
export function version(value: unknown): number {
  requireValue(Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < 2147483647); return Number(value);
}
export function parseProviderCommand(value: unknown): ProviderCommand {
  requireValue(value && typeof value === "object" && !Array.isArray(value)); const action = (value as Record<string, unknown>).action;
  if (action === "search") { const v = object(value, ["action", "query"]); return { action, query: parseQuery(v.query) }; }
  if (action === "read") { const v = object(value, ["action", "id"]); return { action, id: uuid(v.id) }; }
  if (action === "create" || action === "update") {
    const v = object(value, ["action", "operationId", "id", "entry", "allowDuplicate", ...(action === "update" ? ["expectedVersion"] : [])]);
    requireValue(v.allowDuplicate === undefined || typeof v.allowDuplicate === "boolean");
    const common = { operationId: uuid(v.operationId), id: uuid(v.id), entry: parseProvider(v.entry), allowDuplicate: v.allowDuplicate === true };
    return action === "create" ? { action, ...common } : { action, ...common, expectedVersion: version(v.expectedVersion) };
  }
  if (action === "archive") {
    const v = object(value, ["action", "operationId", "id", "expectedVersion", "archived"]); requireValue(typeof v.archived === "boolean");
    return { action, operationId: uuid(v.operationId), id: uuid(v.id), expectedVersion: version(v.expectedVersion), archived: v.archived };
  }
  throw new ProviderProblem("INVALID_REQUEST", "UNKNOWN_ACTION");
}
