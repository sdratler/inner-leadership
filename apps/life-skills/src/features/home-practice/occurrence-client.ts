import { IdentityClientError, sessionInfo } from "../identity/client.ts";
import type { IdentityClientErrorCode } from "../identity/client.ts";
import type { CompletionStatus, OwnCompletionView, PracticeOccurrencePage } from "./types.ts";
import { isVisibility } from "../../lib/visibility.ts";

const codes: readonly IdentityClientErrorCode[] = ["INVALID_REQUEST", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "UNAVAILABLE", "INTERNAL"];
async function privateRequest<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(path, { ...init, ...(signal ? { signal } : {}), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    const body = await response.json() as { ok?: boolean; data?: T; error?: { code?: string } };
    if (response.ok && body?.ok === true && Object.hasOwn(body, "data")) return body.data as T;
    throw new IdentityClientError(codes.includes(body?.error?.code as IdentityClientErrorCode) ? body.error!.code as IdentityClientErrorCode : "UNAVAILABLE");
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof IdentityClientError) throw error;
    throw new IdentityClientError("UNAVAILABLE");
  }
}
export async function practiceAudiences(caseId: string, signal: AbortSignal): Promise<string[]> {
  const rows = await privateRequest<Array<{ id: string; published: boolean; visibility: string }>>(
    "/api/identity/audiences?" + new URLSearchParams({ caseId }), { method: "GET" }, signal);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== "string" || !row.id || typeof row.published !== "boolean" || !isVisibility(row.visibility))) throw new IdentityClientError("UNAVAILABLE");
  return [...new Set(rows.filter(row => row.published && row.visibility !== "private").map(row => row.id))];
}
export async function practiceOccurrences(caseId: string, audienceId: string, from: string, to: string, signal: AbortSignal): Promise<PracticeOccurrencePage> {
  const page = await privateRequest<PracticeOccurrencePage>("/api/home-practice?" + new URLSearchParams({ view: "occurrences", caseId, audienceId, from, to }), { method: "GET" }, signal);
  if (!page || !Array.isArray(page.items) || typeof page.hasMore !== "boolean") throw new IdentityClientError("UNAVAILABLE");
  return page;
}
/** All freshly authorized audiences, bounded concurrency and an explicit global cap. */
export async function practiceRangeOccurrences(caseId: string, audienceId: string | undefined, from: string, to: string, signal: AbortSignal): Promise<PracticeOccurrencePage> {
  const audiences = audienceId ? [audienceId] : await practiceAudiences(caseId, signal);
  const pages: PracticeOccurrencePage[] = [];
  for (let index = 0; index < audiences.length; index += 4) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    pages.push(...await Promise.all(audiences.slice(index, index + 4).map(id => practiceOccurrences(caseId, id, from, to, signal))));
  }
  const items = [...new Map(pages.flatMap(page => page.items).map(item => [item.occurrence.id, item])).values()]
    .sort((a, b) => a.occurrence.occursOn.localeCompare(b.occurrence.occursOn) || (a.occurrence.period === b.occurrence.period ? 0 : a.occurrence.period === "morning" ? -1 : 1) || a.occurrence.id.localeCompare(b.occurrence.id));
  return { items: items.slice(0, 500), hasMore: items.length > 500 || pages.some(page => page.hasMore) };
}

export interface CheckInAttempt {
  readonly occurrenceId: string;
  readonly status: CompletionStatus;
  readonly idempotencyKey: string;
  readonly correctsReportId?: string;
}
/** Retain this exact body on uncertain failure; never generate a key per retry. */
export function checkInAttempt(occurrenceId: string, status: CompletionStatus, correctsReportId?: string): CheckInAttempt {
  return Object.freeze({ occurrenceId, status, idempotencyKey: crypto.randomUUID(), ...(correctsReportId ? { correctsReportId } : {}) });
}
export async function submitPracticeCheckIn(attempt: CheckInAttempt, signal: AbortSignal): Promise<void> {
  const session = await sessionInfo();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await privateRequest("/api/checkins", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken }, body: JSON.stringify(attempt) }, signal);
}
export async function ownCheckInHistory(occurrenceId: string, signal: AbortSignal): Promise<OwnCompletionView[]> {
  const session = await sessionInfo();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const rows = await privateRequest<OwnCompletionView[]>("/api/checkins?" + new URLSearchParams({ occurrenceId, scope: "own" }), { method: "GET" }, signal);
  if (!Array.isArray(rows) || rows.some(row => row.authorAccountId !== session.accountId || typeof row.idempotencyKey !== "string")) throw new IdentityClientError("UNAVAILABLE");
  return rows;
}
/** Reconcile the actual retry receipt, not merely the newest visible status. */
export function checkInReadback(attempt: CheckInAttempt, rows: readonly OwnCompletionView[]): "pending" | "recorded" | "superseded" {
  const recorded = rows.find(row => row.idempotencyKey === attempt.idempotencyKey);
  if (!recorded) return "pending";
  if (recorded.occurrenceId !== attempt.occurrenceId || recorded.status !== attempt.status || recorded.correctedReportId !== (attempt.correctsReportId ?? null)) throw new IdentityClientError("UNAVAILABLE");
  return rows.at(-1)?.reportId === recorded.reportId ? "recorded" : "superseded";
}
export function practiceAccessLost(error: unknown): boolean {
  return error instanceof IdentityClientError && ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(error.code);
}
export function practiceSaveUncertain(error: unknown): boolean {
  return !(error instanceof IdentityClientError) || ["UNAVAILABLE", "INTERNAL"].includes(error.code);
}
