import {afterAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {OutboundProjectionStore} from "../../../src/features/contact-ops/server/outbound-projection-store.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";

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
 expect(await ledger.read(a,operation)).toMatchObject({leadId:lead,state:"prepared",fields:planned,receipt:null});
 expect(await ledger.pendingLeads(a,[lead])).toEqual(new Set([lead]));
 await expect(ledger.prepare(a,lead,0,"Second synthetic message",planned)).rejects.toMatchObject({code:"CONFLICT"});
 const receipt={provider:"synthetic",providerMessageId:"synthetic-provider-id",sentAt:"2026-09-30T00:00:00Z"};
 await ledger.confirm(a,operation,receipt,{...planned,messageReceipt:"synthetic-provider-id"});
 expect(await ledger.read(a,operation)).toMatchObject({state:"sent_pending",receipt,fields:{messageReceipt:"synthetic-provider-id"}});
 await ledger.projected(a,operation);
 expect(await ledger.pendingLeads(a,[lead])).toEqual(new Set());
 expect(await ledger.read(a,operation)).toMatchObject({state:"projected",receipt});
 await expect(ledger.read(f.parent.actor,operation)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(ledger.pendingLeads(f.parent.actor,[lead])).rejects.toMatchObject({code:"FORBIDDEN"});
});

test("authority cannot freeze while a provider attempt or projection remains unresolved",async()=>{
 const {f,ledger,cutover}=await setup(),a=f.practitioner.actor,lead="LS-LEAD-SYNTHETIC-DRAIN";
 const operation=await ledger.prepare(a,lead,0,"Synthetic provider message",{stage:"Contacted"});
 await cutover.advance(a,{action:"prepare",proof:proof(0),operationId:"synthetic-outbound-prepare"});
 await expect(cutover.advance(a,{action:"freeze",proof:proof(1),operationId:"synthetic-outbound-freeze"}))
  .rejects.toMatchObject({code:"CONFLICT"});
 await ledger.confirm(a,operation,{provider:"synthetic",providerMessageId:"synthetic-id",sentAt:"2026-09-30T00:00:00Z"},{stage:"Contacted"});
 await expect(cutover.advance(a,{action:"freeze",proof:proof(1),operationId:"synthetic-outbound-freeze"}))
  .rejects.toMatchObject({code:"CONFLICT"});
 await ledger.projected(a,operation);
 expect(await cutover.advance(a,{action:"freeze",proof:proof(1),operationId:"synthetic-outbound-freeze"}))
  .toMatchObject({state:{phase:"frozen",epoch:2}});
});
