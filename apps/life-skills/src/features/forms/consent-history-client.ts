import { IdentityClientError, type IdentityClientErrorCode } from "../identity/client.ts";
import { consentHistoryCursorSchema, consentHistoryPageSchema, type ConsentHistoryKind, type ConsentHistoryPage } from "./consent-history.ts";
const codes: readonly IdentityClientErrorCode[] = ["INVALID_REQUEST", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "UNAVAILABLE", "INTERNAL"];

/** Normal same-origin authenticated GET only. Never accept private evidence fields. */
export async function readConsentHistory(caseId: string, kind: ConsentHistoryKind, cursor: string | null, signal: AbortSignal): Promise<ConsentHistoryPage> {
  if (cursor !== null && !consentHistoryCursorSchema.safeParse(cursor).success) throw new IdentityClientError("INVALID_REQUEST");
  try {
    const query = new URLSearchParams({ caseId, kind, ...(cursor ? { cursor } : {}) });
    const response = await fetch("/api/forms/consent-history?" + query, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal });
    const body = await response.json() as { ok?: boolean; data?: unknown; error?: { code?: string } };
    if (!response.ok || body.ok !== true) throw new IdentityClientError(codes.includes(body.error?.code as IdentityClientErrorCode) ? body.error!.code as IdentityClientErrorCode : "UNAVAILABLE");
    const parsed = consentHistoryPageSchema.safeParse(body.data);
    if (!parsed.success || parsed.data.caseId !== caseId || parsed.data.kind !== kind) throw new IdentityClientError("UNAVAILABLE");
    return parsed.data;
  } catch (error) {
    if (signal.aborted || error instanceof IdentityClientError) throw error;
    throw new IdentityClientError("UNAVAILABLE");
  }
}
