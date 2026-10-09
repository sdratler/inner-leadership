import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {LeadCommandStore} from "../../../src/features/contact-ops/server/lead-command-store.ts";
import {CallEventsStore} from "../../../src/features/contact-ops/server/call-events-store.ts";
import {callEventSchema} from "../../../src/features/contact-ops/core/call-events.ts";
import type {LeadPreview} from "../../../src/features/contact-ops/core/lead-command.ts";
import {seal} from "../../../src/features/identity/crypto.ts";
import {crmProfileAad} from "../../../src/features/contact-ops/server/native-store.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-lead-command-integrity-20261006",device="00000000-0000-4000-8000-000000000001",phone="+15550002001";
const proof=(epoch:number):CutoverEvidence=>({batchId:"synthetic-command",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",
 expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,
 identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,
 nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true}); // Fixture, never live attestation.
async function setup(activate=true,demoFirst=false){
 const f=await fixture({demoFirst});fixtures.push(f);const db=poolStore(f.pool),actor=f.practitioner.actor;let now=new Date();const clock={now:()=>new Date(now)};
 const authority=new ContactCutoverStore(db,f.keyring,key,clock),crm=new OperationalNativeCrmStore(db,f.keyring,key,clock);
 if(activate){await authority.advance(actor,{action:"prepare",proof:proof(0),operationId:"prepare"});await authority.advance(actor,{action:"freeze",proof:proof(1),operationId:"freeze"});await authority.advance(actor,{action:"switch_native",proof:proof(2),operationId:"switch"});}
 const store=new LeadCommandStore(db,f.keyring,key,clock),calls=new CallEventsStore(db,f.workspaceId,device,f.keyring,key,clock);
 const preview=(text:string,context:Record<string,string>={},operationId:string=randomUUID())=>store.preview(actor,{action:"preview",operationId,expectedEpoch:3,text,...context});
 const ready=async(text:string,context:Record<string,string>={})=>{const p=await preview(text,context);expect(p.state).toBe("ready");return p as LeadPreview;};
 const rows=()=>crm.list(actor,{view:"all",search:"",today:"2026-10-06",page:1,pageSize:100},3);
 const count=async(table:string)=>(await f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[f.workspaceId])).rows[0].n;
 const create=()=>crm.createContact(actor,{name:"Preserved synthetic name",phone,language:"he",source:"manual",notes:"  Original note\nהערה מקורית  ",nextAction:"Keep action",dueDate:"2026-10-07"},randomUUID(),3);
 const call=(number=phone,age=0)=>calls.capture(callEventSchema.parse({source:"android_nomad",from:number,timestamp:now.getTime()-age,duration:0}));
 return {f,actor,authority,crm,store,preview,ready,rows,count,create,call,clock,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
test("preview creates no rows; confirmed exact phone/name creates one lead across concurrent replay",async()=>{
 const s=await setup(),before=await s.count("ls_contact_ops.profiles"),p=await s.ready(`Add Moshe Cohen ${phone} as a Life Skills lead. Call him Sunday; Note: synthetic only`);
 expect(await s.count("ls_contact_ops.profiles")).toBe(before);expect(await s.count("ls_contact_ops.lead_commands")).toBe(0);
 const results=await Promise.all(Array.from({length:6},()=>s.store.apply(s.actor,p.token)));
 expect(results.filter(r=>!r.replayed)).toHaveLength(1);expect(new Set(results.map(r=>r.personId)).size).toBe(1);
 const row=(await s.rows()).items.find(r=>r.personId===results[0]!.personId)!;
 expect(row.displayName).toBe("Moshe Cohen");expect(row.notes).toBe("synthetic only");expect(row.nextAction).toBe("Call");expect(row.followUpDate).toBe(p.intent.dueDate);
 expect(await s.count("ls_contact_ops.profiles")).toBe(before+1);expect(await s.count("ls_contact_ops.lead_commands")).toBe(1);
 expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(1);
});
test("existing exact person appends notes, preserves normal name/history and newer edits on replay",async()=>{
 const s=await setup(),created=await s.create(),before=(await s.rows()).items.find(r=>r.personId===created.personId)!;
 const p=await s.ready("Name is Different supplied name. Stage: Contacted. Call him Monday; Note: \nהערה נוספת, punctuation.",{personId:created.personId});
 expect(p.existingName).toBe(before.displayName);expect(p.name).toBe(before.displayName);
 const saved=await s.store.apply(s.actor,p.token),row=(await s.rows()).items.find(r=>r.personId===created.personId)!;
 expect(row.displayName).toBe(before.displayName);expect(row.notes).toBe(before.notes+"\n"+p.intent.note);expect(row.stage).toBe("Contacted");
 await s.crm.updateFields(s.actor,created.personId,{stage:row.stage,notes:row.notes+"\nLater saved note",nextAction:"Later action",followUpDate:row.followUpDate},row.version!,randomUUID(),3);
 expect(await s.store.apply(s.actor,p.token)).toEqual({...saved,replayed:true});
 const after=(await s.rows()).items.find(r=>r.personId===created.personId)!;expect(after.notes).toBe(row.notes+"\nLater saved note");expect(after.nextAction).toBe("Later action");
});
test("callback window is stored exactly and an unrelated note update preserves it",async()=>{
 const s=await setup(),created=await s.create(),before=(await s.rows()).items.find(r=>r.personId===created.personId)!;
 const callback=await s.ready("Call her tomorrow between 09:00 and 10:00",{personId:created.personId});
 expect(callback.intent).toMatchObject({nextAction:"Call — 09:00–10:00",callbackWindow:{kind:"time_range",start:"09:00",end:"10:00"}});
 await s.store.apply(s.actor,callback.token);const saved=(await s.rows()).items.find(r=>r.personId===created.personId)!;
 expect(saved.nextAction).toBe("Call — 09:00–10:00");expect(saved.followUpDate).toBe(callback.intent.dueDate);expect(saved.notes).toBe(before.notes);
 const note=await s.ready("Note: unrelated administrative note",{personId:created.personId});await s.store.apply(s.actor,note.token);
 const after=(await s.rows()).items.find(r=>r.personId===created.personId)!;
 expect(after.nextAction).toBe(saved.nextAction);expect(after.followUpDate).toBe(saved.followUpDate);expect(after.notes).toBe(before.notes+"\nunrelated administrative note");
});
test("unique recent unclassified caller resolves; two recent callers require choice and zero writes",async()=>{
 const s=await setup();await s.call(phone);const text="The guy who just called is Moshe Cohen. He's interested. Add him as a Life Skills lead.";
 const one=await s.ready(text);expect(one.phone).toBe(phone);expect(one.candidateId).not.toBeNull();
 await s.call("+15550002002");const ambiguous=await s.preview(text);expect(ambiguous.state).toBe("clarify");
 if(ambiguous.state!=="clarify")throw Error("UNEXPECTED_READY");expect(ambiguous.choices).toHaveLength(2);expect(await s.count("ls_contact_ops.profiles")).toBe(0);
 const chosen=await s.ready(text,{candidateId:ambiguous.choices.find(c=>c.phone===phone)!.candidateId!});
 const saved=await s.store.apply(s.actor,chosen.token);expect(saved.state).toBe("created");expect((await s.rows()).items.find(r=>r.personId===saved.personId)?.callActivity?.items).toHaveLength(1);
 expect(await s.count("ls_contact_ops.inbound_threads")).toBe(0);
});
test("old/future/missing caller is not guessed; missing screenshot phone and unsupported stage do not write",async()=>{
 const s=await setup();await s.call(phone,11*60_000);await s.call("+15550002002",-1000);
 expect((await s.preview("The guy who just called is Moshe. Add him as a lead.")).state).toBe("clarify");
 for(const text of ["Screenshot: caller Moshe",`Add Moshe ${phone} as a lead. Stage: payment_verified`])expect((await s.preview(text)).state).toBe("clarify");
 expect(await s.count("ls_contact_ops.lead_commands")).toBe(0);expect(await s.count("ls_contact_ops.profiles")).toBe(0);
});
test("not-lead disposition keeps immutable receipt and cannot delete or archive an existing lead",async()=>{
 const s=await setup();await s.call();const recent=await s.preview("The guy who just called. This number isn't a lead.");expect(recent.state).toBe("ready");
 const saved=await s.store.apply(s.actor,(recent as LeadPreview).token);expect(saved.state).toBe("not_lead");expect(saved.personId).toBeNull();
 expect(await s.count("ls_contact_ops.inbound_activity_candidates")).toBe(1);expect(await s.count("ls_contact_ops.profiles")).toBe(0);
 const created=await s.create();expect((await s.preview("This number isn't a lead.",{personId:created.personId})).state).toBe("clarify");
 expect(await s.count("ls_contact_ops.profiles")).toBe(1);
});
test("requested external labels truthfully unavailable, no provider/outbound/account/case/payment creation",async()=>{
 const s=await setup(),tables=["ls_identity.accounts","ls_cases.cases","ls_calendar.tasks","ls_contact_ops.outbound_projections"],before=await Promise.all(tables.map(s.count));
 const p=await s.ready(`Add Moshe ${phone} as a lead. Add to Google Contacts. Add WhatsApp label.`),r=await s.store.apply(s.actor,p.token);
 expect(r.projections).toEqual({google:"unavailable",whatsapp:"unavailable"});expect(await Promise.all(tables.map(s.count))).toEqual(before);
 const raw=(await s.f.pool.query("SELECT result_ciphertext FROM ls_contact_ops.lead_commands WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].result_ciphertext;
 expect(raw).not.toContain(r.personId);expect(raw).not.toContain(phone);
});
test("expired preview conflicts, completed original operation can safely replay after expiry",async()=>{
 const s=await setup(),p=await s.ready(`Add Moshe ${phone} as a lead.`);s.advance(16*60_000);
 await expect(s.store.apply(s.actor,p.token)).rejects.toThrow("CONFLICT");expect(await s.count("ls_contact_ops.profiles")).toBe(0);
 const p2=await s.ready(`Add Moshe ${phone} as a lead.`),r=await s.store.apply(s.actor,p2.token);s.advance(16*60_000);
 expect(await s.store.apply(s.actor,p2.token)).toEqual({...r,replayed:true});
});
test("changed version, changed authority and operation reuse cannot overwrite or partially save",async()=>{
 const s=await setup(),created=await s.create(),p=await s.ready("Note: command note",{personId:created.personId}),current=(await s.rows()).items.find(r=>r.personId===created.personId)!;
 await s.crm.updateFields(s.actor,created.personId,{stage:current.stage,notes:"Newer note",nextAction:current.nextAction,followUpDate:current.followUpDate},current.version!,randomUUID(),3);
 await expect(s.store.apply(s.actor,p.token)).rejects.toThrow("CONFLICT");expect(await s.count("ls_contact_ops.lead_commands")).toBe(0);
 const p2=await s.ready("Note: accepted",{personId:created.personId}),r=await s.store.apply(s.actor,p2.token);
 const changed=await s.preview("Note: different",{personId:created.personId},p2.operationId);expect(changed.state).toBe("ready");
 await expect(s.store.apply(s.actor,(changed as LeadPreview).token)).rejects.toThrow("CONFLICT");expect(await s.store.apply(s.actor,p2.token)).toEqual({...r,replayed:true});
});
test("token substitution, another workspace and revoked role deny before writes/replay",async()=>{
 const s=await setup(),p=await s.ready(`Add Moshe ${phone} as a lead.`),other=await setup();
 await expect(other.store.apply(other.actor,p.token)).rejects.toThrow("INVALID_REQUEST");
 await expect(s.store.apply(s.actor,p.token.slice(0,-3)+"AAA")).rejects.toThrow("INVALID_REQUEST");
 await s.store.apply(s.actor,p.token);await s.f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.actor.id]);
 await expect(s.store.apply(s.actor,p.token)).rejects.toThrow();expect(await s.count("ls_contact_ops.lead_commands")).toBe(1);
});
test("ordinary customer actor and legacy authority cannot preview or mutate native leads",async()=>{
 const s=await setup(),p=await s.ready(`Add Moshe ${phone} as a lead.`);
 await expect(s.store.apply(s.f.parent.actor,p.token)).rejects.toThrow("INVALID_REQUEST");
 await expect(s.store.preview(s.f.parent.actor,{action:"preview",text:`Add Moshe ${phone} as a lead.`,expectedEpoch:3,operationId:randomUUID()})).rejects.toThrow("FORBIDDEN");
 const legacy=await setup(false);await expect(legacy.preview(`Add Moshe ${phone} as a lead.`)).rejects.toThrow("CONFLICT");
 expect(await legacy.count("ls_contact_ops.profiles")).toBe(0);
});
test("account-only endpoint cannot turn into a duplicate administrative identity",async()=>{
 const s=await setup();await s.f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id,
  seal(phone,`phone:${s.f.workspaceId}:${s.f.parent.actor.id}`,s.f.keyring)]);
 expect(await s.preview(`Add Moshe ${phone} as a lead.`)).toMatchObject({state:"clarify",reason:"reserved"});expect(await s.count("ls_contact_ops.profiles")).toBe(0);
});
test("native DEMO endpoint and selected DEMO person cannot be edited or promoted by Quick update",async()=>{
 const s=await setup(true,true),personId=s.f.parent.actor.personId;
 await s.f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,'ls-owner-20260925','person',$2,'synthetic-command-person',$3)",[s.f.workspaceId,personId,s.f.parent.actor.id]);
 const profile={personId,stage:"New inquiry",notes:"DEMO only",nextAction:null,followUpDate:null,legacyIds:[],
  nativeInquiry:{origin:"native_manual",leadId:"LS-LEAD-native-"+personId,phone,language:"he",source:"Synthetic DEMO fixture",createdAt:s.clock.now().toISOString()}};
 await s.f.pool.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'demo','ls-owner-20260925')",[s.f.workspaceId,personId,seal(JSON.stringify(profile),crmProfileAad(s.f.workspaceId,personId),s.f.keyring)]);
 expect(await s.preview(`Add Moshe ${phone} as a lead.`)).toMatchObject({state:"clarify",reason:"reserved"});
 expect(await s.preview("Note: do not change DEMO",{personId})).toMatchObject({state:"clarify",reason:"reserved"});expect(await s.count("ls_contact_ops.lead_commands")).toBe(0);
});
test("note overflow rolls back the composed candidate match, receipt, link and profile",async()=>{
 const s=await setup();await s.call();const created=await s.create(),current=(await s.rows()).items.find(r=>r.personId===created.personId)!;
 await s.crm.updateFields(s.actor,created.personId,{stage:current.stage,notes:"x".repeat(4990),nextAction:current.nextAction,followUpDate:current.followUpDate},current.version!,randomUUID(),3);
 const p=await s.ready("The guy who just called. Note: "+"y".repeat(20));
 await expect(s.store.apply(s.actor,p.token)).rejects.toThrow("INVALID_REQUEST");
 expect(await s.count("ls_contact_ops.lead_commands")).toBe(0);expect(await s.count("ls_contact_ops.lead_promotion_operations")).toBe(0);expect(await s.count("ls_contact_ops.call_activity_links")).toBe(0);
 expect((await s.rows()).items.find(r=>r.personId===created.personId)?.notes).toBe("x".repeat(4990));
});
test("fresh changed authority blocks a previously legitimate preview without Sheet fallback",async()=>{
 const s=await setup(),p=await s.ready(`Add Moshe ${phone} as a lead.`),state=await s.authority.read(s.actor);
 await s.authority.advance(s.actor,{action:"prepare_rollback",proof:{...proof(3),observedNativeWritesSinceSwitch:state.nativeWritesSinceSwitch},operationId:"rollback-prepare"});
 await expect(s.store.apply(s.actor,p.token)).rejects.toThrow("CONFLICT");expect(await s.count("ls_contact_ops.profiles")).toBe(0);expect(await s.count("ls_contact_ops.lead_commands")).toBe(0);
});
test("immutable command receipt and PUBLIC denial are enforced by native PostgreSQL",async()=>{
 const s=await setup(),p=await s.ready(`Add Moshe ${phone} as a lead.`);await s.store.apply(s.actor,p.token);
 for(const sql of ["UPDATE ls_contact_ops.lead_commands SET created_at=clock_timestamp() WHERE workspace_id=$1","DELETE FROM ls_contact_ops.lead_commands WHERE workspace_id=$1"])
  await expect(s.f.pool.query(sql,[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
 const role="synthetic_command_"+randomUUID().replaceAll("-","");await s.f.pool.query(`CREATE ROLE ${role} NOLOGIN`);
 const client=await s.f.pool.connect();try{await client.query("BEGIN");await client.query(`GRANT USAGE ON SCHEMA ls_contact_ops TO ${role}`);await client.query(`SET LOCAL ROLE ${role}`);
  await expect(client.query("SELECT * FROM ls_contact_ops.lead_commands")).rejects.toMatchObject({code:"42501"});
 }finally{await client.query("ROLLBACK");client.release();await s.f.pool.query(`DROP ROLE ${role}`);}
});
