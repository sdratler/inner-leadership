import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fishingFollowupBatchHttp,fishingFollowupHttp} from "../../src/features/group-application/fishing-followup-http.ts";
import type {FishingInquiryFollowupStore} from "../../src/features/group-application/fishing-followup-store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
const origin="https://life-skills.example.invalid",path="/api/private/group-applications/followups/batch",token="a".repeat(43);
it("requires a session and forwards only one valid bounded cursor",async()=>{
 const actor={id:randomUUID(),workspaceId:randomUUID(),role:"practitioner"} as Actor,listPage=vi.fn(async()=>({items:[],nextCursor:null}));
 const deps={origin,actor:async()=>actor,csrf:()=>"",limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic",store:{listPage} as unknown as Pick<FishingInquiryFollowupStore,"listPage">};
 const req=(query:string,cookie=true)=>new Request(origin+path+query,{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",...(cookie?{cookie:`__Host-ls-session=${token}`}:{})}});
 const cursor="a".repeat(64);expect((await fishingFollowupBatchHttp(req(`?cursor=${cursor}`),async()=>deps)).status).toBe(200);expect(listPage).toHaveBeenCalledWith(actor,cursor);
 for(const query of ["?cursor=bad",`?cursor=${cursor}&cursor=${cursor}`,"?other=value"])expect((await fishingFollowupBatchHttp(req(query),async()=>deps)).status).toBe(400);
 expect((await fishingFollowupBatchHttp(req("",false),async()=>deps)).status).toBe(401);
});
it("requires a session and forwards a single history boundary to the owner-scoped read",async()=>{
 const actor={id:randomUUID(),workspaceId:randomUUID(),role:"practitioner"} as Actor,id=randomUUID(),read=vi.fn(async()=>({history:[],hasMoreHistory:false}));
 const deps={origin,actor:async()=>actor,csrf:()=>"",limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic",store:{read} as unknown as Pick<FishingInquiryFollowupStore,"read"|"followup">};
 const req=(query:string,cookie=true)=>new Request(origin+"/api/private/group-applications/followups"+query,{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",...(cookie?{cookie:`__Host-ls-session=${token}`}:{})}});
 expect((await fishingFollowupHttp(req(`?id=${id}&historyBefore=42`),async()=>deps)).status).toBe(200);expect(read).toHaveBeenCalledWith(actor,id,42);
 for(const query of [`?id=${id}&historyBefore=bad`,`?id=${id}&historyBefore=1&historyBefore=2`,`?id=${id}&other=x`,`?historyBefore=2`])expect((await fishingFollowupHttp(req(query),async()=>deps)).status).toBe(400);
 expect((await fishingFollowupHttp(req(`?id=${id}`,false),async()=>deps)).status).toBe(401);
});
