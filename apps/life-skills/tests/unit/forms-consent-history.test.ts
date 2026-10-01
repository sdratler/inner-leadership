import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { consentHistoryPageSchema, consentHistoryState, formSubmissionReadback, type ConsentHistoryItem } from "../../src/features/forms/consent-history.ts";
import { readConsentHistory } from "../../src/features/forms/consent-history-client.ts";
import { ConsentHistoryRecord, ConsentHistoryWorkspace } from "../../src/features/forms/consent-history-workspace.tsx";
import { readFileSync } from "node:fs";

const caseId = "123e4567-e89b-42d3-a456-426614174000", id = "223e4567-e89b-42d3-a456-426614174000", actor = "323e4567-e89b-42d3-a456-426614174000";
const now = "2026-10-01T12:00:00.000Z";
const recording: ConsentHistoryItem = { kind: "recording", id, version: 2, signedByAccountId: actor, signedAt: "2026-09-01T12:00:00.000Z", withdrawnAt: null, authorityState: "checked", recordingAllowed: true, transcriptionAllowed: false, aiProcessingAllowed: false, childInformed: true, policyVersion: "DEMO-policy-v2", isCurrent: true };
const disclosure: ConsentHistoryItem = { kind: "disclosure", id, sessionId: null, channel: "phone", authorizedByAccountId: actor, recordedByPractitionerId: actor, childDiscussionRecorded: true, authorizedAt: "2026-09-01T12:00:00.000Z", expiresAt: "2026-12-01T12:00:00.000Z", revokedAt: null, usedAt: null };
const page = { caseId, kind: "recording", observedAt: now, items: [recording], nextCursor: null, hasMore: false };
afterEach(() => vi.unstubAllGlobals());

it("accepts only its bounded explicit metadata envelope, never private payloads or mixed histories", () => {
  expect(consentHistoryPageSchema.safeParse(page).success).toBe(true);
  for (const changed of [
    { ...page, items: [{ ...recording, evidenceCiphertext: "private" }] },
    { ...page, items: [disclosure] }, { ...page, items: [recording, recording] },
    { ...page, hasMore: true }, { ...page, nextCursor: "abc" },
    { ...page, items: Array(51).fill(recording) },
  ]) expect(consentHistoryPageSchema.safeParse(changed).success).toBe(false);
});
it("labels withdrawal/revocation/expiry before flags or recorded use, without claiming successful delivery", () => {
  expect(consentHistoryState(recording, now)).toBe("checked");
  expect(consentHistoryState({ ...recording, withdrawnAt: now }, now)).toBe("withdrawn");
  expect(consentHistoryState({ ...recording, isCurrent: false }, now)).toBe("superseded");
  expect(consentHistoryState(disclosure, now)).toBe("recorded_authorization");
  expect(consentHistoryState({ ...disclosure, usedAt: now }, now)).toBe("recorded_use");
  expect(consentHistoryState({ ...disclosure, usedAt: now, expiresAt: now }, now)).toBe("expired");
  expect(consentHistoryState({ ...disclosure, revokedAt: now }, now)).toBe("revoked");
});
it("uses authenticated GET, exact scope and no-store; rejects mismatched or private readbacks", async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true, data: page })); vi.stubGlobal("fetch", fetch);
  expect(await readConsentHistory(caseId, "recording", null, new AbortController().signal)).toEqual(page);
  expect(fetch.mock.calls[0]).toMatchObject(["/api/forms/consent-history?caseId=" + caseId + "&kind=recording", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" }]);
  for (const value of [{ ...page, caseId: id }, { ...page, items: [{ ...recording, answers: "private" }] }]) {
    fetch.mockImplementation(async () => Response.json({ ok: true, data: value }));
    await expect(readConsentHistory(caseId, "recording", null, new AbortController().signal)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  }
  await expect(readConsentHistory(caseId, "recording", "invalid/../", new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
it.each([401, 403, 404, 429, 503])("keeps actual read failure %i as a failure with no fake success", async status => {
  const codes = { 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 429: "RATE_LIMITED", 503: "UNAVAILABLE" };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: codes[status as keyof typeof codes] } }, { status })));
  await expect(readConsentHistory(caseId, "recording", null, new AbortController().signal)).rejects.toMatchObject({ code: codes[status as keyof typeof codes] });
});
it("does not invent a signed agreement, consent permission or provider action in the actual component", () => {
  const en = renderToStaticMarkup(createElement(ConsentHistoryRecord, { locale: "en", caseId, item: recording, observedAt: now }));
  const he = renderToStaticMarkup(createElement(ConsentHistoryRecord, { locale: "he", caseId, item: { ...disclosure, usedAt: now }, observedAt: now }));
  expect(en).toContain("Recorded signature date"); expect(en).toContain("DEMO-policy-v2"); expect(en).toContain("Not allowed / not recorded");
  expect(en).toContain("<summary>Recorded version 2"); expect(en).not.toContain("<details open");
  expect(he).toContain("לא הוכחת מסירה"); expect(he).not.toContain("<button");
  const closed = renderToStaticMarkup(createElement(ConsentHistoryWorkspace, { locale: "en", caseId }));
  expect(closed).toContain("<details"); expect(closed).not.toContain("<details open"); expect(closed).toContain("does not authorize recording");
  const source = readFileSync(new URL("../../src/features/forms/consent-history-read.ts", import.meta.url), "utf8");
  expect(source).toContain("READ ONLY"); expect(source).toContain("LIMIT 51"); expect(source).not.toMatch(/SELECT[^`]*(?:evidence_ciphertext|recipient_ciphertext|topic_ciphertext|purpose_ciphertext)/);
});
it("confirms a real assigned-author submission receipt, not HTTP success or a flag alone", () => {
  const assignment = { id, state: "submitted", assignedAccountId: actor, submissionId: caseId, submissionAuthorAccountId: actor, submittedAt: now };
  expect(formSubmissionReadback(assignment, id, caseId)).toBe(true);
  for (const changes of [{ state: "assigned" }, { submissionId: id }, { submissionAuthorAccountId: id }, { submittedAt: null }])
    expect(formSubmissionReadback({ ...assignment, ...changes }, id, caseId)).toBe(false);
});
