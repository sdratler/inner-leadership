import { afterEach, expect, test, vi } from "vitest";
import { IdentityClientError } from "../../../src/features/identity/client.ts";
import { checkInAttempt, checkInReadback, ownCheckInHistory, practiceAccessLost, practiceAudiences, practiceOccurrences, practiceRangeOccurrences, practiceSaveUncertain, submitPracticeCheckIn } from "../../../src/features/home-practice/occurrence-client.ts";
import { asId } from "../../../src/lib/ids.ts";
import type { OwnCompletionView } from "../../../src/features/home-practice/types.ts";
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
    .mockResolvedValueOnce(ok([{ authorAccountId: id, status: "done", idempotencyKey:id }]));
  vi.stubGlobal("fetch", fetcher); const signal = new AbortController().signal;
  expect(await practiceAudiences(id, signal)).toEqual(["shared"]);
  expect(await practiceOccurrences(id, "shared", "2026-09-29", "2026-09-30", signal)).toEqual({ items: [], hasMore: false });
  expect(await ownCheckInHistory(id, signal)).toEqual([{ authorAccountId: id, status: "done", idempotencyKey:id }]);
  expect(fetcher.mock.calls[3]![0]).toBe(`/api/checkins?occurrenceId=${id}&scope=own`);
  for (const call of fetcher.mock.calls) expect(call[1].method).toBe("GET");
});
test("calendar discovery includes every authorized published audience, not just the first", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([
    {id:"first",published:true,visibility:"family_full"},{id:"second",published:true,visibility:"family_title_completion"},
    {id:"private",published:true,visibility:"private"},{id:"draft",published:false,visibility:"family_full"},
  ])));
  expect(await practiceAudiences(id,new AbortController().signal)).toEqual(["first","second"]);
});
const audiences = [{id:"first",published:true,visibility:"family_full"},{id:"second",published:true,visibility:"family_full"}];
const occurrence = (name:string,period="morning",day="2026-09-29") => ({occurrence:{id:name,period,occursOn:day}});
test("combined Calendar practice is globally ordered and includes a non-first audience", async()=>{
 const first=occurrence("evening","evening"),second=occurrence("morning");
 const fetcher=vi.fn().mockResolvedValueOnce(ok(audiences)).mockResolvedValueOnce(ok({items:[first],hasMore:false})).mockResolvedValueOnce(ok({items:[second],hasMore:false}));vi.stubGlobal("fetch",fetcher);
 expect(await practiceRangeOccurrences(id,undefined,"2026-09-29","2026-09-30",new AbortController().signal)).toEqual({items:[second,first],hasMore:false});
 expect(fetcher.mock.calls[1]![0]).toContain("audienceId=first");expect(fetcher.mock.calls[2]![0]).toContain("audienceId=second");for(const call of fetcher.mock.calls)expect(call[1].method).toBe("GET");
});
test("combined practice applies an honest global 500-item cap and deduplicates occurrence IDs",async()=>{
 const first=Array.from({length:300},(_,index)=>occurrence(`a-${String(index).padStart(3,"0")}`)),second=Array.from({length:201},(_,index)=>occurrence(`b-${String(index).padStart(3,"0")}`));
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(ok(audiences)).mockResolvedValueOnce(ok({items:first,hasMore:false})).mockResolvedValueOnce(ok({items:[...second,first[0]],hasMore:false})));
 const page=await practiceRangeOccurrences(id,undefined,"2026-09-29","2026-09-30",new AbortController().signal);expect(page.items).toHaveLength(500);expect(page.hasMore).toBe(true);expect(new Set(page.items.map(row=>row.occurrence.id)).size).toBe(500);
});
test("a failed authorized audience is not silently converted to partial success or an empty Calendar",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(ok(audiences)).mockResolvedValueOnce(ok({items:[occurrence("first")],hasMore:false})).mockResolvedValueOnce(new Response(JSON.stringify({ok:false,error:{code:"NOT_FOUND"}}),{status:404})));
 await expect(practiceRangeOccurrences(id,undefined,"2026-09-29","2026-09-30",new AbortController().signal)).rejects.toMatchObject({code:"NOT_FOUND"});
});
test("an explicit protected audience does not discover or substitute unrelated audiences",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(ok({items:[],hasMore:true}));vi.stubGlobal("fetch",fetcher);
 expect(await practiceRangeOccurrences(id,"selected","2026-09-29","2026-09-30",new AbortController().signal)).toEqual({items:[],hasMore:true});expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![0]).toContain("audienceId=selected");
});
test("malformed audience discovery fails closed rather than falsely declaring no scheduled practice",async()=>{
 for(const response of [[null],[{id:"bad",published:true,visibility:"unknown"}],[{id:"bad",visibility:"family_full"}]]){
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(ok(response)));await expect(practiceAudiences(id,new AbortController().signal)).rejects.toMatchObject({code:"UNAVAILABLE"});
 }
});
test("own-history rejects an unexpectedly shared response rather than concealing a server disclosure", async () => {
  const fetcher=vi.fn().mockResolvedValueOnce(ok({accountId:id})).mockResolvedValueOnce(ok([{authorAccountId:"other",status:"done",idempotencyKey:id}]));vi.stubGlobal("fetch",fetcher);
  await expect(ownCheckInHistory(id,new AbortController().signal)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
test.each(["recorded","superseded","pending"] as const)("receipt readback reconciles %s without comparing only the latest status", state => {
  const attempt=checkInAttempt(id,"done");
  const row:OwnCompletionView={reportId:asId(id,"completion_report"),occurrenceId:asId(id,"occurrence"),authorAccountId:asId(id,"account"),status:"done",revision:1,reportedAt:"2026-09-29T06:00:00.000Z",correctedReportId:null,idempotencyKey:attempt.idempotencyKey};
  const newer:OwnCompletionView={...row,reportId:asId("00000000-0000-4000-8000-000000000002","completion_report"),status:"not_done",revision:2,correctedReportId:row.reportId,idempotencyKey:crypto.randomUUID()};
  expect(checkInReadback(attempt,state==="pending"?[]:state==="superseded"?[row,newer]:[row])).toBe(state);
});
test.each(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"] as const)("%s is an access denial, not an uncertain retry", code => {
  const error = new IdentityClientError(code); expect(practiceAccessLost(error)).toBe(true); expect(practiceSaveUncertain(error)).toBe(false);
});
test("conflict preserves selection but requires readback; malformed data is not success", async () => {
  expect(practiceSaveUncertain(new IdentityClientError("CONFLICT"))).toBe(false);
  const fetcher = vi.fn().mockResolvedValue(ok({ items: "not-an-array", hasMore: false })); vi.stubGlobal("fetch", fetcher);
  await expect(practiceOccurrences(id, id, "2026-09-29", "2026-09-30", new AbortController().signal)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
