import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { consentRecordReadback, consentTimeCandidates, consentVersionSchema, type ConsentRecordInput, type ConsentVersion } from "../../src/features/session-workflow/consent-contract.ts";
import { consentRecordPort, consentWithdrawalPort, readConsentVersion } from "../../src/features/session-workflow/consent-client.ts";
import { SessionConsentPanel } from "../../src/features/session-workflow/consent-panel.tsx";
import type { SessionDetail } from "../../src/features/session-workflow/database.ts";
import { blankMetrics } from "../../src/features/session-workflow/metrics.ts";
import { PractitionerSessionDesk, sessionAppointmentLabel } from "../../src/ui/revamp/session-desk.tsx";

vi.mock("../../src/features/identity/client.ts", () => ({ sessionInfo: vi.fn(async () => ({ csrfToken: "synthetic-csrf" })) }));
const scope = { workspaceId: "123e4567-e89b-42d3-a456-426614174000", caseId: "223e4567-e89b-42d3-a456-426614174000", sessionId: "323e4567-e89b-42d3-a456-426614174000" };
const signer = "423e4567-e89b-42d3-a456-426614174000", consentId = "523e4567-e89b-42d3-a456-426614174000", key = "623e4567-e89b-42d3-a456-426614174000";
const input: ConsentRecordInput = { signedByAccountId: signer, signedAt: "2026-09-21T10:15:31.000Z", authorityState: "needs_review", recordingAllowed: false, transcriptionAllowed: false, aiProcessingAllowed: false, childInformed: false, policyVersion: "DEMO-existing-document-v3", evidence: "DEMO — Actual synthetic signature and restriction evidence", expectedVersion: 0 };
const saved: ConsentVersion = { ...scope, consentId, version: 1, signedByAccountId: signer, signedAt: input.signedAt, authorityState: input.authorityState, recordingAllowed: false, transcriptionAllowed: false, aiProcessingAllowed: false, childInformed: false, policyVersion: input.policyVersion, evidence: input.evidence, withdrawnAt: null };
const receipt = { consentId, version: 1, permissionToRecord: false };
const envelope = (data: unknown) => Response.json({ ok: true, data });
afterEach(() => vi.unstubAllGlobals());

it("requires exact bounded consent metadata, not a concurrency guard or private ciphertext", () => {
  expect(consentVersionSchema.safeParse(saved).success).toBe(true);
  for (const change of [{ expectedVersion: 0 }, { evidenceCiphertext: "secret" }, { evidence: "x".repeat(4001) }, { version: 0 }, { version: 2147483648 }, { signedAt: "2026-02-30T10:00:00Z" }, { signedByAccountId: "not-an-account" }])
    expect(consentVersionSchema.safeParse({ ...saved, ...change }).success).toBe(false);
});
it("reads actual wall time with seconds and rejects impossible dates, invalid zones and DST gaps", () => {
  expect(consentTimeCandidates("2026-09-21T13:15:31", "Asia/Jerusalem")).toEqual([input.signedAt]);
  for (const [time, zone] of [["2026-02-30T10:00", "UTC"], ["2026-09-21T25:00", "UTC"], ["2026-09-21T10:00:99", "UTC"], ["2026-09-21T10:00", "invented"], ["2026-03-29T02:30", "Europe/Berlin"]])
    expect(consentTimeCandidates(time!, zone!)).toEqual([]);
  expect(consentTimeCandidates("2026-10-25T02:30", "Europe/Berlin")).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
});
it("confirms the exact recorded fields and version, never just a successful response", () => {
  expect(consentRecordReadback(saved, scope.sessionId, receipt, input)).toBe(true);
  expect(consentRecordReadback(saved, scope.sessionId, receipt, { ...input, signedAt: "2026-09-21T13:15:31+03:00" })).toBe(true);
  for (const change of [{ signedByAccountId: consentId }, { signedAt: "2026-09-21T10:15:00.000Z" }, { authorityState: "checked" as const }, { recordingAllowed: true }, { transcriptionAllowed: true }, { aiProcessingAllowed: true }, { childInformed: true }, { policyVersion: "other" }, { evidence: "other" }, { withdrawnAt: input.signedAt }, { sessionId: consentId }, { version: 2 }])
    expect(consentRecordReadback({ ...saved, ...change }, scope.sessionId, receipt, input)).toBe(false);
  expect(consentRecordReadback(saved, scope.sessionId, receipt, { ...input, expectedVersion: 1 })).toBe(false);
  expect(consentRecordReadback(saved, scope.sessionId, receipt, { ...input, signedAt: "invalid" })).toBe(false);
});
it("uses ordinary authenticated no-store reads and rejects a mismatched protected scope", async () => {
  const fetch = vi.fn(async () => envelope(saved)); vi.stubGlobal("fetch", fetch);
  expect(await readConsentVersion(scope, consentId, 1)).toEqual(saved);
  expect(fetch.mock.calls[0]).toMatchObject([`/api/sessions/${scope.sessionId}/consent?consentId=${consentId}&version=1`, { credentials: "same-origin", cache: "no-store" }]);
  for (const change of [{ caseId: consentId }, { workspaceId: consentId }, { sessionId: consentId }, { consentId: signer }, { version: 2 }]) {
    fetch.mockImplementation(async () => envelope({ ...saved, ...change }));
    await expect(readConsentVersion(scope, consentId, 1)).rejects.toThrow("UNAVAILABLE");
  }
});
it.each([401, 403, 404, 409, 503])("does not turn actual read failure %i into consent success", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: "UNAVAILABLE" } }, { status })));
  await expect(readConsentVersion(scope, consentId, 1)).rejects.toThrow("UNAVAILABLE");
});
it("after a committed write and failed read, explicit reconciliation performs only GET and preserves the exact input", async () => {
  let reads = 0;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "POST" ? envelope(receipt) : ++reads === 1 ? Response.json({ ok: false }, { status: 503 }) : envelope(saved));
  vi.stubGlobal("fetch", fetch); const port = consentRecordPort(scope), draft = { ...input };
  expect(await port.execute(draft, key)).toEqual({ state: "unknown" });
  draft.evidence = "Changed mutable caller object";
  expect(await port.execute(draft, key)).toEqual({ state: "rejected", message: "CONFLICT" });
  expect(await port.reconcile(key)).toEqual({ state: "accepted", value: saved });
  const writes = fetch.mock.calls.filter(([, init]) => init?.method === "POST"); expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]![1]!.body as string)).toEqual(input);
  expect(writes[0]![1]).toMatchObject({ credentials: "same-origin", cache: "no-store", headers: { "X-CSRF-Token": "synthetic-csrf", "Idempotency-Key": key } });
  expect(await port.reconcile(key)).toEqual({ state: "rejected", message: "INVALID_REQUEST" });
});
it.each(["lost", "malformed"])("explicitly reconciles a %s write receipt with the identical key and body, not a fresh version", async mode => {
  let writes = 0;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") return envelope(saved);
    if (++writes === 1) { if (mode === "lost") throw new Error("synthetic transport loss"); return envelope({ consentId, version: 0 }); }
    return envelope(receipt);
  });
  vi.stubGlobal("fetch", fetch); const port = consentRecordPort(scope), draft = { ...input };
  expect(await port.execute(draft, key)).toEqual({ state: "unknown" }); draft.evidence = "Do not replace pending input";
  expect(writes).toBe(1); expect(await port.reconcile(key)).toEqual({ state: "accepted", value: saved });
  const calls = fetch.mock.calls.filter(([, init]) => init?.method === "POST"); expect(calls).toHaveLength(2);
  for (const [, init] of calls) { expect(JSON.parse(init!.body as string)).toEqual(input); expect(init!.headers).toMatchObject({ "Idempotency-Key": key }); }
});
it("a mismatched committed readback stays unconfirmed; subsequent checks do not write again", async () => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => envelope(init?.method === "POST" ? receipt : { ...saved, evidence: "another record" }));
  vi.stubGlobal("fetch", fetch); const port = consentRecordPort(scope);
  expect(await port.execute(input, key)).toEqual({ state: "unknown" }); expect(await port.reconcile(key)).toEqual({ state: "unknown" });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});
it("known conflicts or permission denials retain rejection instead of an automatic retry", async () => {
  for (const code of ["CONFLICT", "NOT_FOUND", "UNAUTHENTICATED"]) {
    const fetch = vi.fn(async () => Response.json({ ok: false, error: { code } }, { status: code === "CONFLICT" ? 409 : code === "NOT_FOUND" ? 404 : 401 }));
    vi.stubGlobal("fetch", fetch); const port = consentRecordPort(scope);
    expect(await port.execute(input, key)).toEqual({ state: "rejected", message: code });
    expect(await port.reconcile(key)).toEqual({ state: "rejected", message: "INVALID_REQUEST" }); expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it("withdrawal is saved only after its own next version and actual withdrawal instant are read back", async () => {
  const withdrawnAt = "2026-10-01T12:00:00.000Z", withdrawn = { ...saved, version: 2, withdrawnAt };
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => envelope(init?.method === "POST" ? { consentId, version: 2, withdrawnAt } : withdrawn));
  vi.stubGlobal("fetch", fetch); expect(await consentWithdrawalPort(scope).execute({ expectedVersion: 1 }, key)).toEqual({ state: "accepted", value: withdrawn });
  fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => envelope(init?.method === "POST" ? { consentId, version: 2, withdrawnAt } : { ...withdrawn, withdrawnAt: input.signedAt }));
  expect(await consentWithdrawalPort(scope).execute({ expectedVersion: 1 }, key)).toEqual({ state: "unknown" });
});
it.each(["en", "he"] as const)("the retained %s component requires actual signature, policy and authority without pre-authorizing processing", locale => {
  const model: SessionDetail = { ...scope, clientDisplayName: "DEMO — Authorized client", selectedAppointmentId: consentId, appointments: [], processing: { state: null, audioState: null, message: "", permissionToRecord: false, consent: null }, transcript: null, analysis: null, metrics: blankMetrics(), metricsRevision: 0, recap: null, recapDigest: null, recipients: [{ accountId: signer, name: "DEMO — Parent" }], consentSigners: [{ accountId: signer, name: "DEMO — Parent" }] };
  const markup = renderToStaticMarkup(createElement(SessionConsentPanel, { locale, model, refresh: vi.fn() }));
  expect(markup).toContain(`dir="${locale === "he" ? "rtl" : "ltr"}"`);
  expect(markup).toContain('lsw-consent'); expect(markup.match(/class="lsw-choice"/g)).toHaveLength(4);
  expect(markup).toContain('value="needs_review" selected=""'); expect(markup).not.toContain('type="checkbox" checked');
  expect(markup).toContain('type="datetime-local"'); expect(markup).not.toContain(input.signedAt); expect(markup).not.toContain(input.policyVersion);
  expect(markup).toContain('value="" selected=""'); expect(markup).not.toContain("<details class=\"lsw-details\" open");
  expect(markup).toContain(locale === "en" ? "does not establish that one parent" : "אינה קובעת שהסכמת הורה אחד");
  const command = { async execute() { return { state: "rejected" as const, message: "unit-only" }; }, async reconcile() { return { state: "rejected" as const, message: "unit-only" }; } };
  const session = renderToStaticMarkup(createElement(PractitionerSessionDesk, { locale, model: { ...model, processing: { ...model.processing, message: "No recording uploaded." } }, actions: { upload: vi.fn(), refresh: vi.fn(), selectAnalysisLanguage: vi.fn(), saveRecap: command, speakers: command, metrics: command, share: command }, consentPanel: createElement(SessionConsentPanel, { locale, model, refresh: vi.fn() }) }));
  expect(session.indexOf("<h1>")).toBeLessThan(session.indexOf("lsw-consent")); expect(session.indexOf('aria-label="' + (locale === "en" ? "Session sections" : "חלקי המפגש") + '"')).toBeLessThan(session.indexOf("lsw-consent"));
  expect(session).toContain(locale === "en" ? "No recording uploaded." : "לא הועלתה הקלטה.");
});
it("formats actual appointment instants in the agreed Jerusalem zone without changing IDs or unknown labels", () => {
  expect(sessionAppointmentLabel("2026-09-24T08:00:00.000Z", "en")).toBe(new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date("2026-09-24T08:00:00.000Z")));
  expect(sessionAppointmentLabel("2026-09-24T08:00:00.000Z", "he")).not.toContain("T08:00");
  for (const label of ["constructor", "Unknown imported appointment text", "2026-02-30T08:00:00.000Z"]) expect(sessionAppointmentLabel(label, "he")).toBe(label);
});
