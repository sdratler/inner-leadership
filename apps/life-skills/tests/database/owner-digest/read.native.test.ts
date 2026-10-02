import {beforeAll,afterAll,expect,test,vi} from "vitest";
import {randomBytes,randomUUID,createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {InternalTaskService} from "../../../src/features/calendar/tasks.ts";
import {readTaskCounts,readIntakeFacts} from "../../../src/features/owner-digest/runtime.ts";
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
 const row={leadId:lead,stage:"Prospect",outcome:"",paymentStatus:"Paid claim only",bookingStatus:"Confirmed claim only"} as Prospect;
 const result=await readIntakeFacts(store(),f.practitioner.actor,[row],now);expect(result.awaitingForm).toBe(1);expect(result.journeys.size).toBe(0);
 expect((await readIntakeFacts(store(),f.practitioner.actor,[{...row,stage:"Archived"}],now)).awaitingForm).toBe(0);
 await f.pool.query("UPDATE ls_intake.pre_enrollment_invitations SET revoked_at=$3 WHERE workspace_id=$1 AND invitation_id=$2",[f.workspaceId,invite,now]);expect((await readIntakeFacts(store(),f.practitioner.actor,[row],now)).awaitingForm).toBe(0);
});
test("normal native roles, changed role and revoked session cannot read owner aggregates",async()=>{
 for(const role of ["parent","child","adult_client"] as const){await f.pool.query("UPDATE ls_identity.accounts SET role=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.parent.actor.id,role]);await expect(readTaskCounts(store(),f.parent.actor,now)).rejects.toMatchObject({code:"FORBIDDEN"});}
 await f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);await expect(readTaskCounts(store(),f.practitioner.actor,now)).rejects.toMatchObject({code:"FORBIDDEN"});
 await f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.practitioner.actor.sessionDigest]);await expect(readTaskCounts(store(),f.practitioner.actor,now)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 await expect(readIntakeFacts(store(),f.practitioner.actor,[],now)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
