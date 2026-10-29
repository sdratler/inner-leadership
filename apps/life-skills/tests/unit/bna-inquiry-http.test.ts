import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {publicBnaInquiryHttp,privateBnaInquiryHttp} from "../../src/features/bna-inquiry/http.ts";
import type {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {BNA_COOP_NOTICE} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_INQUIRY_NOTICE} from "../../src/features/bna-inquiry/contract.ts";
import {AppError} from "../../src/lib/errors.ts";
import {freezeBnaAcknowledgment} from "../../src/features/bna-communications/delivery-policy.ts";
import type {BnaAcknowledgmentStore} from "../../src/features/bna-communications/acknowledgment-store.ts";

const origin="https://life-skills.example.invalid",path="/api/public/bna-inquiries";
it("offers a BNA-only challenge, requires same-origin consent, and returns only a generic save receipt",async()=>{
 let now=Date.now();const submit=vi.fn(async()=>({saved:true as const,reference:randomUUID(),replayed:false}));
 const deps={enabled:true,environment:{LS_APP_ORIGIN:origin},challengeKey:"synthetic-bna-challenge-key-32-characters",now:()=>now,
  limits:{consume:async()=>({count:1,retryAfterMs:0})},store:{submit}};
 const request=(method:string,body?:unknown,headers:Record<string,string>={})=>new Request(origin+path,{method,
  headers:{host:"life-skills.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json",...headers},
  ...(body?{body:JSON.stringify(body)}:{})});
 const offer=await publicBnaInquiryHttp(request("GET"),async()=>deps);
 expect(offer.status).toBe(200);
 const data=(await offer.json()).data;
 expect(data.notice).toEqual(BNA_INQUIRY_NOTICE);
 const submission={challenge:data.challenge,operationId:randomUUID(),website:"",fields:{name:"Synthetic Parent",contactChannel:"email",
  contact:"parent@example.invalid",language:"en",townOrZip:"Jerusalem",childAges:[9],
  permission:{confirmed:true,version:BNA_INQUIRY_NOTICE.version,language:"en"}},attribution:{source:"bna_site"}};
 expect((await publicBnaInquiryHttp(request("POST",submission),async()=>deps)).status).toBe(403);
 now+=1500;
 const saved=await publicBnaInquiryHttp(request("POST",submission),async()=>deps);
 expect(saved.status).toBe(201);expect((await saved.json()).data).toEqual(await submit.mock.results[0]!.value);
 expect(submit).toHaveBeenCalledOnce();
 expect((await publicBnaInquiryHttp(request("POST",submission,{origin:"https://other.invalid"}),async()=>deps)).status).toBe(403);
 expect(submit).toHaveBeenCalledOnce();
 expect((await publicBnaInquiryHttp(request("POST",{...submission,fields:{...submission.fields,permission:{...submission.fields.permission,confirmed:false}}}),async()=>deps)).status).toBe(400);
 expect(submit).toHaveBeenCalledOnce();
});

it("binds co-op submission and challenge to its own endpoint",async()=>{
 let now=Date.now();const submit=vi.fn(async(...args:unknown[])=>{void args;return {saved:true as const,reference:randomUUID(),replayed:false};});
 const deps={enabled:true,environment:{LS_APP_ORIGIN:origin},challengeKey:"synthetic-bna-challenge-key-32-characters",now:()=>now,limits:{consume:async()=>({count:1,retryAfterMs:0})},store:{submit}};
 const req=(path:string,method:string,body?:unknown)=>new Request(origin+path,{method,headers:{host:"life-skills.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const old=(await (await publicBnaInquiryHttp(req("/api/public/bna-inquiries","GET"),async()=>deps)).json()).data.challenge;
 const offer=await publicBnaInquiryHttp(req("/api/public/bna-coop-inquiries","GET"),async()=>deps,"coop");const data=(await offer.json()).data;expect(data.notice).toEqual(BNA_COOP_NOTICE);
 const fields={name:"Synthetic",contactChannel:"email",contact:"parent@example.invalid",language:"en",siteLanguage:"he",emailUpdates:false,townOrZip:"Florida",childAges:[10],permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"he"}};
 now+=1500;const body={challenge:old,operationId:randomUUID(),fields};
 expect((await publicBnaInquiryHttp(req("/api/public/bna-coop-inquiries","POST",body),async()=>deps,"coop")).status).toBe(403);
 expect((await publicBnaInquiryHttp(req("/api/public/bna-coop-inquiries","POST",{...body,challenge:data.challenge}),async()=>deps,"coop")).status).toBe(201);
 expect(submit.mock.calls[0]?.[1]).toBe("bna_learning_coop");expect(submit.mock.calls[0]?.[0]).toMatchObject({attribution:{landingPath:"/he/join"}});
 expect((await publicBnaInquiryHttp(req("/api/public/bna-inquiries","POST",{...body,challenge:data.challenge}),async()=>deps)).status).toBe(400);
});

it("only requests a bounded history page for a single authenticated inquiry",async()=>{
 const token="a".repeat(43),actor={id:randomUUID(),workspaceId:randomUUID(),role:"practitioner"} as Actor,read=vi.fn(async()=>({history:[]}));
 const findOperation=vi.fn(async()=>({found:false}));
 const deps={origin,actor:async()=>actor,csrf:()=>"b".repeat(43),limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic-rate-key",store:{read,findOperation,list:vi.fn(),followup:vi.fn()} as unknown as Pick<BnaInquiryStore,"read"|"list"|"findOperation"|"followup">};
 const req=(query:string,cookie=true)=>new Request(origin+"/api/private/bna-inquiries"+query,{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",...(cookie?{cookie:`__Host-ls-session=${token}`}:{})}});
 const id=randomUUID();expect((await privateBnaInquiryHttp(req(`?id=${id}&historyBefore=23`),async()=>deps)).status).toBe(200);expect(read).toHaveBeenCalledWith(actor,id,23);
 const operation=randomUUID();expect((await privateBnaInquiryHttp(req(`?operation=${operation}`),async()=>deps)).status).toBe(200);expect(findOperation).toHaveBeenCalledWith(actor,operation);
 for(const query of [`?historyBefore=23`,`?id=${id}&historyBefore=2&historyBefore=3`,`?id=${id}&before=x`,`?id=${id}&historyBefore=oops`,`?id=${id}&operation=${operation}`,`?operation=${operation}&before=x`,`?operation=`])expect((await privateBnaInquiryHttp(req(query),async()=>deps)).status).toBe(400);
 expect((await privateBnaInquiryHttp(req(`?id=${id}&historyBefore=23`,false),async()=>deps)).status).toBe(401);
});

it("reads the owned inquiry before exposing its frozen acknowledgment and never sends from a preview",async()=>{
 const id=randomUUID(),token="a".repeat(43),actor={id:randomUUID(),workspaceId:randomUUID(),role:"practitioner"} as Actor;
 const fields={name:"Synthetic parent",contactChannel:"email" as const,contact:"synthetic@example.invalid",language:"he" as const,siteLanguage:"en" as const,emailUpdates:false,townOrZip:"Synthetic",childAges:[10],permission:{confirmed:true as const,version:BNA_COOP_NOTICE.version,language:"en" as const}};
 const read=vi.fn(async()=>({id,program:"bna_learning_coop",fields})),readForInquiry=vi.fn(async()=>({state:"unknown" as const,messageId:randomUUID(),version:2,lastCode:"CONTROLLED_DELIVERY_RESERVED",providerId:null,completedAt:null,payload:freezeBnaAcknowledgment("bna_learning_coop",id,fields)!,history:[]}));
 const deps={origin,actor:async()=>actor,csrf:()=>"b".repeat(43),limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic-rate-key",store:{read,list:vi.fn(),findOperation:vi.fn(),followup:vi.fn()} as unknown as Pick<BnaInquiryStore,"read"|"list"|"findOperation"|"followup">,communications:{readForInquiry}};
 const req=(authenticated=true)=>new Request(origin+"/api/private/bna-inquiries?id="+id+"&preview=acknowledgment",{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https",...(authenticated?{cookie:`__Host-ls-session=${token}`}:{})}});
 const response=await privateBnaInquiryHttp(req(),async()=>deps);expect(response.status).toBe(200);
 expect((await response.json()).data).toMatchObject({available:true,deliveryState:"unknown",recipient:fields.contact,candidate:{status:"frozen_snapshot",locale:"he"}});
 expect(readForInquiry).toHaveBeenCalledWith(actor,id);
 readForInquiry.mockClear();read.mockRejectedValueOnce(new AppError("NOT_FOUND"));
 expect((await privateBnaInquiryHttp(req(),async()=>deps)).status).toBe(404);expect(readForInquiry).not.toHaveBeenCalled();
 expect((await privateBnaInquiryHttp(req(false),async()=>deps)).status).toBe(401);expect(readForInquiry).not.toHaveBeenCalled();
});

function acknowledgmentFixture(){
 const id=randomUUID(),messageId=randomUUID(),token='a'.repeat(43),csrf='b'.repeat(43),actor={id:randomUUID(),workspaceId:randomUUID(),role:'practitioner'} as Actor;
 const fields={name:'Synthetic owner',contactChannel:'email' as const,contact:'synthetic@example.invalid',language:'en' as const,siteLanguage:'en' as const,emailUpdates:false,townOrZip:'Synthetic',childAges:[10],permission:{confirmed:true as const,version:BNA_COOP_NOTICE.version,language:'en' as const}};
 type Delivery=Extract<Awaited<ReturnType<BnaAcknowledgmentStore['readForInquiry']>>,{payload:unknown}>;
 let delivery:Delivery={state:'queued',messageId,version:1,lastCode:'INQUIRY_SAVED',providerId:null,completedAt:null,payload:freezeBnaAcknowledgment('bna_learning_coop',id,fields)!,history:[]};
 const read=vi.fn(async()=>({id,program:'bna_learning_coop',fields}));
 const communications={readForInquiry:vi.fn(async():Promise<Delivery>=>delivery),cancel:vi.fn(async()=>({state:'canceled' as const,replayed:false})),retryNotAttempted:vi.fn(async()=>({state:'queued' as const,replayed:false}))};
 const followup=vi.fn(),deps={origin,actor:async()=>actor,csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'synthetic-acknowledgment-rate-key-32-characters',store:{read,list:vi.fn(),findOperation:vi.fn(),followup} as unknown as Pick<BnaInquiryStore,'read'|'list'|'findOperation'|'followup'>,communications};
 const command={action:'cancel_acknowledgment',inquiryId:id,messageId,expectedVersion:1,operationId:randomUUID()};
 const request=(input:unknown,headers:Record<string,string>={},authenticated=true)=>new Request(origin+'/api/private/bna-inquiries',{method:'POST',headers:{host:'life-skills.example.invalid','x-forwarded-proto':'https',origin,'content-type':'application/json','x-csrf-token':csrf,...(authenticated?{cookie:`__Host-ls-session=${token}`} : {}),...headers},body:JSON.stringify(input)});
 return {id,actor,read,communications,followup,deps,command,request,setDelivery:(next:Delivery)=>{delivery=next;},delivery};
}

it('requires an authenticated same-origin CSRF-protected owner action before changing acknowledgment state',async()=>{
 const f=acknowledgmentFixture();
 expect((await privateBnaInquiryHttp(f.request(f.command,{},false),async()=>f.deps)).status).toBe(401);
 expect((await privateBnaInquiryHttp(f.request(f.command,{'x-csrf-token':'invalid'}),async()=>f.deps)).status).toBe(403);
 expect((await privateBnaInquiryHttp(f.request(f.command,{origin:'https://other.invalid'}),async()=>f.deps)).status).toBe(403);
 expect(f.read).not.toHaveBeenCalled();expect(f.communications.cancel).not.toHaveBeenCalled();expect(f.communications.retryNotAttempted).not.toHaveBeenCalled();expect(f.followup).not.toHaveBeenCalled();
});

it('binds the action to the owned inquiry and its exact frozen message',async()=>{
 const f=acknowledgmentFixture();
 expect((await privateBnaInquiryHttp(f.request({...f.command,messageId:randomUUID()}),async()=>f.deps)).status).toBe(404);
 f.read.mockRejectedValueOnce(new AppError('NOT_FOUND'));
 expect((await privateBnaInquiryHttp(f.request(f.command),async()=>f.deps)).status).toBe(404);
 expect(f.communications.cancel).not.toHaveBeenCalled();expect(f.followup).not.toHaveBeenCalled();
});

it('rejects recipient, copy and owner overrides on a delivery action',async()=>{
 const f=acknowledgmentFixture();
 for(const extra of [{recipient:'other@example.invalid'},{subject:'Other copy'},{ownerAccountId:randomUUID()},{program:'bna_support_interest'}]){
  expect((await privateBnaInquiryHttp(f.request({...f.command,...extra}),async()=>f.deps)).status).toBe(400);
 }
 expect(f.communications.cancel).not.toHaveBeenCalled();expect(f.communications.retryNotAttempted).not.toHaveBeenCalled();expect(f.followup).not.toHaveBeenCalled();
});

it('returns current provider facts after an idempotent cancellation replay rather than claiming recalled mail',async()=>{
 const f=acknowledgmentFixture();
 f.communications.cancel.mockImplementationOnce(async()=>{f.setDelivery({...f.delivery,state:'sent',version:4,lastCode:'PROVIDER_ACCEPTED_AFTER_CANCEL',providerId:'synthetic-provider',completedAt:new Date().toISOString()});return {state:'canceled',replayed:true};});
 const response=await privateBnaInquiryHttp(f.request(f.command),async()=>f.deps);
 expect(response.status).toBe(200);expect((await response.json()).data).toMatchObject({replayed:true,acknowledgment:{deliveryState:'sent',deliveryVersion:4,deliveryCode:'PROVIDER_ACCEPTED_AFTER_CANCEL'}});
 expect(f.communications.cancel).toHaveBeenCalledWith(f.actor,{messageId:f.command.messageId,operationId:f.command.operationId,expectedVersion:1});
 expect(f.communications.readForInquiry).toHaveBeenCalledTimes(2);expect(f.followup).not.toHaveBeenCalled();
});

it('preserves retry operation/version and propagates a native unknown-or-stale rejection without another effect',async()=>{
 const f=acknowledgmentFixture(),command={...f.command,action:'retry_acknowledgment'};
 f.communications.retryNotAttempted.mockRejectedValueOnce(new AppError('CONFLICT'));
 expect((await privateBnaInquiryHttp(f.request(command),async()=>f.deps)).status).toBe(409);
 expect(f.communications.retryNotAttempted).toHaveBeenCalledWith(f.actor,{messageId:command.messageId,operationId:command.operationId,expectedVersion:1});
 expect(f.communications.cancel).not.toHaveBeenCalled();expect(f.followup).not.toHaveBeenCalled();
});
