import {afterEach,expect,test,vi} from "vitest";
vi.mock("../../src/features/identity/client.ts",()=>({sessionInfo:vi.fn(async()=>({csrfToken:"SYNTHETIC-CSRF"}))}));
import {sessionRecapCommand,sessionRecapShareCommand,sessionRecapPreview,sessionRecapPracticeChoices} from "../../src/features/session-workflow/client.ts";
const id="00000000-0000-4000-8000-000000000001",person="00000000-0000-4000-8000-000000000002",publicationId="00000000-0000-4000-8000-000000000003",digest="a".repeat(64);
const recap={schemaVersion:1 as const,sessionId:id,caseId:person,version:1,locale:"he" as const,attendance:{appointmentId:person,state:"unrecorded" as const,source:"appointment_record" as const,revision:0,startsAt:"2026-10-01T10:00:00.000Z",arrivedAt:null},focus:["regulation" as const],practices:[],nextStep:"DEMO — הצעד הבא",nextAppointment:null};
const input={sessionId:id,expectedVersion:0,locale:recap.locale,focus:recap.focus,nextStep:recap.nextStep},saved={recap,digest},receipt={publicationId,sharedAt:"2026-10-02T10:00:00.000Z"},share={sessionId:id,expectedVersion:1,expectedDigest:digest,recipientAccountIds:[person]},proof={...receipt,sessionId:id,caseId:person,contentDigest:digest,recipientAccountIds:[person],recap};
const response=(data:unknown,status=200)=>new Response(JSON.stringify({ok:true,data}),{status});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
test("accepted save waits for exact authorized immutable readback; lost read retries the same body and key",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response(saved,201)).mockRejectedValueOnce(new Error("DEMO lost read")).mockResolvedValueOnce(response(saved,201)).mockResolvedValueOnce(response(saved));vi.stubGlobal("fetch",fetcher);const port=sessionRecapCommand(id),key=publicationId;
 expect(await port.execute(input,key)).toEqual({state:"unknown"});expect(await port.reconcile(key)).toEqual({state:"accepted",value:saved});expect(await port.reconcile(key)).toMatchObject({state:"rejected"});
 expect(fetcher.mock.calls[1]![0]).toBe(`/api/sessions/${id}/recap?version=1`);expect(fetcher.mock.calls[0]![1]).toEqual(fetcher.mock.calls[2]![1]);const options=fetcher.mock.calls[0]![1] as RequestInit;expect(options.headers).toMatchObject({"X-CSRF-Token":"SYNTHETIC-CSRF","Idempotency-Key":key});expect(JSON.parse(String(options.body))).not.toHaveProperty("sessionId");
});
test("wrong version/content/digest or private extras cannot produce Saved; a conflict retains no uncertain command",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 for(const wrong of [{...saved,recap:{...recap,version:2}},{...saved,recap:{...recap,nextStep:"different"}},{...saved,digest:"b".repeat(64)},{...saved,recap:{...recap,caseId:id}},{...saved,recap:{...recap,analysis:[]}}]){fetcher.mockResolvedValueOnce(response(saved,201)).mockResolvedValueOnce(response(wrong));expect(await sessionRecapCommand(id).execute(input,publicationId)).toEqual({state:"unknown"});}
 fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ok:false,error:{code:"CONFLICT"}}),{status:409}));const port=sessionRecapCommand(id);expect(await port.execute(input,publicationId)).toEqual({state:"rejected",message:"CONFLICT"});expect(await port.reconcile(publicationId)).toMatchObject({state:"rejected"});
});
test("publication must read back its exact version, recipient set, source digest and timestamp before Shared",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response(receipt,201)).mockRejectedValueOnce(new Error("DEMO lost receipt")).mockResolvedValueOnce(response(receipt,201)).mockResolvedValueOnce(response(proof));vi.stubGlobal("fetch",fetcher);const port=sessionRecapShareCommand(id);
 expect(await port.execute(share,publicationId)).toEqual({state:"unknown"});expect(await port.reconcile(publicationId)).toEqual({state:"accepted",value:receipt});expect(fetcher.mock.calls[0]![1]).toEqual(fetcher.mock.calls[2]![1]);expect(fetcher.mock.calls[1]![0]).toBe(`/api/sessions/${id}/publications/${publicationId}`);
 for(const wrong of [{...proof,recipientAccountIds:[id]},{...proof,contentDigest:"b".repeat(64)},{...proof,sharedAt:"2026-10-02T11:00:00Z"},{...proof,recap:{...recap,version:2}},{...proof,caseId:id}]){fetcher.mockResolvedValueOnce(response(receipt,201)).mockResolvedValueOnce(response(wrong));expect(await sessionRecapShareCommand(id).execute(share,publicationId)).toEqual({state:"unknown"});}
});
test("strict projections deny invented selectors before writes and preview checks exact selected audience",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);expect(await sessionRecapCommand(id).execute({...input,sessionId:person},publicationId)).toMatchObject({state:"rejected"});expect(await sessionRecapShareCommand(id).execute({...share,recipientAccountIds:[person,person]},publicationId)).toMatchObject({state:"rejected"});expect(fetcher).not.toHaveBeenCalled();
 fetcher.mockResolvedValueOnce(response({recap,digest,recipients:[{accountId:person,name:"DEMO — Parent"}]}));expect((await sessionRecapPreview(id,1,[person])).recipients).toHaveLength(1);expect(fetcher.mock.calls[0]![0]).toBe(`/api/sessions/${id}/recap-preview?version=1&recipient=${person}`);
 fetcher.mockResolvedValueOnce(response({recap,digest,recipients:[{accountId:id,name:"DEMO — Wrong"}]}));await expect(sessionRecapPreview(id,1,[person])).rejects.toThrow("UNAVAILABLE");
 fetcher.mockResolvedValueOnce(response({items:[],hasMore:false,privateSource:[]}));await expect(sessionRecapPracticeChoices(id)).rejects.toThrow();
});
