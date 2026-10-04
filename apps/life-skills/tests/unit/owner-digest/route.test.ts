import {beforeEach,expect,it,vi} from "vitest";
import {AppError} from "../../../src/lib/errors.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
const hooks=vi.hoisted(()=>({actor:vi.fn(),snapshot:vi.fn(),ownerRead:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("../../../src/features/identity/runtime.ts",()=>({identityRuntime:async()=>({clock:{now:()=>new Date()},store:{transaction:hooks.ownerRead},services:{sessions:{actor:hooks.actor}}})}));
vi.mock("../../../src/features/marketing-overview/provider.ts",()=>({loadMarketingSnapshot:hooks.snapshot}));
import {GET} from "../../../src/app/api/owner-digest/route.ts";
const origin="https://life-skills.bneineviimacademy.org",cookie=`${SESSION_COOKIE}=synthetic-token`;
beforeEach(()=>{vi.clearAllMocks();hooks.actor.mockResolvedValue({role:"practitioner"});});
it('denies another active practitioner before marketing reads or exposing the owner recipient',async()=>{
 hooks.ownerRead.mockRejectedValueOnce(new AppError('FORBIDDEN'));
 const result=await GET(new Request(origin+'/api/owner-digest',{headers:{cookie}}));
 expect(result.status).toBe(403);expect(hooks.snapshot).not.toHaveBeenCalled();
 expect(await result.text()).not.toMatch(/recipient|followups|sdratler/);
});
it.each(["parent","child","adult_client"])("denies %s before fetching marketing or administrative facts",async role=>{hooks.actor.mockResolvedValue({role});expect((await GET(new Request(origin+"/api/owner-digest",{headers:{cookie}}))).status).toBe(403);expect(hooks.snapshot).not.toHaveBeenCalled();expect(hooks.ownerRead).not.toHaveBeenCalled();});
it("requires exactly one ordinary session and rejects client recipients/identity/date overrides",async()=>{
 for(const headers of [{},{cookie:cookie+";"+cookie}])expect((await GET(new Request(origin+"/api/owner-digest",{headers}))).status).toBe(401);
 expect((await GET(new Request(origin+"/api/owner-digest?recipient=client@example.invalid",{headers:{cookie}}))).status).toBe(400);expect(hooks.snapshot).not.toHaveBeenCalled();
 hooks.actor.mockRejectedValue(new AppError("UNAUTHENTICATED"));const r=await GET(new Request(origin+"/api/owner-digest",{headers:{cookie}}));expect(r.status).toBe(401);expect(r.headers.get("cache-control")).toBe("private, no-store");
});
