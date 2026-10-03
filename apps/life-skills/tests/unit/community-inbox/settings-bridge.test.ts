import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { controlsCommand, readCommunitySettings, requestedSettings, saveCommunitySettings } from "../../../src/features/community-reply/settings-bridge.ts";
const owner="9fe575fe-fba2-4a4b-a136-bb28560b13f2",operationId="412302a8-3694-4718-9a3b-e5de1a78de6e",env={LS_COMMUNITY_SCOUT_BRIDGE_SECRET:"a".repeat(43)};
const settings=()=>({groups:[],lookbackDays:7 as const,schedule:{requested:false,localTime:null,timezone:"Asia/Jerusalem" as const},limits:{postsPerRun:250,draftsPerDay:0,threadsPerRun:0},budgets:{currency:"USD" as const,scrapingMonthCents:null,aiMonthCents:null},autoDraftRequested:false});
const runtime=()=>({asOf:"2026-10-02T10:00:00.000Z",collection:{authorized:false,allowedGroupCount:0,providerConfigured:false,eligible:false,maxItemsPerRun:250,workerEnabled:true,autoDraft:false},limits:{aiRequestsPerUtcDay:30,manualReplyTotal:1,manualReplyUsed:1,manualReplyRemaining:0},usageTodayUtc:{requests:0,inputTokens:0,outputTokens:0,moneyCost:null},queue:{jobs:{},posts:{}},controls:{revision:0,updatedAt:null,settings:settings()}});
const json=(data:unknown)=>new Response(JSON.stringify({ok:true,data}));
describe("central Scout settings bridge",()=>{
 it("uses only the existing fixed target, trusted owner, existing secret and a bounded private read",async()=>{
  const fetcher=vi.fn().mockResolvedValue(json(runtime()));expect(await readCommunitySettings(owner,fetcher,env)).toEqual(runtime());
  expect(fetcher.mock.calls[0]![0]).toBe("https://community-scout-production.up.railway.app/internal/life-skills/settings?ownerId="+owner);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({method:"GET",redirect:"error",cache:"no-store",headers:{Authorization:"Bearer "+env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET}});
  await expect(readCommunitySettings("invalid",fetcher,env)).rejects.toMatchObject({code:"UNAVAILABLE"});await expect(readCommunitySettings(owner,fetcher,{})).rejects.toMatchObject({code:"UNAVAILABLE"});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("fails closed on malformed runtime state instead of inventing cost, capacity or eligibility",async()=>{
  for(const change of [{collection:{...runtime().collection,eligible:true}},{limits:{...runtime().limits,manualReplyRemaining:1}},{usageTodayUtc:{...runtime().usageTodayUtc,moneyCost:0}},{queue:{jobs:{unknown:1},posts:{}}},{controls:{...runtime().controls,updatedAt:"2026-10-02T10:00:00Z"}},{secret:"must-never-pass"}])await expect(readCommunitySettings(owner,vi.fn().mockResolvedValue(json({...runtime(),...change})),env)).rejects.toMatchObject({code:"UNAVAILABLE"});
 });
 it("rejects oversized, malformed and invalid UTF8 envelopes without a fallback",async()=>{
  for(const response of [new Response("x".repeat(100_001)),new Response('{"ok":'),new Response(new Uint8Array([0xff]))])await expect(readCommunitySettings(owner,vi.fn().mockResolvedValue(response),env)).rejects.toMatchObject({code:"UNAVAILABLE"});
 });
 it("validates exact public URLs, aliases, settings keys and requested prerequisites",()=>{
  for(const url of ["https://www.facebook.com/groups/123/../456","https://www.facebook.com/groups/123?x=1","https://www.facebook.com/groups/123/posts/4","https://attacker.invalid/groups/123","not-url"])expect(requestedSettings.safeParse({...settings(),groups:[{url,enabled:true}]}).success).toBe(false);
  expect(requestedSettings.safeParse({...settings(),groups:[{url:"https://www.facebook.com/groups/123",enabled:true},{url:"https://m.facebook.com/groups/123/",enabled:false}]}).success).toBe(false);
  expect(requestedSettings.safeParse({...settings(),schedule:{...settings().schedule,requested:true}}).success).toBe(false);
  expect(requestedSettings.safeParse({...settings(),autoDraftRequested:true}).success).toBe(false);
  expect(controlsCommand.safeParse({operationId,expectedRevision:0,settings:settings(),approveCeilings:false,ownerId:owner}).success).toBe(false);
 });
 it("sends the exact requested save and requires matching revision and settings readback",async()=>{
  const command={operationId,expectedRevision:0,settings:settings(),approveCeilings:false},saved={revision:1,updatedAt:"2026-10-02T10:00:00.000Z",settings:settings()},fetcher=vi.fn().mockResolvedValue(json(saved));
  expect(await saveCommunitySettings(owner,command,fetcher,env)).toEqual(saved);expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({...command,ownerId:owner});
  for(const invalid of [{...saved,revision:2},{...saved,settings:{...settings(),lookbackDays:3}}])await expect(saveCommunitySettings(owner,command,vi.fn().mockResolvedValue(json(invalid)),env)).rejects.toMatchObject({code:"UNAVAILABLE"});
 });
 it.each([[400,"INVALID_REQUEST"],[403,"FORBIDDEN"],[409,"CONFLICT"],[503,"UNAVAILABLE"]])("preserves %s as %s without echoing backend data",async(status,code)=>{
  await expect(readCommunitySettings(owner,vi.fn().mockResolvedValue(new Response("sensitive backend text",{status:Number(status)})),env)).rejects.toMatchObject({code});
 });
});
