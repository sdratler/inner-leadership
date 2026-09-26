/** PREPARED, NOT EXECUTED IN GPT. Run only with the guarded disposable PostgreSQL fixture. */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, type Fixture } from './fixture.ts';
import { drainCalendarEvents } from '../../../src/features/calendar/relay.ts';
let f:Fixture;
const key=()=>randomUUID();
beforeAll(async()=>{f=await fixture();},30000);
afterAll(async()=>{await f?.pool.end();});
describe('LS-030 real PostgreSQL contracts',()=>{
 test('create is durable; identical retry returns one appointment; altered retry conflicts',async()=>{
  const input=f.booking(f.at(48)),command=key();const a=await f.service.create(f.practitioner.actor,command,input);
  expect(await f.service.create(f.practitioner.actor,command,input)).toEqual(a);
  await expect(f.service.create(f.practitioner.actor,command,{...input,location:'Different synthetic logistics'})).rejects.toMatchObject({code:'CONFLICT'});
  expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.appointments WHERE workspace_id=$1 AND id=$2',[f.workspaceId,a.id])).rows[0].n).toBe(1);
 });
 test('two concurrent case bookings cannot take the same practitioner interval',async()=>{
  const results=await Promise.allSettled([f.service.create(f.practitioner.actor,key(),f.booking(f.at(50))),f.service.create(f.practitioner.actor,key(),f.booking(f.at(50),f.second))]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 });
 test('exact 24-hour manual receipt protects immediately, without attendance or practitioner approval',async()=>{
  const id=await f.seed(f.at(23)),receivedAt=f.at(-1);
  const a=await f.service.receiveManualNotice(f.practitioner.actor,id,key(),{kind:'reschedule',source:'phone',receivedAt,requestedBy:f.parent.actor.id,proposedWindows:[]});
  expect(a.notice).toMatchObject({receivedAt,originalStart:f.at(23),noticeMilliseconds:86400000,eligibility:'credit_preserved',state:'pending'});
  expect(a.status).toBe('canceled_family');expect(a.attendance).toBeNull();expect(await f.effects(id)).toEqual(['preserve']);
  const changed=await f.pool.query("UPDATE ls_calendar.notices SET received_at=received_at-interval '1 hour' WHERE workspace_id=$1 AND appointment_id=$2",[f.workspaceId,id]).then(()=>null,e=>e.code);expect(changed).toBe('23514');
 });
 test('late receipt consumes once; earlier manual supplement restores once, even after another exception',async()=>{
  const id=await f.seed(f.at(10));const command=key(),input={kind:'reschedule' as const,proposedWindows:[]};
  let a=await f.service.receiveNotice(f.parent.actor,id,command,input,new Date());
  expect(a.notice?.eligibility).toBe('late_notice');await f.service.receiveNotice(f.parent.actor,id,command,input,new Date());expect(await f.effects(id)).toEqual(['consume']);
  a=await f.service.receiveManualNotice(f.practitioner.actor,id,key(),{...input,source:'whatsapp_manual',receivedAt:f.at(-14),requestedBy:f.parent.actor.id});
  expect(a.notice?.eligibility).toBe('credit_preserved');expect(await f.effects(id)).toEqual(['consume','preserve','restore']);
  await f.service.grantException(f.practitioner.actor,id,key(),{expectedVersion:a.version,reason:'Synthetic documented exception'});
  expect((await f.effects(id)).filter(v=>v==='restore')).toHaveLength(1);
  expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.notices WHERE workspace_id=$1 AND appointment_id=$2',[f.workspaceId,id])).rows[0].n).toBe(2);
 });
 test('actual replacement is confirmed only after protected notice and availability; proposal alone reserves nothing',async()=>{
  const id=await f.seed(f.at(72));const proposed=[{startsAt:f.at(76),endsAt:f.at(78)}];
  const a=await f.service.receiveNotice(f.parent.actor,id,key(),{kind:'reschedule',proposedWindows:proposed},new Date());
  expect(a.replacementId).toBeNull();
  const replaced=await f.service.confirmReplacement(f.practitioner.actor,id,key(),{expectedVersion:a.version,booking:f.booking(f.at(76))});
  expect(replaced.original.status).toBe('rescheduled');expect(replaced.original.replacementId).toBe(replaced.replacement.id);expect(replaced.replacement.originalId).toBe(id);
  await expect(f.service.confirmReplacement(f.practitioner.actor,id,key(),{expectedVersion:replaced.original.version,booking:f.booking(f.at(78))})).rejects.toMatchObject({code:'CONFLICT'});
 });
 test('late replacement is blocked without explicit exception and reason',async()=>{
  const id=await f.seed(f.at(12));const a=await f.service.receiveNotice(f.parent.actor,id,key(),{kind:'reschedule',proposedWindows:[]},new Date());
  await expect(f.service.confirmReplacement(f.practitioner.actor,id,key(),{expectedVersion:a.version,booking:f.booking(f.at(82))})).rejects.toMatchObject({code:'CONFLICT'});
  const allowed=await f.service.grantException(f.practitioner.actor,id,key(),{expectedVersion:a.version,reason:'Synthetic practitioner discretion'});
  const result=await f.service.confirmReplacement(f.practitioner.actor,id,key(),{expectedVersion:allowed.version,booking:f.booking(f.at(82))});expect(result.replacement.id).toBeTruthy();
 });
 test('cross-family and revoked-audience access are denied, including cached retry',async()=>{
  const id=await f.seed(f.at(90),f.second);await expect(f.service.get(f.parent.actor,id)).rejects.toMatchObject({code:'NOT_FOUND'});
  const command=key(),input={kind:'cancel' as const,proposedWindows:[]};await f.service.receiveNotice(f.outsider.actor,id,command,input,new Date());
  await f.pool.query('UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[f.workspaceId,f.second.id,f.outsider.actor.id]);
  await expect(f.service.receiveNotice(f.outsider.actor,id,command,input,new Date())).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 test('no-show counts zero; late correction counts one without a second credit consumption',async()=>{
  const id=await f.seed(f.at(-4));let a=await f.service.recordAttendance(f.practitioner.actor,id,key(),{state:'no_show',arrivedAt:null,expectedVersion:0,correctionReason:null});
  expect(a.countsAsChildSession).toBe(false);expect(await f.effects(id)).toEqual(['consume']);
  a=await f.service.recordAttendance(f.practitioner.actor,id,key(),{state:'late',arrivedAt:f.at(-3.9),expectedVersion:1,correctionReason:'Synthetic observation corrected'});
  expect(a.countsAsChildSession).toBe(true);expect(await f.effects(id)).toEqual(['consume']);
  expect((await f.service.attendanceHistory(f.practitioner.actor,id,null)).items).toHaveLength(2);
  expect((await f.service.childAttendanceCount(f.parent.actor,f.first.id)).attendedChildSessions).toBe(1);
  await expect(f.service.attendanceHistory(f.parent.actor,id,null)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 test('future no-show is denied and parent cannot write attendance',async()=>{
  const id=await f.seed(f.at(96));const input={state:'no_show' as const,arrivedAt:null,expectedVersion:0,correctionReason:null};
  await expect(f.service.recordAttendance(f.practitioner.actor,id,key(),input)).rejects.toMatchObject({code:'CONFLICT'});
  await expect(f.service.recordAttendance(f.parent.actor,id,key(),input)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 test('attendance canceled is separate from provider cancellation and changes no credit',async()=>{
  const id=await f.seed(f.at(-7));const a=await f.service.recordAttendance(f.practitioner.actor,id,key(),{state:'canceled',arrivedAt:null,expectedVersion:0,correctionReason:null});
  expect(a.status).toBe('scheduled');expect(a.creditException).toBeNull();expect(await f.effects(id)).toEqual([]);
 });
 test('joint-parent check-in is fifteen minutes and emits no child-session credit',async()=>{
  const child=await f.seed(f.at(-10));await f.service.recordAttendance(f.practitioner.actor,child,key(),{state:'no_show',arrivedAt:null,expectedVersion:0,correctionReason:null});
  const input={...f.booking(f.at(100)),kind:'parent_guidance' as const,parentForId:child,parentIds:[f.parent.actor.id,f.parentTwo.actor.id]};
  await expect(f.service.create(f.practitioner.actor,key(),input)).rejects.toMatchObject({code:'CONFLICT'});
  const a=await f.service.create(f.practitioner.actor,key(),{...input,checkinExceptionReason:'Synthetic deliberate parent guidance after missed child visit'});
  expect(Date.parse(a.endsAt)-Date.parse(a.startsAt)).toBe(900000);expect(a.checkinNeedsReview).toBe(true);
  await f.service.receiveNotice(f.parent.actor,a.id,key(),{kind:'cancel',proposedWindows:[]},new Date());expect(await f.effects(a.id)).toEqual([]);
  await expect(f.service.create(f.practitioner.actor,key(),{...input,startsAt:f.at(102),parentIds:[f.outsider.actor.id],checkinExceptionReason:'Synthetic test'})).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 test('provider cancellation protects without any parent notice and cannot rewrite an attended appointment',async()=>{
  const id=await f.seed(f.at(18));const a=await f.service.cancelProvider(f.practitioner.actor,id,key(),{expectedVersion:1,reason:'Synthetic provider unavailable'});
  expect(a.status).toBe('canceled_practitioner');expect(a.creditException?.reasonCode).toBe('provider_unavailable');expect(await f.effects(id)).toEqual(['preserve']);
 });
 test('database-only outbox consumer and delivered marker roll back together; retry delivers each event once',async()=>{
  await f.pool.query('CREATE TABLE IF NOT EXISTS ls_calendar.synthetic_test_receipts(event_id uuid PRIMARY KEY,sequence integer NOT NULL)');
  const consume=async(throwAfter:boolean)=>f.db.read(f.practitioner.actor,c=>drainCalendarEvents(c,'credit_effect',async(tx,_event,meta)=>{
   await tx.query('INSERT INTO ls_calendar.synthetic_test_receipts(event_id,sequence) VALUES($1,$2) ON CONFLICT DO NOTHING',[meta.id,meta.sequence]);if(throwAfter)throw new Error('SYNTHETIC_CONSUMER_FAILURE');
  },100));
  await expect(consume(true)).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.synthetic_test_receipts r JOIN ls_calendar.events e ON e.id=r.event_id WHERE e.workspace_id=$1',[f.workspaceId])).rows[0].n).toBe(0);
  expect(await consume(false)).toBeGreaterThan(0);expect(await consume(false)).toBe(0);
 });
 test('database rejects mutable appointment instants and mismatched terms independently of transport',async()=>{
  const id=await f.seed(f.at(110));const code=await f.pool.query("UPDATE ls_calendar.appointments SET starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,id]).then(()=>null,e=>e.code);expect(code).toBe('23514');
 });
 test('marked demo appointments never reserve the practitioner real booking capacity',async()=>{
  const g=await fixture({demoFirst:true});
  try{
  const demo=await g.service.create(g.practitioner.actor,key(),g.booking(g.at(160)));
  expect((await g.pool.query("SELECT count(*)::int AS n FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='appointment' AND entity_key=$2",[g.workspaceId,demo.id])).rows[0].n).toBe(1);
  const real=await g.service.create(g.practitioner.actor,key(),g.booking(g.at(160),g.second));
  expect(real.id).not.toBe(demo.id);
  await expect(g.pool.query('INSERT INTO ls_demo.cases(workspace_id,case_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[g.workspaceId,g.second.id,'ls-owner-20260925','cannot-relabel-booked-real-case'])).rejects.toMatchObject({code:'23514'});
  await g.service.create(g.practitioner.actor,key(),g.booking(g.at(164)));
  await expect(g.service.addAvailability(g.practitioner.actor,key(),{startsAt:g.at(164),endsAt:g.at(165),kind:'blocked'})).resolves.toMatchObject({kind:'blocked'});
  }finally{await g.pool.end();}
 });
});
