/** Guarded, disposable browser fixture. Synthetic initialization evidence is
 * never a production permit. No provider transport or imported data is used. */
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {poolStore,safeTestUrl,type Fixture} from "../../database/calendar/fixture.ts";
import {blindEmail,hashPassword,seal,unseal} from "../../../src/features/identity/crypto.ts";
import {ContactCutoverStore} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {NativeCrmStore,crmProfileAad,crmProfileSchema} from "../../../src/features/contact-ops/server/native-store.ts";
import {cutoverStateAad,cutoverStateSchema} from "../../../src/features/contact-ops/server/cutover-state.ts";
import {PublicGroupApplicationStore} from "../../../src/features/group-application/store.ts";
import {floridaGroupApplicationNotice} from "../../../src/features/group-application/contract.ts";
import {academyActivitySchema} from "../../../src/features/contact-ops/core/academy-crm.ts";
import {opaqueRateLimitKey} from "../../../src/lib/security/rate-limit.ts";

export type AcademyCrmBrowserRuntime={
 credentials:{role:"practitioner"|"parent";accountId:string;email:string;password:string}[];
 inquiries:{locale:"en"|"he";id:string;name:string;email:string}[];
 retired:{personId:string;name:string;marker:string};initializationId:string;
};
type Row=Record<string,unknown>;
type TableSnapshot={table:string;rows:{row:Row}[]};
export type AcademyCrmSnapshot={tables:TableSnapshot[];otherWorkspaces:TableSnapshot[];globalTables:TableSnapshot[]};
const mutableTables=new Set(["ls_identity.people","ls_identity.sessions","ls_identity.action_history","ls_identity.foundation_audit",
 "ls_contact_ops.cutover","ls_contact_ops.profiles","ls_contact_ops.command_receipts","ls_contact_ops.academy_crm_contacts",
 "ls_contact_ops.academy_crm_activity","ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_label_projection"]);
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function must(value:unknown,code:string):asserts value{if(!value)throw Error("ACADEMY_CRM_UI_"+code);}

export async function academyCrmBrowserFixture(f:Fixture,lookupKey:Buffer):Promise<AcademyCrmBrowserRuntime>{
 safeTestUrl();
 must(process.env.LS_ACADEMY_CRM_UI_ONLY==="true"&&process.env.LS_GROUP_INTEREST_TEST_ALLOW==="true","EXPLICIT_FIXTURE_REQUIRED");
 const credentials:AcademyCrmBrowserRuntime["credentials"]=[];
 for(const [role,account]of[["practitioner",f.practitioner],["parent",f.parent]]as const){
  const email="synthetic-academy-crm-"+role+"@example.invalid",password=randomBytes(18).toString("base64url");
  await f.pool.query("UPDATE ls_identity.accounts SET password_hash=$3,email_blind=$4,email_ciphertext=$5 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,account.actor.id,await hashPassword(password),blindEmail(email,lookupKey),seal(email,"email:"+f.workspaceId+":"+account.actor.id,f.keyring)]);
  credentials.push({role,accountId:account.actor.id,email,password});
 }
 const db=poolStore(f.pool),key=lookupKey.toString("hex"),initializationId=randomUUID();
 await new ContactCutoverStore(db,f.keyring,key).initializeAcademy(f.practitioner.actor,{
  operationId:initializationId,expectedEpoch:0,observedNativeWritesSinceSwitch:0,decisionId:"ACADEMY-ONLY-CRM-20261028-01",
  evidence:{retiredSourcesFence:"a".repeat(64),retiredSchedulesFence:"b".repeat(64),retainedAcademyRecords:"c".repeat(64),
   queueReconciliation:"d".repeat(64),restorePlan:"e".repeat(64)}});
 const source=new PublicGroupApplicationStore(db,f.workspaceId,f.keyring,key),inquiries:AcademyCrmBrowserRuntime["inquiries"]=[];
 for(const locale of["en","he"]as const){
  const name=locale==="he"?"הורה סינתטי לאקדמיה":"Synthetic Academy inquiry EN",email="synthetic-crm-inquiry-"+locale+"@example.invalid";
  const saved=await source.submit({operationId:randomUUID(),fields:{parentName:name,contact:email,language:locale,
   cityArea:"Synthetic Florida",programId:"sunday_fishing_academy",schedulePreference:["sunday"],
   permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:locale}}});
  inquiries.push({locale,id:saved.item.id,name,email});
 }
 // Deliberate post-initialization contamination fixture: this old profile must
 // remain inaccessible even if an earlier process left unrelated native rows.
 const retired={personId:randomUUID(),name:"Retired synthetic Israeli person",marker:"RETIRED_SYNTHETIC_PRIVATE_NOTE"};
 await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,clock_timestamp())",
  [retired.personId,f.workspaceId,seal(JSON.stringify({displayName:retired.name}),"person:"+f.workspaceId+":"+retired.personId,f.keyring)]);
 await new NativeCrmStore(db,f.keyring,key).create(f.practitioner.actor,{personId:retired.personId,stage:"Retired",
  nextAction:null,followUpDate:null,notes:retired.marker,legacyIds:[],nativeInquiry:{origin:"native_manual",
   leadId:"LS-LEAD-native-"+retired.personId,phone:"+13055550179",language:"en",source:"Retired synthetic business",createdAt:new Date().toISOString()}},
  "synthetic-retired-crm-browser-profile");
 return {credentials,inquiries,retired,initializationId};
}

/** Snapshot every workspace-owned table, including all provider/outbox tables.
 * Only the explicit CRM and ordinary authentication write set is allowed. */
export async function academyCrmBrowserSnapshot(f:Fixture):Promise<AcademyCrmSnapshot>{
 const inventory=await f.pool.query<{schema:string;table:string}>("SELECT c.table_schema AS schema,c.table_name AS table FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.column_name='workspace_id' AND c.table_schema LIKE 'ls_%' AND t.table_type='BASE TABLE' ORDER BY c.table_schema,c.table_name");
 const globals=await f.pool.query<{schema:string;table:string}>("SELECT t.table_schema AS schema,t.table_name AS table FROM information_schema.tables t WHERE t.table_schema LIKE 'ls_%' AND t.table_type='BASE TABLE' AND NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema=t.table_schema AND c.table_name=t.table_name AND c.column_name='workspace_id') ORDER BY t.table_schema,t.table_name");
 const read=async(other:boolean)=>Promise.all(inventory.rows.map(async row=>({
  table:row.schema+"."+row.table,
  rows:(await f.pool.query("SELECT to_jsonb(t) AS row FROM "+quote(row.schema)+"."+quote(row.table)+" t WHERE workspace_id"+(other?"<>":"=")+"$1 ORDER BY to_jsonb(t)::text",[f.workspaceId])).rows as {row:Row}[],
 })));
 const globalTables=await Promise.all(globals.rows.map(async row=>({table:row.schema+"."+row.table,
  rows:(await f.pool.query("SELECT to_jsonb(t) AS row FROM "+quote(row.schema)+"."+quote(row.table)+" t ORDER BY to_jsonb(t)::text")).rows as {row:Row}[],
 })));
 return {tables:await read(false),otherWorkspaces:await read(true),globalTables};
}

export async function verifyAcademyCrmBrowserEffects(f:Fixture,lookupKey:Buffer,runtime:AcademyCrmBrowserRuntime,before:AcademyCrmSnapshot,rateKey:Buffer){
 const after=await academyCrmBrowserSnapshot(f);
 must(hash(before.otherWorkspaces)===hash(after.otherWorkspaces),"OTHER_WORKSPACE_CHANGED");
 for(const table of before.globalTables){
  const latest=after.globalTables.find(value=>value.table===table.table);must(latest,"GLOBAL_TABLE_DISAPPEARED");
  if(table.table!=="ls_identity.rate_counters")must(hash(table.rows)===hash(latest.rows),"GLOBAL_TABLE_CHANGED:"+table.table);
 }
 const oldRates=before.globalTables.find(value=>value.table==="ls_identity.rate_counters")?.rows??[];
 const currentRates=after.globalTables.find(value=>value.table==="ls_identity.rate_counters")?.rows??[];
 for(const prior of oldRates)must(currentRates.some(row=>hash(row)===hash(prior)),"PREEXISTING_RATE_COUNTER_CHANGED");
 const newRates=currentRates.filter(row=>!oldRates.some(prior=>hash(prior)===hash(row)));
 const rateScopes=[
  {subject:"network:unattributed-shared-network",window:900000,maximum:200},
  {subject:"login-network:unattributed-shared-network",window:900000,maximum:6},
  ...runtime.credentials.flatMap(account=>[
   {subject:"login-email:"+account.email,window:900000,maximum:account.role==="practitioner"?5:1},
   {subject:"account:"+account.accountId,window:900000,maximum:150}]),
  {subject:"academy-crm:"+f.workspaceId+":"+f.practitioner.actor.id,window:60000,maximum:10},
 ];
 const allowedRates=new Map(rateScopes.map(scope=>[opaqueRateLimitKey(scope.subject,rateKey.toString("hex")),scope]));
 must(newRates.length===allowedRates.size&&newRates.every(({row})=>{
  const scope=allowedRates.get(String(row.key_digest));return scope&&row.window_ms===scope.window&&
   Number.isInteger(row.count)&&Number(row.count)>=1&&Number(row.count)<=scope.maximum;
 }),"RATE_COUNTER_WRITE_SET");
 for(const table of before.tables){
  const latest=after.tables.find(value=>value.table===table.table);must(latest,"TABLE_DISAPPEARED");
  if(!mutableTables.has(table.table))must(hash(table.rows)===hash(latest.rows),"UNRELATED_OR_PROVIDER_TABLE_CHANGED:"+table.table);
 }
 const rows=(snapshot:AcademyCrmSnapshot,table:string)=>snapshot.tables.find(value=>value.table===table)?.rows.map(value=>value.row)??[];
 const additions=(table:string)=>{
  const old=rows(before,table),current=rows(after,table);
  for(const prior of old)must(current.some(row=>hash(row)===hash(prior)),"EXISTING_ROW_CHANGED:"+table);
  return current.filter(row=>!old.some(prior=>hash(prior)===hash(row)));
 };
 const admissions=additions("ls_contact_ops.academy_crm_contacts"),activities=additions("ls_contact_ops.academy_crm_activity");
 must(admissions.length===4&&activities.length===8,"CONTACT_ACTIVITY_COUNTS");
 const personIds=new Set(admissions.map(row=>String(row.person_id)));
 must(personIds.size===4&&!personIds.has(runtime.retired.personId)&&admissions.every(row=>row.initialization_id===runtime.initializationId&&row.program_key==="sunday_fishing_academy"&&row.created_by===f.practitioner.actor.id),"ADMISSION_SCOPE");
 for(const inquiry of runtime.inquiries)must(admissions.filter(row=>row.source_application_id===inquiry.id&&row.source_kind==="inquiry").length===1,"INQUIRY_CONVERTED_ONCE");
 must(admissions.filter(row=>row.source_kind==="manual"&&row.source_application_id===null).length===2,"MANUAL_CONTACT_COUNT");
 const people=additions("ls_identity.people");must(people.length===4&&people.every(row=>personIds.has(String(row.id))&&row.kind==="adult"),"PERSON_WRITE_SET");
 const oldProfiles=rows(before,"ls_contact_ops.profiles"),profiles=rows(after,"ls_contact_ops.profiles");
 for(const prior of oldProfiles)must(profiles.some(row=>hash(row)===hash(prior)),"RETIRED_PROFILE_CHANGED");
 const addedProfiles=profiles.filter(row=>!oldProfiles.some(prior=>prior.person_id===row.person_id));
 must(addedProfiles.length===4,"PROFILE_COUNT");
 for(const row of addedProfiles){
  const profile=crmProfileSchema.parse(JSON.parse(unseal(String(row.payload_ciphertext),crmProfileAad(f.workspaceId,String(row.person_id)),f.keyring)));
  must(personIds.has(String(row.person_id))&&profile.academyOrigin?.initializationId===runtime.initializationId&&profile.legacyIds.length===0&&
   profile.nativeInquiry===undefined&&profile.whatsappInquiry===undefined&&row.record_mode==="live","PROFILE_SCOPE");
 }
 const receipts=additions("ls_contact_ops.command_receipts");must(receipts.length===6&&receipts.every(row=>personIds.has(String(row.person_id))&&row.actor_account_id===f.practitioner.actor.id),"PROFILE_RECEIPTS");
 const memberships=additions("ls_contact_ops.fishing_lead_revisions"),projections=additions("ls_contact_ops.fishing_label_projection");
 must(memberships.length===4&&projections.length===4,"MEMBERSHIP_COUNTS");
 for(const row of memberships){
  const membership=JSON.parse(unseal(String(row.payload_ciphertext),"ls_contact_ops/fishing-membership/v1/"+f.workspaceId+"/sunday_fishing_academy/"+row.person_id+"/1",f.keyring));
  must(personIds.has(String(row.person_id))&&row.version===1&&row.program_key==="sunday_fishing_academy"&&membership.outboundEligible===false&&membership.permission?.state==="unknown","MEMBERSHIP_PERMISSION");
 }
 must(projections.every(row=>personIds.has(String(row.person_id))&&row.status==="unconfigured"&&row.unresolved_effect===false),"PROVIDER_PROJECTION_ACTIVATED");
 const events=activities.map(row=>{
  must(personIds.has(String(row.person_id))&&row.actor_account_id===f.practitioner.actor.id&&row.initialization_id===runtime.initializationId,"ACTIVITY_SCOPE");
  return academyActivitySchema.parse(JSON.parse(unseal(String(row.payload_ciphertext),"ls_contact_ops/academy-activity/v1/"+f.workspaceId+"/"+row.operation_id,f.keyring)));
 });
 must(events.filter(event=>event.kind==="created").length===4&&events.filter(event=>event.kind==="updated").length===2&&events.filter(event=>event.kind==="note").length===2,"ACTIVITY_KINDS");
 must(events.every(event=>event.result.outboundEligible===false&&!event.result.replayed&&!event.text.includes("UNSAVED_CONTACT_NOTE_")),"ACTIVITY_REPLAY_OR_DRAFT_LEAK");
 const authorityRows=rows(after,"ls_contact_ops.cutover");must(authorityRows.length===1,"AUTHORITY_COUNT");
 const authority=cutoverStateSchema.parse(JSON.parse(unseal(String(authorityRows[0]!.state_ciphertext),cutoverStateAad(f.workspaceId,1),f.keyring)));
 must(authority.phase==="academy_native"&&authority.epoch===1&&authority.academy?.operationId===runtime.initializationId&&authority.nativeWritesSinceSwitch===10,"AUTHORITY_WRITE_COUNT");
 const allowedAccounts=new Set(runtime.credentials.map(value=>value.accountId));
 const beforeSessions=rows(before,"ls_identity.sessions"),sessions=rows(after,"ls_identity.sessions");
 for(const prior of beforeSessions)must(sessions.some(row=>hash(row)===hash(prior)),"PREEXISTING_SESSION_CHANGED");
 const freshSessions=sessions.filter(row=>!beforeSessions.some(prior=>prior.token_digest===row.token_digest));
 must(freshSessions.length===6&&freshSessions.every(row=>allowedAccounts.has(String(row.account_id)))&&freshSessions.filter(row=>row.revoked_at!==null).length===1,"ORDINARY_SESSION_COUNT");
 const actions=additions("ls_identity.action_history");
 must(actions.length===7&&actions.every(row=>allowedAccounts.has(String(row.actor_account_id)))&&
  actions.filter(row=>row.action==="login_succeeded").length===6&&actions.filter(row=>row.action==="session_revoked").length===1,"AUTHENTICATION_ACTIONS");
 const audits=additions("ls_identity.foundation_audit");
 must(audits.every(row=>allowedAccounts.has(String(row.actor_account_id))&&row.kind==="access_denied"&&row.outcome==="denied"),"AUTHENTICATION_AUDIT_SCOPE");
 // Native readback uses the still-valid, fixture-owned original actor. Browser
 // sessions were established normally; no injected token was used in the UI.
 const state=await new ContactCutoverStore(poolStore(f.pool),f.keyring,lookupKey.toString("hex")).read(f.practitioner.actor);
 must(state.phase==="academy_native"&&state.academy?.importedRows===0,"ZERO_IMPORT_READBACK");
}
