import {randomBytes,randomUUID} from "node:crypto";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {asId} from "../../../src/lib/ids.ts";
import {AppError} from "../../../src/lib/errors.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {systemClock,type Actor} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {FishingLessonHttp} from "../../../src/features/resources/fishing-lesson-http.ts";
import type {FishingLessonJourney} from "../../../src/features/resources/fishing-lesson-journey.ts";
const origin="https://synthetic.invalid",path="/api/resources/education/lesson",token="s".repeat(43),csrf="c".repeat(43),ref={learnerId:randomUUID(),moduleId:"RM-101",version:"synthetic-v1"};
function setup(childAccountsEnabled=false){
 const actor:Actor={id:asId(randomUUID(),"account"),workspaceId:asId(randomUUID(),"workspace"),personId:asId(randomUUID(),"person"),role:"parent",state:"active",locale:"en",sessionDigest:"d".repeat(64),expiresAt:Date.now()+3600000};
 const config:IdentityConfig={enabled:true,origin,workspaceId:actor.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),keyring:{activeKeyId:"test",keys:{test:randomBytes(32)}},sessionSeconds:28800,childAccountsEnabled};
 const sessions={actor:vi.fn(async()=>actor),csrf:()=>csrf},limits={consume:vi.fn(async()=>({count:1,retryAfterMs:1000}))},audit={write:vi.fn(async()=>{})};
 const journey={read:vi.fn<FishingLessonJourney["read"]>().mockResolvedValue({moduleId:ref.moduleId,version:ref.version,portfolio:null}),save:vi.fn(async()=>({revisionId:randomUUID(),duplicate:false}))},factory=vi.fn(()=>journey);
 const http=new FishingLessonHttp({config,sessions,limits,audit,clock:systemClock},factory),command={action:"submit",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"Synthetic answer"}]};
 const request=(method="GET",headers:Record<string,string>={},suffix="?"+new URLSearchParams({...ref,view:"parent"}),body:unknown={reference:ref,command})=>new Request(origin+path+suffix,{method,headers:{cookie:`${SESSION_COOKIE}=${token}`,...method==="GET"?{}:{origin,"content-type":"application/json","x-csrf-token":csrf,"sec-fetch-site":"same-origin"},...headers},...method==="GET"?{}:{body:JSON.stringify(body)}});
 return {http,actor,journey,factory,sessions,audit,request,command};
}
test("closed GET uses the authenticated actor and carries private no-store/security headers",async()=>{
 const s=setup(),r=await s.http.handle(s.request());expect(r.status).toBe(200);expect(s.factory).toHaveBeenCalledWith(s.actor);expect(s.journey.read).toHaveBeenCalledWith(ref,"parent");
 expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("referrer-policy")).toBe("no-referrer");expect(JSON.stringify(await r.json())).not.toMatch(/ciphertext|teacher|privateNote/);
});
test("closed POST preserves exact operation/predecessor without caller roles/grants",async()=>{
 const s=setup(),r=await s.http.handle(s.request("POST",{},""));expect(r.status).toBe(200);expect(s.journey.save).toHaveBeenCalledWith(ref,s.command);
});
test.each(["&view=teacher","&workspaceId=synthetic","&role=practitioner","&guardian=true"])("duplicate/authority query %s is denied",async extra=>{
 const s=setup();expect((await s.http.handle(s.request("GET",{},"?"+new URLSearchParams({...ref,view:"parent"})+extra))).status).toBe(400);expect(s.journey.read).not.toHaveBeenCalled();
});
test.each([{origin:"https://evil.invalid"},{"x-csrf-token":"wrong"},{"sec-fetch-site":"cross-site"}])("unchanged origin/CSRF gates deny %j before journey construction",async headers=>{
 const s=setup();expect((await s.http.handle(s.request("POST",headers,""))).status).toBe(403);expect(s.factory).not.toHaveBeenCalled();
});
test.each(["role","workspaceId","grant","guardian"])("POST injected %s cannot supply server facts",async key=>{
 const s=setup();expect((await s.http.handle(s.request("POST",{},"",{reference:ref,command:s.command,[key]:"synthetic"}))).status).toBe(400);expect(s.journey.save).not.toHaveBeenCalled();
});
test("no session and unsupported method/path never construct a journey",async()=>{
 const s=setup();expect((await s.http.handle(s.request("GET",{cookie:""}))).status).toBe(401);expect(s.factory).not.toHaveBeenCalled();
 expect((await s.http.handle(new Request(origin+"/api/resources"))).status).toBe(404);expect((await s.http.handle(s.request("DELETE",{},""))).status).toBe(404);
});
test.each([["LESSON_JOURNEY_FORBIDDEN",403],["LESSON_JOURNEY_CONFLICT",409],["LESSON_JOURNEY_QUESTION_MISMATCH",400],["private synthetic database failure",503]] as const)("neutral error %s maps to %i without payload logging",async(message,status)=>{
 const s=setup();s.journey.read.mockRejectedValueOnce(Error(message));const r=await s.http.handle(s.request());expect(r.status).toBe(status);expect(JSON.stringify(await r.json())).not.toContain(message);
 if(status===403)expect(s.audit.write).toHaveBeenCalledWith(expect.objectContaining({kind:"access_denied",outcome:"denied"}));
});
test("fresh session failure remains unauthenticated; no fallback",async()=>{const s=setup();s.sessions.actor.mockRejectedValueOnce(new AppError("UNAUTHENTICATED"));expect((await s.http.handle(s.request())).status).toBe(401);expect(s.factory).not.toHaveBeenCalled();});
test("optional child HTTP is independently disabled by default even with a permissive test journey",async()=>{
 const s=setup();s.actor.role="child";expect((await s.http.handle(s.request())).status).toBe(403);expect(s.factory).not.toHaveBeenCalled();
 const enabled=setup(true);enabled.actor.role="child";expect((await enabled.http.handle(enabled.request())).status).toBe(200);expect(enabled.factory).toHaveBeenCalled();
});
