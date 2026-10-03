import { afterEach, expect, test, vi } from "vitest";
import { sessionCommandInput } from "../../src/features/session-workflow/command-input.ts";
import { blankMetrics } from "../../src/features/session-workflow/metrics.ts";
vi.mock("../../src/features/identity/client.ts", () => ({ sessionInfo: async () => ({ csrfToken: "synthetic-csrf" }) }));
import { sessionCommand,sessionSpeakerCommand } from "../../src/features/session-workflow/client.ts";
const id = "123e4567-e89b-42d3-a456-426614174000", key = "223e4567-e89b-42d3-a456-426614174000";
afterEach(() => vi.unstubAllGlobals());
test("speaker capacity rejection clears the pending request without retrying a permanent failure",async()=>{
 const input={sessionId:id,transcriptVersion:1,expectedRevision:100,labels:{constructor:"DEMO — Unsaved correction"}},fetcher=vi.fn().mockResolvedValue(Response.json({ok:false,error:{code:"PAYLOAD_TOO_LARGE"}},{status:413}));
 vi.stubGlobal("fetch",fetcher);const port=sessionSpeakerCommand(id);
 expect(await port.execute(input,key)).toEqual({state:"rejected",message:"PAYLOAD_TOO_LARGE"});expect(input.labels.constructor).toBe("DEMO — Unsaved correction");
 expect(await port.reconcile(key)).toEqual({state:"rejected",message:"No unresolved request"});expect(fetcher).toHaveBeenCalledTimes(1);
});
test.each(["observations", "recap", "share","speakers"])("removes only the matching redundant session identity for %s", operation => {
  const body = { sessionId: id, expectedRevision: 0, values: blankMetrics(), unexpected: "strict server must reject this" };
  expect(sessionCommandInput(`/${id}/${operation}`, body)).toEqual({ expectedRevision: 0, values: body.values, unexpected: body.unexpected });
  expect(body.sessionId).toBe(id);
  expect(sessionCommandInput(`/${id.toUpperCase()}/${operation}`, body)).toEqual({ expectedRevision: 0, values: body.values, unexpected: body.unexpected });
  expect(sessionCommandInput(`/${id}/${operation}`, { ...body, sessionId: id.toUpperCase() })).toEqual({ expectedRevision: 0, values: body.values, unexpected: body.unexpected });
  expect(() => sessionCommandInput(`/${id}/${operation}`, { ...body, sessionId: key })).toThrow("INVALID_REQUEST");
});
test("does not sanitize unrelated routes, keys or invalid identities", () => {
  const body = { sessionId: id, signedByAccountId: key };
  for (const path of ["/ensure", `/${id}/consent`, `/${id}/speaker-unknown`, `/${id}/observations?caseId=${key}`, "/not-a-uuid/recap"]) expect(sessionCommandInput(path, body)).toBe(body);
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
test("speaker write stays unknown until protected exact-revision readback, replaying the original key/body",async()=>{
 const recordedAt="2026-10-01T21:00:00.000Z",receipt={version:1,revision:1,recordedAt},labels=Object.fromEntries([["__proto__","DEMO — Name"]]),input={sessionId:id,transcriptVersion:1,expectedRevision:0,labels};
 const history={versions:[{...receipt,labels}]},fetcher=vi.fn().mockResolvedValueOnce(Response.json({ok:true,data:receipt})).mockResolvedValueOnce(Response.json({ok:false},{status:503})).mockResolvedValueOnce(Response.json({ok:true,data:receipt})).mockResolvedValueOnce(Response.json({ok:true,data:{sessionId:id,privateRecords:{transcript:{version:1,speakerHistory:history}}}}));
 vi.stubGlobal("fetch",fetcher);const port=sessionSpeakerCommand(id);expect(await port.execute(input,key)).toEqual({state:"unknown"});
 labels.__proto__="later unsaved change";expect(await port.reconcile(key)).toEqual({state:"accepted",value:receipt});
 expect(fetcher.mock.calls[0]![1]).toEqual(fetcher.mock.calls[2]![1]);expect(JSON.parse(String(fetcher.mock.calls[2]![1].body)).labels.__proto__).toBe("DEMO — Name");expect(await port.reconcile(key)).toMatchObject({state:"rejected"});
});
test.each(["scope","labels","revision","timestamp"])("speaker readback mismatch %s cannot become saved",async field=>{
 const recordedAt="2026-10-01T21:00:00.000Z",receipt={version:1,revision:1,recordedAt},input={sessionId:id,transcriptVersion:1,expectedRevision:0,labels:{constructor:"DEMO — Own"}};
 const detail={sessionId:field==="scope"?key:id,privateRecords:{transcript:{version:1,speakerHistory:{versions:[{revision:field==="revision"?2:1,recordedAt:field==="timestamp"?"2026-10-01T20:00:00.000Z":recordedAt,labels:field==="labels"?{}:input.labels}]}}}};
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json({ok:true,data:receipt})).mockResolvedValueOnce(Response.json({ok:true,data:detail})));
 expect(await sessionSpeakerCommand(id).execute(input,key)).toEqual({state:"unknown"});
});
test("speaker receipt is confirmed from its protected historical version after a newer transcript arrives",async()=>{
 const receipt={version:1,revision:1,recordedAt:"2026-10-01T21:00:00.000Z"},input={sessionId:id,transcriptVersion:1,expectedRevision:0,labels:{constructor:"DEMO — Historical correction"}};
 const fetcher=vi.fn(async(path:string,options?:RequestInit)=>options?.method==="POST"?Response.json({ok:true,data:receipt}):Response.json({ok:true,data:{sessionId:id,privateRecords:{transcript:{version:path.endsWith('?transcriptVersion=1')?1:2,speakerHistory:{versions:[{revision:1,recordedAt:receipt.recordedAt,labels:input.labels}]}}}}}));
 vi.stubGlobal("fetch",fetcher);expect(await sessionSpeakerCommand(id).execute(input,key)).toEqual({state:"accepted",value:receipt});expect(fetcher.mock.calls[1]![0]).toBe(`/api/sessions/${id}?transcriptVersion=1`);
});
