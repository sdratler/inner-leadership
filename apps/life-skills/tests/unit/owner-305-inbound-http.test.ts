import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {read305,receive305} from "../../src/features/conversation-305/inbound-http.ts";
import {inboundBindingDigest} from "../../src/features/contact-ops/server/inbound-store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
const origin="https://life-skills.example.invalid",secret="synthetic-bridge-secret-never-production";
const inquiry={provider:"whapi" as const,channelId:"synthetic-channel",businessNumber:"+13054916674",providerEventId:"event",providerMessageId:"message",providerThreadId:"thread",eventType:"inbound_message" as const,fromMe:false as const,fromNumber:"+15555550123",pushName:"Synthetic",messageType:"text",messageText:"Synthetic private message",occurredAt:"2026-10-29T00:00:00Z",media:[]};
const env={LS_305_INBOUND_ENABLED:"true",LS_305_CLASSIFICATION_ENABLED:"true",LS_BNA_OWNER_ACCOUNT_ID:randomUUID(),LS_305_INBOUND_BINDING_SHA256:inboundBindingDigest(inquiry),LIFE_SKILLS_APP_BRIDGE_SECRET:secret};
const post=(key=secret)=>new Request(origin+"/api/private/owner-305-inbound",{method:"POST",headers:{"content-type":"application/json","x-life-skills-bridge-secret":key},body:JSON.stringify(inquiry)});
it("requires both flags and the bridge secret before durable capture",async()=>{
 const capture=vi.fn(async()=>({replayed:false,storedAt:"2026-10-29T00:00:00.000Z"})),load=vi.fn(async()=>({capture}));
 expect((await receive305(post(),{...env,LS_305_CLASSIFICATION_ENABLED:"false"},load)).status).toBe(503);
 expect((await receive305(post("wrong"),env,load)).status).toBe(401);expect(load).not.toHaveBeenCalled();
 const response=await receive305(post(),env,load);expect(response.status).toBe(201);expect(load).toHaveBeenCalledWith(env.LS_305_INBOUND_BINDING_SHA256);
 expect(await response.text()).not.toContain(inquiry.messageText);
});
it("requires a session and exact origin before reading the owner store",async()=>{
 const list=vi.fn(async()=>({items:[],hasMore:false})),actor={id:env.LS_BNA_OWNER_ACCOUNT_ID} as Actor;
 const load=vi.fn(async()=>({origin,actor:async()=>actor,store:{list}}));
 const request=(cookie:string,url=origin+"/api/private/owner-305-inbound")=>new Request(url,{headers:{cookie,host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid"}});
 expect((await read305(request(""),env,load)).status).toBe(401);expect(load).not.toHaveBeenCalled();
 expect((await read305(request(`__Host-ls-session=${"a".repeat(43)}`,origin+"/api/private/owner-305-inbound?extra=1"),env,load)).status).toBe(400);expect(list).not.toHaveBeenCalled();
 expect((await read305(request(`__Host-ls-session=${"a".repeat(43)}`),env,load)).status).toBe(200);expect(list).toHaveBeenCalledOnce();
});
