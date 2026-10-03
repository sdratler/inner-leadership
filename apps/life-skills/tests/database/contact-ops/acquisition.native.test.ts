import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {ContactInboundStore,inboundBindingDigest} from "../../../src/features/contact-ops/server/inbound-store.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {AcquisitionDecisionStore} from "../../../src/features/contact-ops/server/acquisition-decisions.ts";
import {AcquisitionCandidateStore} from "../../../src/features/contact-ops/server/acquisition-store.ts";
import type {AcquisitionDecision} from "../../../src/features/contact-ops/core/acquisition.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key="synthetic-acquisition-integrity-only";
const inquiry={provider:"whapi" as const,channelId:"synthetic-acquisition",businessNumber:"+15550001000",providerEventId:"synthetic-event",
 providerMessageId:"synthetic-message",providerThreadId:"synthetic-thread",eventType:"inbound_message" as const,fromMe:false as const,
 fromNumber:"+15550001001",pushName:"Synthetic contact",messageType:"text",messageText:"Synthetic private body",occurredAt:"2026-10-02T10:00:00Z",media:[]};
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-acquisition",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",
 expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,
 identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,
 nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true}); // Isolated gate fixture, not live cutover proof.
async function setup(activate=true){
 const f=await fixture();fixtures.push(f);const db=poolStore(f.pool),actor=f.practitioner.actor;
 const authority=new ContactCutoverStore(db,f.keyring,key),crm=new OperationalNativeCrmStore(db,f.keyring,key),decisions=new AcquisitionDecisionStore(db,f.keyring,key);
 const store=new ContactInboundStore(db,f.workspaceId,f.keyring,key,inboundBindingDigest(inquiry));
 if(activate){await authority.advance(actor,{action:"prepare",proof:proof(0),operationId:"prepare"});await authority.advance(actor,{action:"freeze",proof:proof(1),operationId:"freeze"});
  await authority.advance(actor,{action:"switch_native",proof:proof(2),operationId:"activate"});}
 const count=async(table:string)=>(await f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[f.workspaceId])).rows[0].n as number;
 const review=()=>decisions.list(actor,3,{page:1,search:""});
 const contacts=()=>crm.list(actor,{view:"prospects",search:"",today:"2026-10-03",page:1,pageSize:100},3);
 async function capture(){await store.capture(inquiry);return (await review()).items[0]!;}
 const promote=(id:string):AcquisitionDecision=>({action:"promote",candidateId:id,operationId:randomUUID(),expectedEpoch:3,
  fields:{name:"Synthetic normal contact",stage:"Practitioner-selected status",language:"he",note:"Synthetic authored note\nKeep both lines",nextAction:"Review inquiry",dueDate:"2026-10-03"}});
 return {f,db,actor,authority,crm,decisions,store,count,review,contacts,capture,promote};
}
test("owner promotion commits one person/lead and exact replay, without account/case/task/provider effects",async()=>{
 const {actor,authority,crm,decisions,store,count,review,contacts,capture,promote}=await setup();
 const before=await Promise.all(["ls_identity.people","ls_identity.accounts","ls_cases.cases","ls_calendar.tasks"].map(count));
 const candidate=await capture();expect(candidate.matching).toEqual({state:"unmatched",people:[]});expect((await contacts()).total).toBe(0);
 const command=promote(candidate.id),results=await Promise.all(Array.from({length:8},()=>decisions.decide(actor,command)));
 expect(results.filter(r=>!r.replayed)).toHaveLength(1);expect(new Set(results.map(r=>r.personId)).size).toBe(1);
 const saved=results[0]!;expect(saved).toMatchObject({state:"PROMOTED",authorityEpoch:3,projections:{google:"pending",whatsapp:"pending",reason:"provider_not_verified"}});
 const people=await contacts();expect(people.total).toBe(1);const contact=people.items[0]!;
 expect(contact).toMatchObject({personId:saved.personId,displayName:"Synthetic normal contact",stage:"Practitioner-selected status",notes:"Synthetic authored note\nKeep both lines"});
 expect(contact.references).toHaveLength(1);expect(contact.references[0]!.leadId).toBe("LS-WAPI-native-"+contact.personId);
 expect((await review()).total).toBe(0);expect(await count("ls_contact_ops.lead_promotion_operations")).toBe(1);
 expect(await count("ls_contact_ops.acquisition_projection_status")).toBe(2);
 expect(await Promise.all(["ls_identity.people","ls_identity.accounts","ls_cases.cases","ls_calendar.tasks"].map(count))).toEqual([before[0]!+1,...before.slice(1)]);
 const second={...inquiry,providerEventId:"second-event",providerMessageId:"second-message",messageText:"Another synthetic message",occurredAt:"2026-10-02T11:00:00Z"};
 await store.capture(second);await store.capture(second);expect((await contacts()).total).toBe(1);
 const after=(await contacts()).items[0]!;expect(after.notes).toBe(contact.notes);expect(after.references).toHaveLength(1);expect(after.inboundActivity?.messageCount).toBe(1);
 await crm.updateFields(actor,contact.personId,{stage:after.stage,notes:"Newer authored note",nextAction:after.nextAction,followUpDate:after.followUpDate},after.version!,randomUUID(),3);
 await decisions.decide(actor,command);expect((await contacts()).items[0]!.notes).toBe("Newer authored note");
 expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(4); // capture + decision + second message + authored edit; retries do not count.
 await expect(decisions.decide(actor,{action:"not_lead",candidateId:command.candidateId,operationId:command.operationId,expectedEpoch:3})).rejects.toThrow("CONFLICT");
});
test("match uses the existing exact phone/person and preserves notes, stage and one lead on later messages",async()=>{
 const {actor,crm,decisions,store,capture,contacts,review,count}=await setup();const candidate=await capture();
 const original=await crm.createContact(actor,{name:"Existing synthetic person",phone:inquiry.fromNumber,language:"en",source:"Owner entered",
  notes:"Original existing note",nextAction:"Keep existing action",dueDate:"2026-10-05"},randomUUID(),3);
 const current=(await contacts()).items[0]!;expect((await review()).items[0]!.matching).toMatchObject({state:"existing",people:[{personId:original.personId,eligible:true,version:1}]});
 const command:AcquisitionDecision={action:"match",candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3,personId:original.personId,expectedVersion:1};
 await expect(decisions.decide(actor,{...command,expectedVersion:2})).rejects.toThrow("CONFLICT");
 await expect(decisions.decide(actor,{...command,personId:randomUUID()})).rejects.toThrow("CONFLICT");
 const saved=await decisions.decide(actor,command);expect(saved.state).toBe("MATCHED");
 const {acquisitionProjections,...unchanged}=(await contacts()).items[0]!;expect(unchanged).toEqual(current);
 expect(acquisitionProjections).toHaveLength(2);expect(acquisitionProjections).toEqual(expect.arrayContaining([
  expect.objectContaining({channel:"google_contacts",state:"pending",reason:"provider_not_verified"}),
  expect.objectContaining({channel:"whatsapp",state:"pending",reason:"provider_not_verified"})]));
 expect(JSON.parse(JSON.stringify((await contacts()).items[0])).acquisitionProjections).toEqual(acquisitionProjections);
 await store.capture({...inquiry,providerEventId:"matched-second",providerMessageId:"matched-second",occurredAt:"2026-10-02T11:00:00Z"});
 const after=(await contacts()).items[0]!;expect(after.personId).toBe(original.personId);expect(after.notes).toBe(current.notes);expect(after.stage).toBe(current.stage);
 expect(after.nextAction).toBe(current.nextAction);expect(after.references).toHaveLength(1);expect(after.references[0]!.leadId).toBe(original.leadId);
 expect(after.inboundActivity?.messageCount).toBe(1);expect(await count("ls_contact_ops.profiles")).toBe(1);
 await expect(decisions.decide(actor,{action:"promote",candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3,
  fields:{name:"Duplicate",stage:"New inquiry",language:"",note:"",nextAction:"",dueDate:""}})).rejects.toThrow("CONFLICT");
});
test("not a lead removes only the review item and preserves immutable receipt metadata",async()=>{
 const {actor,db,f,decisions,capture,review,count,promote}=await setup();const candidate=await capture();
 const command:AcquisitionDecision={action:"not_lead",candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3};
 expect(await decisions.decide(actor,command)).toMatchObject({state:"NOT_A_LEAD",personId:null,projections:null,replayed:false});
 expect((await decisions.decide(actor,command)).replayed).toBe(true);expect((await review()).total).toBe(0);
 expect(await count("ls_contact_ops.profiles")).toBe(0);expect(await count("ls_contact_ops.acquisition_projection_status")).toBe(0);
 expect((await new AcquisitionCandidateStore(db,f.keyring,key).recent(actor)).items[0]).toMatchObject({id:candidate.id,phone:inquiry.fromNumber});
 await expect(decisions.decide(actor,promote(candidate.id))).rejects.toThrow("CONFLICT");
 await expect(f.pool.query("UPDATE ls_contact_ops.lead_promotion_operations SET state='PROMOTED' WHERE workspace_id=$1",[f.workspaceId])).rejects.toMatchObject({code:"23514"});
 await expect(f.pool.query("DELETE FROM ls_contact_ops.lead_promotion_operations WHERE workspace_id=$1",[f.workspaceId])).rejects.toMatchObject({code:"23514"});
});
test("concurrent different candidates for one phone cannot produce duplicate people",async()=>{
 const {actor,decisions,store,capture,promote,review,contacts,count}=await setup();const first=await capture();
 await store.capture({...inquiry,providerEventId:"other-thread",providerMessageId:"other-thread",providerThreadId:"other-thread",occurredAt:"2026-10-02T11:00:00Z"});
 const second=(await review()).items.find(item=>item.id!==first.id)!;
 const results=await Promise.allSettled([decisions.decide(actor,promote(first.id)),decisions.decide(actor,promote(second.id))]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 expect((await contacts()).total).toBe(1);expect(await count("ls_contact_ops.profiles")).toBe(1);
 const pending=(await review()).items[0]!;expect(pending.matching.state).toBe("existing");
 const match=pending.matching.people[0]!;expect(await decisions.decide(actor,{action:"match",candidateId:pending.id,operationId:randomUUID(),expectedEpoch:3,
  personId:match.personId,expectedVersion:match.version!})).toMatchObject({state:"MATCHED",personId:match.personId});
 expect((await contacts()).total).toBe(1);
});
test("current authority, fresh role/session, candidate workspace and exact operation are enforced",async()=>{
 const {f,actor,decisions,capture,promote,count}=await setup();const candidate=await capture(),command=promote(candidate.id);
 for(const denied of [f.parent.actor,f.parentTwo.actor,f.outsider.actor]){
  await expect(decisions.list(denied,3,{page:1,search:""})).rejects.toThrow("FORBIDDEN");await expect(decisions.decide(denied,command)).rejects.toThrow("FORBIDDEN");
 }
 await expect(decisions.decide(actor,{...command,expectedEpoch:2})).rejects.toThrow("CONFLICT");
 await expect(decisions.decide(actor,{...command,candidateId:randomUUID()})).rejects.toThrow("NOT_FOUND");
 await expect(decisions.decide({...actor,workspaceId:randomUUID() as typeof actor.workspaceId},command)).rejects.toThrow();
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[actor.sessionDigest]);
 await expect(decisions.decide(actor,command)).rejects.toThrow("UNAUTHENTICATED");expect(await count("ls_contact_ops.profiles")).toBe(0);
});
test.each(["session","account","role"] as const)("a queued %s revocation denies every acquisition decision and replay without saved effects",async boundary=>{
 for(const action of ["promote","match","not_lead","replay"] as const){
  const {f,db,actor,crm,capture,promote,decisions}=await setup(),candidate=await capture();
  let command:AcquisitionDecision=promote(candidate.id);
  if(action==="match"){
   const existing=await crm.createContact(actor,{name:"Existing synthetic revocation target",phone:inquiry.fromNumber,language:"en",source:"Owner entered",
    notes:"Preserve this existing note",nextAction:"Keep this action",dueDate:"2026-10-05"},randomUUID(),3);
   command={action:"match",candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3,personId:existing.personId,expectedVersion:1};
  }else if(action==="not_lead")command={action:"not_lead",candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3};
  else if(action==="replay")await decisions.decide(actor,command);
  // Snapshot the actual encrypted rows and authority counter, not only counts.
  // The revoker below changes identity/session facts only, never these records.
  const tables=["ls_identity.people","ls_cases.cases","ls_calendar.tasks","ls_contact_ops.profiles","ls_contact_ops.inbound_threads",
   "ls_contact_ops.inbound_activity_candidates","ls_contact_ops.message_receipts","ls_contact_ops.lead_promotion_operations",
   "ls_contact_ops.acquisition_projection_status","ls_contact_ops.cutover"];
  const snapshot=()=>Promise.all(tables.map(async table=>(await f.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value
   FROM ${table} t WHERE workspace_id=$1`,[f.workspaceId])).rows[0].value));
  const before=await snapshot(),accountsBefore=(await f.pool.query("SELECT count(*)::int AS n FROM ls_identity.accounts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n;
  const revoker=await f.pool.connect();let outcome:Promise<{error:unknown}>|null=null;
  try{
   await revoker.query("BEGIN");await revoker.query("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE",[f.workspaceId]);
   const blocker=(await revoker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
   if(boundary==="session")await revoker.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[actor.sessionDigest]);
   else if(boundary==="account")await revoker.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,actor.id]);
   else await revoker.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,actor.id]);
   let reportPid!:(pid:number)=>void;const ready=new Promise<number>(resolve=>{reportPid=resolve;});
   const observedDb:IdentityStore={transaction:work=>db.transaction(async tx=>{
    await tx.query("SET LOCAL statement_timeout='10s'");const [backend]=await tx.query<{pid:number}>("SELECT pg_backend_pid() AS pid");
    reportPid(backend!.pid);return work(tx);
   })};
   // Observe the real production-style adapter's transaction; do not mock its
   // authorization, lock, isolation level, result or commit.
   outcome=new AcquisitionDecisionStore(observedDb,f.keyring,key).decide(actor,command).then(()=>({error:null}),error=>({error}));
   const decisionPid=await ready,deadline=Date.now()+5000;let blocked=false;
   while(Date.now()<deadline){
    blocked=(await f.pool.query("SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked",[decisionPid,blocker])).rows[0].blocked;
    if(blocked)break;await new Promise<void>(resolve=>setTimeout(resolve,10));
   }
   expect(blocked,"decision must actually wait behind the uncommitted revocation").toBe(true);
   await revoker.query("COMMIT");
   expect((await outcome).error).toMatchObject({code:boundary==="role"?"FORBIDDEN":"UNAUTHENTICATED"});
   expect(await snapshot()).toEqual(before);
   expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_identity.accounts WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(accountsBefore);
  }finally{
   await revoker.query("ROLLBACK");revoker.release();if(outcome)await outcome;
   await f.pool.end();fixtures.splice(fixtures.indexOf(f),1);
  }
 }
});
test("legacy/frozen authority never accepts a browser promotion or reads native shadow candidates",async()=>{
 const {actor,authority,decisions}=await setup(false);
 await expect(decisions.list(actor,0,{page:1,search:""})).rejects.toThrow("CONFLICT");
 const command:AcquisitionDecision={action:"not_lead",candidateId:randomUUID(),operationId:randomUUID(),expectedEpoch:0};
 await expect(decisions.decide(actor,command)).rejects.toThrow("CONFLICT");
 await authority.advance(actor,{action:"prepare",proof:proof(0),operationId:"prepare"});await authority.advance(actor,{action:"freeze",proof:proof(1),operationId:"freeze"});
 await expect(decisions.decide(actor,{...command,expectedEpoch:2})).rejects.toThrow("CONFLICT");
});
test("failed commit rolls back person/profile/thread/decision/projections and authority counter",async()=>{
 const {f,db,actor,authority,capture,promote,count,decisions}=await setup();const candidate=await capture(),command=promote(candidate.id);
 const before=await count("ls_identity.people");
 const failing:IdentityStore={transaction:work=>db.transaction(async tx=>{await work(tx);throw Error("SYNTHETIC_ACQUISITION_COMMIT_FAILURE");})};
 await expect(new AcquisitionDecisionStore(failing,f.keyring,key).decide(actor,command)).rejects.toThrow("SYNTHETIC_ACQUISITION_COMMIT_FAILURE");
 for(const table of ["ls_contact_ops.profiles","ls_contact_ops.inbound_threads","ls_contact_ops.lead_promotion_operations","ls_contact_ops.acquisition_projection_status"])expect(await count(table)).toBe(0);
 expect(await count("ls_identity.people")).toBe(before);expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(1);
 expect((await decisions.decide(actor,command)).replayed).toBe(false);
 const saved=(await f.pool.query("SELECT result_ciphertext FROM ls_contact_ops.lead_promotion_operations WHERE workspace_id=$1",[f.workspaceId])).rows[0].result_ciphertext;
 expect(saved).not.toContain("Synthetic");expect(saved).not.toContain(inquiry.fromNumber);
});
test("bounded search and pagination use persisted candidates, exclude decisions and never expose body/clinical fields",async()=>{
 const {actor,decisions,store,capture,promote,review}=await setup();const first=await capture();
 for(let i=0;i<12;i++)await store.capture({...inquiry,providerEventId:"page-event-"+i,providerMessageId:"page-message-"+i,providerThreadId:"page-thread-"+i,
  fromNumber:"+15550002"+String(i).padStart(3,"0"),pushName:"Synthetic other "+i});
 const page=await review();expect(page).toMatchObject({total:13,page:1,pages:2});expect(page.items).toHaveLength(12);
 const last=await decisions.list(actor,3,{page:2,search:""});expect(last.items).toHaveLength(1);
 expect(new Set([...page.items,...last.items].map(row=>row.id)).size).toBe(13);
 expect((await decisions.list(actor,3,{page:1,search:"Synthetic contact"})).total).toBe(1);
 expect(JSON.stringify(page)).not.toContain(inquiry.messageText);expect(JSON.stringify(page)).not.toContain("caseId");
 await decisions.decide(actor,promote(first.id));expect((await review()).total).toBe(12);
 await expect(decisions.list(actor,3,{page:0,search:""})).rejects.toThrow("INVALID_REQUEST");
});
test("new acquisition tables enforce ciphertext, workspace foreign keys and public permission denials",async()=>{
 const {f,actor,decisions,capture,promote}=await setup();const candidate=await capture(),command=promote(candidate.id);
 const other=await fixture();fixtures.push(other);
 await expect(f.pool.query(`INSERT INTO ls_contact_ops.lead_promotion_operations(workspace_id,operation_id,candidate_id,actor_account_id,
  authority_epoch,payload_digest,state,person_id,result_ciphertext) VALUES($1,$2,$3,$4,3,$5,'NOT_A_LEAD',NULL,'synthetic')`,
  [f.workspaceId,randomUUID(),candidate.id,other.practitioner.actor.id,"a".repeat(64)])).rejects.toMatchObject({code:"23503"});
 await decisions.decide(actor,command);
 await expect(f.pool.query("UPDATE ls_contact_ops.acquisition_projection_status SET state='applied' WHERE workspace_id=$1",[f.workspaceId])).rejects.toMatchObject({code:"23514"});
 const role="synthetic_acquisition_denied_"+randomUUID().replaceAll("-","");await f.pool.query(`CREATE ROLE ${role} NOLOGIN`);
 try{await f.pool.query(`GRANT USAGE ON SCHEMA ls_contact_ops TO ${role}`);const client=await f.pool.connect();
  try{await client.query(`SET ROLE ${role}`);for(const table of ["inbound_activity_candidates","lead_promotion_operations","acquisition_projection_status"])
   await expect(client.query(`SELECT * FROM ls_contact_ops.${table}`)).rejects.toMatchObject({code:"42501"});}
  finally{await client.query("RESET ROLE");client.release();}}
 finally{await f.pool.query(`REVOKE USAGE ON SCHEMA ls_contact_ops FROM ${role}`);await f.pool.query(`DROP ROLE ${role}`);}
});
