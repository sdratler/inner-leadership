import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createInquiryEmailTransport,inquiryEmailQueueEnabled} from "../../src/features/group-application/inquiry-email.ts";
import {inquiryEmailContent} from "../../src/features/group-application/inquiry-email-copy.ts";
import {publicGroupApplicationHttp} from "../../src/features/group-application/http.ts";
import {issueFloridaGroupApplicationChallenge} from "../../src/features/group-application/challenge.ts";
import {floridaGroupApplicationNotice,type FloridaParentApplicationFields} from "../../src/features/group-application/contract.ts";
const reference="01234567-89ab-4def-8123-456789abcdef";
it.each([false,true])("HTTP only invokes mail after durable save; uncertain send %s cannot erase it",async(fails)=>{
 const origin="https://synthetic.example.invalid",key="synthetic-inquiry-email-rate-key",now=Date.parse("2029-01-01T12:00:03Z"),order:string[]=[];
 const fields:FloridaParentApplicationFields={parentName:"Synthetic Parent",contact:"parent@example.invalid",language:"en",childAge:"10",cityArea:"Hollywood",programId:"sunday_fishing_academy",schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}};
 const afterCommit=vi.fn(async(id:string)=>{expect(id).toBe(reference);expect(order).toEqual(["committed"]);order.push("mail");if(fails)throw Error("uncertain provider");return "sent" as const;});
 const deps=async()=>({enabled:true,environment:{NODE_ENV:"production",LS_APP_ORIGIN:origin},challengeKey:key,now:()=>now,limits:{consume:async()=>({count:1,retryAfterMs:1000})},store:{submit:async()=>{order.push("committed");return {saved:true as const,replayed:false,duplicate:false,item:{id:reference,source:"public_group_application" as const,state:"owner_review" as const,receivedAt:new Date(now).toISOString(),fields}};}},afterCommit});
 const body={operationId:reference,fields,website:"",challenge:issueFloridaGroupApplicationChallenge(key,"sunday_fishing_academy",now-3000,reference)};
 const response=await publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications?program=sunday_fishing_academy",{method:"POST",headers:{host:"synthetic.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json"},body:JSON.stringify(body)}),deps);
 expect(response.status).toBe(201);expect(await response.json()).toMatchObject({ok:true,data:{saved:true,item:{id:reference},acknowledgment:fails?"unknown":"sent"}});expect(afterCommit).toHaveBeenCalledTimes(1);
});
it.each(["en","he"] as const)("keeps %s acknowledgment minimal, with reference and no paid-enrollment claim",locale=>{
 const content=inquiryEmailContent(reference,locale);expect(content.text).toContain(reference);expect(content.subject.length).toBeLessThanOrEqual(150);
 expect(content.text).toContain(locale==="en"?"does not confirm enrollment, payment":"אינה אישור הרשמה, תשלום");expect(content.text).not.toContain("http");
});
it("rejects invalid references and keeps both queue and send OFF by default",()=>{
 expect(()=>inquiryEmailContent("header\r\ninjection","en")).toThrow();expect(inquiryEmailQueueEnabled({})).toBe(false);expect(inquiryEmailQueueEnabled({LS_INQUIRY_EMAIL_QUEUE_ENABLED:"true"})).toBe(true);
 expect(()=>createInquiryEmailTransport({})).toThrow();expect(()=>createInquiryEmailTransport({LS_INQUIRY_EMAIL_SEND_ENABLED:"true",LS_AUTH_EMAIL_PROVIDER:"resend"})).toThrow();
});
it("reuses the Office Gmail transport only under a separate explicit purpose gate; no credentials or external calls here",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:"synthetic_token"})).mockResolvedValueOnce(Response.json({id:"synthetic_receipt"}));
 const env={LS_INQUIRY_EMAIL_SEND_ENABLED:"true",LS_AUTH_EMAIL_ENABLED:"true",LS_AUTH_EMAIL_PROVIDER:"gmail",LS_AUTH_EMAIL_FROM:"office@bneineviimacademy.org",LS_AUTH_GOOGLE_CLIENT_ID:"synthetic-client",LS_AUTH_GOOGLE_CLIENT_SECRET:"synthetic-secret",LS_AUTH_GOOGLE_REFRESH_TOKEN:"synthetic-refresh"};
 const {transport,from}=createInquiryEmailTransport(env,fetcher);
 expect(transport.nonIdempotent).toBe(true);expect(await transport.send({from,to:"parent@example.invalid",...inquiryEmailContent(reference,"en"),idempotencyKey:`ls-auth-${reference}`})).toEqual({providerId:"synthetic_receipt"});expect(fetcher).toHaveBeenCalledTimes(2);
});
