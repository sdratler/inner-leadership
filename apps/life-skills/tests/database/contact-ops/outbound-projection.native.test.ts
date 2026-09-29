import {afterAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {OutboundProjectionStore} from "../../../src/features/contact-ops/server/outbound-projection-store.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {reconcileLegacyProspectProjection} from "../../../src/features/contact-ops/server/authoritative-prospect-send.ts";
import type {Prospect} from "../../../src/features/prospects/bridge.ts";

const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
async function setup(){
 const f=await fixture();fixtures.push(f);
 return {f,ledger:new OutboundProjectionStore(poolStore(f.pool),f.keyring,"synthetic-outbound-integrity-key-20260930"),
  cutover:new ContactCutoverStore(poolStore(f.pool),f.keyring,"synthetic-authority-integrity-key-20260928")};
}
const proof=(epoch:number):CutoverEvidence=>({batchId:"synthetic-cutover-batch",sourceFileId:"synthetic-workbook",
 sourceRevision:"synthetic-frozen-revision",expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,
 backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,
 identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,
 consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,
 sourceFrozen:true,restorePlanReady:true});

test("encrypted pre-send intent and receipt survive reload and forbid another send to that lead",async()=>{
 const {f,ledger}=await setup(),a=f.practitioner.actor,lead="LS-LEAD-SYNTHETIC-OUTBOUND";
 const planned={stage:"Contacted",nextAction:"Synthetic follow-up"};
 const operation=await ledger.prepare(a,lead,0,"Synthetic provider message",planned);
 const raw=(await f.pool.query("SELECT projection_ciphertext,receipt_ciphertext,state FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND operation_id=$2",[f.workspaceId,operation])).rows[0];
 expect(raw.state).toBe("prepared");expect(raw.receipt_ciphertext).toBeNull();
 expect(raw.projection_ciphertext).not.toContain("Synthetic follow-up");
 expect(await ledger.read(a,operation)).toMatchObject({leadId:lead,state:"prepared",message:"Synthetic provider message",fields:planned,receipt:null});
 expect(await ledger.pendingLeads(a,[lead])).toEqual(new Set([lead]));
 expect((await ledger.pendingForLeads(a,[lead])).get(lead)).toMatchObject({operationId:operation,state:"prepared",message:"Synthetic provider message"});
 await expect(ledger.prepare(a,lead,0,"Second synthetic message",planned)).rejects.toMatchObject({code:"CONFLICT"});
 const receipt={provider:"synthetic",providerMessageId:"synthetic-provider-id",sentAt:"2026-09-30T00:00:00Z"};
 await ledger.confirm(a,operation,receipt,{...planned,messageReceipt:"synthetic-provider-id"});
 const finalFields={...planned,messageReceipt:"synthetic-provider-id"};
 expect(await ledger.read(a,operation)).toMatchObject({state:"sent_pending",message:"Synthetic provider message",receipt,fields:finalFields});
 expect((await ledger.pendingForLeads(a,[lead])).get(lead)).toMatchObject({operationId:operation,state:"sent_pending",message:"Synthetic provider message"});
 let visible={...planned};
 const update=vi.fn().mockImplementation(async (_lead:string,fields:typeof finalFields)=>{visible={...fields};});
 const list=vi.fn().mockImplementation(async()=>[{leadId:lead,...visible}]);
 const runtime={store:poolStore(f.pool),config:{workspaceId:f.workspaceId}} as unknown as Parameters<typeof reconcileLegacyProspectProjection>[1];
 expect(await reconcileLegacyProspectProjection(a,runtime,operation,
  {authority:{read:actor=>new ContactCutoverStore(poolStore(f.pool),f.keyring,"synthetic-authority-integrity-key-20260928").read(actor)},
   update,list:list as unknown as ()=>Promise<Prospect[]>,ledger})).toEqual({projected:true});
 expect(update).toHaveBeenCalledWith(lead,finalFields);expect(list).toHaveBeenCalledOnce();
 expect(await ledger.pendingLeads(a,[lead])).toEqual(new Set());
 expect(await ledger.read(a,operation)).toMatchObject({state:"projected",receipt});
 await expect(ledger.read(f.parent.actor,operation)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(ledger.pendingLeads(f.parent.actor,[lead])).rejects.toMatchObject({code:"FORBIDDEN"});
});

test("authority cannot freeze while a provider attempt or projection remains unresolved",async()=>{
 const {f,ledger,cutover}=await setup(),a=f.practitioner.actor,lead="LS-LEAD-SYNTHETIC-DRAIN";
 const operation=await ledger.prepare(a,lead,0,"Synthetic provider message",{stage:"Contacted"});
 await expect(cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"synthetic-outbound-prepare"}))
  .rejects.toMatchObject({code:"CONFLICT"});
 await ledger.confirm(a,operation,{provider:"synthetic",providerMessageId:"synthetic-id",sentAt:"2026-09-30T00:00:00Z"},{stage:"Contacted"});
 await expect(cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"synthetic-outbound-prepare"}))
  .rejects.toMatchObject({code:"CONFLICT"});
 await ledger.projected(a,operation);
 await cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"synthetic-outbound-prepare"});
 expect(await cutover.advance(a,{action:"freeze",proof:proof(1),operationId:"synthetic-outbound-freeze"}))
  .toMatchObject({state:{phase:"frozen",epoch:2}});
});

test("a documented provider non-delivery can close an old prepared hold without sending or erasing evidence",async()=>{
 const {f,ledger,cutover}=await setup(),a=f.practitioner.actor,lead="LS-LEAD-SYNTHETIC-NOT-DELIVERED";
 const operation=await ledger.prepare(a,lead,0,"Synthetic undelivered message",{stage:"Contacted"});
 const evidence={provider:"whapi" as const,source:"provider_support_case" as const,
  reference:"WHAPI-SUPPORT-12345",checkedAt:new Date().toISOString(),
  acknowledgement:"I verified this exact message was not delivered" as const};
 await expect(ledger.notDelivered(a,operation,evidence)).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await f.pool.query("UPDATE ls_contact_ops.outbound_projections SET created_at=clock_timestamp()-interval '20 minutes' WHERE workspace_id=$1 AND operation_id=$2",[f.workspaceId,operation]);
 await expect(ledger.notDelivered(f.parent.actor,operation,evidence)).rejects.toMatchObject({code:"FORBIDDEN"});
 await ledger.notDelivered(a,operation,evidence);
 expect(await ledger.read(a,operation)).toMatchObject({state:"not_delivered",message:"Synthetic undelivered message",receipt:null,resolution:evidence});
 const raw=(await f.pool.query("SELECT receipt_ciphertext,resolution_ciphertext FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND operation_id=$2",[f.workspaceId,operation])).rows[0];
 expect(raw.receipt_ciphertext).toBeNull();expect(raw.resolution_ciphertext).not.toContain(evidence.reference);
 expect(await ledger.pendingLeads(a,[lead])).toEqual(new Set());
 expect(await cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"synthetic-not-delivered-prepare"}))
  .toMatchObject({state:{phase:"shadow_ready",epoch:1}});
});

test("rollback cannot advance a Sheet-writable epoch while an outbound result is unresolved",async()=>{
 const {f,ledger,cutover}=await setup(),a=f.practitioner.actor,lead="LS-LEAD-SYNTHETIC-ROLLBACK";
 await cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"synthetic-rollback-prepare"});
 const operation=await ledger.prepare(a,lead,1,"Synthetic in-flight message",{stage:"Contacted"});
 await expect(cutover.advance(a,{action:"prepare_rollback",proof:proof(1),operationId:"synthetic-rollback-hold"}))
  .rejects.toMatchObject({code:"CONFLICT"});
 await ledger.confirm(a,operation,{provider:"synthetic",providerMessageId:"synthetic-rollback-id",sentAt:"2026-09-30T00:00:00Z"},{stage:"Contacted"});
 await expect(cutover.advance(a,{action:"prepare_rollback",proof:proof(1),operationId:"synthetic-rollback-hold"}))
  .rejects.toMatchObject({code:"CONFLICT"});
 await ledger.projected(a,operation);
 expect(await cutover.advance(a,{action:"prepare_rollback",proof:proof(1),operationId:"synthetic-rollback-hold"}))
  .toMatchObject({state:{phase:"rollback_prepared",epoch:2}});
 expect(await cutover.advance(a,{action:"finish_rollback",proof:proof(2),operationId:"synthetic-rollback-finish"}))
  .toMatchObject({state:{phase:"sheet_active",epoch:3}});
});

test("a pending send remains discoverable and unreconciled when its authoritative lead is missing",async()=>{
 const {f,ledger,cutover}=await setup(),a=f.practitioner.actor,lead="LS-LEAD-SYNTHETIC-MISSING";
 const operation=await ledger.prepare(a,lead,0,"Synthetic orphaned message",{stage:"Contacted"});
 expect(await ledger.pendingForLeads(a,[])).toEqual(new Map());
 expect((await ledger.pendingPage(a)).items).toMatchObject([{leadId:lead,operationId:operation,state:"prepared"}]);
 await ledger.confirm(a,operation,{provider:"synthetic",providerMessageId:"synthetic-orphan-id",sentAt:"2026-09-30T00:00:00Z"},{stage:"Contacted"});
 const runtime={store:poolStore(f.pool),config:{workspaceId:f.workspaceId}} as unknown as Parameters<typeof reconcileLegacyProspectProjection>[1];
 const update=vi.fn().mockResolvedValue(undefined),missing=vi.fn().mockResolvedValue([]);
 await expect(reconcileLegacyProspectProjection(a,runtime,operation,
  {authority:{read:actor=>cutover.read(actor)},update,list:missing,ledger})).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect(await ledger.read(a,operation)).toMatchObject({state:"sent_pending",leadId:lead});
 expect((await ledger.pendingPage(a)).items).toMatchObject([{leadId:lead,operationId:operation,state:"sent_pending"}]);
 await expect(cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"orphaned-hold"})).rejects.toMatchObject({code:"CONFLICT"});
 const restored=vi.fn().mockResolvedValue([{leadId:lead,stage:"Contacted"}]);
 expect(await reconcileLegacyProspectProjection(a,runtime,operation,
  {authority:{read:actor=>cutover.read(actor)},update,list:restored as unknown as ()=>Promise<Prospect[]>,ledger})).toEqual({projected:true});
 expect((await ledger.pendingPage(a)).items).toEqual([]);
 expect(await cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"orphaned-hold"})).toMatchObject({state:{phase:"shadow_ready"}});
});

test("pending-ledger enumeration is practitioner-only and cursor-bounded",async()=>{
 const {f,ledger}=await setup(),a=f.practitioner.actor;
 await ledger.prepare(a,"LS-LEAD-SYNTHETIC-PAGE-A",0,"Synthetic message A",{stage:"Contacted"});
 await ledger.prepare(a,"LS-LEAD-SYNTHETIC-PAGE-B",0,"Synthetic message B",{stage:"Contacted"});
 const first=await ledger.pendingPage(a,null,1);
 expect(first.items).toHaveLength(1);expect(first.nextCursor).toBe(first.items[0]!.operationId);
 const second=await ledger.pendingPage(a,first.nextCursor,1);
 expect(second.items).toHaveLength(1);expect(second.nextCursor).toBeNull();
 expect(second.items[0]!.operationId).not.toBe(first.items[0]!.operationId);
 await expect(ledger.pendingPage(f.parent.actor)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(ledger.pendingPage(a,"invalid-cursor")).rejects.toMatchObject({code:"INVALID_REQUEST"});
});
