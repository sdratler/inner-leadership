import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../../src/lib/security/session.ts";
const hooks=vi.hoisted(()=>({actor:vi.fn(),read:vi.fn(),save:vi.fn(),csrf:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("../../../src/features/identity/runtime.ts",()=>({identityRuntime:async()=>({config:{origin:"https://life-skills.bneineviimacademy.org"},services:{sessions:{actor:hooks.actor,csrf:hooks.csrf}}})}));
vi.mock("../../../src/features/community-reply/settings-bridge.ts",async original=>({...await original(),readCommunitySettings:hooks.read,saveCommunitySettings:hooks.save}));
import {GET,PUT} from "../../../src/app/api/community-settings/route.ts";
const origin="https://life-skills.bneineviimacademy.org",owner="9fe575fe-fba2-4a4b-a136-bb28560b13f2",cookie=`${SESSION_COOKIE}=synthetic-token`,csrf="a".repeat(43);
const value={operationId:owner,expectedRevision:0,settings:{groups:[],lookbackDays:7,schedule:{requested:false,localTime:null,timezone:"Asia/Jerusalem"},limits:{postsPerRun:250,draftsPerDay:0,threadsPerRun:0},budgets:{currency:"USD",scrapingMonthCents:null,aiMonthCents:null},autoDraftRequested:false},approveCeilings:false};
const request=(extra={},body:unknown=value)=>new Request(origin+"/api/community-settings",{method:"PUT",headers:{cookie,origin,"content-type":"application/json","x-csrf-token":csrf,...extra},body:JSON.stringify(body)});
describe("ordinary practitioner settings authorization",()=>{
 beforeEach(()=>{vi.clearAllMocks();hooks.actor.mockResolvedValue({id:owner,role:"practitioner"});hooks.csrf.mockReturnValue(csrf);hooks.read.mockResolvedValue({controls:{revision:0}});hooks.save.mockResolvedValue({revision:1});});
 it.each(["parent","child","adult_client"])("denies %s before contacting Scout",async role=>{hooks.actor.mockResolvedValue({id:owner,role});expect((await GET(new Request(origin+"/api/community-settings",{headers:{cookie}}))).status).toBe(403);expect((await PUT(request())).status).toBe(403);expect(hooks.read).not.toHaveBeenCalled();expect(hooks.save).not.toHaveBeenCalled();});
 it("requires one current session and takes owner identity only from it",async()=>{
  for(const headers of [{},{cookie:cookie+";"+cookie}])expect((await GET(new Request(origin+"/api/community-settings",{headers}))).status).toBe(401);
  expect((await PUT(request({}, {...value,ownerId:owner}))).status).toBe(400);expect(hooks.save).not.toHaveBeenCalled();
  expect((await GET(new Request(origin+"/api/community-settings",{headers:{cookie}}))).status).toBe(200);expect(hooks.read).toHaveBeenCalledWith(owner);
  const saved=await PUT(request());expect(saved.status).toBe(200);expect(saved.headers.get("cache-control")).toBe("private, no-store");expect(hooks.save).toHaveBeenCalledWith(owner,value);
 });
 it("preserves strict origin, CSRF, query and body bounds",async()=>{
  for(const extra of [{origin:"https://untrusted.invalid"},{"x-csrf-token":"b".repeat(43)}])expect((await PUT(request(extra))).status).toBe(403);
  expect((await GET(new Request(origin+"/api/community-settings?ownerId="+owner,{headers:{cookie}}))).status).toBe(400);
  for(const body of [{...value,expectedRevision:-1},{...value,approveCeilings:"yes"},{...value,settings:{...value.settings,providerToken:"never-accepted"}}])expect((await PUT(request({},body))).status).toBe(400);
  expect(hooks.save).not.toHaveBeenCalled();
 });
});
