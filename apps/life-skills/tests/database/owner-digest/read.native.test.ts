import {beforeAll,afterAll,expect,test,vi} from "vitest";
import {randomBytes,randomUUID,createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {InternalTaskService} from "../../../src/features/calendar/tasks.ts";
import {readTaskCounts,readIntakeFacts,loadOwnerDigest} from "../../../src/features/owner-digest/runtime.ts";
import {blindEmail} from "../../../src/features/identity/crypto.ts";
import {OWNER_REPORT_RECIPIENT} from "../../../src/features/owner-digest/email.ts";
import type {MarketingSnapshot} from "../../../src/features/marketing-overview/contracts.ts";
import {contentDayKey} from "../../../src/features/marketing-overview/calendar-model.ts";
import type {Prospect} from "../../../src/features/prospects/bridge.ts";
let f:Fixture;const now=new Date(),today=contentDayKey(now.toISOString()),store=()=>poolStore(f.pool);
beforeAll(async()=>{f=await fixture({demoFirst:true});});afterAll(async()=>{await f?.pool.end();});
test("native production binder counts encrypted internal tasks without double counting CRM or DEMO records",async()=>{
 const tasks=new InternalTaskService(f.db,randomBytes(32));
 const create=async(caseId:typeof f.first.id|null=null)=>tasks.create(f.practitioner.actor,randomUUID(),{caseId,title:"DEMO isolated private task title",note:"DEMO confidential narrative must not enter digest",sourcePath:null,dueDate:today,dueTime:null});
 const first=await create(),done=await create();await tasks.complete(f.practitioner.actor,done.id,randomUUID(),1);await create(f.first.id);
 const linked=await create();await f.pool.query("UPDATE ls_calendar.tasks SET source_kind='crm_followup',source_digest=$3,source_revision=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,linked.id,"a".repeat(64)]);
 const marked=await create();await f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id) VALUES($1,'ls-owner-20260925','task',$2,$3,$4)",[f.workspaceId,marked.id,"isolated-digest-task",f.first.id]);
 const observed=await readTaskCounts(store(),f.practitioner.actor,now);expect(observed).toEqual({due:1,overdue:0,future:0});expect(JSON.stringify(observed)).not.toMatch(/title|note|confidential/);
 const historyBefore=(await f.pool.query("SELECT COUNT(*)::int AS n FROM ls_calendar.task_history WHERE workspace_id=$1",[f.workspaceId])).rows[0].n;
 expect(await readTaskCounts(store(),f.practitioner.actor,now)).toEqual(observed);expect((await f.pool.query("SELECT COUNT(*)::int AS n FROM ls_calendar.task_history WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(historyBefore);
 expect((await f.pool.query("SELECT title_ciphertext FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2",[f.workspaceId,first.id])).rows[0].title_ciphertext).not.toContain("private task title");
});
test("intake counts use the existing invitation/receipt ledger, not imported sent/payment claims",async()=>{
 const lead="LS-LEAD-digest-"+randomUUID(),invite=randomUUID(),slot=randomUUID(),token=createHash("sha256").update(invite).digest("hex");
 await f.pool.query("INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)",[f.workspaceId,invite,token,lead,JSON.stringify([slot]),new Date(now.getTime()+86400000),now,f.practitioner.actor.id]);
 const row={leadId:lead,stage:"Prospect",outcome:"",nextAction:"",dueDate:"",paymentStatus:"Paid claim only",bookingStatus:"Confirmed claim only"} as Prospect;
 const result=await readIntakeFacts(store(),f.practitioner.actor,[row],now);expect(result.awaitingForm).toBe(1);expect(result.journeys.size).toBe(0);
 expect((await readIntakeFacts(store(),f.practitioner.actor,[{...row,stage:"Archived"}],now)).awaitingForm).toBe(0);
 for(const value of ['opt out','opted-out','OPT_OUT','do_not_contact','Do-Not-Contact','Closed','Not interested','No fit','CLOSED','Closed — older inquiry']){
  for(const suppressed of [{...row,stage:value},{...row,outcome:value}]){
   expect((await readIntakeFacts(store(),f.practitioner.actor,[suppressed],now)).awaitingForm,value).toBe(0);
  }
 }
 await f.pool.query("UPDATE ls_intake.pre_enrollment_invitations SET revoked_at=$3 WHERE workspace_id=$1 AND invitation_id=$2",[f.workspaceId,invite,now]);expect((await readIntakeFacts(store(),f.practitioner.actor,[row],now)).awaitingForm).toBe(0);
});
test("one canonical submission excludes other valid invitations across every later journey phase",async()=>{
 const lead='LS-LEAD-submitted-'+randomUUID(),invitations=[randomUUID(),randomUUID()],receipt=randomUUID();
 for(const invitation of invitations)await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id)
  VALUES($1,$2,$3,$4,'["synthetic-slot"]'::jsonb,clock_timestamp()+interval '1 day',clock_timestamp(),$5)`,[f.workspaceId,invitation,createHash('sha256').update(invitation).digest('hex'),lead,f.practitioner.actor.id]);
 await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_receipts(workspace_id,receipt_id,invitation_id,idempotency_key,payload_ciphertext,payload_digest,consent_version,consent_hash,received_at)
  VALUES($1,$2,$3,$4,'synthetic-unused-intake-ciphertext',$5,'synthetic-consent',$5,clock_timestamp())`,[f.workspaceId,receipt,invitations[0],randomUUID(),'a'.repeat(64)]);
 await f.pool.query(`INSERT INTO ls_onboarding.prospect_journeys(workspace_id,stable_lead_ref,intake_receipt_id,state,created_at,updated_at)
  VALUES($1,$2,$3,'intake_submitted',clock_timestamp(),clock_timestamp())`,[f.workspaceId,lead,receipt]);
 const row={leadId:lead,stage:'Prospect',outcome:'',nextAction:'',dueDate:''} as Prospect;
 for(const state of ['intake_submitted','awaiting_payment','payment_verified','awaiting_booking','active','hold']){
  await f.pool.query('UPDATE ls_onboarding.prospect_journeys SET state=$3 WHERE workspace_id=$1 AND stable_lead_ref=$2',[f.workspaceId,lead,state]);
  const facts=await readIntakeFacts(store(),f.practitioner.actor,[row],now);
  expect(facts.awaitingForm,state).toBe(0);expect(facts.journeys.get(lead)?.journeyState).toBe(state);
 }
 expect((await f.pool.query('SELECT consumed_at,revoked_at FROM ls_intake.pre_enrollment_invitations WHERE workspace_id=$1 AND invitation_id=$2',[f.workspaceId,invitations[1]])).rows[0]).toEqual({consumed_at:null,revoked_at:null});
});
test('pending forms include other practitioners only within the same workspace and valid invitation lifecycle',async()=>{
 const other=await fixture(),lead='LS-LEAD-handover-'+randomUUID(),row={leadId:lead,stage:'Prospect',outcome:'',nextAction:'',dueDate:''} as Prospect;
 try{
  await f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.outsider.actor.id]);
  const insert=async(workspace:string,creator:string,expired=false,revoked=false)=>{
   const id=randomUUID();await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id,revoked_at)
    VALUES($1,$2,$3,$4,'["synthetic-slot"]'::jsonb,$5,clock_timestamp(),$6,$7)`,[workspace,id,createHash('sha256').update(id).digest('hex'),lead,new Date(now.getTime()+(expired?-86400000:86400000)),creator,revoked?now:null]);return id;
  };
  await insert(other.workspaceId,other.practitioner.actor.id);
  expect((await readIntakeFacts(store(),f.practitioner.actor,[row],now)).awaitingForm).toBe(0);
  await insert(f.workspaceId,f.outsider.actor.id,true);await insert(f.workspaceId,f.outsider.actor.id,false,true);
  expect((await readIntakeFacts(store(),f.practitioner.actor,[row],now)).awaitingForm).toBe(0);
  const valid=await insert(f.workspaceId,f.outsider.actor.id);
  expect((await readIntakeFacts(store(),f.practitioner.actor,[row],now)).awaitingForm).toBe(1);
  await f.pool.query('UPDATE ls_intake.pre_enrollment_invitations SET consumed_at=$3 WHERE workspace_id=$1 AND invitation_id=$2',[f.workspaceId,valid,now]);
  expect((await readIntakeFacts(store(),f.practitioner.actor,[row],now)).awaitingForm).toBe(0);
 }finally{
  await f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.outsider.actor.id]);await other.pool.end();
 }
});
test('actual native owner account binding excludes other practitioners and unverified owners',async()=>{
 const lookupKey=randomBytes(32),runtime={store:store(),clock:{now:()=>now},config:{workspaceId:f.workspaceId,lookupKey}} as Parameters<typeof loadOwnerDigest>[1];
 const marketing:MarketingSnapshot={source:'synthetic',fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
 await f.pool.query('UPDATE ls_identity.accounts SET email_blind=$3 WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.practitioner.actor.id,blindEmail(OWNER_REPORT_RECIPIENT,lookupKey)]);
 await f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.outsider.actor.id]);
 try{
  await expect(loadOwnerDigest(f.outsider.actor,runtime,marketing,'en')).rejects.toMatchObject({code:'FORBIDDEN'});
  const digest=await loadOwnerDigest(f.practitioner.actor,runtime,marketing,'en');expect(digest.reportDate).toBe(today);
  await f.pool.query('UPDATE ls_identity.accounts SET email_verified_at=NULL WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.practitioner.actor.id]);
  await expect(loadOwnerDigest(f.practitioner.actor,runtime,marketing,'en')).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{
  await f.pool.query('UPDATE ls_identity.accounts SET email_verified_at=$3 WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.practitioner.actor.id,now]);
  await f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.outsider.actor.id]);
 }
});
test("normal native roles, changed role and revoked session cannot read owner aggregates",async()=>{
 for(const role of ["parent","child","adult_client"] as const){await f.pool.query("UPDATE ls_identity.accounts SET role=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.parent.actor.id,role]);await expect(readTaskCounts(store(),f.parent.actor,now)).rejects.toMatchObject({code:"FORBIDDEN"});}
 await f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);await expect(readTaskCounts(store(),f.practitioner.actor,now)).rejects.toMatchObject({code:"FORBIDDEN"});
 await f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);await expect(readTaskCounts(store(),f.practitioner.actor,now)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 await expect(readIntakeFacts(store(),f.practitioner.actor,[],now)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
