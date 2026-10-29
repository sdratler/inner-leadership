import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {owner305ConversationHttp} from "../../src/features/conversation-305/http.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {Owner305ConversationStore} from "../../src/features/conversation-305/store.ts";

const origin="https://life-skills.example.invalid",path="/api/private/owner-305-conversations",token="a".repeat(43),csrf="b".repeat(43);
const actor={id:randomUUID(),workspaceId:randomUUID(),role:"practitioner",state:"active",locale:"en",personId:randomUUID(),sessionDigest:"d".repeat(64),expiresAt:Date.now()+3600000} as Actor;
const command={kind:"create",operationId:randomUUID(),channel:"phone",contactHint:"Synthetic caller",
 followup:{classification:"unclassified",note:"Asked for a callback",nextAction:"Call again",dueDate:"2026-11-02",waitingCondition:null}};
it("requires a signed-in owner session, same-origin CSRF, flag, and bounded manual command",async()=>{
 const save=vi.fn(async()=>({saved:true as const,id:randomUUID(),replayed:false}));
 const deps={enabled:true,origin,actor:async()=>actor,csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic-305-rate-key-32-characters",
  store:{save,list:async()=>({lineNumber:"+13054916674",items:[],hasMore:false}),read:async()=>({id:randomUUID()})} as unknown as Pick<Owner305ConversationStore,"save"|"list"|"read">};
 const request=(method:string,body?:unknown,headers:Record<string,string>={})=>new Request(origin+path,{method,
  headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",origin,
   "sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":csrf,cookie:`__Host-ls-session=${token}`,...headers},
  ...(body?{body:JSON.stringify(body)}:{})});
 const disabled=await owner305ConversationHttp(request("GET"),async()=>({...deps,enabled:false}));expect(disabled.status).toBe(404);
 expect((await owner305ConversationHttp(request("GET",undefined,{cookie:""}),async()=>deps)).status).toBe(401);
 expect((await owner305ConversationHttp(request("POST",command,{origin:"https://other.invalid"}),async()=>deps)).status).toBe(403);
 expect((await owner305ConversationHttp(request("POST",command,{"x-csrf-token":"wrong"}),async()=>deps)).status).toBe(403);
 expect((await owner305ConversationHttp(request("POST",{...command,followup:{...command.followup,nextAction:null,dueDate:null,waitingCondition:null}}),async()=>deps)).status).toBe(400);
 expect(save).not.toHaveBeenCalled();
 const response=await owner305ConversationHttp(request("POST",command),async()=>deps);
 expect(response.status).toBe(201);expect((await response.json()).data).toEqual(await save.mock.results[0]!.value);expect(save).toHaveBeenCalledOnce();
});


it("forwards one pagination cursor and rejects mixed or duplicate query parameters",async()=>{
 const list=vi.fn(async()=>({lineNumber:"+13054916674",items:[],hasMore:false,nextCursor:null}));
 const deps={enabled:true,origin,actor:async()=>actor,csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic-305-rate-key-32-characters",store:{list,read:vi.fn(),save:vi.fn()} as unknown as Pick<Owner305ConversationStore,"save"|"list"|"read">};
 const request=(query:string)=>new Request(origin+path+query,{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",cookie:`__Host-ls-session=${token}`}});
 expect((await owner305ConversationHttp(request("?before=opaque-cursor"),async()=>deps)).status).toBe(200);expect(list).toHaveBeenCalledWith(actor,"opaque-cursor");
 for(const query of ["?before=one&before=two","?before=one&id=two","?before=","?other=one"])expect((await owner305ConversationHttp(request(query),async()=>deps)).status).toBe(400);
});
it("forwards a bounded history page only with its conversation reference",async()=>{
 const id=randomUUID(),read=vi.fn(async()=>({history:[],hasMoreHistory:false}));
 const deps={enabled:true,origin,actor:async()=>actor,csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic-305-rate-key-32-characters",store:{list:vi.fn(),read,save:vi.fn()} as unknown as Pick<Owner305ConversationStore,"save"|"list"|"read">};
 const request=(query:string)=>new Request(origin+path+query,{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",cookie:`__Host-ls-session=${token}`}});
 expect((await owner305ConversationHttp(request(`?id=${id}&historyBefore=42`),async()=>deps)).status).toBe(200);expect(read).toHaveBeenCalledWith(actor,id,42);
 for(const query of [`?id=${id}&historyBefore=bad`,`?id=${id}&historyBefore=1&historyBefore=2`,`?historyBefore=2`,`?id=${id}&before=cursor`])expect((await owner305ConversationHttp(request(query),async()=>deps)).status).toBe(400);
});
