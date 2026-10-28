import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {publicBnaInquiryHttp} from "../../src/features/bna-inquiry/http.ts";
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
