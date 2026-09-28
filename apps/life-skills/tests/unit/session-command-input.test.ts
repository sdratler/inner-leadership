import { afterEach, expect, test, vi } from "vitest";
import { sessionCommandInput } from "../../src/features/session-workflow/command-input.ts";
import { blankMetrics } from "../../src/features/session-workflow/metrics.ts";
vi.mock("../../src/features/identity/client.ts", () => ({ sessionInfo: async () => ({ csrfToken: "synthetic-csrf" }) }));
import { sessionCommand } from "../../src/features/session-workflow/client.ts";
const id = "123e4567-e89b-42d3-a456-426614174000", key = "223e4567-e89b-42d3-a456-426614174000";
afterEach(() => vi.unstubAllGlobals());
test.each(["observations", "recap", "share"])("removes only the matching redundant session identity for %s", operation => {
  const body = { sessionId: id, expectedRevision: 0, values: blankMetrics(), unexpected: "strict server must reject this" };
  expect(sessionCommandInput(`/${id}/${operation}`, body)).toEqual({ expectedRevision: 0, values: body.values, unexpected: body.unexpected });
  expect(body.sessionId).toBe(id);
  expect(() => sessionCommandInput(`/${id}/${operation}`, { ...body, sessionId: key })).toThrow("INVALID_REQUEST");
});
test("does not sanitize unrelated routes, keys or invalid identities", () => {
  const body = { sessionId: id, signedByAccountId: key };
  for (const path of ["/ensure", `/${id}/consent`, `/${id}/speakers`, `/${id}/observations?caseId=${key}`, "/not-a-uuid/recap"]) expect(sessionCommandInput(path, body)).toBe(body);
  const clean = { expectedRevision: 0, values: blankMetrics() };
  expect(sessionCommandInput(`/${id}/observations`, clean)).toBe(clean);
});
test("actual transport sends strict projected body and reconciles an identical snapshot/key after ambiguity", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 })).mockResolvedValueOnce(Response.json({ ok: true, data: { revision: 1 } }));
  vi.stubGlobal("fetch", fetcher);
  const input = { sessionId: id, values: blankMetrics(), expectedRevision: 0 }, port = sessionCommand<typeof input, { revision: number }>(`/${id}/observations`);
  expect(await port.execute(input, key)).toEqual({ state: "unknown" });
  input.values.engagement = { score: 10, notObservedReason: null, note: "later edit must not alter pending retry" };
  expect(await port.reconcile(key)).toEqual({ state: "accepted", value: { revision: 1 } });
  const first = fetcher.mock.calls[0]![1] as RequestInit, second = fetcher.mock.calls[1]![1] as RequestInit;
  expect(first.body).toBe(second.body); expect(JSON.parse(String(first.body))).not.toHaveProperty("sessionId");
  expect(JSON.parse(String(first.body)).values.engagement.score).toBeNull();
  expect(first.headers).toMatchObject({ "Idempotency-Key": key, "X-CSRF-Token": "synthetic-csrf" }); expect(second.headers).toEqual(first.headers);
  expect(await port.reconcile(key)).toMatchObject({ state: "rejected" });
});
test("mismatched identity is rejected before any network write", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await sessionCommand(`/${id}/recap`).execute({ sessionId: key }, key)).toEqual({ state: "rejected", message: "INVALID_REQUEST" });
  expect(fetcher).not.toHaveBeenCalled();
});
