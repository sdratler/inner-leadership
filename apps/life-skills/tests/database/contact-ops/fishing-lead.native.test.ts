import {afterAll,expect,test,vi} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {FishingLeadStore,type FishingLeadPreview} from "../../../src/features/contact-ops/server/fishing-lead-store.ts";
import {fishingLeadHttp} from "../../../src/features/contact-ops/server/fishing-lead-http.ts";
import {PublicGroupApplicationStore} from "../../../src/features/group-application/store.ts";
import {floridaGroupApplicationNotice} from "../../../src/features/group-application/contract.ts";
import {NativeCrmStore} from "../../../src/features/contact-ops/server/native-store.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {fishingLeadDisplayState} from "../../../src/features/contact-ops/core/fishing-lead.ts";
import {asId} from "../../../src/lib/ids.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-fishing-membership-integrity-20261014",phone="+13055550109",program="sunday_fishing_academy" as const;
type Ready=Extract<FishingLeadPreview,{state:"ready"}>;
const proof=(epoch:number):CutoverEvidence=>({batchId:"synthetic-fishing-membership",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",
 expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,
 identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,
 nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true}); // Fixture only, NEVER live proof.
async function setup(activate=true){
 const f=await fixture();fixtures.push(f);const db=poolStore(f.pool),actor=f.practitioner.actor;let now=new Date();const clock={now:()=>new Date(now)};
 const authority=new ContactCutoverStore(db,f.keyring,key,clock),crm=new OperationalNativeCrmStore(db,f.keyring,key,clock);
 if(activate){await authority.advance(actor,{action:"prepare",proof:proof(0),operationId:"prepare"});await authority.advance(actor,{action:"freeze",proof:proof(1),operationId:"freeze"});await authority.advance(actor,{action:"switch_native",proof:proof(2),operationId:"switch"});}
 const store=new FishingLeadStore(db,f.keyring,key,program,clock),inquiries=new PublicGroupApplicationStore(db,f.workspaceId,f.keyring,key,clock);
 const inquiry=async(contact=phone)=>{const saved=await inquiries.submit({operationId:randomUUID(),fields:{parentName:"Synthetic inquiry parent",contact,
  language:"en",cityArea:"Synthetic Florida",programId:program,schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}});
  return {kind:"inquiry" as const,id:saved.item.id};};
 const ready=async(source:{kind:"inquiry"|"person";id:string},expectedAssociationVersion=0,operationId=randomUUID())=>{
  const result=await store.preview(actor,{action:"preview_add",operationId,expectedEpoch:3,source,expectedAssociationVersion,relationship:"guardian"});
  expect(result.state).toBe("ready");return result as Ready;
 };
 const confirm=(p:Ready)=>store.confirm(actor,{action:"confirm",token:p.token,confirmNewPerson:p.newPerson});
 const count=async(table:string)=>(await f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[f.workspaceId])).rows[0].n as number;
 const snapshot=async(tables:readonly string[])=>Promise.all(tables.map(async table=>({table,rows:(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows})));
 const create=()=>crm.createContact(actor,{name:"Preserved synthetic name",phone,language:"he",source:"synthetic-existing",
  notes:"  Original synthetic note\nהערה מקורית  ",nextAction:"Preserve existing action",dueDate:"2026-10-30"},randomUUID(),3);
 const sessions=new IdentitySessions(db,{enabled:true,origin:"https://synthetic-fishing.example.invalid",workspaceId:f.workspaceId,keyring:f.keyring,
  csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:"synthetic-fishing-http-limit-key-20261014",sessionSeconds:8*3600},clock);
 const dependencies=async()=>({origin:"https://synthetic-fishing.example.invalid",actor:(token:string)=>sessions.actor(token),csrf:(token:string)=>sessions.csrf(token),
  limits:new PostgresIdentityRateStore(db),rateLimitKey:"synthetic-fishing-http-limit-key-20261014",store});
 const http=(input:unknown,token=f.practitioner.token,overrides:Record<string,string>={})=>fishingLeadHttp(new Request("https://synthetic-fishing.example.invalid/api/private/fishing-leads/"+program,
  {method:"POST",headers:{host:"synthetic-fishing.example.invalid","x-forwarded-proto":"https",origin:"https://synthetic-fishing.example.invalid","sec-fetch-site":"same-origin",
   cookie:SESSION_COOKIE+"="+token,"x-csrf-token":sessions.csrf(token),"content-type":"application/json",...overrides},body:JSON.stringify(input)}),program,dependencies);
 const get=(source:{kind:"person"|"inquiry";id:string})=>fishingLeadHttp(new Request("https://synthetic-fishing.example.invalid/api/private/fishing-leads/"+program+"?source="+source.kind+"&sourceId="+source.id,
  {headers:{host:"synthetic-fishing.example.invalid","x-forwarded-proto":"https",cookie:SESSION_COOKIE+"="+f.practitioner.token}}),program,dependencies);
 return {f,db,actor,clock,authority,crm,store,inquiries,inquiry,ready,confirm,count,snapshot,create,http,get,
  advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
const forbidden=["ls_identity.accounts","ls_identity.account_subjects","ls_cases.cases","ls_cases.case_guardians","ls_calendar.appointments",
 "ls_calendar.tasks","ls_calendar.task_history","ls_contact_ops.outbound_projections","ls_identity.auth_mail_outbox","ls_onboarding.first_session_orders"];

test("explicit Academy notes/status/manual date edit replays, keeps history and leaves the Israeli profile/other fishing association untouched",async()=>{
 const s=await setup(),person=await s.create(),source=await s.inquiry(),added=await s.confirm(await s.ready(source));expect(added.personId).toBe(person.personId);
 const other=new FishingLeadStore(s.db,s.f.keyring,key,"private_fishing_life_skills",s.clock),otherPreview=await other.preview(s.actor,{action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source:{kind:"person",id:person.personId},expectedAssociationVersion:0,relationship:"adult_partner"});
 expect(otherPreview.state).toBe("ready");if(otherPreview.state!=="ready")throw Error("PREVIEW_REQUIRED");await other.confirm(s.actor,{action:"confirm",token:otherPreview.token,confirmNewPerson:false});
 const preserved=await s.snapshot([...forbidden,"ls_contact_ops.profiles"]),otherBefore=await other.read(s.actor,person.personId,3),details={status:"callback_requested" as const,notes:"Synthetic Academy-only note",nextAction:"Owner calls family",followUpDate:"2026-11-03"};
 const input={action:"preview_edit" as const,operationId:randomUUID(),expectedEpoch:3,personId:person.personId,expectedAssociationVersion:1,details};
 const response=await s.http(input);expect(response.status).toBe(200);const preview=(await response.json()).data as Ready;expect(preview.details).toEqual(details);
 const confirm={action:"confirm",token:preview.token,confirmNewPerson:false},first=await s.http(confirm),retry=await s.http(confirm);expect(first.status).toBe(200);expect(retry.status).toBe(200);expect((await retry.json()).data).toMatchObject({version:2,replayed:true,tasksCreated:0,outboundEligible:false});
 const reopened=new FishingLeadStore(s.db,s.f.keyring,key,program,s.clock);expect((await reopened.read(s.actor,person.personId,3)).membership).toMatchObject({version:2,state:"active",details});
 expect(await other.read(s.actor,person.personId,3)).toEqual(otherBefore);expect(await s.snapshot([...forbidden,"ls_contact_ops.profiles"])).toEqual(preserved);
 const history=await s.f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.fishing_lead_revisions WHERE workspace_id=$1 AND program_key=$2 AND person_id=$3 ORDER BY version",[s.f.workspaceId,program,person.personId]);expect(history.rows).toHaveLength(2);expect(JSON.stringify(history.rows)).not.toContain(details.notes);
 expect((await s.http({...input,operationId:randomUUID(),details:{...details,notes:"Stale overwrite"}})).status).toBe(409);
 await expect(other.preview(s.actor,{...input,operationId:randomUUID()})).rejects.toMatchObject({code:"FORBIDDEN"});
 const removal=await reopened.preview(s.actor,{action:"preview_remove",operationId:randomUUID(),expectedEpoch:3,personId:person.personId,expectedAssociationVersion:2});expect(removal.state).toBe("ready");if(removal.state!=="ready")throw Error("PREVIEW_REQUIRED");await reopened.confirm(s.actor,{action:"confirm",token:removal.token,confirmNewPerson:false});
 expect((await reopened.read(s.actor,person.personId,3)).membership).toMatchObject({state:"removed",version:3,details});expect(await other.read(s.actor,person.personId,3)).toEqual(otherBefore);
 const restored=await s.confirm(await s.ready(source,3));expect(restored.version).toBe(4);expect((await reopened.read(s.actor,person.personId,3)).membership?.details).toEqual(details);
});
test("explicit unmatched inquiry creates one minimal adult/profile/membership atomically across six retries and ZERO tasks/defaults",async()=>{
 const s=await setup(),source=await s.inquiry(),before=await s.snapshot(forbidden),peopleBefore=await s.count("ls_identity.people"),p=await s.ready(source);
 expect(p.newPerson).toBe(true);expect(await s.count("ls_contact_ops.profiles")).toBe(0);expect(await s.count("ls_contact_ops.fishing_lead_revisions")).toBe(0);
 const results=await Promise.all(Array.from({length:6},()=>s.confirm(p)));expect(results.filter(r=>!r.replayed)).toHaveLength(1);
 expect(new Set(results.map(r=>r.personId)).size).toBe(1);expect(await s.count("ls_identity.people")).toBe(peopleBefore+1);
 expect(await s.count("ls_contact_ops.profiles")).toBe(1);expect(await s.count("ls_contact_ops.command_receipts")).toBe(2);
 expect(await s.count("ls_contact_ops.fishing_lead_revisions")).toBe(1);expect(await s.count("ls_contact_ops.fishing_lead_operations")).toBe(1);
 const profile=await new NativeCrmStore(s.db,s.f.keyring,key,s.clock).read(s.actor,results[0]!.personId);
 expect(profile!.profile).toMatchObject({nextAction:null,followUpDate:null,notes:""});expect(profile!.profile).not.toHaveProperty("callbackWindow");
 expect(await s.snapshot(forbidden)).toEqual(before);expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(1);
 const read=await new FishingLeadStore(s.db,s.f.keyring,key,program,s.clock).read(s.actor,results[0]!.personId,3);
 expect(read.membership).toMatchObject({state:"active",version:1,outboundEligible:false,permission:{state:"unknown"}});expect(read.projection?.status).toBe("unconfigured");
});
test("existing contact Add keeps exact name/stage/notes/follow-up/opt-out and populated task rows unchanged",async()=>{
 const s=await setup(),created=await s.create(),source=await s.inquiry();
 const existing=await s.crm.read(s.actor,created.personId,3);await s.crm.update(s.actor,{...existing!.profile,doNotContact:true},existing!.version,randomUUID(),3);
 await s.f.pool.query(`INSERT INTO ls_calendar.tasks(workspace_id,id,created_by,title_ciphertext,due_date)
  VALUES($1,$2,$3,'synthetic-preserved-encrypted-task','2026-10-30')`,[s.f.workspaceId,randomUUID(),s.actor.id]);
 const protectedRows=[...forbidden,"ls_identity.people","ls_contact_ops.profiles","ls_contact_ops.command_receipts"],before=await s.snapshot(protectedRows);
 const p=await s.ready(source);expect(p.personId).toBe(created.personId);expect(p.name).toBe("Preserved synthetic name");
 await s.confirm(p);expect(await s.snapshot(protectedRows)).toEqual(before);
 expect((await s.store.read(s.actor,created.personId,3)).membership?.outboundEligible).toBe(false);
});
test("Remove and exact old Add replay stay Removed after fresh store/HTTP read; fresh Restore then old Remove replay stays Active",async()=>{
 const s=await setup(),created=await s.create(),source={kind:"person" as const,id:created.personId},add=await s.ready(source),historical=await s.confirm(add);
 const remove=await s.store.preview(s.actor,{action:"preview_remove",operationId:randomUUID(),expectedEpoch:3,personId:created.personId,expectedAssociationVersion:1}) as Ready;
 const removed=await s.confirm(remove),beforeReplay=await s.snapshot(["ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_lead_operations","ls_contact_ops.fishing_label_projection","ls_contact_ops.cutover"]);
 s.advance(16*60_000);expect(await s.confirm(add)).toEqual({...historical,replayed:true});expect(await s.snapshot(["ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_lead_operations","ls_contact_ops.fishing_label_projection","ls_contact_ops.cutover"])).toEqual(beforeReplay);
 const read=await s.store.read(s.actor,created.personId,3);expect(read.membership).toMatchObject({state:"removed",version:2});expect(read.projection).toMatchObject({generation:2,desiredPresent:false});
 expect(fishingLeadDisplayState(historical,read.membership!)).toBe("removed");
 const get=await s.get(source);expect(get.status).toBe(200);expect((await get.json()).data.membership.state).toBe("removed");
 const restore=await s.ready(source,2);await s.confirm(restore);expect(await s.confirm(remove)).toEqual({...removed,replayed:true});
 expect((await s.store.read(s.actor,created.personId,3)).membership).toMatchObject({state:"active",version:3});
});
test("two distinct previews for the same unmatched endpoint cannot create duplicate People or partial membership",async()=>{
 const s=await setup(),source=await s.inquiry(),previews=await Promise.all([s.ready(source),s.ready(source)]);
 const results=await Promise.allSettled(previews.map(s.confirm));expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(await s.count("ls_contact_ops.profiles")).toBe(1);expect(await s.count("ls_contact_ops.fishing_lead_revisions")).toBe(1);
 expect(await s.count("ls_contact_ops.fishing_lead_operations")).toBe(1);expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(1);
});
test("failure after canonical creation rolls back identity/profile/membership/receipts/counter, then exact retry succeeds",async()=>{
 const s=await setup(),source=await s.inquiry(),p=await s.ready(source),tables=[...forbidden,"ls_identity.people","ls_contact_ops.profiles","ls_contact_ops.command_receipts",
  "ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_lead_operations","ls_contact_ops.fishing_label_projection","ls_contact_ops.cutover"],before=await s.snapshot(tables);
 let fail=true;const db:IdentityStore={transaction:work=>s.db.transaction(tx=>work({async query<R extends object>(sql:string,values:readonly unknown[]=[]){
  if(fail&&sql.includes("INSERT INTO ls_contact_ops.fishing_lead_revisions")){fail=false;throw Error("SYNTHETIC_AFTER_CANONICAL_CREATION");}return tx.query<R>(sql,values);
 }}))};
 const store=new FishingLeadStore(db,s.f.keyring,key,program,s.clock);
 await expect(store.confirm(s.actor,{action:"confirm",token:p.token,confirmNewPerson:true})).rejects.toThrow("SYNTHETIC_AFTER_CANONICAL_CREATION");
 expect(await s.snapshot(tables)).toEqual(before);await s.confirm(p);expect(await s.count("ls_contact_ops.fishing_lead_operations")).toBe(1);
});
test("in-process retained HTTP plus real native sessions preserve exact unknown-outcome request and owner reload",async()=>{
 const s=await setup(),source=await s.inquiry(),p=await s.ready(source),body={action:"confirm",token:p.token,confirmNewPerson:true};
 // The first response is deliberately discarded AFTER the real handler commits.
 const discarded=await s.http(body);expect(discarded.status).toBe(200);
 const retry=await s.http(body);expect(retry.status).toBe(200);const result=(await retry.json()).data;expect(result.replayed).toBe(true);
 const read=await s.get(source);expect(read.status).toBe(200);expect((await read.json()).data.membership).toMatchObject({personId:result.personId,state:"active",version:1});
 expect(await s.count("ls_contact_ops.fishing_lead_operations")).toBe(1);expect(await s.count("ls_calendar.tasks")).toBe(0);
});
test("fresh parent, revoked practitioner, wrong actor/program/workspace and changed operation payload deny with no native effects",async()=>{
 const s=await setup(),source=await s.inquiry(),p=await s.ready(source),tables=["ls_contact_ops.profiles","ls_contact_ops.fishing_lead_operations","ls_contact_ops.fishing_lead_revisions","ls_contact_ops.cutover"];
 const before=await s.snapshot(tables);await expect(s.store.confirm(s.f.parent.actor,{action:"confirm",token:p.token,confirmNewPerson:true})).rejects.toThrow("INVALID_REQUEST");
 await expect(s.store.preview(s.f.parent.actor,{action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source,expectedAssociationVersion:0,relationship:"guardian"})).rejects.toThrow("FORBIDDEN");
 const other=new FishingLeadStore(s.db,s.f.keyring,key,"private_fishing_life_skills",s.clock);
 await expect(other.confirm(s.actor,{action:"confirm",token:p.token,confirmNewPerson:true})).rejects.toThrow("INVALID_REQUEST");
 await expect(s.store.confirm({...s.actor,workspaceId:asId(randomUUID(),"workspace")},{action:"confirm",token:p.token,confirmNewPerson:true})).rejects.toThrow("INVALID_REQUEST");
 expect(await s.snapshot(tables)).toEqual(before);
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.actor.id]);
 await expect(s.confirm(p)).rejects.toThrow("UNAUTHENTICATED");expect(await s.snapshot(tables)).toEqual(before);
});
test("origin/CSRF/parent/malformed body denials use actual session read and cannot mutate membership",async()=>{
 const s=await setup(),source=await s.inquiry(),p=await s.ready(source),body={action:"confirm",token:p.token,confirmNewPerson:true};
 expect((await s.http(body,s.f.parent.token)).status).toBe(403);
 expect((await s.http(body,s.f.practitioner.token,{origin:"https://wrong.example.invalid"})).status).toBe(403);
 expect((await s.http(body,s.f.practitioner.token,{"x-csrf-token":"invalid"})).status).toBe(403);
 expect((await s.http({...body,program:"private_fishing_life_skills"})).status).toBe(400);
 expect(await s.count("ls_contact_ops.fishing_lead_operations")).toBe(0);expect(await s.count("ls_contact_ops.profiles")).toBe(0);
});
test("email-only, wrong-program/Israel inquiry and stale preview/version never invent identity or permission",async()=>{
 const s=await setup(),email=await s.inquiry("synthetic-inquiry@example.invalid");
 expect(await s.store.preview(s.actor,{action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source:email,expectedAssociationVersion:0,relationship:"guardian"})).toMatchObject({state:"clarify",reason:"email_only"});
 expect(await s.store.context(s.actor,email)).toMatchObject({state:"blocked",reason:"email_only"});
 const source=await s.inquiry(),p=await s.ready(source);s.advance(16*60_000);await expect(s.confirm(p)).rejects.toThrow("CONFLICT");
 expect(await s.count("ls_contact_ops.profiles")).toBe(0);expect(await s.count("ls_calendar.tasks")).toBe(0);
 const wrong=new FishingLeadStore(s.db,s.f.keyring,key,"private_fishing_life_skills",s.clock);
 await expect(wrong.preview(s.actor,{action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source,expectedAssociationVersion:0,relationship:"adult_partner"})).rejects.toThrow("FORBIDDEN");
});
test("Sheet/frozen/stale authority blocks only native actions without fallback",async()=>{
 const s=await setup(false),source=await s.inquiry();expect(await s.store.context(s.actor,source)).toMatchObject({state:"blocked",reason:"native_authority_required",epoch:0});
 await expect(s.ready(source)).rejects.toThrow("CONFLICT");expect(await s.count("ls_contact_ops.profiles")).toBe(0);
});
test("another program association and later profile edits survive scoped Remove and historical Add replay",async()=>{
 const s=await setup(),created=await s.create(),source={kind:"person" as const,id:created.personId},a=await s.ready(source);await s.confirm(a);
 const vip=new FishingLeadStore(s.db,s.f.keyring,key,"private_fishing_life_skills",s.clock),b=await vip.preview(s.actor,
  {action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source,expectedAssociationVersion:0,relationship:"adult_partner"}) as Ready;
 await vip.confirm(s.actor,{action:"confirm",token:b.token,confirmNewPerson:false});
 const remove=await s.store.preview(s.actor,{action:"preview_remove",operationId:randomUUID(),expectedEpoch:3,personId:created.personId,expectedAssociationVersion:1}) as Ready;await s.confirm(remove);
 const profile=await s.crm.read(s.actor,created.personId,3);await s.crm.update(s.actor,{...profile!.profile,notes:profile!.profile.notes+"\nLater note"},profile!.version,randomUUID(),3);
 const before=await s.snapshot(["ls_contact_ops.profiles","ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_label_projection","ls_contact_ops.cutover"]);
 await s.confirm(a);expect(await s.snapshot(["ls_contact_ops.profiles","ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_label_projection","ls_contact_ops.cutover"])).toEqual(before);
 expect((await s.store.read(s.actor,created.personId,3)).membership?.state).toBe("removed");expect((await vip.read(s.actor,created.personId,3)).membership?.state).toBe("active");
});
test("successful token replay after a real authority transition denies and preserves current membership/receipt/projection/counter",async()=>{
 const s=await setup(),source=await s.inquiry(),p=await s.ready(source);await s.confirm(p);
 const state=await s.authority.read(s.actor);
 await s.authority.advance(s.actor,{action:"prepare_rollback",operationId:randomUUID(),
  proof:{...proof(3),observedNativeWritesSinceSwitch:state.nativeWritesSinceSwitch}});
 const tables=["ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_lead_operations","ls_contact_ops.fishing_label_projection","ls_contact_ops.cutover"],before=await s.snapshot(tables);
 await expect(s.confirm(p)).rejects.toThrow("CONFLICT");expect(await s.snapshot(tables)).toEqual(before);
});
test("different valid preview using a committed operation ID conflicts while the original exact replay stays immutable",async()=>{
 const s=await setup(),source=await s.inquiry(),p=await s.ready(source),result=await s.confirm(p);
 const different=await s.store.preview(s.actor,{action:"preview_remove",operationId:p.operationId,expectedEpoch:3,personId:result.personId,expectedAssociationVersion:1});
 expect(different.state).toBe("ready");const tables=["ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_lead_operations","ls_contact_ops.fishing_label_projection","ls_contact_ops.cutover"],before=await s.snapshot(tables);
 await expect(s.confirm(different as Ready)).rejects.toThrow("CONFLICT");expect(await s.snapshot(tables)).toEqual(before);
 expect(await s.confirm(p)).toEqual({...result,replayed:true});expect(await s.snapshot(tables)).toEqual(before);
});
