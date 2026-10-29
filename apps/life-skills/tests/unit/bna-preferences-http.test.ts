import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {publicBnaPreferenceHttp,privateBnaPreferenceHttp} from "../../src/features/bna-communications/preferences-http.ts";
import type {BnaPreferenceStore} from "../../src/features/bna-communications/preferences-store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {BNA_PREFERENCE_NOTICE,type BnaPreferenceSnapshot} from "../../src/features/bna-communications/preferences-contract.ts";
const origin="https://life-skills.example.invalid",token="a".repeat(1000),session="b".repeat(43),csrf="c".repeat(43),id=randomUUID();
const limits={consume:async()=>({count:1,retryAfterMs:0})};
const preferences:BnaPreferenceSnapshot={version:0,program:"bna_learning_coop",locale:"en",permissionGrantedAt:null,withdrawn:false,paused:false,replyPending:false,invalidRecipient:false,complaint:false};
const request=(path:string,method="POST",body?:unknown,headers:Record<string,string>={})=>new Request(origin+path,{method,
 headers:{host:"life-skills.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-forwarded-proto":"https",...headers},
 ...(body?{body:JSON.stringify(body)}:{})});
it("recipient reads require a capability in a same-origin JSON body and never mutate",async()=>{
 const readRecipient=vi.fn(async()=>({inquiryId:id,preferences,notice:BNA_PREFERENCE_NOTICE,canSubscribe:true})),updateRecipient=vi.fn(),deps={enabled:true,origin,limits,rateLimitKey:"synthetic-preference-rate-key-at-least-32",store:{readRecipient,updateRecipient}};
 const path="/api/public/bna-preferences",body={action:"read",token};
 const result=await publicBnaPreferenceHttp(request(path,"POST",body),async()=>deps);expect(result.status).toBe(200);
 expect(result.headers.get("cache-control")).toContain("no-store");expect(result.headers.get("referrer-policy")).toBe("no-referrer");
 expect(readRecipient).toHaveBeenCalledWith(token);expect(updateRecipient).not.toHaveBeenCalled();
 for(const req of [request(path,"GET"),request(path+"?token="+token,"POST",body),request(path,"POST",body,{origin:"https://attacker.invalid"}),request(path,"POST",body,{"sec-fetch-site":"cross-site"})])
  expect((await publicBnaPreferenceHttp(req,async()=>deps)).status).toBeGreaterThanOrEqual(400);
 expect((await publicBnaPreferenceHttp(request(path,"POST",body),async()=>({...deps,enabled:false}))).status).toBe(404);
});
it("recipient mutation is strict, bounded and sends only the intended command to the native store",async()=>{
 const readRecipient=vi.fn(),updateRecipient=vi.fn(async()=>({replayed:false,preferences:{...preferences,withdrawn:true}}));
 const deps={enabled:true,origin,limits,rateLimitKey:"synthetic-preference-rate-key-at-least-32",store:{readRecipient,updateRecipient}},path="/api/public/bna-preferences";
 const command={action:"unsubscribe_all",inquiryId:id,operationId:randomUUID(),expectedVersion:1},body={action:"update",token,command};
 expect((await publicBnaPreferenceHttp(request(path,"POST",body),async()=>deps)).status).toBe(200);
 expect(updateRecipient).toHaveBeenCalledWith(token,command);
 expect((await publicBnaPreferenceHttp(request(path,"POST",{...body,command:{...command,workspaceId:randomUUID()}}),async()=>deps)).status).toBe(400);
 expect((await publicBnaPreferenceHttp(request(path,"POST",body,{"content-type":"text/plain"}),async()=>deps)).status).toBe(415);
 expect((await publicBnaPreferenceHttp(request(path,"POST",{...body,token:"x".repeat(25000)}),async()=>deps)).status).toBe(413);
 expect(updateRecipient).toHaveBeenCalledTimes(1);
});
it("owner access requires the session, owner-scoped store, exact query, origin and CSRF",async()=>{
 const actor={id:randomUUID(),workspaceId:randomUUID(),role:"practitioner"} as Actor;
 const readOwner=vi.fn(async()=>({preferences:{version:0}})),updateOwner=vi.fn(async()=>({replayed:false})),issueCapability=vi.fn(async()=>({token,expiresAt:"2026-11-29T00:00:00Z"}));
 const deps={enabled:true,origin,actor:async()=>actor,csrf:()=>csrf,limits,rateLimitKey:"synthetic-owner-rate-key-at-least-32",store:{readOwner,updateOwner,issueCapability} as unknown as Pick<BnaPreferenceStore,"readOwner"|"updateOwner"|"issueCapability">};
 const path="/api/private/bna-preferences",auth={cookie:`__Host-ls-session=${session}`,"x-csrf-token":csrf};
 expect((await privateBnaPreferenceHttp(request(path+"?id="+id,"GET",undefined,auth),async()=>deps)).status).toBe(200);expect(readOwner).toHaveBeenCalledWith(actor,id);
 expect((await privateBnaPreferenceHttp(request(path+"?id="+id+"&id="+id,"GET",undefined,auth),async()=>deps)).status).toBe(400);
 expect((await privateBnaPreferenceHttp(request(path+"?id="+id,"GET"),async()=>deps)).status).toBe(401);
 const body={action:"pause_all",inquiryId:id,operationId:randomUUID(),expectedVersion:0,note:"Synthetic owner pause"};
 expect((await privateBnaPreferenceHttp(request(path,"POST",body,auth),async()=>deps)).status).toBe(200);expect(updateOwner).toHaveBeenCalledWith(actor,body);
 expect((await privateBnaPreferenceHttp(request(path,"POST",body,{...auth,"x-csrf-token":"d".repeat(43)}),async()=>deps)).status).toBe(403);
 expect((await privateBnaPreferenceHttp(request(path,"POST",body,{...auth,origin:"https://attacker.invalid"}),async()=>deps)).status).toBe(403);
 expect((await privateBnaPreferenceHttp(request(path,"POST",{action:"issue_link",inquiryId:id},auth),async()=>deps)).status).toBe(200);expect(issueCapability).toHaveBeenCalledWith(actor,id);
});
