import { afterEach, expect, test, vi } from "vitest";
import { IdentityClientError } from "../../../src/features/identity/client.ts";
import { checkInAttempt, ownCheckInHistory, practiceAccessLost, practiceAudience, practiceOccurrences, practiceSaveUncertain, submitPracticeCheckIn } from "../../../src/features/home-practice/occurrence-client.ts";
afterEach(() => vi.unstubAllGlobals());
const id = "00000000-0000-4000-8000-000000000001";
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
test("uncertain write retries the exact immutable body with fresh real-session CSRF", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(ok({ csrfToken: "first" })).mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(ok({ csrfToken: "second" })).mockResolvedValueOnce(ok({ status: "done" }));
  vi.stubGlobal("fetch", fetcher);
  const attempt = checkInAttempt(id, "done", id), controller = new AbortController();
  expect(Object.isFrozen(attempt)).toBe(true);
  await expect(submitPracticeCheckIn(attempt, controller.signal)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await submitPracticeCheckIn(attempt, controller.signal);
  expect(fetcher.mock.calls).toHaveLength(4);
  expect(fetcher.mock.calls[1]![1].body).toBe(fetcher.mock.calls[3]![1].body);
  expect(fetcher.mock.calls[3]![1]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { "X-CSRF-Token": "second" } });
  expect(JSON.parse(fetcher.mock.calls[3]![1].body)).toEqual(attempt);
});
test("read paths never mutate and history returns only the current account's records", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(ok([{ id, published: true, visibility: "private" }, { id: "shared", published: true, visibility: "family_full" }]))
    .mockResolvedValueOnce(ok({ items: [], hasMore: false })).mockResolvedValueOnce(ok({ accountId: id }))
    .mockResolvedValueOnce(ok([{ authorAccountId: "other", status: "not_done" }, { authorAccountId: id, status: "done" }]));
  vi.stubGlobal("fetch", fetcher); const signal = new AbortController().signal;
  expect(await practiceAudience(id, signal)).toBe("shared");
  expect(await practiceOccurrences(id, "shared", "2026-09-29", "2026-09-30", signal)).toEqual({ items: [], hasMore: false });
  expect(await ownCheckInHistory(id, signal)).toEqual([{ authorAccountId: id, status: "done" }]);
  for (const call of fetcher.mock.calls) expect(call[1].method).toBe("GET");
});
test.each(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"] as const)("%s is an access denial, not an uncertain retry", code => {
  const error = new IdentityClientError(code); expect(practiceAccessLost(error)).toBe(true); expect(practiceSaveUncertain(error)).toBe(false);
});
test("conflict preserves selection but requires readback; malformed data is not success", async () => {
  expect(practiceSaveUncertain(new IdentityClientError("CONFLICT"))).toBe(false);
  const fetcher = vi.fn().mockResolvedValue(ok({ items: "not-an-array", hasMore: false })); vi.stubGlobal("fetch", fetcher);
  await expect(practiceOccurrences(id, id, "2026-09-29", "2026-09-30", new AbortController().signal)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
