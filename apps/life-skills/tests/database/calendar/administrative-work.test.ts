import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {fixture,type Fixture} from './fixture.ts';
import {InternalTaskService} from '../../../src/features/calendar/tasks.ts';
import {contentWorkSources} from '../../../src/features/calendar/content-work-tasks.ts';
import {contentPublication,contentSnapshot} from '../../unit/calendar/content-fixture.ts';
import {civilDate,dayStart,shiftDay} from '../../../src/features/calendar/time.ts';
const opened:Fixture[]=[];afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.pool.end()));});
async function setup(demo=false){
 const f=await fixture({demoFirst:demo});opened.push(f);const tasks=new InternalTaskService(f.db,randomBytes(32)),lead='LS-LEAD-SYNTHETIC-'+randomUUID();
 const today=civilDate(new Date().toISOString()),from=dayStart(shiftDay(today,-10)),to=dayStart(shiftDay(today,50));
 const row={leadId:lead,name:'DEMO — synthetic intake only',caseId:f.first.id,dueDate:'',nextAction:'',stage:'Prospect',outcome:''};
 const list=()=>tasks.list(f.practitioner.actor,from,to,null);
 const sync=(rows=[row])=>tasks.syncCrmFollowups(f.practitioner.actor,rows);
 const effects=async()=>(await f.pool.query(`SELECT (SELECT count(*) FROM ls_onboarding.provider_receipts WHERE workspace_id=$1)::int AS receipts,(SELECT count(*) FROM ls_onboarding.payment_allocations WHERE workspace_id=$1)::int AS allocations,(SELECT count(*) FROM ls_calendar.events WHERE workspace_id=$1)::int AS events`,[f.workspaceId])).rows[0];
 async function intake(){
  const invitation=randomUUID(),receipt=randomUUID(),order='synthetic-task-order-'+randomUUID();
  await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id) VALUES($1,$2,$3,$4,'["synthetic-slot"]',clock_timestamp()+interval '1 day',clock_timestamp(),$5)`,[f.workspaceId,invitation,createHash('sha256').update(invitation).digest('hex'),lead,f.practitioner.actor.id]);
  await f.pool.query(`INSERT INTO ls_intake.pre_enrollment_receipts(workspace_id,receipt_id,invitation_id,idempotency_key,payload_ciphertext,payload_digest,consent_version,consent_hash,received_at) VALUES($1,$2,$3,$4,'SYNTHETIC_PRIVATE_INTAKE_NEVER_READ',$5,'synthetic-consent',$5,clock_timestamp())`,[f.workspaceId,receipt,invitation,randomUUID(),'a'.repeat(64)]);
  await f.pool.query(`INSERT INTO ls_onboarding.prospect_journeys(workspace_id,stable_lead_ref,intake_receipt_id,state,created_at,updated_at) VALUES($1,$2,$3,'awaiting_payment',clock_timestamp(),clock_timestamp())`,[f.workspaceId,lead,receipt]);
  const child=(await f.pool.query(`SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2`,[f.workspaceId,f.first.id])).rows[0].person_id;
  await f.pool.query(`INSERT INTO ls_onboarding.first_session_orders(workspace_id,order_id,case_id,child_id,amount_minor,currency,purpose) VALUES($1,$2,$3,$4,55000,'ILS','first_session')`,[f.workspaceId,order,f.first.id,child]);
  await f.pool.query('UPDATE ls_onboarding.prospect_journeys SET first_session_order_id=$3 WHERE workspace_id=$1 AND stable_lead_ref=$2',[f.workspaceId,lead,order]);
  return{receipt,order,child};
 }
 return{f,tasks,lead,today,row,list,sync,effects,intake};
}
test('only native intake/payment/booking facts create and resolve stable encrypted internal work, without second acceptance or source effects',async()=>{
 const h=await setup();expect(await h.sync()).toEqual({created:0,updated:0,resolved:0,unchanged:1});
 const s=await h.intake(),before=await h.effects();expect(await h.sync()).toMatchObject({created:1});const intake=(await h.list()).find(row=>row.sourceKind==='intake_followup')!;
 expect(intake).toMatchObject({caseId:h.f.first.id,dueDate:h.today,dueTime:null,state:'open',note:null});expect(intake.sourcePath).toContain('leadId='+h.lead);
 expect(JSON.stringify(await h.list())).not.toContain('SYNTHETIC_PRIVATE_INTAKE_NEVER_READ');expect(await h.effects()).toEqual(before);
 expect(await h.sync()).toMatchObject({created:0,updated:0,resolved:0});
 // A string/flag cannot turn a genuine submitted intake into verified payment.
 await h.f.pool.query("UPDATE ls_onboarding.prospect_journeys SET state='active' WHERE workspace_id=$1 AND stable_lead_ref=$2",[h.f.workspaceId,h.lead]);
 expect(await h.sync([{...h.row,paymentStatus:'Paid',bookingStatus:'Confirmed',formSubmitted:'yes'} as typeof h.row])).toMatchObject({created:0,updated:0,resolved:0});
 expect((await h.list()).find(row=>row.sourceKind==='booking_followup')).toBeUndefined();
 const transaction='synthetic-transaction-'+randomUUID();await h.f.pool.query(`INSERT INTO ls_onboarding.payment_allocations(workspace_id,provider_account_id,transaction_id,order_id,child_id,amount_minor) VALUES($1,'synthetic-provider',$2,$3,$4,55000)`,[h.f.workspaceId,transaction,s.order,s.child]);
 expect(await h.sync()).toMatchObject({created:1,resolved:1});const booking=(await h.list()).find(row=>row.sourceKind==='booking_followup')!;expect(booking).toMatchObject({state:'open',dueTime:null,note:null});
 await h.tasks.manage(h.f.practitioner.actor,booking.id,randomUUID(),{expectedVersion:1,state:'in_progress',snoozedUntil:shiftDay(h.today,2)});
 expect(await h.sync()).toMatchObject({created:0,updated:0,resolved:0});expect(await h.tasks.get(h.f.practitioner.actor,booking.id)).toMatchObject({state:'in_progress',version:2});
 const appointment=await h.f.seed(h.f.at(36));await h.f.pool.query('UPDATE ls_onboarding.prospect_journeys SET confirmed_appointment_id=$3 WHERE workspace_id=$1 AND stable_lead_ref=$2',[h.f.workspaceId,h.lead,appointment]);
 const afterBooking=await h.effects();expect(await h.sync()).toMatchObject({created:0,resolved:1});expect(await h.tasks.get(h.f.practitioner.actor,booking.id)).toMatchObject({state:'done',snoozedUntil:null,version:3});expect(await h.effects()).toEqual(afterBooking);
 expect(await h.sync()).toMatchObject({created:0,updated:0,resolved:0});expect((await h.list()).map(row=>row.id).sort()).toEqual([intake.id,booking.id].sort());
 await expect(h.f.pool.query('DELETE FROM ls_calendar.task_history WHERE workspace_id=$1',[h.f.workspaceId])).rejects.toMatchObject({code:'23514'});
});
test('wrong-family booking cannot resolve paid work; actual reversal/suppression uses the same tasks without sends or invented money',async()=>{
 const h=await setup(),s=await h.intake(),transaction='synthetic-payment-'+randomUUID();await h.f.pool.query(`INSERT INTO ls_onboarding.payment_allocations(workspace_id,provider_account_id,transaction_id,order_id,child_id,amount_minor) VALUES($1,'synthetic-provider',$2,$3,$4,55000)`,[h.f.workspaceId,transaction,s.order,s.child]);
 const wrong=await h.f.service.create(h.f.practitioner.actor,randomUUID(),{caseId:h.f.second.id,audienceId:h.f.second.audienceId,kind:'individual',startsAt:h.f.at(24),parentForId:null,parentIds:[],bufferBefore:0,bufferAfter:0,location:'Synthetic',checkinExceptionReason:null});
 await h.f.pool.query('UPDATE ls_onboarding.prospect_journeys SET confirmed_appointment_id=$3 WHERE workspace_id=$1 AND stable_lead_ref=$2',[h.f.workspaceId,h.lead,wrong.id]);
 await h.sync();const [booking]=await h.list();expect(booking?.sourceKind).toBe('booking_followup');
 await h.f.pool.query(`INSERT INTO ls_onboarding.payment_reversals(workspace_id,provider_account_id,transaction_id) VALUES($1,'synthetic-provider',$2)`,[h.f.workspaceId,transaction]);
 const before=await h.effects();expect(await h.sync()).toMatchObject({created:1,resolved:1});expect(await h.tasks.get(h.f.practitioner.actor,booking!.id)).toMatchObject({state:'done'});expect(await h.effects()).toEqual(before);
 expect(await h.sync([{...h.row,outcome:'opt-out'}])).toMatchObject({resolved:1});expect((await h.list()).every(row=>row.state==='done')).toBe(true);
});
test('task completion never confirms booking; missing authority rows and source-read failures retain work',async()=>{
 const h=await setup();await h.intake();await h.sync();const [task]=await h.list();await h.tasks.complete(h.f.practitioner.actor,task!.id,randomUUID(),1);
 expect((await h.f.pool.query('SELECT state,confirmed_appointment_id FROM ls_onboarding.prospect_journeys WHERE workspace_id=$1',[h.f.workspaceId])).rows[0]).toEqual({state:'awaiting_payment',confirmed_appointment_id:null});
 const saved=await h.list();expect(await h.sync([])).toEqual({created:0,updated:0,resolved:0,unchanged:0});expect(await h.list()).toEqual(saved);
 await h.f.pool.query('ALTER TABLE ls_intake.pre_enrollment_receipts RENAME COLUMN received_at TO synthetic_unavailable_received_at');
 try{await expect(h.sync()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await h.list()).toEqual(saved);}finally{await h.f.pool.query('ALTER TABLE ls_intake.pre_enrollment_receipts RENAME COLUMN synthetic_unavailable_received_at TO received_at');}
});
test('actual DEMO case provenance prevents administrative source tasks from crossing into live work; customers denied',async()=>{
 const h=await setup(true);await h.intake();expect(await h.sync()).toMatchObject({created:0});expect(await h.list()).toEqual([]);
 await h.f.pool.query('UPDATE ls_onboarding.prospect_journeys SET first_session_order_id=NULL WHERE workspace_id=$1',[h.f.workspaceId]);
 expect(await h.sync()).toMatchObject({created:0});expect(await h.list()).toEqual([]);
 for(const actor of [h.f.parent.actor,h.f.outsider.actor])await expect(h.tasks.syncCrmFollowups(actor,[h.row])).rejects.toMatchObject({code:'FORBIDDEN'});
});
test('handover cannot unlink, read or modify another practitioner case; conflicting CRM/native case bindings are preserved',async()=>{
 const h=await setup();await h.intake();await h.sync();const [saved]=await h.list();
 expect(await h.sync([{...h.row,caseId:h.f.second.id}])).toMatchObject({created:0,updated:0,resolved:0});expect(await h.tasks.get(h.f.practitioner.actor,saved!.id)).toEqual(saved);
 await h.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[h.f.workspaceId,h.f.practitioner.actor.id]);
 await h.f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE workspace_id=$1 AND id=$2",[h.f.workspaceId,h.f.outsider.actor.id]);
 await h.tasks.syncCrmFollowups(h.f.outsider.actor,[h.row]);expect(await h.tasks.list(h.f.outsider.actor,dayStart(shiftDay(h.today,-1)),dayStart(shiftDay(h.today,2)),null)).toEqual([]);
 await expect(h.tasks.get(h.f.outsider.actor,saved!.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await h.f.pool.query('SELECT case_id,state,version FROM ls_calendar.tasks WHERE workspace_id=$1',[h.f.workspaceId])).rows[0]).toEqual({case_id:h.f.first.id,state:'open',version:1});
});
test('history-write failure rolls back CRM and administrative source work together; bounded/strict source failures never partially save',async()=>{
 const h=await setup();await h.intake();await h.sync();const saved=await h.list();
 await h.f.pool.query(`CREATE FUNCTION ls_calendar.synthetic_task_history_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic history failure'; END$$`);
 await h.f.pool.query('CREATE TRIGGER synthetic_task_history_failure BEFORE INSERT ON ls_calendar.task_history FOR EACH ROW EXECUTE FUNCTION ls_calendar.synthetic_task_history_failure()');
 try{await expect(h.sync([{...h.row,name:'DEMO changed identity',nextAction:'Review submitted intake',dueDate:h.today}])).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await h.list()).toEqual(saved);}
 finally{await h.f.pool.query('DROP TRIGGER synthetic_task_history_failure ON ls_calendar.task_history');await h.f.pool.query('DROP FUNCTION ls_calendar.synthetic_task_history_failure()');}
 const source=contentWorkSources(contentSnapshot([contentPublication({state:'failed'})])).find(row=>row.kind==='publishing_failure')!;
 for(const rows of [[source,source],[{...source,dueDate:'2026-02-30'}],[{...source,sourcePath:'https://unsafe.invalid'}],[{...source,kind:'intake_followup'}],[{...source,caseId:h.f.first.id}]])await expect(h.tasks.syncContentWork(h.f.practitioner.actor,rows as typeof source[])).rejects.toMatchObject({code:rows[0]?.kind==='intake_followup'||rows[0]?.caseId?'INVALID_REQUEST':'UNAVAILABLE'});
 expect(await h.list()).toEqual(saved);
});
test('current registered approval/failure records use the same durable tasks; missing/scheduled/accepted records cannot silently resolve saved work',async()=>{
 const h=await setup(),snapshot=contentSnapshot([contentPublication({state:'failed',errorCode:'SYNTHETIC_FAILURE'})]);snapshot.creatives=[{...snapshot.creatives[0]!,review:'in_review',approvedDigest:null}];
 const sync=()=>h.tasks.syncContentWork(h.f.practitioner.actor,contentWorkSources(snapshot)),before=await h.effects();
 expect(await sync()).toEqual({created:2,updated:0,resolved:0,unchanged:0});const first=await h.list();expect(first.every(row=>row.caseId===null&&row.dueDate===h.today&&row.dueTime===null)).toBe(true);
 expect(await sync()).toEqual({created:0,updated:0,resolved:0,unchanged:2});
 const approval=first.find(row=>row.sourceKind==='creative_approval')!;await h.tasks.complete(h.f.practitioner.actor,approval.id,randomUUID(),1);expect(snapshot.creatives[0]?.review).toBe('in_review');
 const failure=first.find(row=>row.sourceKind==='publishing_failure')!;await h.tasks.manage(h.f.practitioner.actor,failure.id,randomUUID(),{expectedVersion:1,state:'in_progress',snoozedUntil:shiftDay(h.today,2)});
 snapshot.creatives=[];snapshot.publications=[];expect(await sync()).toEqual({created:0,updated:0,resolved:0,unchanged:0});expect(await h.tasks.get(h.f.practitioner.actor,failure.id)).toMatchObject({state:'in_progress',version:2});
 snapshot.creatives=contentSnapshot().creatives;snapshot.publications=[contentPublication({state:'sending',providerReceiptId:'DEMO-accepted',providerReadAt:'2026-10-05T19:00:00Z',receiptKind:'schedule'})];
 expect(await sync()).toMatchObject({resolved:1});expect(await h.tasks.get(h.f.practitioner.actor,failure.id)).toMatchObject({state:'in_progress',version:2});
 snapshot.publications=[contentPublication({state:'published',providerReceiptId:'DEMO-verified',providerReadAt:'2026-10-05T19:00:00Z',receiptKind:'publication',confirmedAt:'2026-10-05T17:01:00Z'})];
 expect(await sync()).toMatchObject({resolved:1});expect(await h.tasks.get(h.f.practitioner.actor,failure.id)).toMatchObject({state:'done',snoozedUntil:null,version:3});expect(await h.effects()).toEqual(before);
 const raw=(await h.f.pool.query('SELECT title_ciphertext,source_path_ciphertext FROM ls_calendar.tasks WHERE workspace_id=$1',[h.f.workspaceId])).rows;expect(JSON.stringify(raw)).not.toContain('Review artwork');
 await expect(h.tasks.syncContentWork(h.f.parent.actor,contentWorkSources(snapshot))).rejects.toMatchObject({code:'FORBIDDEN'});
});
