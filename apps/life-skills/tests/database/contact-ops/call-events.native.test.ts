import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {AcquisitionDecisionStore} from "../../../src/features/contact-ops/server/acquisition-decisions.ts";
import {CallEventsStore} from "../../../src/features/contact-ops/server/call-events-store.ts";
import {callEventSchema,type CallEvent} from "../../../src/features/contact-ops/core/call-events.ts";
import {crmProfileAad,crmProfileSchema} from "../../../src/features/contact-ops/server/native-store.ts";
import {seal,unseal} from "../../../src/features/identity/crypto.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-nomad-integrity-only-20261006",device="00000000-0000-4000-8000-000000000001";
const event:CallEvent=callEventSchema.parse({source:"android_nomad",from:"+15550001001",contact:"Synthetic caller",timestamp:"1791277200000",duration:"0"});
const proof=(epoch:number):CutoverEvidence=>({batchId:"synthetic-nomad",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",
 expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,
 identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,
 nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true}); // Isolated fixture, NOT live cutover evidence.
async function setup(activate=true,demoFirst=false){
 const f=await fixture({demoFirst});fixtures.push(f);const db=poolStore(f.pool),actor=f.practitioner.actor;
 const authority=new ContactCutoverStore(db,f.keyring,key),crm=new OperationalNativeCrmStore(db,f.keyring,key),decisions=new AcquisitionDecisionStore(db,f.keyring,key);
 const calls=new CallEventsStore(db,f.workspaceId,device,f.keyring,key);
 const prepare=async()=>{await authority.advance(actor,{action:"prepare",proof:proof(0),operationId:"prepare"});await authority.advance(actor,{action:"freeze",proof:proof(1),operationId:"freeze"});};
 const switchNative=()=>authority.advance(actor,{action:"switch_native",proof:proof(2),operationId:"switch"});
 if(activate){await prepare();await switchNative();}
 const count=async(table:string)=>(await f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[f.workspaceId])).rows[0].n as number;
 const contacts=()=>crm.list(actor,{view:"all",search:"",today:"2026-10-06",page:1,pageSize:100},3);
 const review=()=>decisions.list(actor,3,{page:1,search:""});
 const create=(phone=event.phone)=>crm.createContact(actor,{name:"Existing synthetic person",phone,language:"he",source:"Owner entered",
  notes:"Original note\nהערה שמורה",nextAction:"Keep next action",dueDate:"2026-10-07"},randomUUID(),3);
 const match=async(candidateId:string,personId:string)=>{const row=(await contacts()).items.find(r=>r.personId===personId)!;return decisions.decide(actor,{action:"match",candidateId,personId,expectedVersion:row.version!,expectedEpoch:3,operationId:randomUUID()});};
 return {f,db,actor,authority,crm,decisions,calls,count,contacts,review,create,prepare,switchNative,match};
}
test("unknown call is one encrypted unclassified candidate across concurrent retries, with no lead/account/case/task/send",async()=>{
 const s=await setup();const tables=["ls_identity.people","ls_identity.accounts","ls_cases.cases","ls_calendar.tasks","ls_contact_ops.profiles","ls_contact_ops.inbound_threads","ls_contact_ops.acquisition_projection_status"];
 const before=await Promise.all(tables.map(s.count));const results=await Promise.all(Array.from({length:8},()=>s.calls.capture(event)));
 expect(results.filter(r=>!r.replayed)).toHaveLength(1);expect(await s.count("ls_contact_ops.inbound_activity_candidates")).toBe(1);
 expect(await Promise.all(tables.map(s.count))).toEqual(before);expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);
 const candidate=(await s.review()).items[0]!;expect(candidate).toMatchObject({...event,state:"NEEDS_REVIEW",matching:{state:"unmatched",people:[]}});
 const raw=(await s.f.pool.query("SELECT metadata_ciphertext FROM ls_contact_ops.inbound_activity_candidates WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].metadata_ciphertext;
 expect(raw).not.toContain(event.phone);expect(raw).not.toContain(event.displayName);expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(1);
 await expect(s.calls.capture({...event,displayName:"Changed under same identity"})).rejects.toThrow("CONFLICT");
 expect((await s.review()).items[0]?.displayName).toBe(event.displayName);
});
test("false reported known caller stays in Needs Review without CRM attachment or field changes",async()=>{
 const s=await setup(),created=await s.create(),before=(await s.contacts()).items.find(r=>r.personId===created.personId)!;
 // The actual ringing caller is B, but the unqualified upstream reports A.
 // Backend cannot recover B from an A-only payload; a phone match is not trust.
 await s.create("+15550001002");
 const concurrent=await Promise.all(Array.from({length:8},()=>s.calls.capture(event)));
 expect(concurrent.filter(result=>!result.replayed)).toHaveLength(1);
 const after=(await s.contacts()).items.find(r=>r.personId===created.personId)!;
 expect(after).toEqual(before);expect(after.callActivity).toBeUndefined();
 expect((await s.review()).items[0]).toMatchObject({state:"NEEDS_REVIEW",matching:{state:"existing",people:[{personId:created.personId}]}});expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);
 expect(await s.count("ls_contact_ops.inbound_threads")).toBe(0);expect(await s.count("ls_contact_ops.lead_promotion_operations")).toBe(0);
 expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(3);expect(after.version).toBe(before.version);
 const second={...event,occurredAt:"2026-10-06T09:05:00.000Z"};await s.calls.capture(second);
 expect((await s.review()).total).toBe(2);expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);
 // Distinct queued timestamps are two notifications, not proof of two physical calls.
 expect(await s.count("ls_contact_ops.inbound_activity_candidates")).toBe(2);
});
test("explicit promotion uses genuine manual Phone/Nomad provenance; match preserves existing fields and replays once",async()=>{
 const s=await setup();await s.calls.capture(event);const candidate=(await s.review()).items[0]!;
 const command={action:"promote" as const,candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3,
  fields:{name:"Normal synthetic name",stage:"Owner-chosen stage",language:"he" as const,note:"Saved owner note",nextAction:"Call back",dueDate:"2026-10-07"}};
 const saved=await s.decisions.decide(s.actor,command);expect((await s.decisions.decide(s.actor,command)).replayed).toBe(true);
 const row=(await s.contacts()).items.find(r=>r.personId===saved.personId)!;
 expect(row.references).toHaveLength(1);expect(row.references[0]).toMatchObject({nativeOrigin:"native_manual",source:"Phone · Nomad",leadId:"LS-LEAD-native-"+row.personId});
 expect(row.callActivity?.items).toHaveLength(1);expect(row.notes).toBe(command.fields.note);expect(row.inboundActivity).toBeUndefined();
 expect(await s.count("ls_contact_ops.inbound_threads")).toBe(0);expect((await s.review()).total).toBe(0);
 await s.calls.capture({...event,occurredAt:"2026-10-06T09:05:00.000Z"});expect(await s.count("ls_contact_ops.profiles")).toBe(1);
});
test("not-lead disposition and immutable known-person link survive later phone changes/replays",async()=>{
 const s=await setup();await s.calls.capture(event);const candidate=(await s.review()).items[0]!;
 await s.decisions.decide(s.actor,{action:"not_lead",candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3});await s.create();await s.calls.capture(event);
 expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);expect((await s.review()).total).toBe(0);
 const next={...event,occurredAt:"2026-10-06T09:06:00.000Z"};await s.calls.capture(next);const row=(await s.contacts()).items.find(r=>r.references.some(ref=>ref.phone===event.phone))!;
 const candidateId=(await s.review()).items[0]!.id;await s.match(candidateId,row.personId);
 await expect(s.decisions.decide(s.actor,{action:"match",candidateId,operationId:randomUUID(),expectedEpoch:3,personId:row.personId,expectedVersion:row.version!})).rejects.toThrow("CONFLICT");
 const raw=(await s.f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,row.personId])).rows[0].payload_ciphertext;
 const profile=crmProfileSchema.parse(JSON.parse(unseal(raw,crmProfileAad(s.f.workspaceId,row.personId),s.f.keyring)));
 await s.f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,row.personId,
  seal(JSON.stringify({...profile,nativeInquiry:{...profile.nativeInquiry!,phone:"+15550001009"}}),crmProfileAad(s.f.workspaceId,row.personId),s.f.keyring)]);
 await s.calls.capture(next);expect(await s.count("ls_contact_ops.call_activity_links")).toBe(1);expect((await s.review()).total).toBe(0);
});
test("Sheet/frozen receipts remain quarantined when replayed after native cutover",async()=>{
 const s=await setup(false);await s.calls.capture(event);expect(await s.count("ls_contact_ops.profiles")).toBe(0);
 expect((await s.authority.read(s.actor)).phase).toBe("sheet_active");await s.prepare();await s.calls.capture({...event,occurredAt:"2026-10-06T09:01:00.000Z"});
 expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);await s.switchNative();await s.create();await s.calls.capture(event);
 expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);expect((await s.review()).total).toBe(2);expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(1);
});
test.each(["suppressed","archived","minor","reserved","shared","demo"] as const)("%s endpoint cannot be silently linked or promoted",async kind=>{
 const s=await setup(true,kind==="demo"),created=kind==="demo"?{personId:s.f.parent.actor.personId!}:await s.create();
 if(kind==="suppressed")await s.crm.updateFields(s.actor,created.personId,{stage:"Do not contact",notes:"Keep",nextAction:null,followUpDate:null},1,randomUUID(),3);
 if(kind==="archived")await s.f.pool.query("UPDATE ls_contact_ops.profiles SET archived_at=clock_timestamp() WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,created.personId]);
 if(kind==="minor")await s.f.pool.query("UPDATE ls_identity.people SET kind='minor' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,created.personId]);
 if(kind==="reserved")await s.f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id,
  seal(event.phone,`phone:${s.f.workspaceId}:${s.f.parent.actor.id}`,s.f.keyring)]);
 if(kind==="shared"){
  const other=await s.create("+15550001002"),raw=(await s.f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,other.personId])).rows[0].payload_ciphertext;
  const p=crmProfileSchema.parse(JSON.parse(unseal(raw,crmProfileAad(s.f.workspaceId,other.personId),s.f.keyring)));
  await s.f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,other.personId,
   seal(JSON.stringify({...p,nativeInquiry:{...p.nativeInquiry!,phone:event.phone}}),crmProfileAad(s.f.workspaceId,other.personId),s.f.keyring)]);
 }
 if(kind==="demo"){
  await s.f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,'ls-owner-20260925','person',$2,'synthetic-nomad-person',$3)",[s.f.workspaceId,created.personId,s.f.parent.actor.id]);
  const profile=crmProfileSchema.parse({personId:created.personId,stage:"New inquiry",notes:"DEMO only",nextAction:null,followUpDate:null,legacyIds:[],
   nativeInquiry:{origin:"native_manual",leadId:"LS-LEAD-native-"+created.personId,phone:event.phone,language:"he",source:"Synthetic DEMO fixture",createdAt:event.occurredAt}});
  await s.f.pool.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'demo','ls-owner-20260925')",
   [s.f.workspaceId,created.personId,seal(JSON.stringify(profile),crmProfileAad(s.f.workspaceId,created.personId),s.f.keyring)]);
 }
 await s.calls.capture(event);expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);
 expect((await s.review()).total).toBe(1);expect(await s.count("ls_contact_ops.inbound_threads")).toBe(0);
});
test("latest-five activity stays bounded and ordinary denied/revoked roles cannot read calls",async()=>{
 const s=await setup(),created=await s.create();
 for(let minute=0;minute<7;minute++){await s.calls.capture({...event,occurredAt:new Date(Date.parse(event.occurredAt)+minute*60000).toISOString()});await s.match((await s.review()).items[0]!.id,created.personId);}
 const row=(await s.contacts()).items.find(r=>r.personId===created.personId)!;expect(row.callActivity).toMatchObject({items:Array.from({length:5},()=>expect.anything()),hasMore:true});
 expect(row.callActivity!.items[0]!.occurredAt).toBe("2026-10-06T09:06:00.000Z");
 for(const denied of [s.f.parent.actor,s.f.parentTwo.actor,s.f.outsider.actor]){
  await expect(s.crm.list(denied,{view:"all",search:"",today:"2026-10-06",page:1,pageSize:100},3)).rejects.toThrow("FORBIDDEN");
  await expect(s.decisions.list(denied,3,{page:1,search:""})).rejects.toThrow("FORBIDDEN");
 }
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[s.actor.sessionDigest]);
 await expect(s.contacts()).rejects.toThrow("UNAUTHENTICATED");
});
test("new call links enforce same-workspace foreign keys, immutability and real SQL permission denial",async()=>{
 const s=await setup(),created=await s.create();await s.calls.capture(event);
 await s.match((await s.review()).items[0]!.id,created.personId);
 for(const sql of ["UPDATE ls_contact_ops.call_activity_links SET linked_at=clock_timestamp() WHERE workspace_id=$1","DELETE FROM ls_contact_ops.call_activity_links WHERE workspace_id=$1"])
  await expect(s.f.pool.query(sql,[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
 await expect(s.f.pool.query("INSERT INTO ls_contact_ops.call_activity_links(workspace_id,candidate_id,person_id) VALUES($1,$2,$3)",[randomUUID(),randomUUID(),created.personId])).rejects.toMatchObject({code:"23503"});
 const role="synthetic_nomad_"+randomUUID().replaceAll("-","");await s.f.pool.query(`CREATE ROLE ${role} NOLOGIN`);
 const client=await s.f.pool.connect();try{
  await client.query("BEGIN");await client.query(`GRANT USAGE ON SCHEMA ls_contact_ops TO ${role}`);await client.query(`SET LOCAL ROLE ${role}`);
  await expect(client.query("SELECT * FROM ls_contact_ops.call_activity_links")).rejects.toMatchObject({code:"42501"});
 }finally{await client.query("ROLLBACK");client.release();await s.f.pool.query(`DROP ROLE ${role}`);}
});
