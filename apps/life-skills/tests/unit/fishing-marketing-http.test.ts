import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {receiveFishingMarketing} from "../../src/features/fishing-marketing/http.ts";
const secret="synthetic-fishing-bridge-secret-not-real",env={LS_FISHING_MARKETING_ENABLED:"true",LS_FISHING_MARKETING_BRIDGE_SECRET:secret,LS_BNA_OWNER_ACCOUNT_ID:randomUUID()};
const at="2026-10-29T14:00:00Z",snapshot={schemaVersion:1,program:"fishing",channel:"facebook_group_manual",mode:"assisted",generatedAt:at,
 schedule:{timezone:"America/New_York",dailyCap:5,cooldownDays:30,enabled:true,funnelReady:false,day:"2026-10-29",window:"due",nextDue:at,lastRun:null},assets:[],targets:[],items:[],itemsTruncated:false,history:[],historyAvailable:false,historyTruncated:false,excludedHistory:0};
const request=(key=secret,payload:unknown=snapshot)=>new Request("https://synthetic.invalid/api/private/fishing-marketing",{method:"POST",headers:{"content-type":"application/json","x-fishing-marketing-secret":key},body:JSON.stringify(payload)});
it("only accepts an enabled authenticated bridge and never echoes the snapshot",async()=>{
 const save=vi.fn(async()=>({replayed:false,receivedAt:at})),load=vi.fn(async()=>({save}));
 expect((await receiveFishingMarketing(request(),{...env,LS_FISHING_MARKETING_ENABLED:"false"},load)).status).toBe(503);
 expect((await receiveFishingMarketing(request("wrong"),env,load)).status).toBe(401);expect(load).not.toHaveBeenCalled();
 expect((await receiveFishingMarketing(request(secret,{...snapshot,program:"bna"}),env,load)).status).toBe(400);expect(load).not.toHaveBeenCalled();
 const response=await receiveFishingMarketing(request(),env,load);expect(response.status).toBe(201);expect(save).toHaveBeenCalledOnce();
 expect(await response.text()).not.toContain("facebook_group_manual");
});
