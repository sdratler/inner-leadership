import { expect, test, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { asId } from "../../../src/lib/ids.ts";
import { readJson } from "../../../src/lib/http/json.ts";
import { SESSION_COOKIE } from "../../../src/lib/security/session.ts";
import { Ls050HttpBoundary } from "../../../src/features/forms/http-boundary.ts";
import type { IdentityConfig } from "../../../src/features/identity/config.ts";
import { systemClock, type Actor } from "../../../src/features/identity/types.ts";
const origin="https://synthetic.invalid",token="s".repeat(43),csrf="c".repeat(43);
function setup(){
 const actor:Actor={id:asId("123e4567-e89b-42d3-a456-426614174000","account"),workspaceId:asId("223e4567-e89b-42d3-a456-426614174000","workspace"),personId:asId("323e4567-e89b-42d3-a456-426614174000","person"),role:"practitioner",state:"active",locale:"en",sessionDigest:"d".repeat(64),expiresAt:Date.now()+3600000};
 const config:IdentityConfig={enabled:true,origin,workspaceId:actor.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),keyring:{activeKeyId:"test",keys:{test:randomBytes(32)}},sessionSeconds:28800};
 const sessions={actor:vi.fn(async()=>actor),csrf:()=>csrf},limits={consume:vi.fn(async()=>({count:1,retryAfterMs:1000}))},audit={write:vi.fn(async()=>{})},boundary=new Ls050HttpBoundary({config,sessions,limits,audit,clock:systemClock});
 const dispatch=vi.fn(async(_actor:Actor,_id:string,url:URL)=>({data:{path:url.pathname,query:url.search,role:_actor.role}}));
 const request=(method="GET",headers:Record<string,string>={},url="http://127.0.0.1:8080/api/sessions/observations?caseId=synthetic",body:unknown={value:"synthetic input"})=>new Request(url,{method,headers:{cookie:`${SESSION_COOKIE}=${token}`,"x-forwarded-host":"synthetic.invalid","x-forwarded-proto":"https",...method==="GET"?{}:{origin,"content-type":"application/json","x-csrf-token":csrf,"sec-fetch-site":"same-origin"},...headers},...method==="GET"?{}:{body:JSON.stringify(body)}});
 return {config,sessions,limits,audit,boundary,dispatch,request};
}
test("existing strict HTTPS proxy adapter preserves path/query and authenticates before dispatch",async()=>{
 const s=setup(),response=await s.boundary.handle(s.request(),["GET"],s.dispatch);
 expect(response.status).toBe(200);expect((await response.json()).data).toEqual({path:"/api/sessions/observations",query:"?caseId=synthetic",role:"practitioner"});expect(s.sessions.actor).toHaveBeenCalledWith(token);expect(s.limits.consume).toHaveBeenCalledTimes(1);expect(response.headers.get("cache-control")).toBe("private, no-store");
});
test.each([{"x-forwarded-host":"evil.invalid"},{"x-forwarded-host":"synthetic.invalid,evil.invalid"},{"x-forwarded-proto":"http"},{"x-forwarded-proto":"https,http"},{"x-forwarded-proto":""}])("rejects untrusted or ambiguous forwarding before authentication %j",async headers=>{
 const s=setup();expect((await s.boundary.handle(s.request("GET",headers),["GET"],s.dispatch)).status).toBe(503);expect(s.sessions.actor).not.toHaveBeenCalled();expect(s.dispatch).not.toHaveBeenCalled();
});
test("proxied POST keeps original strict body, origin and CSRF gates",async()=>{
 const s=setup(),request=s.request("POST"),dispatch=vi.fn(async()=>({data:await readJson(request,z.strictObject({value:z.string()}))}));
 expect((await s.boundary.handle(request,["POST"],dispatch)).status).toBe(200);
 for(const headers of [{origin:"https://evil.invalid"},{"x-csrf-token":"wrong"},{"sec-fetch-site":"cross-site"}]){const denied=setup();expect((await denied.boundary.handle(denied.request("POST",headers),["POST"],denied.dispatch)).status).toBe(403);expect(denied.dispatch).not.toHaveBeenCalled();}
 const extra=s.request("POST",{},origin+"/api/sessions",{value:"synthetic",unexpected:true});expect((await s.boundary.handle(extra,["POST"],async()=>({data:await readJson(extra,z.strictObject({value:z.string()}))}))).status).toBe(400);
});
test("direct canonical requests still require authentication; wrong direct origin and hashes are not repaired",async()=>{
 const s=setup(),direct=new Request(origin+"/api/sessions",{headers:{cookie:`${SESSION_COOKIE}=${token}`}});
 expect((await s.boundary.handle(direct,["GET"],s.dispatch)).status).toBe(200);
 for(const request of [new Request("https://evil.invalid/api/sessions",{headers:{cookie:`${SESSION_COOKIE}=${token}`}}),s.request("GET",{},"http://127.0.0.1:8080/api/sessions#fragment")])expect((await s.boundary.handle(request,["GET"],s.dispatch)).status).toBe(400);
 expect((await s.boundary.handle(s.request("GET",{cookie:""}),["GET"],s.dispatch)).status).toBe(401);
});
