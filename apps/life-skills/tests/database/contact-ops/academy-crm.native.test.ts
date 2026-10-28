import {afterAll,expect,test,vi} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {AcademyCrmStore} from "../../../src/features/contact-ops/server/academy-crm-store.ts";
import {NativeCrmStore} from "../../../src/features/contact-ops/server/native-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {PublicGroupApplicationStore} from "../../../src/features/group-application/store.ts";
import {floridaGroupApplicationNotice} from "../../../src/features/group-application/contract.ts";
import {academyCrmHttp} from "../../../src/features/contact-ops/server/academy-crm-http.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {seal,tokenDigest,unseal} from "../../../src/features/identity/crypto.ts";
import {ContactInboundStore,inboundBindingDigest} from "../../../src/features/contact-ops/server/inbound-store.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import {readTaskCounts} from "../../../src/features/owner-digest/runtime.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import type {AcademyCrmCommand,AcademyInitializationInput} from "../../../src/features/contact-ops/core/academy-crm.ts";

const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-academy-crm-integrity-20261028",program="sunday_fishing_academy" as const;
// Only synthetic disposable test evidence, never a live initialization permit.
const proof=(operationId=randomUUID()):AcademyInitializationInput=>({operationId,expectedEpoch:0,observedNativeWritesSinceSwitch:0,
 decisionId:"ACADEMY-ONLY-CRM-20261028-01",evidence:{retiredSourcesFence:"a".repeat(64),retiredSchedulesFence:"b".repeat(64),
  retainedAcademyRecords:"c".repeat(64),queueReconciliation:"d".repeat(64),restorePlan:"e".repeat(64)}});
const fields:Extract<AcademyCrmCommand,{action:"create"}>["fields"]={name:"Synthetic Academy parent",phone:null,email:"synthetic-academy@example.invalid",language:"en" as const,
 relationship:"guardian" as const,stage:"New inquiry",nextAction:"Review possible dates",followUpDate:"2026-12-01",notes:"Synthetic Academy note"};
const admin={stage:fields.stage,nextAction:fields.nextAction,followUpDate:fields.followUpDate,notes:fields.notes};
const create=(change:Partial<typeof fields>={},operationId=randomUUID()):AcademyCrmCommand=>({action:"create",operationId,expectedEpoch:1,fields:{...fields,...change}});
async function setup(initialize=true){
 const f=await fixture();fixtures.push(f);const db=poolStore(f.pool),actor=f.practitioner.actor;
 const authority=new ContactCutoverStore(db,f.keyring,key),crm=new AcademyCrmStore(db,f.keyring,key),initialization=proof();
 if(initialize)await authority.initializeAcademy(actor,initialization);
 const inquiries=new PublicGroupApplicationStore(db,f.workspaceId,f.keyring,key);
 const inquiry=async(contact="synthetic-inquiry@example.invalid",selectedProgram=program as string)=>inquiries.submit({operationId:randomUUID(),fields:{
  parentName:"Synthetic saved inquiry",contact,language:"en",cityArea:"Synthetic Florida",programId:selectedProgram as typeof program,
  schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}});
 const count=async(table:string)=>(await f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[f.workspaceId])).rows[0].n as number;
 const sessions=new IdentitySessions(db,{enabled:true,origin:"https://academy-crm.example.invalid",workspaceId:f.workspaceId,keyring:f.keyring,
  csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:"synthetic-academy-http-limit-key",sessionSeconds:8*3600},systemClock);
 const dependencies=async()=>({origin:"https://academy-crm.example.invalid",actor:(token:string)=>sessions.actor(token),csrf:(token:string)=>sessions.csrf(token),
  limits:new PostgresIdentityRateStore(db),rateLimitKey:"synthetic-academy-http-limit-key",store:crm});
 const http=(input?:unknown,token=f.practitioner.token,overrides:Record<string,string>={},query="")=>academyCrmHttp(new Request("https://academy-crm.example.invalid/api/private/academy-crm"+query,
  {method:input===undefined?"GET":"POST",headers:{host:"academy-crm.example.invalid","x-forwarded-proto":"https",origin:"https://academy-crm.example.invalid",
   "sec-fetch-site":"same-origin",cookie:SESSION_COOKIE+"="+token,"x-csrf-token":sessions.csrf(token),"content-type":"application/json",...overrides},
   ...(input===undefined?{}:{body:JSON.stringify(input)})}),dependencies);
 return {f,db,actor,authority,crm,initialization,inquiry,count,http,sessions};
}

test("fresh initialization is explicit, zero-import, immutable and preserves unrelated identity and Academy inquiries",async()=>{
 const s=await setup(false);const inquiry=await s.inquiry();
 const sourceBefore=(await s.f.pool.query("SELECT to_jsonb(a) AS row FROM ls_service_interest.public_applications a WHERE workspace_id=$1",[s.f.workspaceId])).rows;
 const counts=await Promise.all(["ls_identity.people","ls_identity.accounts","ls_cases.cases","ls_calendar.tasks"].map(s.count));
 expect(await s.crm.list(s.actor)).toEqual({state:"setup_required",authorityEpoch:0});
 await expect(s.crm.execute(s.actor,create())).rejects.toThrow("CONFLICT");
 const initialized=await s.authority.initializeAcademy(s.actor,s.initialization);
 expect(initialized).toMatchObject({replayed:false,state:{phase:"academy_native",epoch:1,sourceFileId:null,sourceRevision:null,
  academy:{kind:"academy_fresh",program,importedRows:0,operationId:s.initialization.operationId}}});
 expect(await s.count("ls_contact_ops.legacy_links")).toBe(0);expect(await s.count("ls_contact_ops.profiles")).toBe(0);
 expect(await Promise.all(["ls_identity.people","ls_identity.accounts","ls_cases.cases","ls_calendar.tasks"].map(s.count))).toEqual(counts);
 expect((await s.f.pool.query("SELECT to_jsonb(a) AS row FROM ls_service_interest.public_applications a WHERE workspace_id=$1",[s.f.workspaceId])).rows).toEqual(sourceBefore);
 expect((await s.crm.previewInquiry(s.actor,inquiry.item.id,1)).sourceApplicationId).toBe(inquiry.item.id);
 expect(await s.crm.list(s.actor)).toMatchObject({state:"ready",total:0,items:[]});
 await expect(s.f.pool.query("DELETE FROM ls_contact_ops.cutover_history WHERE workspace_id=$1",[s.f.workspaceId])).rejects.toThrow("CONTACT_CUTOVER_HISTORY_APPEND_ONLY");
});

test("initialization requires fresh owner, exact prior state, no existing CRM data, and one serialized operation",async()=>{
 const s=await setup(false);
 await expect(s.authority.initializeAcademy(s.f.parent.actor,s.initialization)).rejects.toThrow("FORBIDDEN");
 await expect(s.authority.initializeAcademy(s.actor,{...s.initialization,expectedEpoch:1})).rejects.toThrow("CONFLICT");
 const attempts=[s.initialization,proof()];
 const results=await Promise.allSettled(attempts.map(p=>s.authority.initializeAcademy(s.actor,p)));
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 const winner=attempts[results.findIndex(result=>result.status==="fulfilled")]!;
 await s.crm.execute(s.actor,create());
 expect(await s.authority.initializeAcademy(s.actor,winner)).toMatchObject({replayed:true,state:{nativeWritesSinceSwitch:0}});
 expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(1);
 await expect(s.authority.initializeAcademy(s.actor,{...winner,evidence:{...winner.evidence,restorePlan:"f".repeat(64)}})).rejects.toThrow("CONFLICT");
 const old=await setup(false);
 await new NativeCrmStore(old.db,old.f.keyring,key).create(old.actor,{personId:old.actor.personId,...admin,legacyIds:[]},"synthetic-retired-profile");
 await expect(old.authority.initializeAcademy(old.actor,old.initialization)).rejects.toThrow("CONFLICT");
 expect((await old.authority.read(old.actor)).phase).toBe("sheet_active");
});

test("Academy email-only inquiry converts once, preserves source bytes, and grants no account or outbound permission",async()=>{
 const s=await setup(),source=await s.inquiry();
 const sourceBefore=(await s.f.pool.query("SELECT to_jsonb(a) AS row FROM ls_service_interest.public_applications a WHERE workspace_id=$1",[s.f.workspaceId])).rows;
 const accountCount=await s.count("ls_identity.accounts"),taskCount=await s.count("ls_calendar.tasks");
 const preview=await s.crm.previewInquiry(s.actor,source.item.id,1);
 const command:AcademyCrmCommand={action:"from_inquiry",operationId:randomUUID(),expectedEpoch:1,
  sourceApplicationId:preview.sourceApplicationId,sourceDigest:preview.sourceDigest,fields:admin};
 const results=await Promise.all(Array.from({length:6},()=>s.crm.execute(s.actor,command)));
 expect(results.filter(r=>!r.replayed)).toHaveLength(1);expect(new Set(results.map(r=>r.personId)).size).toBe(1);
 const detail=await s.crm.read(s.actor,results[0]!.personId,1);
 expect((await s.crm.previewInquiry(s.actor,source.item.id,1)).existingPersonId).toBe(results[0]!.personId);
 expect(detail.contact).toMatchObject({name:"Synthetic saved inquiry",outboundEligible:false,origin:{kind:"inquiry",phone:null,
  email:"synthetic-inquiry@example.invalid",sourceApplicationId:source.item.id}});
 expect(await s.count("ls_identity.accounts")).toBe(accountCount);expect(await s.count("ls_calendar.tasks")).toBe(taskCount);
 expect(await s.count("ls_contact_ops.outbound_projections")).toBe(0);
 const membership=(await s.f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.fishing_lead_revisions WHERE workspace_id=$1",[s.f.workspaceId])).rows[0];
 expect(JSON.parse(unseal(membership.payload_ciphertext,`ls_contact_ops/fishing-membership/v1/${s.f.workspaceId}/${program}/${results[0]!.personId}/1`,s.f.keyring)))
  .toMatchObject({outboundEligible:false,permission:{state:"unknown"}});
 expect((await s.f.pool.query("SELECT to_jsonb(a) AS row FROM ls_service_interest.public_applications a WHERE workspace_id=$1",[s.f.workspaceId])).rows).toEqual(sourceBefore);
 await expect(s.crm.execute(s.actor,{...command,operationId:randomUUID()})).rejects.toThrow("CONFLICT");
 await expect(s.crm.execute(s.actor,{...command,sourceDigest:"f".repeat(64)})).rejects.toThrow("CONFLICT");
});

test("old profiles and clinical people never enter Academy search, direct reads, identity matching or updates",async()=>{
 const s=await setup(),oldId=randomUUID();
 await s.f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,clock_timestamp())",
  [oldId,s.f.workspaceId,seal(JSON.stringify({displayName:"Retired Israeli Person"}),`person:${s.f.workspaceId}:${oldId}`,s.f.keyring)]);
 await new NativeCrmStore(s.db,s.f.keyring,key).create(s.actor,{personId:oldId,...admin,notes:"RETIRE_ONLY_SECRET",legacyIds:[],
  nativeInquiry:{origin:"native_manual",leadId:"LS-LEAD-native-"+oldId,phone:"+13055550123",language:"en",source:"Retired business",createdAt:new Date().toISOString()}},"synthetic-old-profile");
 const result=await s.crm.execute(s.actor,create({phone:"+13055550123",email:null}));
 expect(result.personId).not.toBe(oldId);expect(await s.crm.list(s.actor)).toMatchObject({total:1,items:[{personId:result.personId}]});
 expect(await s.crm.list(s.actor,{search:"Retired"})).toMatchObject({total:0,items:[]});
 expect(JSON.stringify(await s.crm.list(s.actor))).not.toContain("RETIRE_ONLY_SECRET");
 await expect(s.crm.read(s.actor,oldId,1)).rejects.toThrow("NOT_FOUND");
 await expect(s.crm.execute(s.actor,{action:"update",operationId:randomUUID(),expectedEpoch:1,personId:oldId,expectedVersion:1,fields:admin})).rejects.toThrow("NOT_FOUND");
 await expect(new OperationalNativeCrmStore(s.db,s.f.keyring,key).list(s.actor,{view:"all",search:"",today:"2026-10-28",page:1,pageSize:20},1)).rejects.toThrow("CONFLICT");
});

test("saved next action and conversation survive a new session; replay cannot overwrite later edits",async()=>{
 const s=await setup(),created=await s.crm.execute(s.actor,create());
 const update:AcademyCrmCommand={action:"update",operationId:randomUUID(),expectedEpoch:1,personId:created.personId,expectedVersion:1,
  fields:{...admin,nextAction:"Call after the family replies",notes:"New saved note"}};
 expect(await s.crm.execute(s.actor,update)).toMatchObject({version:2,replayed:false});
 const note:AcademyCrmCommand={action:"note",operationId:randomUUID(),expectedEpoch:1,personId:created.personId,expectedVersion:2,text:"Synthetic parent asked about Sunday."};
 await s.crm.execute(s.actor,note);await s.crm.execute(s.actor,{...update,operationId:randomUUID(),expectedVersion:2,fields:{...admin,nextAction:"Send dates for review"}});
 expect(await s.crm.execute(s.actor,update)).toMatchObject({version:2,replayed:true});
 const token=randomBytes(32).toString("base64url");
 await s.f.pool.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,clock_timestamp(),$4)",
  [tokenDigest(token),s.f.workspaceId,s.actor.id,new Date(Date.now()+3600000)]);
 const otherSession=await s.sessions.actor(token),reopened=await new AcademyCrmStore(s.db,s.f.keyring,key).read(otherSession,created.personId,1);
 expect(reopened.contact.fields.nextAction).toBe("Send dates for review");expect(reopened.contact.version).toBe(3);
 expect(reopened.history.some(row=>row.text===note.text)).toBe(true);
 await expect(s.crm.execute(s.actor,{...update,operationId:randomUUID()})).rejects.toThrow("CONFLICT");
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[s.actor.sessionDigest]);
 await expect(s.crm.read(s.actor,created.personId,1)).rejects.toThrow("UNAUTHENTICATED");
 expect((await s.crm.read(otherSession,created.personId,1)).contact.personId).toBe(created.personId);
});

test("retired inbound capture/read and unscoped task totals are blocked without discarding durable receipts",async()=>{
 const s=await setup(false),inquiry={provider:"whapi" as const,channelId:"synthetic-retired",businessNumber:"+13055550199",
  providerEventId:"synthetic-old-event",providerMessageId:"synthetic-old-message",providerThreadId:"synthetic-old-thread",eventType:"inbound_message" as const,
  fromMe:false as const,fromNumber:"+13055550123",pushName:"Retired person",messageType:"text",messageText:"RETIRE_ONLY_MESSAGE",occurredAt:new Date().toISOString(),media:[]};
 const inbox=new ContactInboundStore(s.db,s.f.workspaceId,s.f.keyring,key,inboundBindingDigest(inquiry));
 await inbox.capture(inquiry);expect(await s.count("ls_contact_ops.message_receipts")).toBe(1);
 await s.authority.initializeAcademy(s.actor,s.initialization);
 await expect(inbox.recent(s.actor)).rejects.toThrow("UNAVAILABLE");
 await expect(inbox.capture(inquiry)).rejects.toThrow("UNAVAILABLE");
 await expect(inbox.capture({...inquiry,providerEventId:"synthetic-new-event",providerMessageId:"synthetic-new-message"})).rejects.toThrow("UNAVAILABLE");
 expect(await s.count("ls_contact_ops.message_receipts")).toBe(1);expect(await s.count("ls_contact_ops.profiles")).toBe(0);
 await expect(readTaskCounts(s.db,s.actor,new Date())).rejects.toThrow("UNAVAILABLE");
});

test("ordinary HTTP retains owner, origin, CSRF, strict body and direct-object boundaries",async()=>{
 const s=await setup();
 expect((await s.http(create(),s.f.parent.token)).status).toBe(403);
 expect((await s.http(create(),s.f.practitioner.token,{"x-csrf-token":"wrong"})).status).toBe(403);
 expect((await s.http(create(),s.f.practitioner.token,{origin:"https://unrelated.example.invalid"})).status).toBe(403);
 expect((await s.http({...create(),workspaceId:randomUUID()})).status).toBe(400);
 expect((await s.http({action:"initialize_academy",...proof()})).status).toBe(400);
 const created=await s.http(create());expect(created.status).toBe(200);const result=(await created.json()).data;
 const readback=await s.http(undefined,s.f.practitioner.token,{},`?personId=${result.personId}&expectedEpoch=1`);
 expect(readback.status).toBe(200);expect((await readback.json()).data.contact.origin.email).toBe(fields.email);
 expect((await s.http(undefined,s.f.practitioner.token,{},`?personId=${s.actor.personId}&expectedEpoch=1`)).status).toBe(404);
 expect((await s.http(undefined,s.f.practitioner.token,{},"?search=one&search=two")).status).toBe(400);
});

test("counter save failure rolls back the person, profile, admission, membership and activity together",async()=>{
 const s=await setup(),people=await s.count("ls_identity.people");
 const failing:IdentityStore={transaction:work=>s.db.transaction(tx=>work({query:async<T extends object>(sql:string,values?:readonly unknown[])=>{
  if(sql.startsWith("INSERT INTO ls_contact_ops.cutover("))throw Error("SYNTHETIC_AUTHORITY_SAVE_FAILURE");return tx.query<T>(sql,values);
 }}))};
 await expect(new AcademyCrmStore(failing,s.f.keyring,key).execute(s.actor,create())).rejects.toThrow("SYNTHETIC_AUTHORITY_SAVE_FAILURE");
 expect(await s.count("ls_identity.people")).toBe(people);
 for(const table of ["profiles","academy_crm_contacts","academy_crm_activity","fishing_lead_revisions","fishing_label_projection"])
  expect(await s.count("ls_contact_ops."+table)).toBe(0);
 expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(0);
});

test("unresolved retired sends block initialization without consuming its operation or changing authority",async()=>{
 const s=await setup(false),operationId=randomUUID();
 await s.f.pool.query(`INSERT INTO ls_contact_ops.outbound_projections(workspace_id,operation_id,actor_account_id,legacy_lead_id,
  authority_epoch,request_digest,projection_ciphertext,state) VALUES($1,$2,$3,'LS-LEAD-synthetic-retired',0,$4,$5,'prepared')`,
  [s.f.workspaceId,operationId,s.actor.id,"a".repeat(64),"synthetic-private-projection"]);
 await expect(s.authority.initializeAcademy(s.actor,s.initialization)).rejects.toThrow("CONFLICT");
 expect((await s.authority.read(s.actor)).phase).toBe("sheet_active");
 expect(await s.count("ls_contact_ops.cutover_history")).toBe(0);
 await s.f.pool.query("UPDATE ls_contact_ops.outbound_projections SET state='not_delivered',resolution_ciphertext='synthetic-settled' WHERE workspace_id=$1 AND operation_id=$2",[s.f.workspaceId,operationId]);
 expect(await s.authority.initializeAcademy(s.actor,s.initialization)).toMatchObject({replayed:false,state:{phase:"academy_native"}});
});

test("inquiry previews and conversion reject other programs and other workspaces before admitting a contact",async()=>{
 const s=await setup(),other=await setup(),unrelated=await s.inquiry("other-program@example.invalid","private_fishing_life_skills"),foreign=await other.inquiry();
 for(const source of [unrelated,foreign]){
  await expect(s.crm.previewInquiry(s.actor,source.item.id,1)).rejects.toThrow("NOT_FOUND");
  await expect(s.crm.execute(s.actor,{action:"from_inquiry",operationId:randomUUID(),expectedEpoch:1,
   sourceApplicationId:source.item.id,sourceDigest:"f".repeat(64),fields:admin})).rejects.toThrow("NOT_FOUND");
 }
 expect(await s.count("ls_contact_ops.academy_crm_contacts")).toBe(0);
 const created=await s.crm.execute(s.actor,create());
 await expect(other.crm.read(other.actor,created.personId,1)).rejects.toThrow("NOT_FOUND");
 await expect(other.crm.execute(other.actor,{action:"note",operationId:randomUUID(),expectedEpoch:1,personId:created.personId,expectedVersion:1,text:"Unrelated workspace"})).rejects.toThrow("NOT_FOUND");
});
