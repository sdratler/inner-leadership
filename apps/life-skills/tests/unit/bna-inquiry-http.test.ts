import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {publicBnaInquiryHttp,privateBnaInquiryHttp} from "../../src/features/bna-inquiry/http.ts";
import type {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {BNA_COOP_NOTICE} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_INQUIRY_NOTICE} from "../../src/features/bna-inquiry/contract.ts";

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
 const deps={origin,actor:async()=>actor,csrf:()=>"b".repeat(43),limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic-rate-key",store:{read,list:vi.fn(),followup:vi.fn()} as unknown as Pick<BnaInquiryStore,"read"|"list"|"followup">};
 const req=(query:string,cookie=true)=>new Request(origin+"/api/private/bna-inquiries"+query,{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",...(cookie?{cookie:`__Host-ls-session=${token}`}:{})}});
 const id=randomUUID();expect((await privateBnaInquiryHttp(req(`?id=${id}&historyBefore=23`),async()=>deps)).status).toBe(200);expect(read).toHaveBeenCalledWith(actor,id,23);
 for(const query of [`?historyBefore=23`,`?id=${id}&historyBefore=2&historyBefore=3`,`?id=${id}&before=x`,`?id=${id}&historyBefore=oops`])expect((await privateBnaInquiryHttp(req(query),async()=>deps)).status).toBe(400);
 expect((await privateBnaInquiryHttp(req(`?id=${id}&historyBefore=23`,false),async()=>deps)).status).toBe(401);
});
