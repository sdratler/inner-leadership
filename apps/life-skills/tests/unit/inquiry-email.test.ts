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

it('controlled test transport requires issued exact authority and never enables generic sends',async()=>{
 const {createSignupWorkerAdmission,signupRecipientDigest,SignupEmailNotAttemptedError}=await import('../../src/features/group-application/academy-signup-worker-admission.ts');
 let instant=new Date('2026-10-27T12:00:00.000Z');
 const ids={workspaceId:'11111111-1111-4111-8111-111111111111',projectId:'22222222-2222-4222-8222-222222222222',environmentId:'33333333-3333-4333-8333-333333333333',serviceId:'44444444-4444-4444-8444-444444444444'};
 const context={...ids,enabled:true,freeEnabled:true,sendEnabled:true,founderApproved:true,sourceCommit:'a'.repeat(40),releaseCommit:'a'.repeat(40),origin:'https://bneineviimacademy.org',templateModuleSha256:'b'.repeat(64),templateContractSha256:'c'.repeat(64),templateCatalogSha256:'d'.repeat(64),templateFacadeSha256:'e'.repeat(64),templateVersion:'JLFA-EXACT-COPY-20261026-05',transportHashes:{gmail:'1'.repeat(64),contract:'2'.repeat(64),resend:'3'.repeat(64)}};
 const data={...ids,version:'JLFA-SIGNUP-WORKER-ADMISSION-v2',approvalReceiptSha256:'f'.repeat(64),sourceCommit:context.sourceCommit,origin:context.origin,sender:'office@bneineviimacademy.org',templateModuleSha256:context.templateModuleSha256,templateContractSha256:context.templateContractSha256,templateCatalogSha256:context.templateCatalogSha256,templateFacadeSha256:context.templateFacadeSha256,templateVersion:context.templateVersion,transportHashes:context.transportHashes,cutoff:instant.toISOString(),expiresAt:'2026-10-27T13:00:00.000Z',allowedTemplateIds:['R00','R03'],r00Exception:{version:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'},population:{mode:'controlled_test',admittedAt:instant.toISOString(),recipientSha256:signupRecipientDigest('controlled@example.invalid'),learnerIds:['66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777']}};
 const {createHash}=await import('node:crypto'),{readFileSync}=await import('node:fs');const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const actual={templateModuleSha256:sha('src/features/group-application/academy-founder-email.ts'),templateContractSha256:sha('src/features/group-application/academy-founder-contract.ts'),templateCatalogSha256:sha('src/features/group-application/academy-exact-email-copy.json'),templateFacadeSha256:sha('src/features/group-application/academy-exact-copy.ts'),transportHashes:{gmail:sha('src/providers/email/gmail.ts'),contract:sha('src/providers/email/transport.ts'),resend:sha('src/providers/email/resend.ts')}};Object.assign(context,actual);Object.assign(data,actual);
 const policy=createSignupWorkerAdmission(data,context,instant)!;expect(policy).not.toBeNull();
 const env={LS_INQUIRY_EMAIL_SEND_ENABLED:'false',LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED:'true',LS_ACADEMY_SIGNUP_WORKER_ENABLED:'true',LS_ACADEMY_FREE_REGISTRATION_ENABLED:'true',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'false',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:data.sender,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic-client',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic-secret',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic-refresh',LS_IDENTITY_WORKSPACE_ID:ids.workspaceId,RAILWAY_PROJECT_ID:ids.projectId,RAILWAY_ENVIRONMENT_ID:ids.environmentId,RAILWAY_SERVICE_ID:ids.serviceId,RAILWAY_GIT_COMMIT_SHA:data.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:data.sourceCommit,LS_APP_ORIGIN:data.origin};
 Object.assign(env,{LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify(data)});
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'synthetic_token'})).mockResolvedValueOnce(Response.json({id:'synthetic_receipt'}));
 expect(()=>createInquiryEmailTransport(env,fetcher)).toThrow();
 expect(()=>createInquiryEmailTransport(env,fetcher,{policy:{...policy},now:()=>instant})).toThrow(SignupEmailNotAttemptedError);
 for(const change of [{LS_INQUIRY_EMAIL_SEND_ENABLED:'true'},{LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED:'false'},{RAILWAY_GIT_COMMIT_SHA:'0'.repeat(40)},{RAILWAY_SERVICE_ID:ids.projectId}])expect(()=>createInquiryEmailTransport({...env,...change},fetcher,{policy,now:()=>instant})).toThrow(SignupEmailNotAttemptedError);
 const {transport,from}=createInquiryEmailTransport(env,fetcher,{policy,now:()=>instant});expect(fetcher).not.toHaveBeenCalled();
 const message={from,to:'controlled@example.invalid',subject:'Synthetic',text:'Synthetic',idempotencyKey:'ls-auth-01234567-89ab-4def-8123-456789abcdef'};
 expect(()=>transport.send({...message,to:'other@example.invalid'})).toThrow(SignupEmailNotAttemptedError);expect(fetcher).not.toHaveBeenCalled();
 expect(await transport.send(message)).toEqual({providerId:'synthetic_receipt'});expect(fetcher).toHaveBeenCalledTimes(2);
 instant=new Date(data.expiresAt);expect(()=>transport.send(message)).toThrow(SignupEmailNotAttemptedError);expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(['future_submissions','references'] as const)('finite %s signup transport fences after OAuth while generic behavior stays separate',async mode=>{
 const {createSignupWorkerAdmission,signupRecipientDigest,SignupEmailNotAttemptedError}=await import('../../src/features/group-application/academy-signup-worker-admission.ts');
 let instant=new Date('2026-10-27T12:00:00.000Z');
 const ids={workspaceId:'11111111-1111-4111-8111-111111111111',projectId:'22222222-2222-4222-8222-222222222222',environmentId:'33333333-3333-4333-8333-333333333333',serviceId:'44444444-4444-4444-8444-444444444444'};
 const context={...ids,enabled:true,freeEnabled:true,sendEnabled:true,founderApproved:true,sourceCommit:'a'.repeat(40),releaseCommit:'a'.repeat(40),origin:'https://bneineviimacademy.org',templateModuleSha256:'b'.repeat(64),templateContractSha256:'c'.repeat(64),templateCatalogSha256:'d'.repeat(64),templateFacadeSha256:'e'.repeat(64),templateVersion:'JLFA-EXACT-COPY-20261026-05',transportHashes:{gmail:'1'.repeat(64),contract:'2'.repeat(64),resend:'3'.repeat(64)}};
 const data={...ids,version:'JLFA-SIGNUP-WORKER-ADMISSION-v2',approvalReceiptSha256:'f'.repeat(64),sourceCommit:context.sourceCommit,origin:context.origin,sender:'office@bneineviimacademy.org',templateModuleSha256:context.templateModuleSha256,templateContractSha256:context.templateContractSha256,templateCatalogSha256:context.templateCatalogSha256,templateFacadeSha256:context.templateFacadeSha256,templateVersion:context.templateVersion,transportHashes:context.transportHashes,cutoff:instant.toISOString(),expiresAt:'2026-10-27T13:00:00.000Z',allowedTemplateIds:['R00','R03'],r00Exception:{version:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'},population:{mode:'controlled_test',admittedAt:instant.toISOString(),recipientSha256:signupRecipientDigest('controlled@example.invalid'),learnerIds:['66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777']}};
 const {createHash}=await import('node:crypto'),{readFileSync}=await import('node:fs');const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const actual={templateModuleSha256:sha('src/features/group-application/academy-founder-email.ts'),templateContractSha256:sha('src/features/group-application/academy-founder-contract.ts'),templateCatalogSha256:sha('src/features/group-application/academy-exact-email-copy.json'),templateFacadeSha256:sha('src/features/group-application/academy-exact-copy.ts'),transportHashes:{gmail:sha('src/providers/email/gmail.ts'),contract:sha('src/providers/email/transport.ts'),resend:sha('src/providers/email/resend.ts')}};Object.assign(context,actual);Object.assign(data,actual);
 const input={...data,population:mode==='references'?{mode,families:[{reference:'88888888-8888-4888-8888-888888888888',recipientSha256:signupRecipientDigest('controlled@example.invalid')}]}:{mode}};
 const policy=createSignupWorkerAdmission(input,context,instant)!;expect(policy).not.toBeNull();
 const env={LS_INQUIRY_EMAIL_SEND_ENABLED:'true',LS_ACADEMY_SIGNUP_WORKER_ENABLED:'true',LS_ACADEMY_FREE_REGISTRATION_ENABLED:'true',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'true',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:data.sender,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic-client',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic-secret',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic-refresh',LS_IDENTITY_WORKSPACE_ID:ids.workspaceId,RAILWAY_PROJECT_ID:ids.projectId,RAILWAY_ENVIRONMENT_ID:ids.environmentId,RAILWAY_SERVICE_ID:ids.serviceId,RAILWAY_GIT_COMMIT_SHA:data.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:data.sourceCommit,LS_APP_ORIGIN:data.origin,LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify(input)};
 let oauth=0,messageCalls=0;const fetcher=(async(url:string|URL|Request)=>{if(String(url).includes('oauth2')){oauth++;instant=new Date(data.expiresAt);return Response.json({access_token:'synthetic'});}messageCalls++;return Response.json({id:'must_not_send'});}) as typeof fetch;
 const {transport,from}=createInquiryEmailTransport(env,fetcher,{policy,now:()=>instant});
 await expect(transport.send({from,to:'controlled@example.invalid',subject:'Synthetic',text:'Synthetic',idempotencyKey:'ls-auth-01234567-89ab-4def-8123-456789abcdef'})).rejects.toBeInstanceOf(SignupEmailNotAttemptedError);expect(oauth).toBe(1);expect(messageCalls).toBe(0);
});

it('queue revocation blocks controlled factory and the actual message HTTP after awaited OAuth',async()=>{
 const {createSignupWorkerAdmission,signupRecipientDigest,SignupEmailNotAttemptedError}=await import('../../src/features/group-application/academy-signup-worker-admission.ts');
 const instant=new Date('2026-10-27T12:00:00.000Z');
 const ids={workspaceId:'11111111-1111-4111-8111-111111111111',projectId:'22222222-2222-4222-8222-222222222222',environmentId:'33333333-3333-4333-8333-333333333333',serviceId:'44444444-4444-4444-8444-444444444444'};
 const context={...ids,enabled:true,freeEnabled:true,sendEnabled:true,founderApproved:true,sourceCommit:'a'.repeat(40),releaseCommit:'a'.repeat(40),origin:'https://bneineviimacademy.org',templateModuleSha256:'b'.repeat(64),templateContractSha256:'c'.repeat(64),templateCatalogSha256:'d'.repeat(64),templateFacadeSha256:'e'.repeat(64),templateVersion:'JLFA-EXACT-COPY-20261026-05',transportHashes:{gmail:'1'.repeat(64),contract:'2'.repeat(64),resend:'3'.repeat(64)}};
 const data={...ids,version:'JLFA-SIGNUP-WORKER-ADMISSION-v2',approvalReceiptSha256:'f'.repeat(64),sourceCommit:context.sourceCommit,origin:context.origin,sender:'office@bneineviimacademy.org',templateModuleSha256:context.templateModuleSha256,templateContractSha256:context.templateContractSha256,templateCatalogSha256:context.templateCatalogSha256,templateFacadeSha256:context.templateFacadeSha256,templateVersion:context.templateVersion,transportHashes:context.transportHashes,cutoff:instant.toISOString(),expiresAt:'2026-10-27T13:00:00.000Z',allowedTemplateIds:['R00','R03'],r00Exception:{version:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'},population:{mode:'controlled_test',admittedAt:instant.toISOString(),recipientSha256:signupRecipientDigest('controlled@example.invalid'),learnerIds:['66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777']}};
 const {createHash}=await import('node:crypto'),{readFileSync}=await import('node:fs');const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const actual={templateModuleSha256:sha('src/features/group-application/academy-founder-email.ts'),templateContractSha256:sha('src/features/group-application/academy-founder-contract.ts'),templateCatalogSha256:sha('src/features/group-application/academy-exact-email-copy.json'),templateFacadeSha256:sha('src/features/group-application/academy-exact-copy.ts'),transportHashes:{gmail:sha('src/providers/email/gmail.ts'),contract:sha('src/providers/email/transport.ts'),resend:sha('src/providers/email/resend.ts')}};Object.assign(context,actual);Object.assign(data,actual);
 const policy=createSignupWorkerAdmission(data,context,instant)!;expect(policy).not.toBeNull();
 const env={LS_INQUIRY_EMAIL_SEND_ENABLED:'false',LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED:'true',LS_ACADEMY_SIGNUP_WORKER_ENABLED:'true',LS_ACADEMY_FREE_REGISTRATION_ENABLED:'true',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'false',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:data.sender,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic-client',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic-secret',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic-refresh',LS_IDENTITY_WORKSPACE_ID:ids.workspaceId,RAILWAY_PROJECT_ID:ids.projectId,RAILWAY_ENVIRONMENT_ID:ids.environmentId,RAILWAY_SERVICE_ID:ids.serviceId,RAILWAY_GIT_COMMIT_SHA:data.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:data.sourceCommit,LS_APP_ORIGIN:data.origin};
 Object.assign(env,{LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify(data)});
 const never=vi.fn();for(const value of ['false',undefined])expect(()=>createInquiryEmailTransport({...env,LS_INQUIRY_EMAIL_QUEUE_ENABLED:value},never,{policy,now:()=>instant})).toThrow(SignupEmailNotAttemptedError);expect(never).not.toHaveBeenCalled();
 let oauth=0,messageCalls=0;const fetcher=(async(url:string|URL|Request)=>{if(String(url).includes('oauth2')){oauth++;env.LS_INQUIRY_EMAIL_QUEUE_ENABLED='false';return Response.json({access_token:'synthetic'});}messageCalls++;return Response.json({id:'must_not_send'});}) as typeof fetch;
 const {transport,from}=createInquiryEmailTransport(env,fetcher,{policy,now:()=>instant});await expect(transport.send({from,to:'controlled@example.invalid',subject:'Synthetic',text:'Synthetic',idempotencyKey:'ls-auth-01234567-89ab-4def-8123-456789abcdef'})).rejects.toBeInstanceOf(SignupEmailNotAttemptedError);expect(oauth).toBe(1);expect(messageCalls).toBe(0);
});
