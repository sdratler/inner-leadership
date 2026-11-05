import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {loadTrip390AckAdmission,academy650AckSourceFiles,ACADEMY650_ACK_POLICY_VERSION,TRIP390_ACK_PURPOSE,TRIP390_ACK_SENDER} from '../../src/features/group-application/academy-trip390-ack-admission.ts';
import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_OFFER} from '../../src/features/group-application/academy-trip390-contract.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {trip390V1InterestSchema} from '../../src/features/group-application/academy-trip390-v1.ts';
import {privateDigest} from '../../src/features/contact-ops/server/digests.ts';
import {academy650AckContent,ACADEMY650_ACK_COPY_VERSION} from '../../src/features/group-application/academy650-r2-ack.ts';
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,afterEach,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {InquiryEmailOutbox} from "../../src/features/group-application/inquiry-email.ts";
import {INQUIRY_EMAIL_FROM} from "../../src/features/group-application/inquiry-email-copy.ts";
import {floridaGroupApplicationNotice,type FloridaParentApplicationFields} from "../../src/features/group-application/contract.ts";
import {seal,unseal} from "../../src/features/identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {asId} from "../../src/lib/ids.ts";

let db:PGlite;
const workspace=asId(randomUUID(),"workspace"),now=new Date("2029-01-01T12:00:00Z"),clock={now:()=>now};
const ring={activeKeyId:"test",keys:{test:Buffer.alloc(32,9)}},key="synthetic-inquiry-email-test-key";
const store:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>(await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const application=new PublicGroupApplicationStore(store,workspace,ring,key,clock,true);
const outbox=new InquiryEmailOutbox(store,workspace,ring,clock),actors:Actor[]=[];
function command(overrides:Partial<FloridaParentApplicationFields>={}){return {operationId:randomUUID(),fields:{parentName:"Synthetic Parent",contact:`p-${randomUUID()}@example.invalid`,language:"en",childAge:"10",cityArea:"Hollywood",programId:"sunday_fishing_academy",schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"},...overrides} as FloridaParentApplicationFields};}
async function row(reference:string){return (await db.query<{id:string;state:string;payload_ciphertext:string;provider_id:string|null}>("SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2",[workspace,reference])).rows[0]!;}
let sourceHashes:Record<string,string>;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('REAL_NETWORK_NOT_ADMITTED');}));
 sourceHashes=Object.fromEntries(await Promise.all(Object.entries(academy650AckSourceFiles).map(async([k,p])=>[k,sha((await readFile(p,'utf8')).replace(/\r\n/g,'\n'))])));
 expect(Object.keys(sourceHashes)).toHaveLength(22);
 db=new PGlite();
 await db.exec("CREATE SCHEMA ls_control");
 for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0131_ls_public_group_applications.sql","0135_ls_inquiry_email_outbox.sql","0136_ls_academy_founder.sql","0137_ls_academy_owner_notifications.sql"])await db.exec(await readFile("migrations/"+name,"utf8"));
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
 for(const role of ["practitioner","parent"] as const){const id=randomUUID(),digest=id.replaceAll("-","").padEnd(64,"0");
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspace,role,digest,now]);
  await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
  await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date(now.getTime()+86400000)]);
  actors.push({id,workspaceId:workspace,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:now.getTime()+86400000} as Actor);
 }
},20000);
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();});
afterAll(async()=>{try{await db?.close();}finally{vi.unstubAllGlobals();}});
it("commits encrypted one-to-one mail intent with the inquiry; exact and new-key replays never duplicate it",async()=>{
 const input=command(),saved=await application.submit(input),first=await row(saved.item.id);
 expect(saved).toMatchObject({saved:true,acknowledgment:"queued"});expect(first.state).toBe("queued");
 expect(first.payload_ciphertext).not.toContain(input.fields.contact);expect(first.payload_ciphertext).not.toContain(saved.item.id);
 expect((await application.submit(input)).item.id).toBe(saved.item.id);
 expect((await application.submit({...input,operationId:randomUUID()})).item.id).toBe(saved.item.id);
 await expect(application.submit({...input,fields:{...input.fields,childAge:"11"}})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await db.query("SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE application_id=$1",[saved.item.id])).rows).toEqual([{id:first.id}]);
 expect(await application.list(actors[0]!)).toContainEqual(saved.item);await expect(application.list(actors[1]!)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("keeps phone-only and other programs valid without inventing a destination",async()=>{
 for(const input of [command({contact:"+15550003111"}),command({programId:"private_fishing_life_skills"})]){const saved=await application.submit(input);expect(saved).toMatchObject({acknowledgment:"not_requested"});expect(await row(saved.item.id)).toBeUndefined();}
});
it("OFF remains compatible with pre-outbox databases and never queries the email table",async()=>{
 const guarded:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.includes("inquiry_email_outbox"))throw Error("unexpected mail");return tx.query(sql,values);}}))};
 const saved=await new PublicGroupApplicationStore(guarded,workspace,ring,key,clock).submit(command());
 expect(saved).not.toHaveProperty("acknowledgment");expect(await row(saved.item.id)).toBeUndefined();
});
it("rolls back both inquiry and operation if atomic queue persistence fails",async()=>{
 const input=command(),before=(await db.query("SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1",[workspace])).rows;const broken:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.startsWith("INSERT INTO ls_service_interest.inquiry_email_outbox"))throw Error("queue unavailable");return tx.query(sql,values);}}))};
 await expect(new PublicGroupApplicationStore(broken,workspace,ring,key,clock,true).submit(input)).rejects.toThrow("queue unavailable");
 expect((await db.query("SELECT operation_id FROM ls_service_interest.public_application_operations WHERE operation_id=$1",[input.operationId])).rows).toEqual([]);
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1",[workspace])).rows).toEqual(before);
 expect(await new PublicGroupApplicationStore(store,workspace,ring,key,clock).replaySaved(input)).toBeNull();
});
it("a fresh worker sends only after the native commit and committed unknown reservation, outside the DB transaction",async()=>{
 const input=command({language:"he",permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"he"}}),saved=await application.submit(input),mail=await row(saved.item.id);
 const send=vi.fn(async(message:{to:string;text:string;idempotencyKey:string})=>{
  expect((await row(saved.item.id)).state).toBe("unknown");expect(message.to).toBe(input.fields.contact);expect(message.text).toContain(saved.item.id);expect(message.text).toContain("אינה אישור הרשמה");expect(message.idempotencyKey).toBe(`ls-auth-${mail.id}`);return {providerId:"synthetic_mail_1"};
 });
 expect(await new InquiryEmailOutbox(store,workspace,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("sent");
 expect(await row(saved.item.id)).toMatchObject({state:"sent",provider_id:"synthetic_mail_1"});
 expect(await outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");expect(send).toHaveBeenCalledTimes(1);
});
it("unknown network results survive a new worker and replay without resending",async()=>{
 const input=command(),saved=await application.submit(input),mail=await row(saved.item.id),send=vi.fn(async()=>{throw Error("unknown external result");});
 expect(await outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("unknown");await application.submit(input);
 expect(await new InquiryEmailOutbox(store,workspace,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");
 expect(send).toHaveBeenCalledTimes(1);expect((await row(saved.item.id)).state).toBe("unknown");
 await expect(outbox.reconcile(actors[1]!,mail.id,{state:"sent",providerId:"verified_provider_2"})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(await outbox.reconcile(actors[0]!,mail.id,{state:"sent",providerId:"verified_provider_2"})).toBe("sent");
 await expect(outbox.reconcile(actors[0]!,mail.id,{state:"canceled"})).rejects.toMatchObject({code:"CONFLICT"});
});
it("DB failure after a successful provider response leaves unknown and never automatically sends again",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn(async()=>({providerId:"synthetic_mail_3"}));
 const broken:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.includes("SET state='sent'"))throw Error("commit failed");return tx.query(sql,values);}}))};
 expect(await new InquiryEmailOutbox(broken,workspace,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("unknown");
 expect(await outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");expect(send).toHaveBeenCalledTimes(1);
});
it("concurrent worker reservations cannot deliver twice",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn(async()=>({providerId:"synthetic_mail_4"}));
 expect((await Promise.all([outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM),outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)])).sort()).toEqual(["idle","sent"]);expect(send).toHaveBeenCalledTimes(1);
});
it("post-commit HTTP dispatch by native reference shares the same durable no-resend state across retries",async()=>{
 const input=command(),saved=await application.submit(input),send=vi.fn(async()=>({providerId:"synthetic_post_commit"}));
 expect(await outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM)).toBe("sent");
 await application.submit(input);expect(await outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM)).toBe("sent");
 expect(send).toHaveBeenCalledTimes(1);expect(await outbox.dispatchForApplication(randomUUID(),{send},INQUIRY_EMAIL_FROM)).toBe("not_requested");
});
it("rejects mismatched recipient/purpose before network, even with valid ciphertext",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn();
 const payload={purpose:"academy_inquiry_acknowledgment_v1",reference:saved.item.id,recipient:"other@example.invalid",locale:"en"};
 await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[workspace,mail.id,seal(JSON.stringify(payload),`ls_service_interest/inquiry_email/v1/${workspace}/${mail.id}`,ring)]);
 await expect(outbox.dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(send).not.toHaveBeenCalled();expect((await row(saved.item.id)).state).toBe("queued");
});
it("workspace scoping and sender restrictions prevent cross-destination delivery",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id),send=vi.fn();
 const other=asId(randomUUID(),"workspace");await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[other,now]);
 expect(await new InquiryEmailOutbox(store,other,ring,clock).dispatchOne(mail.id,{send},INQUIRY_EMAIL_FROM)).toBe("idle");
 await expect(outbox.dispatchOne(mail.id,{send},"wrong@example.invalid")).rejects.toMatchObject({code:"INVALID_REQUEST"});expect(send).not.toHaveBeenCalled();
});

function tripCommand(){const fields=currentTrip390Fields();fields.email=`trip-${randomUUID()}@example.invalid`;fields.children[0]!.name='SyntheticOlder';fields.children.push({...fields.children[0]!,id:randomUUID(),name:'SyntheticYounger',ageYears:9});return {operationId:randomUUID(),fields};}
function admittedTrip(input:ReturnType<typeof tripCommand>,reference:string,id:string){
 const fields=input.fields,content=academy650AckContent({reference,parentFirstName:fields.guardianName.split(" ")[0]!,children:fields.children.map(({id,name})=>({id,name})),messageLanguage:fields.messageLanguage});
 const target={reference,id,operationId:input.operationId,fields,content},initial=now;
  const policy={version:ACADEMY650_ACK_POLICY_VERSION,approvalReceiptSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),workspaceId:workspace,projectId:randomUUID(),environmentId:randomUUID(),serviceId:randomUUID(),origin:'https://life-skills.bneineviimacademy.org',sender:TRIP390_ACK_SENDER,replyTo:TRIP390_ACK_SENDER,requestVersion:TRIP390_INTEREST_VERSION,noticeVersion:TRIP390_NOTICE_VERSION,offerVersion:TRIP390_OFFER.version,payloadVersion:3,payloadKind:TRIP390_ACK_PURPOSE,templateVersion:ACADEMY650_ACK_COPY_VERSION,sourceHashes,notBefore:initial.toISOString(),admittedAt:initial.toISOString(),expiresAt:new Date(initial.valueOf()+3600000).toISOString(),population:{mode:'controlled_test',requests:[{reference:target.reference,outboxId:target.id,operationId:target.operationId,recipientSha256:sha(target.fields.email),messageLanguage:target.fields.messageLanguage,childIds:target.fields.children.map(c=>c.id),contentSha256:target.content.contentSha256}]}};
  const env:Record<string,string|undefined>={LS_ACADEMY_TRIP390_ACK_ENABLED:'true',LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED:'true',LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON:JSON.stringify(policy),LS_INQUIRY_EMAIL_QUEUE_ENABLED:'false',LS_INQUIRY_EMAIL_SEND_ENABLED:'false',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'false',LS_ACADEMY_SIGNUP_WORKER_ENABLED:'false',LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED:'false',LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:policy.sender,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic-id',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic-secret',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic-refresh',RAILWAY_GIT_COMMIT_SHA:policy.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:policy.sourceCommit,LS_IDENTITY_WORKSPACE_ID:workspace,RAILWAY_PROJECT_ID:policy.projectId,RAILWAY_ENVIRONMENT_ID:policy.environmentId,RAILWAY_SERVICE_ID:policy.serviceId,LS_APP_ORIGIN:policy.origin};
  const issued=loadTrip390AckAdmission(env,now);expect(issued).not.toBeNull();return {env,issued:issued!,policy};
 }
const tripOutbox=()=>new InquiryEmailOutbox(store,workspace,ring,clock,key);
const oauth='https://oauth2.googleapis.com/token',gmail='https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
function tripTransport(onSend?: (mime:string)=>Promise<Response>){return vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
 const url=String(input);expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');
 if(url===oauth)return new Response(JSON.stringify({access_token:'synthetic-access'}));
 expect(url).toBe(gmail);const mime=Buffer.from(JSON.parse(String(init?.body)).raw,'base64url').toString('utf8');
 return onSend?onSend(mime):new Response(JSON.stringify({id:'synthetic-trip-provider'}));
});}

it('atomically saves current siblings, leading-zero ZIP, total-day driving and one frozen chosen-language ACK; retries never backfill',async()=>{
 const input=tripCommand(),saved=await application.submit(input),mail=await row(saved.item.id);
 expect(saved.acknowledgment).toBe('queued');expect(mail.state).toBe('queued');expect(mail.payload_ciphertext).not.toContain(input.fields.email);
 const payload=JSON.parse(unseal(mail.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${mail.id}`,ring));
 const rendered=academy650AckContent({reference:saved.item.id,parentFirstName:input.fields.guardianName.split(" ")[0]!,children:input.fields.children.map(({id,name})=>({id,name})),messageLanguage:'he'});
 expect(payload).toMatchObject({version:3,requestVersion:TRIP390_INTEREST_VERSION,offerVersion:TRIP390_OFFER.version,copyVersion:ACADEMY650_ACK_COPY_VERSION,childIds:input.fields.children.map(child=>child.id),locale:'he',recipient:input.fields.email,subject:rendered.subject,text:rendered.text,html:rendered.html,contentSha256:rendered.contentSha256});
 expect((await new PublicGroupApplicationStore(store,workspace,ring,key,clock,true).readForOwner(actors[0]!,saved.item.id)).fields).toEqual(input.fields);
 expect((await application.submit(input)).item.id).toBe(saved.item.id);expect((await application.submit({...input,operationId:randomUUID()})).item.id).toBe(saved.item.id);
 expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM ls_service_interest.inquiry_email_outbox WHERE application_id=$1',[saved.item.id])).rows[0]!.count).toBe(1);
 const noQueue=await new PublicGroupApplicationStore(store,workspace,ring,key,clock,false).submit(tripCommand());
 await application.submit({operationId:randomUUID(),fields:noQueue.item.fields as ReturnType<typeof currentTrip390Fields>});
 expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM ls_service_interest.inquiry_email_outbox WHERE application_id=$1',[noQueue.item.id])).rows[0]!.count).toBe(0);
});
it('rolls back the application and operation when new ACK storage fails',async()=>{
 const input=tripCommand();const broken:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.includes('INSERT INTO ls_service_interest.inquiry_email_outbox'))throw Error('synthetic atomic queue failure');return tx.query(sql,values);}}))};
 await expect(new PublicGroupApplicationStore(broken,workspace,ring,key,clock,true).submit(input)).rejects.toThrow('synthetic atomic queue failure');
 expect(await application.replaySaved(input)).toBeNull();
});
it('keeps an exact frozen v1 saved operation readable beside v2 and never queues it under new bytes',async()=>{
 const {lessonDayDriving:_,phone:__,...historicBase}=currentTrip390Fields();void _;void __;const fields=trip390V1InterestSchema.parse({...historicBase,version:'JLFA-TRIP390-INTEREST-v1',offerVersion:'JLFA-KEYS390-v1',notes:'Historical synthetic answer',children:[{id:randomUUID(),name:'Historical synthetic child',ageYears:22,experience:'some'}],acknowledgment:{version:'JLFA-TRIP390-INTEREST-NOTICE-v1',language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false}});
 const reference=randomUUID(),operationId=randomUUID(),digest=privateDigest({domain:'public-group-application/v1',workspace,fields},key);
 await db.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,'en',$7)`,[workspace,reference,'0'.repeat(64),digest,seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${workspace}/${reference}`,ring),fields.acknowledgment.version,now]);
 await db.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',[workspace,operationId,digest,reference]);
 expect((await application.replaySaved({operationId,fields}))?.item.fields).toEqual(fields);
 expect((await application.submit({operationId,fields})).item.fields).toEqual(fields);
 await expect(application.submit({operationId:randomUUID(),fields})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 const current=await application.submit(tripCommand());const mixed=await application.listPage(actors[0]!,{});
 expect(mixed.items.map(v=>v.id)).toEqual(expect.arrayContaining([reference,current.item.id]));
 expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM ls_service_interest.inquiry_email_outbox WHERE application_id=$1',[reference])).rows[0]!.count).toBe(0);
});
it('sends current V4 R2 once through issued admission and actual Gmail adapter, preserving chosen language and siblings',async()=>{
 const input=tripCommand(),saved=await application.submit(input),mail=await row(saved.item.id),a=admittedTrip(input,saved.item.id,mail.id),send=tripTransport();
 expect(await tripOutbox().dispatchTrip390One(mail.id,a.issued,a.env,send as typeof fetch)).toBe('sent');
 expect(await row(saved.item.id)).toMatchObject({state:'sent',provider_id:'synthetic-trip-provider'});
 expect(await tripOutbox().dispatchTrip390One(mail.id,a.issued,a.env,send as typeof fetch)).toBe('idle');
 expect(send.mock.calls.filter(([url])=>url===gmail)).toHaveLength(1);
 const mime=Buffer.from(JSON.parse(String(send.mock.calls.find(([url])=>url===gmail)![1]!.body)).raw,'base64url').toString('utf8');
 expect(mime).toContain('To: '+input.fields.email);
 const content=academy650AckContent({reference:saved.item.id,parentFirstName:input.fields.guardianName.split(" ")[0]!,children:input.fields.children.map(({id,name})=>({id,name})),messageLanguage:input.fields.messageLanguage});
 expect(content.messageLanguage).toBe('he');for(const child of input.fields.children)expect(content.text).toContain(child.name);
 const payload=JSON.parse(unseal(mail.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${mail.id}`,ring));
 expect(payload).toMatchObject({locale:'he',subject:content.subject,text:content.text,html:content.html,contentSha256:content.contentSha256});
 const plain=/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(mime);
 const html=/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(mime);
 expect(plain).not.toBeNull();expect(html).not.toBeNull();
 expect(Buffer.from(plain![1]!.replace(/\r\n/g,''),'base64')).toEqual(Buffer.from(content.text));
 expect(Buffer.from(html![1]!.replace(/\r\n/g,''),'base64')).toEqual(Buffer.from(content.html));
});
it('restarts with one current frozen ACK and preserves UNKNOWN without a blind resend',async()=>{
 let inspectionCompleted=false;
 const input=tripCommand(),saved=await application.submit(input),mail=await row(saved.item.id),a=admittedTrip(input,saved.item.id,mail.id),send=tripTransport(async mime=>{
  expect((await row(saved.item.id)).state).toBe('unknown');expect(mime).toContain('To: '+input.fields.email);
  const payload=JSON.parse(unseal(mail.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${mail.id}`,ring));for(const child of input.fields.children)expect(payload.text).toContain(child.name);
  inspectionCompleted=true;
  throw Error('synthetic uncertain send');
 });
 expect(await tripOutbox().dispatchTrip390One(mail.id,a.issued,a.env,send as typeof fetch)).toBe('unknown');
 expect(inspectionCompleted).toBe(true);
 expect(await tripOutbox().dispatchTrip390One(mail.id,a.issued,a.env,send as typeof fetch)).toBe('idle');
 await application.submit(input);expect(send.mock.calls.filter(([url])=>url===gmail)).toHaveLength(1);expect(send).toHaveBeenCalledTimes(2);
 expect(await row(saved.item.id)).toMatchObject({state:'unknown',provider_id:null});
});
it('rejects current ACK language/content tampering before any OAuth or message network',async()=>{
 const input=tripCommand(),saved=await application.submit(input),mail=await row(saved.item.id),a=admittedTrip(input,saved.item.id,mail.id),send=tripTransport();
 const payload=JSON.parse(unseal(mail.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${mail.id}`,ring));payload.locale='en';
 await db.query('UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[workspace,mail.id,seal(JSON.stringify(payload),`ls_service_interest/inquiry_email/v1/${workspace}/${mail.id}`,ring)]);
 const tampered=await row(saved.item.id);expect(tampered.state).toBe('queued');
 expect(await tripOutbox().dispatchTrip390One(mail.id,a.issued,a.env,send as typeof fetch)).toBe('idle');expect(send).not.toHaveBeenCalled();
 expect(await row(saved.item.id)).toEqual(tampered);expect(fetch).not.toHaveBeenCalled();
});
it("rechecks a revoked practitioner session before unknown reconciliation",async()=>{
 const saved=await application.submit(command()),mail=await row(saved.item.id);await outbox.dispatchOne(mail.id,{send:async()=>{throw Error();}},INQUIRY_EMAIL_FROM);
 await db.query("UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1",[actors[0]!.sessionDigest,now]);
 await expect(outbox.reconcile(actors[0]!,mail.id,{state:"canceled"})).rejects.toMatchObject({code:"UNAUTHENTICATED"});expect((await row(saved.item.id)).state).toBe("unknown");
});
