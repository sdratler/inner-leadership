import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createInquiryEmailTransport,inquiryEmailQueueEnabled,queueInquiryEmail} from "../../src/features/group-application/inquiry-email.ts";
import {inquiryEmailContent} from "../../src/features/group-application/inquiry-email-copy.ts";
import{floridaParentApplicationFieldsSchema,floridaGroupApplicationNotice}from"../../src/features/group-application/contract.ts";
import{ACADEMY_INTAKE_VERSION}from"../../src/features/group-application/academy-intake.ts";
import{unseal}from"../../src/features/identity/crypto.ts";
import type{WorkspaceId}from"../../src/lib/ids.ts";
import {publicGroupApplicationHttp} from "../../src/features/group-application/http.ts";
import {issueFloridaGroupApplicationChallenge} from "../../src/features/group-application/challenge.ts";
import type {FloridaParentApplicationFields} from "../../src/features/group-application/contract.ts";
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
 const mime=Buffer.from(JSON.parse(String(fetcher.mock.calls[1]![1].body)).raw,'base64url').toString('utf8');expect(mime).toContain('From: JLFA Office <office@bneineviimacademy.org>\r\n');expect(mime).not.toContain('From: Life Skills');
});
it.each([
 {contact:"+12025550101",confirmationEmail:"confirmation@example.invalid",expected:"confirmation@example.invalid"},
 {contact:"original@example.invalid",confirmationEmail:"confirmation@example.invalid",expected:"confirmation@example.invalid"},
 {contact:"original@example.invalid",confirmationEmail:undefined,expected:"original@example.invalid"},
 {contact:"+12025550101",confirmationEmail:undefined,expected:null},
])("queues only the explicitly selected acknowledgment destination ($contact/$confirmationEmail)",async({contact,confirmationEmail,expected})=>{
 const fields=floridaParentApplicationFieldsSchema.parse({parentName:"Synthetic parent",contact,language:"en",cityArea:"Synthetic area",programId:"sunday_fishing_academy",schedulePreference:["sunday"],scheduleContext:"program_format_interest",
  academyFit:{version:"RM-FIT-20261014-04-v1",learners:[{approximateAge:10,gear:"not_sure",experience:"new"}],maximumDriveMinutes:30,parentDropoff:"yes"},
  academyIntake:{version:ACADEMY_INTAKE_VERSION,postalCode:"33431",driveLimit:"up_to_30",preferredGroupLanguage:"either",stagePreference:"discuss",keysTravel:"discuss",offshoreInterest:"discuss",nextStep:"callback",confirmationEmail,learners:[{gradeBand:"grade_3_5",schooling:"school",tackleBox:"not_sure"}]},
  permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}});
 const workspace="11111111-1111-4111-8111-111111111111" as WorkspaceId,ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,7)}},query=vi.fn().mockResolvedValue([]);
 const result=await queueInquiryEmail({query},workspace,reference,fields,ring,new Date("2026-10-18T00:00:00Z"));
 expect(result).toBe(expected?"queued":"not_requested");expect(query).toHaveBeenCalledTimes(expected?1:0);
 if(expected){const args=query.mock.calls[0]![1] as unknown[];const payload=JSON.parse(unseal(args[4] as string,`ls_service_interest/inquiry_email/v1/${workspace}/${args[1]}`,ring));expect(payload).toEqual({purpose:"academy_inquiry_acknowledgment_v1",reference,recipient:expected,locale:"en"});expect(String(args[4])).not.toContain(expected);}
});
