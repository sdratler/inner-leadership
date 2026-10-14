import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {FishingLeadStore} from "../../../src/features/contact-ops/server/fishing-lead-store.ts";
import {PublicGroupApplicationStore} from "../../../src/features/group-application/store.ts";
import {floridaGroupApplicationNotice} from "../../../src/features/group-application/contract.ts";
import {reconcileFishingLabel,type FishingLabelPorts} from "../../../src/features/contact-ops/server/fishing-label-projection.ts";
import type {FishingLabelProjection} from "../../../src/features/contact-ops/core/fishing-lead.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-fishing-label-native-integrity-20261014",program="sunday_fishing_academy" as const;
const proof=(expectedEpoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-label-fixture",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",expectedEpoch,
 observedNativeWritesSinceSwitch:writes,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,
 writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
async function setup(poolMax=8){
 const f=await fixture();fixtures.push(f);f.pool.options.max=poolMax;const db=poolStore(f.pool),actor=f.practitioner.actor,clock={now:()=>new Date()},authority=new ContactCutoverStore(db,f.keyring,key,clock);
 for(const [action,epoch] of [["prepare",0],["freeze",1],["switch_native",2]] as const)await authority.advance(actor,{action,proof:proof(epoch),operationId:"fixture-"+action});
 const store=new FishingLeadStore(db,f.keyring,key,program,clock),inquiries=new PublicGroupApplicationStore(db,f.workspaceId,f.keyring,key,clock);
 const source=await inquiries.submit({operationId:randomUUID(),fields:{parentName:"Synthetic label parent",contact:"+13055550109",language:"en",cityArea:"Synthetic Florida",programId:program,
  schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}});
 const p=await store.preview(actor,{action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source:{kind:"inquiry",id:source.item.id},expectedAssociationVersion:0,relationship:"guardian"});
 if(p.state!=="ready")throw Error("LABEL_FIXTURE_PREVIEW_MISSING");const result=await store.confirm(actor,{action:"confirm",token:p.token,confirmNewPerson:true}),personId=result.personId;
 const current=async()=>{const p=(await store.read(actor,personId,3)).projection;if(!p)throw Error("LABEL_FIXTURE_PROJECTION_MISSING");return p;};
 const binding={accountId:"synthetic-channel",managedLabelId:"16",chatId:"13055550109@s.whatsapp.net"};let present=false,changes=0;
 const ports:FishingLabelPorts={accountId:binding.accountId,now:clock.now,serial:work=>store.withLabelLease(actor,personId,3,work),current,
  record:(a,b,evidence)=>store.recordLabelProjection(actor,3,a,b,evidence),capability:async()=>({accountId:binding.accountId,state:"supported",checkedAt:clock.now().toISOString()}),binding:async()=>binding,
  read:async()=>({binding,present,checkedAt:clock.now().toISOString()}),change:async(_,desired)=>{expect((await current()).status).toBe("outcome_unknown");changes++;present=desired;return {status:200};}};
 const protectedTables=["ls_identity.people","ls_identity.accounts","ls_identity.account_subjects","ls_cases.cases","ls_cases.case_guardians","ls_calendar.appointments","ls_calendar.tasks","ls_calendar.task_history",
  "ls_contact_ops.profiles","ls_contact_ops.command_receipts","ls_contact_ops.fishing_lead_revisions","ls_contact_ops.fishing_lead_operations","ls_contact_ops.outbound_projections","ls_identity.auth_mail_outbox","ls_onboarding.first_session_orders"];
 const snapshot=()=>Promise.all(protectedTables.map(async table=>({table,rows:(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows})));
 const remove=async()=>{const p=await store.preview(actor,{action:"preview_remove",operationId:randomUUID(),expectedEpoch:3,personId,expectedAssociationVersion:1});if(p.state!=="ready")throw Error("REMOVE_PREVIEW");return store.confirm(actor,{action:"confirm",token:p.token,confirmNewPerson:false});};
 return {f,actor,authority,store,ports,current,binding,personId,snapshot,remove,changes:()=>changes,setPresent:(value:boolean)=>{present=value;}};
}
test("actual native lease/CAS serializes concurrent label checks; one effect/readback and no identity/profile/task/member/receipt changes",async()=>{
 const s=await setup(),before=await s.snapshot(),initial=await s.current();const results=await Promise.allSettled(Array.from({length:4},()=>reconcileFishingLabel(initial,s.ports)));
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected").every(r=>r.status==="rejected"&&r.reason.code==="RATE_LIMITED")).toBe(true);
 expect(s.changes()).toBe(1);expect((await s.current()).status).toBe("verified");
 expect(await s.snapshot()).toEqual(before);expect((await s.authority.read(s.actor)).nativeWritesSinceSwitch).toBe(4); // nativeAdd + binding + unknown + verified; not replays.
});
test("timeout-after-apply persists unknown through fresh store; retry only reads and verifies, without repeating native Add/provider effect",async()=>{
 const s=await setup(),before=await s.snapshot();let reads=0,changes=0;s.ports.read=async()=>{if(++reads===2)throw Error("synthetic failed read");return {binding:s.binding,present:changes>0,checkedAt:new Date().toISOString()};};
 s.ports.change=async()=>{changes++;throw Error("synthetic timeout after apply");};expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("outcome_unknown");
 const reopened=new FishingLeadStore(poolStore(s.f.pool),s.f.keyring,key,program);expect((await reopened.read(s.actor,s.personId,3)).projection?.status).toBe("outcome_unknown");
 expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("verified");expect(changes).toBe(1);expect(await s.snapshot()).toEqual(before);
});
test("deployed five-connection pool keeps native Remove available while excess provider jobs fail boundedly",async()=>{
 const s=await setup(5),initial=await s.current();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 s.ports.change=async()=>{entered();await gate;s.setPresent(true);return {status:200};};
 const active=reconcileFishingLabel(initial,s.ports);await started;
 try{
  const busy=await Promise.allSettled(Array.from({length:7},()=>reconcileFishingLabel(initial,s.ports)));
  expect(busy.every(r=>r.status==="rejected"&&r.reason.code==="RATE_LIMITED")).toBe(true);
  await s.remove();expect((await s.current()).generation).toBe(2);expect(s.f.pool.totalCount).toBeLessThanOrEqual(5);
 }finally{release();}
 expect((await active).state).toBe("superseded");expect((await s.current()).status).toBe("outcome_unknown");
});
test("queued old Add and late Add readback cannot overwrite newer Remove; managed association is reconciled to absent",async()=>{
 const s=await setup();s.ports.change=async()=>{await s.remove();s.setPresent(true);return {status:200};};
 expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("superseded");const removed=await s.current();expect(removed).toMatchObject({generation:2,desiredPresent:false,status:"outcome_unknown",unresolvedEffect:{generation:1,binding:s.binding}});
 const stale={...removed,generation:1,desiredPresent:true},checkedAt=new Date().toISOString();
 expect(await s.store.recordLabelProjection(s.actor,3,stale,{...stale,status:"verified",unresolvedEffect:undefined,verifiedAt:checkedAt},
  {generation:1,binding:s.binding,present:true,checkedAt})).toBe(false);
 s.ports.change=async(_,desired)=>{expect(desired).toBe(false);s.setPresent(false);return {status:404};};expect((await reconcileFishingLabel(removed,s.ports)).state).toBe("verified");
 expect((await s.store.read(s.actor,s.personId,3)).membership).toMatchObject({state:"removed",version:2});
});
test("pending/unknown effect fences authority transitions even with fresh counted proof; verified readback unlocks the existing controlled transition",async()=>{
 const s=await setup();let current=await s.current();await s.store.recordLabelProjection(s.actor,3,current,{...current,binding:s.binding,status:"pending"});
 for(const status of ["pending","outcome_unknown"] as const){current=await s.current();await s.store.recordLabelProjection(s.actor,3,current,{...current,status});
  const state=await s.authority.read(s.actor);await expect(s.authority.advance(s.actor,{action:"prepare_rollback",proof:proof(3,state.nativeWritesSinceSwitch),operationId:"blocked-"+status})).rejects.toMatchObject({code:"CONFLICT"});
  expect(await s.authority.read(s.actor)).toEqual(state);
 }
 s.setPresent(true);expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("verified");const state=await s.authority.read(s.actor);
 expect((await s.authority.advance(s.actor,{action:"prepare_rollback",proof:proof(3,state.nativeWritesSinceSwitch),operationId:"verified-transition"})).state.epoch).toBe(4);
});
test("unsupported capability is persisted with exact account evidence, no provider mutation, no native membership change",async()=>{
 const s=await setup(),before=await s.snapshot();s.ports.capability=async()=>({accountId:s.binding.accountId,state:"unsupported",checkedAt:new Date().toISOString()});
 expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("unsupported");expect((await s.current()).capability?.labelsSupported).toBe(false);expect(s.changes()).toBe(0);expect(await s.snapshot()).toEqual(before);
});
test("fresh role/revocation/epoch and immutable target guards deny projection writes before effects",async()=>{
 const s=await setup(),p=await s.current(),before=await s.snapshot();const next:FishingLabelProjection={...p,binding:s.binding,status:"pending"};
 await expect(s.store.recordLabelProjection(s.f.parent.actor,3,p,next)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(s.store.recordLabelProjection(s.actor,2,p,next)).rejects.toMatchObject({code:"CONFLICT"});
 await expect(s.store.recordLabelProjection(s.actor,3,p,{...next,desiredPresent:false})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.actor.id]);
 await expect(s.store.recordLabelProjection(s.actor,3,p,next)).rejects.toMatchObject({code:"UNAUTHENTICATED"});expect(await s.snapshot()).toEqual(before);
});
test("RM04-LABEL-UNKNOWN-GENERATION-01 native reopen: Remove/unsupported cannot clear old unknown or authority fence; exact absence reconciliation unlocks it",async()=>{
 const s=await setup(),p=await s.current();await s.store.recordLabelProjection(s.actor,3,p,{...p,binding:s.binding,status:"outcome_unknown"});
 await s.remove();const reopened=new FishingLeadStore(poolStore(s.f.pool),s.f.keyring,key,program),read=await reopened.read(s.actor,s.personId,3);
 expect(read.membership).toMatchObject({state:"removed",version:2});expect(read.projection).toMatchObject({status:"outcome_unknown",generation:2,unresolvedEffect:{generation:1,binding:s.binding}});
 const before=await s.snapshot();s.ports.capability=async()=>({accountId:s.binding.accountId,state:"unsupported",checkedAt:new Date().toISOString()});
 expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("outcome_unknown");let state=await s.authority.read(s.actor);
 await expect(s.authority.advance(s.actor,{action:"prepare_rollback",proof:proof(3,state.nativeWritesSinceSwitch),operationId:"unknown-after-remove"})).rejects.toMatchObject({code:"CONFLICT"});
 const current=await s.current();await expect(s.store.recordLabelProjection(s.actor,3,current,{...current,status:"unsupported",unresolvedEffect:undefined,
  capability:{accountId:s.binding.accountId,labelsSupported:false,checkedAt:new Date().toISOString()}})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 s.ports.capability=async()=>({accountId:s.binding.accountId,state:"supported",checkedAt:new Date().toISOString()});s.setPresent(true);
 expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("verified");expect((await s.current()).unresolvedEffect).toBeUndefined();
 expect(await s.snapshot()).toEqual(before);state=await s.authority.read(s.actor);
 expect((await s.authority.advance(s.actor,{action:"prepare_rollback",proof:proof(3,state.nativeWritesSinceSwitch),operationId:"exact-absent-resolved"})).state.epoch).toBe(4);
});
test("related capability/binding loss and explicit Restore retain original unresolved binding until exact current readback",async()=>{
 const s=await setup(),p=await s.current();await s.store.recordLabelProjection(s.actor,3,p,{...p,binding:s.binding,status:"outcome_unknown"});await s.remove();
 const preview=await s.store.preview(s.actor,{action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source:{kind:"person",id:s.personId},expectedAssociationVersion:2,relationship:"guardian"});
 if(preview.state!=="ready")throw Error("RESTORE_PREVIEW");await s.store.confirm(s.actor,{action:"confirm",token:preview.token,confirmNewPerson:false});
 const before=await s.snapshot();s.ports.binding=async()=>null;s.ports.capability=async()=>{throw Error("synthetic lost capability");};
 expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("outcome_unknown");const current=await s.current();
 expect(current).toMatchObject({generation:3,desiredPresent:true,binding:s.binding,unresolvedEffect:{generation:1,binding:s.binding}});
 await expect(s.store.recordLabelProjection(s.actor,3,current,{...current,binding:null,status:"unconfigured",unresolvedEffect:undefined})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 const state=await s.authority.read(s.actor);await expect(s.authority.advance(s.actor,{action:"prepare_rollback",proof:proof(3,state.nativeWritesSinceSwitch),operationId:"lost-binding-fence"})).rejects.toMatchObject({code:"CONFLICT"});
 s.ports.capability=async()=>({accountId:s.binding.accountId,state:"supported",checkedAt:new Date().toISOString()});s.setPresent(true);
 expect((await reconcileFishingLabel(await s.current(),s.ports)).state).toBe("verified");expect((await s.current()).unresolvedEffect).toBeUndefined();expect(s.changes()).toBe(0);expect(await s.snapshot()).toEqual(before);
});
