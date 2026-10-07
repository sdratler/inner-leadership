import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {leadCommandHttp,type LeadCommandHttpDependencies} from "../../../src/features/contact-ops/server/lead-command-http.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {asId} from "../../../src/lib/ids.ts";
import {AppError} from "../../../src/lib/errors.ts";
const id="00000000-0000-4000-8000-000000000001",origin="https://life-skills.bneineviimacademy.org",token="x".repeat(43),csrf="c".repeat(43);
const actor={id:asId(id,"account"),workspaceId:asId(id,"workspace"),personId:asId(id,"person"),role:"practitioner" as const,state:"active" as const,
 locale:"he" as const,sessionDigest:"synthetic",expiresAt:Date.now()+60_000};
const command={action:"preview",operationId:id,expectedEpoch:3,text:"Note: synthetic administrative follow up"};
const req=(body:unknown=command,headers:Record<string,string>={},suffix="",method="POST")=>new Request(origin+"/api/private/contact-lead-command"+suffix,{method,
 headers:{cookie:`${SESSION_COOKIE}=${token}`,origin,"x-forwarded-host":new URL(origin).host,"x-forwarded-proto":"https","content-type":"application/json","x-csrf-token":csrf,...headers},...(method==="GET"?{}:{body:JSON.stringify(body)})});
function dependencies(){const preview=vi.fn(async()=>({state:"clarify" as const,reason:"identity" as const,choices:[]})),apply=vi.fn();
 const d:LeadCommandHttpDependencies={origin,actor:async()=>actor,csrf:()=>csrf,limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:0}))},
  rateLimitKey:"synthetic-lead-command-rate-key-20261006",store:{preview,apply}};return {d,preview,apply};}
test("missing/malformed/duplicate session never loads runtime",async()=>{
 const load=vi.fn();for(const cookie of ["",`${SESSION_COOKIE}=bad`,`${SESSION_COOKIE}=${token};${SESSION_COOKIE}=${token}`])
  expect((await leadCommandHttp(req(command,{cookie}),load)).status).toBe(401);expect(load).not.toHaveBeenCalled();
});
test.each(["parent","child","adult_client"] as const)("ordinary %s cannot parse/confirm practitioner commands",async role=>{
 const {d,preview,apply}=dependencies();d.actor=async()=>({...actor,role});
 for(const input of [command,{action:"apply",token:"t".repeat(90)}])expect((await leadCommandHttp(req(input),async()=>d)).status).toBe(403);
 expect(preview).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
});
test("canonical origin, POST and CSRF required; query/role/provider/clinical flags rejected",async()=>{
 const {d,preview}=dependencies();for(const h of [{origin:"https://evil.invalid"},{"x-csrf-token":"bad"}])
  expect((await leadCommandHttp(req(command,h),async()=>d)).status).toBe(403);
 for(const input of [{...command,role:"practitioner"},{...command,paymentVerified:true},{...command,clinicalNote:"private"},{...command,expectedEpoch:0.5}])
  expect((await leadCommandHttp(req(input),async()=>d)).status).toBe(400);
 expect((await leadCommandHttp(req(command,{},"?mode=demo"),async()=>d)).status).toBe(400);
 expect((await leadCommandHttp(req(command,{},"","GET"),async()=>d)).status).toBe(400);expect(preview).not.toHaveBeenCalled();
});
test("bounded parsing/confirmation dispatch and private headers",async()=>{
 const {d,preview,apply}=dependencies(),r=await leadCommandHttp(req(),async()=>d);expect(r.status).toBe(200);expect(preview).toHaveBeenCalledWith(actor,command);
 for(const [name,value] of [["cache-control","private, no-store"],["referrer-policy","no-referrer"],["x-content-type-options","nosniff"]])expect(r.headers.get(name!)).toBe(value);
 apply.mockResolvedValue({operationId:id,replayed:true});expect((await leadCommandHttp(req({action:"apply",token:"t".repeat(90)}),async()=>d)).status).toBe(200);
 expect(apply).toHaveBeenCalledWith(actor,"t".repeat(90));
});
test("limiter/native failures are explicit, sanitized and never a false save",async()=>{
 const {d,preview}=dependencies();for(const [error,status] of [[new AppError("CONFLICT"),409],[new Error("private-provider-secret"),503]] as const){
  preview.mockRejectedValue(error);const r=await leadCommandHttp(req(),async()=>d);expect(r.status).toBe(status);expect(await r.text()).not.toContain("private-provider-secret");}
 d.limits.consume=async()=>({count:31,retryAfterMs:1000});expect((await leadCommandHttp(req(),async()=>d)).status).toBe(429);
});
