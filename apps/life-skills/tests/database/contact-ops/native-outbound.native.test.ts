import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {NativeOutboundStore} from "../../../src/features/contact-ops/server/native-outbound.ts";
import {OutboundProjectionStore} from "../../../src/features/contact-ops/server/outbound-projection-store.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-native-outbound-integrity-key",binding="a".repeat(64);
const fields={stage:"Intake sent",nextAction:"Review submitted intake",dueDate:"",updateProvenance:"private-app:intake-sent"};
const receipt={provider:"whapi",providerMessageId:"synthetic-provider-native-outbound",sentAt:"2026-10-05T09:00:00.000Z"};
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-outbound-batch",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,
 backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,
 inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
async function setup(activate=true,demo=false){
 const f=await fixture({demoFirst:demo});fixtures.push(f);const db=poolStore(f.pool),a=f.practitioner.actor;
 const authority=new ContactCutoverStore(db,f.keyring,key),crm=new OperationalNativeCrmStore(db,f.keyring,key);
 if(activate)for(const [i,action] of (["prepare","freeze","switch_native"] as const).entries())await authority.advance(a,{action,proof:proof(i),operationId:action});
 return {f,db,a,authority,crm,outbound:new NativeOutboundStore(db,f.keyring,key),ledger:new OutboundProjectionStore(db,f.keyring,key)};
}
async function person(s:Awaited<ReturnType<typeof setup>>){return s.crm.createContact(s.a,{name:"Synthetic native recipient",phone:"+15555550123",language:"en",source:"Synthetic isolated fixture",notes:"Preserve original note",nextAction:"Reply",dueDate:""},randomUUID(),3);}
test("native intent resolves actual recipient, encrypts it, survives reload and projects exactly once without overwriting concurrent notes",async()=>{
 const s=await setup(),p=await person(s),id=await s.outbound.prepare(s.a,p.leadId,3,"Synthetic test message",fields,binding);
 expect(await s.outbound.request(s.a,id,3,binding)).toMatchObject({operationId:id,phone:"+15555550123",recordMode:"live",authorityEpoch:3});
 const ciphertext=(await s.f.pool.query("SELECT projection_ciphertext FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND operation_id=$2",[s.a.workspaceId,id])).rows[0].projection_ciphertext;
 expect(ciphertext).not.toContain("15555550123");expect(ciphertext).not.toContain("Synthetic test message");
 await s.crm.updateProspectFields(s.a,p.leadId,{notes:"Preserve newer concurrent note"},1,randomUUID(),3);
 await s.ledger.confirm(s.a,id,receipt,{...fields,formSent:receipt.sentAt,messageReceipt:receipt.providerMessageId});
 expect((await s.ledger.read(s.a,id))?.native?.phone).toBe("+15555550123");
 expect(await s.outbound.project(s.a,id,3)).toEqual({projected:true});
 expect(await s.outbound.project(s.a,id,3)).toEqual({projected:true});
 expect(await s.crm.read(s.a,p.personId,3)).toMatchObject({version:3,profile:{notes:"Preserve newer concurrent note",stage:"Intake sent",
  outreach:{[p.leadId]:{messageReceipt:receipt.providerMessageId,formSent:receipt.sentAt}}}});
 expect((await s.crm.prospects(s.a,3)).find(r=>r.leadId===p.leadId)).toMatchObject({formSent:receipt.sentAt,messageReceipt:receipt.providerMessageId,
  lastContact:receipt.sentAt,paymentVerified:false,bookingConfirmed:false,notes:"Preserve newer concurrent note"});
 expect(await s.ledger.pendingLeads(s.a,[p.leadId])).toEqual(new Set());
});
test("unknown delivery holds a second send and rollback; request rechecks opt-out after preparing",async()=>{
 const s=await setup(),p=await person(s),id=await s.outbound.prepare(s.a,p.leadId,3,"Synthetic test message",fields,binding);
 await expect(s.outbound.prepare(s.a,p.leadId,3,"Second message",fields,binding)).rejects.toMatchObject({code:"CONFLICT"});
 const state=await s.authority.read(s.a);
 await expect(s.authority.advance(s.a,{action:"prepare_rollback",proof:proof(3,state.nativeWritesSinceSwitch),operationId:"rollback"})).rejects.toMatchObject({code:"CONFLICT"});
 await s.crm.updateProspectFields(s.a,p.leadId,{outcome:"Do not contact"},1,randomUUID(),3);
 await expect(s.outbound.request(s.a,id,3,binding)).rejects.toMatchObject({code:"FORBIDDEN"});
 expect((await s.ledger.read(s.a,id))?.state).toBe("prepared");
});
test("conflicting stage is retained and receipt remains pending without any provider resend",async()=>{
 const s=await setup(),p=await person(s),id=await s.outbound.prepare(s.a,p.leadId,3,"Synthetic test message",fields,binding);
 await s.crm.updateProspectFields(s.a,p.leadId,{stage:"Owner changed stage",notes:"Do not lose this"},1,randomUUID(),3);
 await s.ledger.confirm(s.a,id,receipt,fields);
 await expect(s.outbound.project(s.a,id,3)).rejects.toMatchObject({code:"CONFLICT"});
 expect(await s.crm.read(s.a,p.personId,3)).toMatchObject({version:2,profile:{stage:"Owner changed stage",notes:"Do not lose this"}});
 expect((await s.ledger.read(s.a,id))?.state).toBe("sent_pending");
});
test("ordinary profile edits cannot invent, alter or remove receipt-derived outreach facts",async()=>{
 const s=await setup(),p=await person(s),id=await s.outbound.prepare(s.a,p.leadId,3,"Synthetic test message",fields,binding);
 let current=(await s.crm.read(s.a,p.personId,3))!;
 await expect(s.crm.update(s.a,{...current.profile,outreach:{[p.leadId]:{lastContact:receipt.sentAt,messageReceipt:"forged",updateProvenance:"private-app:practitioner-click"}}},1,randomUUID(),3)).rejects.toThrow("OUTREACH_REQUIRES_DELIVERY_RECEIPT");
 await s.ledger.confirm(s.a,id,receipt,fields);await s.outbound.project(s.a,id,3);
 current=(await s.crm.read(s.a,p.personId,3))!;const cleared={...current.profile};delete cleared.outreach;
 await expect(s.crm.update(s.a,cleared,current.version,randomUUID(),3)).rejects.toThrow("OUTREACH_REQUIRES_DELIVERY_RECEIPT");
});
test("legacy/frozen/stale authority, wrong role, workspace, binding and revoked session fail closed",async()=>{
 const held=await setup(false);
 await expect(held.outbound.prepare(held.a,"LS-LEAD-SYNTHETIC",0,"Synthetic",fields,binding)).rejects.toMatchObject({code:"CONFLICT"});
 const s=await setup(),p=await person(s),id=await s.outbound.prepare(s.a,p.leadId,3,"Synthetic",fields,binding);
 await expect(s.outbound.request(s.a,id,2,binding)).rejects.toMatchObject({code:"CONFLICT"});
 await expect(s.outbound.request(s.a,id,3,"b".repeat(64))).rejects.toMatchObject({code:"CONFLICT"});
 await expect(s.outbound.request(s.f.parent.actor,id,3,binding)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(s.outbound.request({...s.a,workspaceId:randomUUID() as typeof s.a.workspaceId},id,3,binding)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[s.a.sessionDigest]);
 await expect(s.outbound.request(s.a,id,3,binding)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
test("retained DEMO person provenance blocks a native outbound intent",async()=>{
 const s=await setup(true,true),personId=s.f.parent.actor.personId,leadId="LS-LEAD-native-"+personId;
 await s.f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,'ls-owner-20260925','person',$2,$3,$4)",
  [s.f.workspaceId,personId,"synthetic-outbound-demo-"+randomUUID(),s.f.parent.actor.id]);
 await s.crm.create(s.a,{personId,stage:"New inquiry",nextAction:null,followUpDate:null,notes:"Synthetic DEMO",legacyIds:[],
  nativeInquiry:{origin:"native_manual",leadId,phone:"+15555550124",language:"en",source:"Synthetic DEMO",createdAt:"2026-10-05T09:00:00.000Z"}},randomUUID(),3);
 await expect(s.outbound.prepare(s.a,leadId,3,"Never send DEMO",fields,binding)).rejects.toThrow();
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1",[s.a.workspaceId])).rows[0].n).toBe(0);
});
test("simultaneous native attempts serialize before provider dispatch",async()=>{
 const s=await setup(),p=await person(s);
 const results=await Promise.allSettled([1,2].map(i=>s.outbound.prepare(s.a,p.leadId,3,"Synthetic simultaneous "+i,fields,binding)));
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1",[s.a.workspaceId])).rows[0].n).toBe(1);
});
test("projection marker failure rolls profile changes back with the receipt still pending",async()=>{
 const s=await setup(),p=await person(s),id=await s.outbound.prepare(s.a,p.leadId,3,"Synthetic",fields,binding);
 await s.ledger.confirm(s.a,id,receipt,fields);
 const failing=new NativeOutboundStore({transaction:work=>s.db.transaction(tx=>work({query:async<T extends object>(sql:string,v?:readonly unknown[])=>{
  if(sql.includes("SET state='projected'"))throw Error("SYNTHETIC_MARKER_FAILURE");return tx.query<T>(sql,v);
 }}))},s.f.keyring,key);
 await expect(failing.project(s.a,id,3)).rejects.toThrow("SYNTHETIC_MARKER_FAILURE");
 expect(await s.crm.read(s.a,p.personId,3)).toMatchObject({version:1,profile:{stage:"New inquiry"}});
 expect((await s.ledger.read(s.a,id))?.state).toBe("sent_pending");
});
