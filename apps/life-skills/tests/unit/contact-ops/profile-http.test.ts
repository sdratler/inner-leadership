import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {nativeProfileHttp,type NativeProfileHttpDependencies} from "../../../src/features/contact-ops/server/profile-http.ts";
import {AppError} from "../../../src/lib/errors.ts";
import {ContractError} from "../../../src/features/contact-ops/core/validation.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
const origin="https://synthetic.invalid",token="a".repeat(43),csrf="b".repeat(43),personId="00000000-0000-4000-8000-000000000001";
const actor={role:"practitioner"} as Actor;
const fields={stage:"New inquiry",nextAction:"Respond tomorrow",followUpDate:"2026-09-29",notes:"Preserved synthetic administrative note — עברית"};
const body={action:"update",personId,expectedEpoch:3,expectedVersion:1,operationId:"00000000-0000-4000-8000-000000000002",fields};
function request(options:{cookie?:string;method?:string;query?:string;body?:unknown;headers?:Record<string,string>}={}){
 const method=options.method??"GET";
 return new Request("http://127.0.0.1:8080/api/private/contact-profiles"+(options.query??(method==="GET"?`?personId=${personId}&expectedEpoch=3`:"")),{
  method,headers:{cookie:options.cookie??`${SESSION_COOKIE}=${token}`,"x-forwarded-proto":"https","x-forwarded-host":"synthetic.invalid",
   ...(method==="POST"?{"content-type":"application/json",origin,"x-csrf-token":csrf}:{}),...options.headers},
  ...(method==="POST"?{body:JSON.stringify(options.body??body)}:{})});
}
function dependencies(){
 const read=vi.fn(async()=>({profile:{personId,...fields,legacyIds:["LS-LEAD-synthetic"]},version:1}));
 const updateFields=vi.fn(async()=>({version:2,replayed:false}));
 const d:NativeProfileHttpDependencies={origin,actor:async()=>actor,csrf:()=>csrf,store:{read,updateFields}};
 return {d,read,updateFields};
}
test("missing, malformed and duplicate cookies cannot even initialize private services",async()=>{
 const load=vi.fn();for(const cookie of ["",`${SESSION_COOKIE}=bad`,`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`])
  expect((await nativeProfileHttp(request({cookie}),load)).status).toBe(401);
 expect(load).not.toHaveBeenCalled();
});
test.each(["parent","child","adult_client"] as const)("ordinary %s sessions never read or update administrative contacts",async role=>{
 const {d,read,updateFields}=dependencies();d.actor=async()=>({...actor,role});
 for(const method of ["GET","POST"])expect((await nativeProfileHttp(request({method}),async()=>d)).status).toBe(403);
 expect(read).not.toHaveBeenCalled();expect(updateFields).not.toHaveBeenCalled();
});
test("bounded ordinary native read hides server-owned legacy mappings and all session details",async()=>{
 const {d,read}=dependencies(),response=await nativeProfileHttp(request(),async()=>d);
 expect(response.status).toBe(200);expect(read).toHaveBeenCalledWith(actor,personId,3);
 const raw=await response.text();expect(JSON.parse(raw).data).toEqual({personId,...fields,version:1,authorityEpoch:3});
 for(const secret of [token,csrf,"LS-LEAD-synthetic","legacyIds"])expect(raw).not.toContain(secret);
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
test("unknown, repeated, malformed and coercible query fields cannot select a role or authority",async()=>{
 const {d,read}=dependencies();
 for(const query of [`?personId=${personId}&expectedEpoch=3&role=practitioner`,`?personId=${personId}&expectedEpoch=3&expectedEpoch=3`,
  `?personId=${personId}&expectedEpoch=03`,`?personId=${personId}&expectedEpoch=3e0`,`?personId=${personId}&expectedEpoch=9007199254740992`,"?personId=bad&expectedEpoch=3"])
  expect((await nativeProfileHttp(request({query}),async()=>d)).status).toBe(400);
 expect(read).not.toHaveBeenCalled();
 for(const headers of [{"x-forwarded-host":"evil.invalid"},{"x-forwarded-proto":"http"},{"x-forwarded-host":"synthetic.invalid,evil.invalid"}])
  expect((await nativeProfileHttp(request({headers}),async()=>d)).status).toBe(503);
 expect(read).not.toHaveBeenCalled();
});
test("POST requires actual origin/CSRF, strict administrative fields and valid dates; no forged mappings or provider action",async()=>{
 const {d,updateFields}=dependencies();
 for(const headers of [{origin:"https://evil.invalid"},{"x-csrf-token":"bad"},{"sec-fetch-site":"cross-site"}])
  expect((await nativeProfileHttp(request({method:"POST",headers}),async()=>d)).status).toBe(403);
 for(const input of [{...body,role:"practitioner"},{...body,action:"send"},{...body,fields:{...fields,legacyIds:["LS-LEAD-other"]}},
  {...body,fields:{...fields,personId}},{...body,fields:{...fields,followUpDate:"2026-02-30"}},{...body,expectedVersion:0}])
  expect((await nativeProfileHttp(request({method:"POST",body:input}),async()=>d)).status).toBe(400);
 expect(updateFields).not.toHaveBeenCalled();
});
test("exact update and replay retain expected version/epoch and one stable operation identity",async()=>{
 const {d,updateFields}=dependencies();
 for(const replayed of [false,true]){
  updateFields.mockResolvedValueOnce({version:2,replayed});
  const response=await nativeProfileHttp(request({method:"POST"}),async()=>d);
  expect(response.status).toBe(200);expect((await response.json()).data).toEqual({version:2,replayed,authorityEpoch:3,personId});
 }
 expect(updateFields).toHaveBeenNthCalledWith(1,actor,personId,fields,1,body.operationId,3);
 expect(updateFields).toHaveBeenNthCalledWith(2,actor,personId,fields,1,body.operationId,3);
});
test("native conflicts/revocation/database failures are honest errors, not an empty profile or Sheet fallback",async()=>{
 for(const [error,status] of [[new AppError("CONFLICT"),409],[new ContractError("STALE_PROFILE_VERSION"),409],
  [new ContractError("OPERATION_REUSED_WITH_DIFFERENT_INPUT"),409],[new AppError("UNAUTHENTICATED"),401],[new Error("synthetic-private-error"),503]] as const){
  const {d}=dependencies();d.store.updateFields=async()=>{throw error};
  const response=await nativeProfileHttp(request({method:"POST"}),async()=>d);expect(response.status).toBe(status);
  const raw=await response.text();expect(JSON.parse(raw).ok).toBe(false);expect(raw).not.toContain("synthetic-private-error");
 }
 const {d}=dependencies();d.store.read=async()=>null;expect((await nativeProfileHttp(request(),async()=>d)).status).toBe(404);
});
