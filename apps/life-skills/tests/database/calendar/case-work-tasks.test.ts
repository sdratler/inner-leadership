/** Real PostgreSQL, production SQL binder and retained domain services. These
 * fixture sessions are authorization evidence, not ordinary-browser login. */
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {fixture,poolStore,type Fixture} from './fixture.ts';
import {CalendarStore} from '../../../src/features/calendar/store.ts';
import {InternalTaskService} from '../../../src/features/calendar/tasks.ts';
import {civilDate,dayStart,shiftDay} from '../../../src/features/calendar/time.ts';
import {FormsService} from '../../../src/features/forms/service.ts';
import {ProgressService} from '../../../src/features/progress/service.ts';
import {DatabaseAttendanceReader} from '../../../src/features/progress/sources.ts';
import {DatabaseParentReportReader} from '../../../src/features/updates/sources.ts';
import {HomePracticeService} from '../../../src/features/home-practice/service.ts';
import {UpdateService} from '../../../src/features/updates/service.ts';
import {SessionDatabaseService} from '../../../src/features/session-workflow/database.ts';
import {blankMetrics} from '../../../src/features/session-workflow/metrics.ts';
import {systemClock} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
import {caseTaskKinds} from '../../../src/features/calendar/case-work-copy.ts';

const opened:Fixture[]=[];
afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.pool.end()));});
const narrative={taughtAndPractised:['Synthetic practice'],parentReportedExamples:[],practitionerObservations:[],usefulChanges:[],continuingDifficulty:[],uncertainty:'Synthetic uncertainty',nextAdjustment:'Synthetic next step',informationLimits:'No parent source selected'};
async function setup(demo=false){
 const f=await fixture({demoFirst:demo});opened.push(f);const store=poolStore(f.pool);
 const config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
 const forms=new FormsService(store,config,systemClock),practice=new HomePracticeService(store,config,systemClock),updates=new UpdateService(store,config,systemClock,practice,practice);
 const progress=new ProgressService(store,config,systemClock,new DatabaseAttendanceReader(store),new DatabaseParentReportReader(store),practice),sessions=new SessionDatabaseService(store,f.keyring,systemClock);
 const tasks=new InternalTaskService(f.db,config.lookupKey),mode=demo?'demo' as const:'live' as const;
 const from=dayStart(shiftDay(civilDate(f.at(0)),-8)),to=dayStart(shiftDay(civilDate(f.at(0)),40));
 const list=()=>tasks.list(f.practitioner.actor,from,to,null,mode);
 const counters=async()=>(await f.pool.query(`SELECT
  (SELECT count(*) FROM ls_calendar.events WHERE workspace_id=$1)::integer AS events,
  (SELECT count(*) FROM ls_payments.credit_events WHERE workspace_id=$1)::integer AS payments`,[f.workspaceId])).rows[0];
 async function form(){
  const template=await forms.createTemplate(f.practitioner.actor,{key:'SYNTHETIC_TASK',version:1,locale:'en',targetRole:'parent',definition:{title:'Synthetic form',introduction:'Synthetic',fields:[{key:'note',kind:'short_text',label:'Note',required:true}]},provenance:'Synthetic local fixture',published:true},randomUUID());
  const assigned=await forms.assign(f.practitioner.actor,{caseId:f.first.id,templateId:template.templateId,assignedAccountId:f.parent.actor.id,dueDate:null,postSubmissionAudienceId:null},randomUUID());
  const submission=await forms.submit(f.parent.actor,{assignmentId:assigned.assignmentId,answers:{note:'Synthetic private answer never copied to tasks'},idempotencyKey:randomUUID()},randomUUID());
  return{assigned,submission};
 }
 async function sources(){
  const submitted=await form(),periodStart=shiftDay(civilDate(f.at(0)),-7),periodEnd=shiftDay(periodStart,28);
  const review=await progress.createReview(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,periodStart,periodEnd,assignmentVersionIds:[],parentReportIds:[],narrative},randomUUID());
  const version=await practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:'W01',templateVersion:'synthetic-v1',instructions:'Synthetic private instruction',startsOn:periodStart,endsOn:null},randomUUID());
  await practice.publish(f.practitioner.actor,version.assignmentId,version.versionId,randomUUID());
  const communication=await updates.submitParentReport(f.parent.actor,{caseId:f.first.id,audienceId:f.first.audienceId,practiceVersionId:version.versionId,body:'Synthetic confidential message never copied to task',idempotencyKey:randomUUID()},randomUUID());
  const pastStart=f.at(-72),past=await f.seed(pastStart);
  await f.service.recordAttendance(f.practitioner.actor,past,randomUUID(),{state:'present',arrivedAt:pastStart,expectedVersion:0,correctionReason:null});
  const session=await sessions.ensureForAppointment(f.practitioner.actor,f.first.id,past);
  const future=await f.seed(f.at(96));await f.service.receiveNotice(f.parent.actor,future,randomUUID(),{kind:'reschedule',proposedWindows:[]},new Date());
  return{submitted,review,communication,session,future};
 }
 return{f,store,config,forms,progress,updates,sessions,tasks,mode,from,to,list,form,sources,counters};
}

test('verified domain events create one encrypted all-day task per source and preserve replay/history without source effects',async()=>{
 const h=await setup(),s=await h.sources(),before=await h.counters();
 expect(await h.tasks.syncCaseWork(h.f.practitioner.actor)).toEqual({created:5,updated:0,resolved:0,unchanged:0});
 expect(await h.tasks.syncCaseWork(h.f.practitioner.actor)).toEqual({created:0,updated:0,resolved:0,unchanged:5});
 const rows=await h.list();expect(rows).toHaveLength(5);expect(new Set(rows.map(row=>row.sourceKind))).toEqual(new Set(caseTaskKinds));
 expect(rows.every(row=>row.caseId===h.f.first.id&&row.state==='open'&&row.dueTime===null&&row.note===null)).toBe(true);
 expect(rows.find(row=>row.sourceKind==='calendar_notice')?.sourcePath).toContain('date='+civilDate(h.f.at(96)));
 expect(rows.find(row=>row.sourceKind==='session_observations')?.sourcePath).toContain(`/cases/${h.f.first.id}/sessions/${s.session.sessionId}`);
 expect(JSON.stringify(rows)).not.toMatch(/confidential message|private answer|private instruction|uncertainty|values_ciphertext/);
 const raw=(await h.f.pool.query('SELECT title_ciphertext,source_path_ciphertext,source_digest,source_revision FROM ls_calendar.tasks WHERE workspace_id=$1',[h.f.workspaceId])).rows;
 expect(JSON.stringify(raw)).not.toContain('Review');expect(JSON.stringify(raw)).not.toContain(h.f.first.id);
 expect(raw.every((row:{source_digest:string;source_revision:string})=>/^[a-f0-9]{64}$/.test(row.source_digest)&&/^[a-f0-9]{64}$/.test(row.source_revision))).toBe(true);
 expect(await h.counters()).toEqual(before);
 const done=rows.find(row=>row.sourceKind==='form_review')!;await h.tasks.complete(h.f.practitioner.actor,done.id,randomUUID(),done.version);
 expect((await h.forms.listAssignments(h.f.practitioner.actor,h.f.first.id)).find(row=>row.id===s.submitted.assigned.assignmentId)?.state).toBe('submitted');
 expect(await h.tasks.syncCaseWork(h.f.practitioner.actor)).toEqual({created:0,updated:0,resolved:0,unchanged:5});
 expect((await h.list()).find(row=>row.id===done.id)?.state).toBe('done');expect(await h.counters()).toEqual(before);
});
test('actual source resolution updates existing tasks once with immutable history, without a new acceptance or invented action',async()=>{
 const h=await setup(),s=await h.sources();await h.tasks.syncCaseWork(h.f.practitioner.actor);const first=await h.list();
 await h.forms.markReviewed(h.f.practitioner.actor,s.submitted.submission.submissionId,randomUUID());
 await h.updates.review(h.f.practitioner.actor,s.communication.id,randomUUID());
 await h.progress.publishReview(h.f.practitioner.actor,s.review.reviewId,randomUUID(),1);
 const values=blankMetrics();for(const value of Object.values(values))value.notObservedReason='Synthetic not observed';
 await h.sessions.saveObservations(h.f.practitioner.actor,s.session.sessionId,values,0,randomUUID());
 const appointment=await h.f.service.get(h.f.practitioner.actor,s.future);await h.f.service.closeRequest(h.f.practitioner.actor,s.future,randomUUID(),appointment.version);
 const before=await h.counters();expect(await h.tasks.syncCaseWork(h.f.practitioner.actor)).toEqual({created:0,updated:0,resolved:5,unchanged:0});
 expect(await h.tasks.syncCaseWork(h.f.practitioner.actor)).toEqual({created:0,updated:0,resolved:0,unchanged:5});
 const rows=await h.list();expect(rows.map(row=>row.id).sort()).toEqual(first.map(row=>row.id).sort());expect(rows.every(row=>row.state==='done'&&row.version===2)).toBe(true);
 expect((await h.f.pool.query('SELECT action FROM ls_calendar.task_history WHERE workspace_id=$1 ORDER BY version,task_id',[h.f.workspaceId])).rows.map((row:{action:string})=>row.action)).toEqual([...Array(5).fill('created'),...Array(5).fill('source_resolved')]);
 await expect(h.f.pool.query("DELETE FROM ls_calendar.task_history WHERE workspace_id=$1",[h.f.workspaceId])).rejects.toMatchObject({code:'23514'});expect(await h.counters()).toEqual(before);
});
test('DEMO source tasks have immutable case/batch provenance and remain isolated from live lists and completion',async()=>{
 const h=await setup(true);await h.form();expect(await h.tasks.syncCaseWork(h.f.practitioner.actor,'live')).toEqual({created:0,updated:0,resolved:0,unchanged:0});
 expect(await h.tasks.syncCaseWork(h.f.practitioner.actor,'demo')).toEqual({created:1,updated:0,resolved:0,unchanged:0});const [task]=await h.list();
 expect(await h.tasks.list(h.f.practitioner.actor,h.from,h.to,null,'live')).toEqual([]);expect(task?.sourcePath).toContain('mode=demo');
 const markers=(await h.f.pool.query("SELECT case_id,batch_id,entity_key FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='task'",[h.f.workspaceId])).rows;
 expect(markers).toEqual([{case_id:h.f.first.id,batch_id:'ls-owner-20260925',entity_key:task!.id}]);
 await expect(h.tasks.complete(h.f.practitioner.actor,task!.id,randomUUID(),1,'live')).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(h.tasks.syncCaseWork(h.f.parent.actor,'demo')).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(h.tasks.syncCaseWork(h.f.outsider.actor)).rejects.toMatchObject({code:'FORBIDDEN'});
});
test('future/unattended sessions and incomplete submission flags cannot invent work or verified form submission',async()=>{
 const h=await setup(),future=await h.f.seed(h.f.at(48));await h.sessions.ensureForAppointment(h.f.practitioner.actor,h.f.first.id,future);
 expect(await h.tasks.syncCaseWork(h.f.practitioner.actor)).toEqual({created:0,updated:0,resolved:0,unchanged:1});expect(await h.list()).toEqual([]);
});
test('source-read failure and history-write failure roll back the whole reconciliation while retaining saved tasks',async()=>{
 const h=await setup();await h.form();await h.tasks.syncCaseWork(h.f.practitioner.actor);const before=await h.list();
 for(const boundary of ['WITH sources AS','INSERT INTO ls_calendar.task_history']){
  if(boundary.includes('history'))await h.f.pool.query("UPDATE ls_forms.form_assignments SET state='reviewed' WHERE workspace_id=$1",[h.f.workspaceId]);
  const failedStore={transaction:<T>(work:Parameters<typeof h.store.transaction<T>>[0])=>h.store.transaction(tx=>work({async query<R extends object>(sql:string,args:readonly unknown[]=[]){if(sql.includes(boundary))await tx.query('SELECT 1/0');return tx.query<R>(sql,args);}}))};
  const tasks=new InternalTaskService(new CalendarStore(failedStore,h.f.keyring,systemClock),h.config.lookupKey);
  await expect(tasks.syncCaseWork(h.f.practitioner.actor)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await h.list()).toEqual(before);
 }
});
test('source tuple rejects unknown kinds and partial/null digests; migration leaves existing task history intact',async()=>{
 const h=await setup();await h.form();await h.tasks.syncCaseWork(h.f.practitioner.actor);const [task]=await h.list(),digest=createHash('sha256').update('synthetic').digest('hex');
 for(const [kind,d,r] of [['unknown',digest,digest],['report_review',null,digest],[null,digest,null],['crm_followup',digest,null]]){
  await expect(h.f.pool.query('UPDATE ls_calendar.tasks SET source_kind=$3,source_digest=$4,source_revision=$5 WHERE workspace_id=$1 AND id=$2',[h.f.workspaceId,task!.id,kind,d,r])).rejects.toMatchObject({code:'23514'});
 }
 expect(await h.list()).toEqual([task]);
});
