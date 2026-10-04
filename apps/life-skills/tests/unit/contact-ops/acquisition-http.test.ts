import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {acquisitionHttp,type AcquisitionHttpDependencies} from "../../../src/features/contact-ops/server/acquisition-http.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {AppError} from "../../../src/lib/errors.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {CutoverState} from "../../../src/features/contact-ops/core/cutover.ts";
const origin="https://synthetic.invalid",token="a".repeat(43),csrf="b".repeat(43),actor={role:"practitioner"} as Actor;
const state=(phase:CutoverState["phase"]="native_active"):CutoverState=>({phase,epoch:3,batchId:"synthetic",sourceFileId:"synthetic",sourceRevision:"synthetic",nativeWritesSinceSwitch:0});
const command={action:"not_lead" as const,candidateId:"00000000-0000-4000-8000-000000000001",operationId:"00000000-0000-4000-8000-000000000002",expectedEpoch:3};
function request(query="",body?:unknown,headers:Record<string,string>={}){return new Request("http://127.0.0.1:8080/api/private/contact-acquisition"+query,
 {method:body===undefined?"GET":"POST",headers:{cookie:`${SESSION_COOKIE}=${token}`,"x-forwarded-host":"synthetic.invalid","x-forwarded-proto":"https",
  ...(body===undefined?{}:{Origin:origin,"content-type":"application/json","x-csrf-token":csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function deps(){const read=vi.fn(async()=>state()),list=vi.fn(async()=>({items:[],total:0,page:1,pages:1,authorityEpoch:3,hasMore:false})),
 decide=vi.fn(async()=>({candidateId:command.candidateId,state:"NOT_A_LEAD" as const,personId:null,version:null,authorityEpoch:3,replayed:false,projections:null}));
 const d:AcquisitionHttpDependencies={origin,actor:async()=>actor,csrf:()=>csrf,authority:{read},store:{list,decide}};return{d,read,list,decide};}
test("missing, duplicate or malformed ordinary session never initializes acquisition services",async()=>{
 const load=vi.fn();for(const cookie of ["",`${SESSION_COOKIE}=bad`,`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`])
  expect((await acquisitionHttp(request("",undefined,{cookie}),load)).status).toBe(401);expect(load).not.toHaveBeenCalled();
});
test.each(["parent","child","adult_client"] as const)("%s cannot read or decide acquisition records",async role=>{
 const {d,read,list,decide}=deps();d.actor=async()=>({...actor,role});for(const r of [request(),request("",command)])expect((await acquisitionHttp(r,async()=>d)).status).toBe(403);
 expect(read).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();expect(decide).not.toHaveBeenCalled();
});
test.each(["sheet_active","shadow_ready"] as const)("%s shows truthful cutover dependency, never native shadow data",async phase=>{
 const {d,read,list}=deps();read.mockResolvedValue(state(phase));const r=await acquisitionHttp(request(),async()=>d);expect(r.status).toBe(200);
 expect((await r.json()).data).toEqual({source:"sheet",authorityEpoch:3});expect(list).not.toHaveBeenCalled();
});
test.each(["frozen","rollback_prepared"] as const)("%s cannot fall back to legacy review data",async phase=>{
 const {d,read,list}=deps();read.mockResolvedValue(state(phase));expect((await acquisitionHttp(request(),async()=>d)).status).toBe(409);expect(list).not.toHaveBeenCalled();
});
test("bounded native reads use the fresh durable authority and private response headers",async()=>{
 const {d,list}=deps(),r=await acquisitionHttp(request("?page=2&search=%D7%A9%D7%9C%D7%95%D7%9D"),async()=>d);
 expect(r.status).toBe(200);expect(list).toHaveBeenCalledWith(actor,3,{page:2,search:"שלום"});expect((await r.json()).data).toMatchObject({source:"native",authorityEpoch:3});
 expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("referrer-policy")).toBe("no-referrer");
});
test("query cannot select role, native authority, history or provider effects",async()=>{
 const {d,read,list}=deps();for(const q of ["?page=01","?page=0","?page=1e0","?page=100000","?page=1&page=2","?role=practitioner","?native=true","?mode=demo","?history=true","?search="+"x".repeat(201)])
  expect((await acquisitionHttp(request(q),async()=>d)).status).toBe(400);expect(read).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
});
test("owner mutations require canonical origin and exact CSRF, not provider authentication",async()=>{
 const {d,decide}=deps();for(const h of [{Origin:"https://evil.invalid"},{"x-csrf-token":"bad"}])expect((await acquisitionHttp(request("",command,h),async()=>d)).status).toBe(403);
 expect(decide).not.toHaveBeenCalled();expect((await acquisitionHttp(request("",command),async()=>d)).status).toBe(200);expect(decide).toHaveBeenCalledWith(actor,command);
});
test("strict decision rejects provider flags, invented payment, invalid date and clinical fields",async()=>{
 const {d,decide}=deps(),fields={name:"Synthetic",stage:"New inquiry",language:"",note:"",nextAction:"",dueDate:""};
 for(const input of [{...command,providerVerified:true},{...command,role:"practitioner"},{...command,fields:{notes:"clinical"}},{...command,expectedEpoch:0.5},
  {...command,action:"promote",fields:{...fields,dueDate:"2026-02-30"}},{...command,action:"promote",fields:{...fields,paymentVerified:true}},
  {...command,action:"promote",fields:{...fields,clinicalNote:"private"}}])expect((await acquisitionHttp(request("",input),async()=>d)).status).toBe(400);
 expect(decide).not.toHaveBeenCalled();
});
test("stale decision and provider/native failure never reveal private errors or a false save",async()=>{
 for(const [error,status] of [[new AppError("CONFLICT"),409],[new Error("private-detail-with-token"),503]] as const){const {d,decide}=deps();decide.mockRejectedValue(error);
  const r=await acquisitionHttp(request("",command),async()=>d);expect(r.status).toBe(status);expect(await r.text()).not.toContain("private-detail-with-token");}
 const {d,list}=deps();expect((await acquisitionHttp(request("",undefined,{"x-forwarded-host":"evil.invalid"}),async()=>d)).status).toBe(503);expect(list).not.toHaveBeenCalled();
});
