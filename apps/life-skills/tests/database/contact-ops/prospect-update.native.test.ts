import {afterAll,beforeAll,expect,test,vi} from "vitest";
import {randomUUID,createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,safeTestUrl,type Fixture} from "../calendar/fixture.ts";
import {drizzleIdentityStore} from "../../../src/features/identity/drizzle-store.ts";
import {closeDatabase} from "../../../src/db/client.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {seal} from "../../../src/features/identity/crypto.ts";
import {NativeCrmStore,crmProfileSchema,type CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {authoritativeProspectUpdate} from "../../../src/features/contact-ops/server/authoritative-prospect-update.ts";

const fixtures:Fixture[]=[],key="synthetic-prospect-update-integrity-key-20260928",source="synthetic-existing-workbook",sheet=5;
const originals={url:process.env.LS_DATABASE_URL,tls:process.env.LS_DATABASE_TLS};
beforeAll(async()=>{await closeDatabase();process.env.LS_DATABASE_URL=safeTestUrl();process.env.LS_DATABASE_TLS="disable";});
afterAll(async()=>{await closeDatabase();for(const f of fixtures)await f.pool.end();
 if(originals.url===undefined)delete process.env.LS_DATABASE_URL;else process.env.LS_DATABASE_URL=originals.url;
 if(originals.tls===undefined)delete process.env.LS_DATABASE_TLS;else process.env.LS_DATABASE_TLS=originals.tls;
});
// ONLY isolated fixture inputs; these are not production writer/cutover evidence.
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-prospect-update",sourceFileId:source,sourceRevision:"synthetic-revision",
 expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,
 identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,
 nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
async function setup(demo=false,sourceOutcome?:string){
 const f=await fixture({demoFirst:demo});fixtures.push(f);const a=f.practitioner.actor,personId=demo?f.parent.actor.personId:randomUUID();
 const leads=["LS-LEAD-update-"+randomUUID(),"LS-LEAD-update-"+randomUUID()];
 if(demo)await f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,'ls-owner-20260925','person',$2,$3,$4)",
  [f.workspaceId,personId,"synthetic-profile-"+randomUUID(),f.parent.actor.id]);
 else await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,clock_timestamp())",
  [personId,f.workspaceId,seal(JSON.stringify({displayName:"Synthetic editable prospect"}),`person:${f.workspaceId}:${personId}`,f.keyring)]);
 const profile:CrmProfile={personId,legacyIds:leads,stage:"New inquiry",nextAction:"Synthetic original action",followUpDate:"2026-09-28",notes:"Synthetic original notes — עברית English"};
 await new NativeCrmStore(drizzleIdentityStore,f.keyring,key).create(a,profile,"synthetic-update-profile-create");
 for(const [i,lead]of leads.entries()){
  const fields={"Lead ID":lead,"Outcome":sourceOutcome??"Synthetic original outcome "+i,"Response owner":"Synthetic original owner "+i,
   "Payment status":"PAID — historical claim only","Booking status":"Confirmed — historical claim only","Phone":"+972520000001"};
  const snapshot={sourceRow:i+2,payload:{displayName:"Synthetic imported source",language:"he",stageText:"New inquiry",sourceFields:fields}};
  await f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext)
   VALUES($1,$2,$3,'Synthetic Leads',$4,$5,'synthetic-revision',$6,$7)`,[f.workspaceId,source,sheet,lead,personId,createHash("sha256").update(lead).digest("hex"),
   seal(JSON.stringify(snapshot),`ls_contact_ops/legacy/v1/${f.workspaceId}/${source}/${sheet}/${lead}`,f.keyring)]);
 }
 const authority=new ContactCutoverStore(drizzleIdentityStore,f.keyring,key),native=new OperationalNativeCrmStore(drizzleIdentityStore,f.keyring,key);
 const sheetWriter=vi.fn().mockRejectedValue(Error("SHEET_WRITER_MUST_NOT_RUN"));
 const d={authority,native,sheet:{update:sheetWriter}};
 return {f,a,personId,leads,profile,authority,native,d,sheetWriter};
}
async function activate(s:Awaited<ReturnType<typeof setup>>){for(const [i,action]of (["prepare","freeze","switch_native"] as const).entries())
 await s.authority.advance(s.a,{action,proof:proof(i),operationId:"synthetic-update-"+action});}
const command=(s:Awaited<ReturnType<typeof setup>>,fields:{notes?:string;owner?:string;outcome?:string;nextAction?:string;dueDate?:string},version=1)=>
 ({action:"update" as const,leadId:s.leads[0]!,fields,expectedEpoch:3,expectedVersion:version,operationId:randomUUID()});
async function snapshots(s:Awaited<ReturnType<typeof setup>>){return (await s.f.pool.query("SELECT legacy_lead_id,row_digest,source_revision,snapshot_ciphertext FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 ORDER BY legacy_lead_id",[s.f.workspaceId])).rows;}

test("production adapter updates one exact mapping; notes, encrypted history and payment/booking facts survive",async()=>{
 const s=await setup();await activate(s);const before=await snapshots(s),request=command(s,{nextAction:"Synthetic revised action",owner:"Synthetic new owner",outcome:"Contacted"});
 let transactions=0;const db:IdentityStore={transaction:work=>{transactions++;return drizzleIdentityStore.transaction(work);}};
 const native=new OperationalNativeCrmStore(db,s.f.keyring,key);
 expect(await authoritativeProspectUpdate(s.a,request,{...s.d,native})).toMatchObject({updated:true,source:"native",personId:s.personId,version:2,replayed:false});
 expect(transactions).toBe(1);expect(await snapshots(s)).toEqual(before);
 const saved=await s.native.read(s.a,s.personId,3);expect(saved).toMatchObject({version:2,profile:{notes:s.profile.notes,legacyIds:s.leads,nextAction:request.fields.nextAction,
  leadUpdates:{[s.leads[0]!]:{owner:"Synthetic new owner",outcome:"Contacted"}}}});
 const rows=await s.native.prospects(s.a,3),selected=rows.find(r=>r.leadId===s.leads[0])!,second=rows.find(r=>r.leadId===s.leads[1])!;
 expect(selected).toMatchObject({owner:"Synthetic new owner",outcome:"Contacted",notes:s.profile.notes,paymentVerified:false,bookingConfirmed:false,
  nativeEdit:{personId:s.personId,profileVersion:2,authorityEpoch:3}});
 expect(second).toMatchObject({owner:"Synthetic original owner 1",outcome:"Synthetic original outcome 1",notes:s.profile.notes});
 const stored=(await s.f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,s.personId])).rows[0];
 expect(stored.payload_ciphertext).not.toContain(s.profile.notes);expect(stored.payload_ciphertext).not.toContain("Synthetic new owner");expect(s.sheetWriter).not.toHaveBeenCalled();
 expect((await s.authority.read(s.a)).nativeWritesSinceSwitch).toBe(1);
});

test("replay after an intervening note save returns the original receipt without overwriting the newer note",async()=>{
 const s=await setup();await activate(s);const original=command(s,{nextAction:"Synthetic first edit",owner:"Synthetic first owner"});
 expect(await authoritativeProspectUpdate(s.a,original,s.d)).toMatchObject({version:2,replayed:false});
 await s.native.updateFields(s.a,s.personId,{stage:"Contacted",nextAction:"Synthetic later action",followUpDate:"2026-09-29",notes:"Synthetic later note must survive"},2,"synthetic-later-profile-save",3);
 expect(await authoritativeProspectUpdate(s.a,original,s.d)).toMatchObject({version:2,replayed:true});
 expect(await s.native.read(s.a,s.personId,3)).toMatchObject({version:3,profile:{notes:"Synthetic later note must survive",nextAction:"Synthetic later action",
  leadUpdates:{[s.leads[0]!]:{owner:"Synthetic first owner"}}}});
 await expect(authoritativeProspectUpdate(s.a,{...original,fields:{nextAction:"Synthetic altered retry"}},s.d)).rejects.toThrow("CONFLICT");
 expect((await s.authority.read(s.a)).nativeWritesSinceSwitch).toBe(3);expect(s.sheetWriter).not.toHaveBeenCalled();
});

test("stale and competing edits retain the winning note and do not create failed receipts",async()=>{
 const s=await setup();await activate(s);const commands=[command(s,{notes:"Synthetic contender A"}),command(s,{notes:"Synthetic contender B"})];
 const result=await Promise.allSettled(commands.map(r=>authoritativeProspectUpdate(s.a,r,s.d)));
 expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(result.filter(r=>r.status==="rejected")).toHaveLength(1);
 const saved=await s.native.read(s.a,s.personId,3);expect(saved?.version).toBe(2);expect(commands.map(c=>c.fields.notes)).toContain(saved?.profile.notes);
 expect((await s.authority.read(s.a)).nativeWritesSinceSwitch).toBe(1);
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.command_receipts WHERE workspace_id=$1 AND operation_id LIKE 'prospect-%'",[s.f.workspaceId])).rows[0].n).toBe(2);
});

test("counter failure rolls back both partial-edit receipts and encrypted profile; the same retry then succeeds",async()=>{
 const s=await setup();await activate(s);const request=command(s,{notes:"Synthetic atomic edit"}),before=await snapshots(s);
 const failing:IdentityStore={transaction:work=>drizzleIdentityStore.transaction(tx=>work({query:async<T extends object>(sql:string,v?:readonly unknown[])=>{
  if(sql.startsWith("INSERT INTO ls_contact_ops.cutover("))throw Error("SYNTHETIC_COUNTER_FAILURE");return tx.query<T>(sql,v);}}))};
 await expect(authoritativeProspectUpdate(s.a,request,{...s.d,native:new OperationalNativeCrmStore(failing,s.f.keyring,key)})).rejects.toThrow("SYNTHETIC_COUNTER_FAILURE");
 expect(await s.native.read(s.a,s.personId,3)).toMatchObject({version:1,profile:{notes:s.profile.notes}});expect(await snapshots(s)).toEqual(before);
 expect((await s.authority.read(s.a)).nativeWritesSinceSwitch).toBe(0);
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.command_receipts WHERE workspace_id=$1 AND operation_id LIKE 'prospect-%'",[s.f.workspaceId])).rows[0].n).toBe(0);
 expect(await authoritativeProspectUpdate(s.a,request,s.d)).toMatchObject({version:2,replayed:false});
});

test("real role/session/workspace and stale authority deny both an edit and its replay",async()=>{
 const s=await setup();await activate(s);const request=command(s,{notes:"Synthetic authorized edit"});await authoritativeProspectUpdate(s.a,request,s.d);
 await expect(authoritativeProspectUpdate(s.f.parent.actor,request,s.d)).rejects.toThrow("FORBIDDEN");
 await expect(authoritativeProspectUpdate({...s.a,workspaceId:randomUUID() as typeof s.a.workspaceId},request,s.d)).rejects.toThrow("UNAUTHENTICATED");
 await expect(authoritativeProspectUpdate(s.a,{...request,expectedEpoch:2},s.d)).rejects.toThrow("CONFLICT");
 await s.authority.advance(s.a,{action:"prepare_rollback",proof:proof(3,1),operationId:"synthetic-hold"});
 await expect(authoritativeProspectUpdate(s.a,request,s.d)).rejects.toThrow("CONFLICT");
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[s.a.sessionDigest]);
 await expect(authoritativeProspectUpdate(s.a,request,s.d)).rejects.toThrow("UNAUTHENTICATED");expect(s.sheetWriter).not.toHaveBeenCalled();
});

test("unknown or ambiguous exact legacy mappings fail closed; no phone/name fallback",async()=>{
 const s=await setup();await activate(s);const request=command(s,{notes:"Synthetic should not save"});
 await expect(authoritativeProspectUpdate(s.a,{...request,leadId:"LS-LEAD-unknown"},s.d)).rejects.toThrow("NOT_FOUND");
 await s.f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext)
  SELECT workspace_id,source_file_id,source_sheet_id+1,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext
  FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND legacy_lead_id=$2`,[s.f.workspaceId,s.leads[0]]);
 await expect(authoritativeProspectUpdate(s.a,request,s.d)).rejects.toThrow("CONFLICT");
 expect(await s.native.read(s.a,s.personId,3)).toMatchObject({version:1,profile:{notes:s.profile.notes}});expect((await s.authority.read(s.a)).nativeWritesSinceSwitch).toBe(0);
});

test("clearing is explicit; long bilingual input persists, lead-only suppression does not invent journey facts",async()=>{
 const s=await setup();await activate(s);const notes="הערה מנהלית Synthetic note ".repeat(150);
 await authoritativeProspectUpdate(s.a,command(s,{notes,nextAction:"",dueDate:"",owner:"",outcome:"Do not contact — synthetic opt-out"}),s.d);
 expect(await s.native.read(s.a,s.personId,3)).toMatchObject({version:2,profile:{notes,nextAction:null,followUpDate:null}});
 const row=(await s.native.prospects(s.a,3)).find(r=>r.leadId===s.leads[0]);expect(row).toMatchObject({stage:"Do not contact",owner:"",paymentVerified:false,bookingConfirmed:false});
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
});

test("DEMO administrative editing stays synthetic and does not enter the live projection or schedule provider effects",async()=>{
 const s=await setup(true);await activate(s);await authoritativeProspectUpdate(s.a,command(s,{notes:"DEMO — Synthetic saved follow-up"}),s.d);
 expect((await s.f.pool.query("SELECT record_mode,demo_batch_id FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,s.personId])).rows[0])
  .toEqual({record_mode:"demo",demo_batch_id:"ls-owner-20260925"});
 expect(await s.native.prospects(s.a,3)).toEqual([]);expect(s.sheetWriter).not.toHaveBeenCalled();
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
});

test("profile extension rejects unmapped or privileged override keys, retaining existing older-profile compatibility",()=>{
 const profile:CrmProfile={personId:randomUUID(),stage:"New inquiry",nextAction:null,followUpDate:null,notes:"Synthetic notes",legacyIds:["LS-LEAD-valid"]};
 expect(crmProfileSchema.safeParse(profile).success).toBe(true);
 expect(crmProfileSchema.safeParse({...profile,leadUpdates:{"LS-LEAD-valid":{owner:"Synthetic owner"}}}).success).toBe(true);
 expect(crmProfileSchema.safeParse({...profile,leadUpdates:{"LS-LEAD-other":{owner:"Synthetic owner"}}}).success).toBe(false);
 expect(crmProfileSchema.safeParse({...profile,leadUpdates:{"LS-LEAD-valid":{paymentVerified:true}}}).success).toBe(false);
});

test("imported opt-outs remain sticky when outcome/status edits clear or replace their display values",async()=>{
 for(const outcome of ["Do not contact — synthetic source","Opted out — synthetic source"]){
  const s=await setup(false,outcome);await activate(s);const before=await snapshots(s);
  await authoritativeProspectUpdate(s.a,command(s,{outcome:"Contacted",owner:"Synthetic reassigned"}),s.d);
  await authoritativeProspectUpdate(s.a,command(s,{outcome:""},2),s.d);
  await s.native.updateFields(s.a,s.personId,{stage:"Contacted",nextAction:"Synthetic administrative review",followUpDate:null,notes:s.profile.notes},3,"synthetic-optout-status-save",3);
  const rows=await s.native.prospects(s.a,3);expect(rows).toHaveLength(2);expect(rows.every(row=>row.stage==="Do not contact")).toBe(true);
  expect(await snapshots(s)).toEqual(before);
  expect((await s.native.list(s.a,{view:"all",search:"",today:"2026-09-28",page:1,pageSize:20},3)).items.find(r=>r.personId===s.personId)?.doNotContact).toBe(true);
 }
});

test("native opt-out becomes sticky independently of a later administrative outcome/status change",async()=>{
 const s=await setup();await activate(s);await authoritativeProspectUpdate(s.a,command(s,{outcome:"Do not contact — synthetic new opt-out"}),s.d);
 await authoritativeProspectUpdate(s.a,command(s,{outcome:"Contacted"},2),s.d);
 await s.native.updateFields(s.a,s.personId,{stage:"New inquiry",nextAction:null,followUpDate:null,notes:s.profile.notes},3,"synthetic-native-optout-status",3);
 expect(await s.native.read(s.a,s.personId,3)).toMatchObject({version:4,profile:{doNotContact:true}});
 expect((await s.native.prospects(s.a,3)).every(row=>row.stage==="Do not contact")).toBe(true);
});

test("a sibling owner-only partial save preserves another lead's current notes; its stale competing note is denied",async()=>{
 const s=await setup();await activate(s);
 await authoritativeProspectUpdate(s.a,command(s,{notes:"Synthetic newer lead A note",nextAction:"Synthetic newer shared action"}),s.d);
 const sibling={...command(s,{owner:"Synthetic lead B owner"},2),leadId:s.leads[1]!};
 expect(await authoritativeProspectUpdate(s.a,sibling,s.d)).toMatchObject({version:3,replayed:false});
 expect(await s.native.read(s.a,s.personId,3)).toMatchObject({version:3,profile:{notes:"Synthetic newer lead A note",nextAction:"Synthetic newer shared action",
  leadUpdates:{[s.leads[1]!]:{owner:"Synthetic lead B owner"}}}});
 await expect(authoritativeProspectUpdate(s.a,{...command(s,{notes:"Synthetic stale sibling note"}),leadId:s.leads[1]!},s.d)).rejects.toThrow("CONFLICT");
 expect(await s.native.read(s.a,s.personId,3)).toMatchObject({version:3,profile:{notes:"Synthetic newer lead A note"}});
});
