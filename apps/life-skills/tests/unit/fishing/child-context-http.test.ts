import {randomBytes,randomUUID} from "node:crypto";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {asId} from "../../../src/lib/ids.ts";
import {AppError} from "../../../src/lib/errors.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {systemClock,type Actor} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {fishingChildContextHttp} from "../../../src/features/fishing/child-context-http.ts";
import type {EducationalChildContexts} from "../../../src/features/fishing/native-child-context.ts";

const origin="https://synthetic.invalid",path="/api/private/fishing/children",token="s".repeat(43);
function setup(){
 const actor:Actor={id:asId(randomUUID(),"account"),workspaceId:asId(randomUUID(),"workspace"),personId:asId(randomUUID(),"person"),role:"parent",state:"active",locale:"he",sessionDigest:"d".repeat(64),expiresAt:Date.now()+3600000};
 const child=asId(randomUUID(),"person"),other=asId(randomUUID(),"person");
 const config:IdentityConfig={enabled:true,origin,workspaceId:actor.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),keyring:{activeKeyId:"test",keys:{test:randomBytes(32)}},sessionSeconds:28800};
 const sessions={actor:vi.fn(async()=>actor),csrf:()=>"unused"},limits={consume:vi.fn(async()=>({count:1,retryAfterMs:1000}))},audit={write:vi.fn(async()=>{})};
 const read=vi.fn(async(_actor:Actor,selected:string|null):Promise<EducationalChildContexts>=>({children:[{learnerId:child,displayName:"  שם אחד / Same name  "},{learnerId:other,displayName:"  שם אחד / Same name  "}],selectedLearnerId:selected===null?null:asId(selected,"person")}));
 const load=vi.fn(async()=>({runtime:{config,sessions,limits,audit,clock:systemClock},children:{read}}));
 const request=(query="",headers:Record<string,string>={},method="GET",url=origin+path)=>new Request(url+query,{method,headers:{cookie:`${SESSION_COOKIE}=${token}`,...headers}});
 return {actor,child,other,config,sessions,limits,audit,read,load,request,run:(request:Request)=>fishingChildContextHttp(request,load)};
}
test("ordinary session supplies parent identity, own same-name IDs and unchanged labels; null never selects the first",async()=>{
 const s=setup(),r=await s.run(s.request()),body=await r.json();expect(r.status).toBe(200);expect(s.sessions.actor).toHaveBeenCalledWith(token);expect(s.read).toHaveBeenCalledWith(s.actor,null);
 expect(body.data).toEqual({children:[{learnerId:s.child,displayName:"  שם אחד / Same name  "},{learnerId:s.other,displayName:"  שם אחד / Same name  "}],selectedLearnerId:null});
 expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("referrer-policy")).toBe("no-referrer");expect(r.headers.get("x-content-type-options")).toBe("nosniff");expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
});
test("explicit selection preserves stable identity and normalizes UUID case only",async()=>{
 const s=setup(),r=await s.run(s.request("?learnerId="+s.other.toUpperCase()));expect(r.status).toBe(200);expect(s.read).toHaveBeenCalledWith(s.actor,s.other);expect((await r.json()).data.selectedLearnerId).toBe(s.other);
});
test("a genuine empty authorized list stays empty without invented children or selection",async()=>{
 const s=setup();s.read.mockResolvedValueOnce({children:[],selectedLearnerId:null});const r=await s.run(s.request());expect(r.status).toBe(200);expect((await r.json()).data).toEqual({children:[],selectedLearnerId:null});
});
test("a selected learner missing from the returned native list cannot become success",async()=>{
 const s=setup();s.read.mockResolvedValueOnce({children:[{learnerId:s.child,displayName:"Synthetic child"}],selectedLearnerId:s.other});expect((await s.run(s.request("?learnerId="+s.other))).status).toBe(503);
});
test.each(["?learnerId=","?learnerId=not-uuid","?role=parent","?workspaceId=synthetic","?accountId=synthetic","?guardian=true","?learnerId=123e4567-e89b-42d3-a456-426614174000&learnerId=123e4567-e89b-42d3-a456-426614174000"])("strict query denies %s before any child read",async query=>{
 const s=setup();expect((await s.run(s.request(query))).status).toBe(400);expect(s.read).not.toHaveBeenCalled();
});
test.each(["practitioner","adult_client","child"] as const)("%s cannot turn parent metadata into another role's access",async role=>{
 const s=setup();s.actor.role=role;expect((await s.run(s.request())).status).toBe(403);expect(s.read).not.toHaveBeenCalled();expect(s.audit.write).toHaveBeenCalledWith(expect.objectContaining({kind:"access_denied",outcome:"denied"}));
});
test.each(["",`${SESSION_COOKIE}=short`,`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`])("invalid or duplicate cookie fails closed",async cookie=>{
 const s=setup();expect((await s.run(s.request("",{cookie}))).status).toBe(401);expect(s.sessions.actor).not.toHaveBeenCalled();expect(s.read).not.toHaveBeenCalled();
});
test("expired/revoked session fails without a child read or role fallback",async()=>{
 const s=setup();s.sessions.actor.mockRejectedValueOnce(new AppError("UNAUTHENTICATED"));expect((await s.run(s.request())).status).toBe(401);expect(s.read).not.toHaveBeenCalled();
});
test("same parent is reloaded on every request; wrong-family/revoked child errors remain neutral",async()=>{
 const s=setup();expect((await s.run(s.request())).status).toBe(200);s.read.mockRejectedValueOnce(new AppError("NOT_FOUND"));const r=await s.run(s.request("?learnerId="+s.child));expect(r.status).toBe(404);expect(s.sessions.actor).toHaveBeenCalledTimes(2);expect(s.read).toHaveBeenCalledTimes(2);expect((await r.json()).error).toEqual({code:"NOT_FOUND"});
});
test.each(["POST","DELETE","HEAD"])("%s cannot mutate or read this GET-only endpoint",async method=>{
 const s=setup();expect((await s.run(s.request("",{},method))).status).toBe(404);expect(s.read).not.toHaveBeenCalled();
});
test("unknown route, foreign origin, poisoned forwarding and disabled identity deny",async()=>{
 const s=setup();expect((await s.run(s.request("",{},"GET",origin+"/api/private/fishing/unknown"))).status).toBe(404);
 expect((await s.run(s.request("",{},"GET","https://foreign.invalid"+path))).status).toBe(400);
 expect((await s.run(s.request("",{"x-forwarded-proto":"https,http","x-forwarded-host":"synthetic.invalid"}))).status).toBe(503);
 s.config.enabled=false;expect((await s.run(s.request())).status).toBe(400);expect(s.read).not.toHaveBeenCalled();
});
test("existing canonical internal HTTPS proxy works without making forwarding an identity",async()=>{
 const s=setup();expect((await s.run(s.request("",{"x-forwarded-proto":"https","x-forwarded-host":"synthetic.invalid"},"GET","http://internal.invalid"+path))).status).toBe(200);expect(s.read).toHaveBeenCalledWith(s.actor,null);
});
test("rate-limit and durable-audit failures remain closed",async()=>{
 const s=setup();s.limits.consume.mockResolvedValueOnce({count:151,retryAfterMs:1000});expect((await s.run(s.request())).status).toBe(429);expect(s.read).not.toHaveBeenCalled();
 s.actor.role="child";s.audit.write.mockRejectedValueOnce(Error("PRIVATE_AUDIT_FAILURE"));const r=await s.run(s.request());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain("PRIVATE_AUDIT_FAILURE");
});
test("native projection drops all extra profile, clinical and payment fields",async()=>{
 const s=setup();s.read.mockResolvedValueOnce({children:[{learnerId:s.child,displayName:"אבג",clinical:"PRIVATE_CLINICAL_CANARY"}],selectedLearnerId:null,provider:"PRIVATE_PROVIDER_CANARY"} as unknown as EducationalChildContexts);
 const r=await s.run(s.request());expect(r.status).toBe(200);expect((await r.json()).data).toEqual({children:[{learnerId:s.child,displayName:"אבג"}],selectedLearnerId:null});
});
test.each(["implicit_selection","duplicate_ids","overflow","invalid_name"])("malformed native projection %s is unavailable, not partial success",async kind=>{
 const s=setup(),children=[{learnerId:s.child,displayName:"Synthetic child"}];
 s.read.mockResolvedValueOnce({children:kind==="duplicate_ids"?[...children,...children]:kind==="overflow"?Array.from({length:101},()=>children[0]!):kind==="invalid_name"?[{learnerId:s.child,displayName:""}]:children,selectedLearnerId:kind==="implicit_selection"?s.child:null});
 expect((await s.run(s.request())).status).toBe(503);
});
test("native driver and runtime failures are private retryable failures",async()=>{
 const s=setup();s.read.mockRejectedValueOnce(Error("PRIVATE_DATABASE_CONNECTION"));const r=await s.run(s.request());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain("PRIVATE_DATABASE_CONNECTION");
 s.load.mockRejectedValueOnce(Error("PRIVATE_RUNTIME_SECRET"));const unavailable=await s.run(s.request());expect(unavailable.status).toBe(503);expect(unavailable.headers.get("cache-control")).toBe("private, no-store");expect(unavailable.headers.get("referrer-policy")).toBe("no-referrer");expect(JSON.stringify(await unavailable.json())).not.toContain("PRIVATE_RUNTIME_SECRET");
});
