/** Disposable, already-migrated native PostgreSQL only; no provider adapters. */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { closeDatabase } from '../../../src/db/client.ts';
import { drizzleIdentityStore } from '../../../src/features/identity/drizzle-store.ts';
import { CalendarStore } from '../../../src/features/calendar/store.ts';
import { InternalTaskService } from '../../../src/features/calendar/tasks.ts';
import { civilDate, dayStart, shiftDay } from '../../../src/features/calendar/time.ts';
import { fixture, safeTestUrl, type Fixture } from './fixture.ts';
import { MAX_CALENDAR_TASKS, MAX_OPERATIONAL_PROSPECTS } from '../../../src/features/contact-ops/core/limits.ts';

let f:Fixture;
beforeAll(async()=>{f=await fixture();},30000);
afterAll(async()=>{await f?.pool.end();});
describe('internal task PostgreSQL contract',()=>{
 test('a practitioner handover never grants access to another case through task list, completion or replay',async()=>{
  const isolated=await fixture();
  try{
   const tasks=new InternalTaskService(isolated.db,Buffer.alloc(32,9)),dueDate=civilDate(isolated.at(48)),input={title:'Synthetic private case work',dueDate,dueTime:null,note:'Do not disclose outside the case',sourcePath:null,caseId:isolated.first.id};
   const restricted=await tasks.create(isolated.practitioner.actor,randomUUID(),input),allowed=await tasks.create(isolated.practitioner.actor,randomUUID(),{...input,caseId:isolated.second.id}),internal=await tasks.create(isolated.practitioner.actor,randomUUID(),{...input,caseId:null}),from=dayStart(dueDate),to=dayStart(shiftDay(dueDate,1));
   const crm={leadId:'LS-LEAD-HANDOVER',name:'Synthetic case-linked work',nextAction:'Review source',dueDate,caseId:isolated.first.id,stage:'New',outcome:''};
   await tasks.syncCrmFollowups(isolated.practitioner.actor,[crm]);
   const previous=(await tasks.list(isolated.practitioner.actor,from,to,null)).find(row=>row.sourceKind==='crm_followup')!;
   await isolated.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[isolated.workspaceId,isolated.practitioner.actor.id]);
   await isolated.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE workspace_id=$1 AND id=$2",[isolated.workspaceId,isolated.outsider.actor.id]);
   await isolated.pool.query('UPDATE ls_cases.cases SET practitioner_account_id=$3 WHERE workspace_id=$1 AND id=$2',[isolated.workspaceId,isolated.second.id,isolated.outsider.actor.id]);
   const incoming={...isolated.outsider.actor,role:'practitioner' as const};
   // Clearing, replacing or closing the current CRM link must not clear/take
   // over an existing task's now-inaccessible case or its revision history.
   for(const update of [{caseId:'',nextAction:'Updated source'},{caseId:isolated.second.id,nextAction:'Reassigned source'},{caseId:'',stage:'Archived'}]){
    expect(await tasks.syncCrmFollowups(incoming,[{...crm,...update}])).toEqual({created:0,updated:0,resolved:0,unchanged:1});
    expect((await isolated.pool.query('SELECT case_id,version,state FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[isolated.workspaceId,previous.id])).rows[0]).toEqual({case_id:isolated.first.id,version:1,state:'open'});
    await expect(tasks.get(incoming,previous.id)).rejects.toMatchObject({code:'NOT_FOUND'});
   }
   expect((await tasks.list(incoming,from,to,null)).map(row=>row.id).sort()).toEqual([allowed.id,internal.id].sort());
   await expect(tasks.list(incoming,from,to,isolated.first.id)).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(tasks.get(incoming,restricted.id)).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(tasks.manage(incoming,restricted.id,randomUUID(),{expectedVersion:1,state:'done',snoozedUntil:null})).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(tasks.complete(incoming,restricted.id,randomUUID(),1)).rejects.toMatchObject({code:'NOT_FOUND'});
   const key=randomUUID();await tasks.complete(incoming,allowed.id,key,1);
   await isolated.pool.query('UPDATE ls_cases.cases SET practitioner_account_id=$3 WHERE workspace_id=$1 AND id=$2',[isolated.workspaceId,isolated.second.id,isolated.practitioner.actor.id]);
   await expect(tasks.complete(incoming,allowed.id,key,1)).rejects.toMatchObject({code:'NOT_FOUND'});
   expect((await isolated.pool.query('SELECT state,version FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[isolated.workspaceId,restricted.id])).rows[0]).toEqual({state:'open',version:1});
   expect((await isolated.pool.query('SELECT action FROM ls_calendar.task_history WHERE workspace_id=$1 AND task_id=$2',[isolated.workspaceId,restricted.id])).rows).toEqual([{action:'created'}]);
  }finally{await isolated.pool.end();}
 });
 test('every existing opt-out/closed spelling suppresses or resolves work without rewriting source text',async()=>{
  const isolated=await fixture();
  try{
   const tasks=new InternalTaskService(isolated.db,Buffer.alloc(32,9)),dueDate=civilDate(isolated.at(48)),base={leadId:'LS-LEAD-SUPPRESSION',name:'Synthetic administrative contact',nextAction:'Call',dueDate,caseId:isolated.first.id,stage:'New',outcome:''};
   for(const [index,text] of ['opt out','opted-out','OPT_OUT','do_not_contact','Do-Not-Contact','Closed','Not interested','No fit'].entries()){
    const row={...base,leadId:base.leadId+'-'+index};await tasks.syncCrmFollowups(isolated.practitioner.actor,[row]);
    expect(await tasks.syncCrmFollowups(isolated.practitioner.actor,[{...row,outcome:text}])).toEqual({created:0,updated:0,resolved:1,unchanged:0});
    expect(await tasks.syncCrmFollowups(isolated.practitioner.actor,[{...row,outcome:text}])).toEqual({created:0,updated:0,resolved:0,unchanged:1});
    expect(await tasks.syncCrmFollowups(isolated.practitioner.actor,[{...row,leadId:row.leadId+'-new',stage:text}])).toEqual({created:0,updated:0,resolved:0,unchanged:1});
   }
   expect((await tasks.list(isolated.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),null)).every(row=>row.state==='done')).toBe(true);
   expect(base.stage).toBe('New');expect(base.outcome).toBe('');
   expect((await isolated.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[isolated.workspaceId])).rows[0].n).toBe(0);
  }finally{await isolated.pool.end();}
 });
 test('task workflow is reversible, versioned, partitioned and effect-free with source dates and immutable history retained',async()=>{
  const isolated=await fixture({demoFirst:true});
  try{
   const tasks=new InternalTaskService(isolated.db,Buffer.alloc(32,9)),dueDate=civilDate(isolated.at(48)),later=shiftDay(dueDate,2),input={title:'Synthetic workflow task',dueDate,dueTime:null,note:'Synthetic retained private note',sourcePath:'/en/app/clients?mode=demo',caseId:isolated.first.id,mode:'demo' as const};
   const original=await tasks.create(isolated.practitioner.actor,randomUUID(),input),key=randomUUID(),edit={expectedVersion:1,state:'in_progress' as const,snoozedUntil:later,mode:'demo' as const};
   const changed=await tasks.manage(isolated.practitioner.actor,original.id,key,edit);
   expect(changed).toMatchObject({title:input.title,dueDate,dueTime:null,note:input.note,sourcePath:input.sourcePath,caseId:input.caseId,state:'in_progress',snoozedUntil:later,version:2});
   expect(await tasks.manage(isolated.practitioner.actor,original.id,key,edit)).toEqual(changed);
   expect(await tasks.get(isolated.practitioner.actor,original.id,'demo')).toEqual(changed);
   expect(await tasks.list(isolated.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),null,'demo')).toEqual([]);
   expect(await tasks.list(isolated.practitioner.actor,dayStart(later),dayStart(shiftDay(later,1)),null,'demo')).toEqual([changed]);
   await expect(tasks.manage(isolated.parent.actor,original.id,randomUUID(),edit)).rejects.toMatchObject({code:'FORBIDDEN'});
   await expect(tasks.get(isolated.parent.actor,original.id,'demo')).rejects.toMatchObject({code:'FORBIDDEN'});
   await expect(tasks.manage(isolated.practitioner.actor,original.id,key,{...edit,mode:'live'})).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(tasks.get(isolated.practitioner.actor,original.id)).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(tasks.manage(isolated.practitioner.actor,original.id,randomUUID(),edit)).rejects.toMatchObject({code:'CONFLICT'});
   await expect(tasks.manage(isolated.practitioner.actor,original.id,key,{...edit,snoozedUntil:null})).rejects.toMatchObject({code:'CONFLICT'});
   await expect(tasks.manage(isolated.practitioner.actor,original.id,randomUUID(),{...edit,expectedVersion:2,snoozedUntil:'2000-01-01'})).rejects.toMatchObject({code:'INVALID_REQUEST'});
   const done=await tasks.complete(isolated.practitioner.actor,original.id,randomUUID(),2,'demo');expect(done).toMatchObject({state:'done',snoozedUntil:null,version:3,note:input.note,dueDate});
   const reopened=await tasks.manage(isolated.practitioner.actor,original.id,randomUUID(),{expectedVersion:3,state:'open',snoozedUntil:null,mode:'demo'});expect(reopened).toMatchObject({state:'open',version:4,dueDate,note:input.note});
   const history=(await isolated.pool.query('SELECT version,action,state_value,snoozed_until::text FROM ls_calendar.task_history WHERE workspace_id=$1 AND task_id=$2 ORDER BY version',[isolated.workspaceId,original.id])).rows;
   expect(history).toEqual([{version:1,action:'created',state_value:null,snoozed_until:null},{version:2,action:'managed',state_value:'in_progress',snoozed_until:later},{version:3,action:'completed',state_value:null,snoozed_until:null},{version:4,action:'managed',state_value:'open',snoozed_until:null}]);
   await expect(isolated.pool.query('UPDATE ls_calendar.task_history SET action=$3 WHERE workspace_id=$1 AND task_id=$2',[isolated.workspaceId,original.id,'created'])).rejects.toMatchObject({code:'23514'});
   expect((await isolated.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[isolated.workspaceId])).rows[0].n).toBe(0);
   expect((await isolated.pool.query('SELECT count(*)::int AS n FROM ls_payments.credit_events WHERE workspace_id=$1',[isolated.workspaceId])).rows[0].n).toBe(0);
   await isolated.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[isolated.workspaceId,isolated.practitioner.actor.id]);
   await expect(tasks.manage(isolated.practitioner.actor,original.id,key,edit)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
  }finally{await isolated.pool.end();}
 });
 test('source refresh preserves in-progress/snoozed work; actual source resolution clears snooze without provider effects',async()=>{
  const isolated=await fixture();
  try{
   const tasks=new InternalTaskService(isolated.db,Buffer.alloc(32,9)),dueDate=civilDate(isolated.at(72)),until=shiftDay(dueDate,2),row={leadId:'LS-LEAD-SYNTHETIC-WORKFLOW',name:'Synthetic source',nextAction:'Review',dueDate,caseId:isolated.first.id,stage:'New',outcome:''};
   await tasks.syncCrmFollowups(isolated.practitioner.actor,[row]);const first=(await tasks.list(isolated.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),null))[0]!;
   await tasks.manage(isolated.practitioner.actor,first.id,randomUUID(),{expectedVersion:1,state:'in_progress',snoozedUntil:until});
   await tasks.syncCrmFollowups(isolated.practitioner.actor,[{...row,nextAction:'Updated synthetic action'}]);
   expect(await tasks.get(isolated.practitioner.actor,first.id)).toMatchObject({state:'in_progress',snoozedUntil:until,dueDate,version:3});
   expect(await tasks.syncCrmFollowups(isolated.practitioner.actor,[])).toEqual({created:0,updated:0,resolved:0,unchanged:0});
   await tasks.syncCrmFollowups(isolated.practitioner.actor,[{...row,nextAction:'Updated synthetic action',stage:'Archived'}]);
   expect(await tasks.get(isolated.practitioner.actor,first.id)).toMatchObject({state:'done',snoozedUntil:null,dueDate,version:4});
   expect((await isolated.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[isolated.workspaceId])).rows[0].n).toBe(0);
  }finally{await isolated.pool.end();}
 });
 test('DEMO task writes require immutable case provenance; lists, completion and replay stay partitioned',async()=>{
  const isolated=await fixture({demoFirst:true});
  try{
   const tasks=new InternalTaskService(isolated.db,Buffer.alloc(32,9)),dueDate=civilDate(isolated.at(48)),from=dayStart(dueDate),to=dayStart(shiftDay(dueDate,1));
   const input={title:'DEMO — Synthetic isolated task',note:'DEMO — retained internal note',dueDate,dueTime:null,sourcePath:null,caseId:isolated.first.id,mode:'demo' as const};
   const key=randomUUID(),created=await tasks.create(isolated.practitioner.actor,key,input);
   expect(await tasks.create(isolated.practitioner.actor,key,input)).toEqual(created);
   expect(await tasks.list(isolated.practitioner.actor,from,to,null)).toEqual([]);
   expect((await tasks.list(isolated.practitioner.actor,from,to,null,'demo')).map(t=>t.id)).toEqual([created.id]);
   const live=await tasks.create(isolated.practitioner.actor,randomUUID(),{...input,mode:'live',caseId:isolated.second.id});
   expect((await tasks.list(isolated.practitioner.actor,from,to,null)).map(t=>t.id)).toEqual([live.id]);
   expect((await tasks.list(isolated.practitioner.actor,from,to,null,'demo')).map(t=>t.id)).toEqual([created.id]);
   for(const bad of [{...input,mode:'live' as const},{...input,caseId:null},{...input,caseId:isolated.second.id}])
    await expect(tasks.create(isolated.practitioner.actor,randomUUID(),bad)).rejects.toMatchObject({code:'INVALID_REQUEST'});
   await expect(tasks.create(isolated.parent.actor,randomUUID(),input)).rejects.toMatchObject({code:'FORBIDDEN'});
   await expect(tasks.list(isolated.parent.actor,from,to,null,'demo')).rejects.toMatchObject({code:'FORBIDDEN'});
   await expect(tasks.complete(isolated.practitioner.actor,created.id,randomUUID(),1)).rejects.toMatchObject({code:'NOT_FOUND'});
   await expect(tasks.complete(isolated.practitioner.actor,live.id,randomUUID(),1,'demo')).rejects.toMatchObject({code:'NOT_FOUND'});
   const completeKey=randomUUID(),done=await tasks.complete(isolated.practitioner.actor,created.id,completeKey,1,'demo');
   expect(done).toMatchObject({state:'done',version:2,note:input.note});
   expect(await tasks.complete(isolated.practitioner.actor,created.id,completeKey,1,'demo')).toEqual(done);
   await expect(tasks.complete(isolated.practitioner.actor,created.id,completeKey,1,'live')).rejects.toMatchObject({code:'NOT_FOUND'});
   const markers=(await isolated.pool.query("SELECT entity_key,case_id FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='task'",[isolated.workspaceId])).rows;
   expect(markers).toEqual([{entity_key:created.id,case_id:isolated.first.id}]);
   expect((await isolated.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[isolated.workspaceId])).rows[0].n).toBe(0);
  }finally{await isolated.pool.end();}
 });
 test('identity schema allows only one practitioner per workspace',async()=>{
  const index=(await f.pool.query(`SELECT pg_get_indexdef('ls_identity.one_practitioner_per_workspace'::regclass) AS definition`)).rows[0]?.definition as string;
  expect(index).toContain('UNIQUE INDEX one_practitioner_per_workspace');
  expect(index).toContain('WHERE');
  expect(index).toContain("role = 'practitioner'");
 });
 test('manual task is encrypted, practitioner-only, idempotent, all-day and has no provider/payment effect',async()=>{
  const tasks=new InternalTaskService(f.db,Buffer.alloc(32,9)),dueDate=civilDate(f.at(48)),from=dayStart(dueDate),to=dayStart(shiftDay(dueDate,1));
  const input={title:'Synthetic internal follow-up',dueDate,dueTime:null,note:'Synthetic private work note',sourcePath:'/en/app/clients',caseId:f.first.id};
  const command=randomUUID(),before=(await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[f.workspaceId])).rows[0].n;
  const created=await tasks.create(f.practitioner.actor,command,input);
  expect(created).toMatchObject({...input,state:'open',version:1});
  expect(await tasks.create(f.practitioner.actor,command,input)).toEqual(created);
  await expect(tasks.create(f.practitioner.actor,command,{...input,title:'Changed synthetic task'})).rejects.toMatchObject({code:'CONFLICT'});
  expect(await tasks.list(f.practitioner.actor,from,to,f.first.id)).toEqual([created]);
  expect(await tasks.list(f.practitioner.actor,from,to,f.second.id)).toEqual([]);
  await expect(tasks.list(f.parent.actor,from,to,null)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(tasks.create(f.parent.actor,randomUUID(),input)).rejects.toMatchObject({code:'FORBIDDEN'});
  const raw=(await f.pool.query('SELECT title_ciphertext,note_ciphertext,source_path_ciphertext FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[f.workspaceId,created.id])).rows[0];
  expect(JSON.stringify(raw)).not.toContain(input.title);expect(JSON.stringify(raw)).not.toContain(input.note);
  const completed=await tasks.complete(f.practitioner.actor,created.id,randomUUID(),created.version);
  expect(completed).toMatchObject({state:'done',version:2,dueDate,dueTime:null});
  await expect(tasks.complete(f.practitioner.actor,created.id,randomUUID(),created.version)).rejects.toMatchObject({code:'CONFLICT'});
  expect((await f.pool.query('SELECT action FROM ls_calendar.task_history WHERE workspace_id=$1 AND task_id=$2 ORDER BY version',[f.workspaceId,created.id])).rows.map((row:{action:string})=>row.action)).toEqual(['created','completed']);
  await expect(f.pool.query('UPDATE ls_calendar.task_history SET action=$3 WHERE workspace_id=$1 AND task_id=$2',[f.workspaceId,created.id,'created'])).rejects.toMatchObject({code:'23514'});
  await expect(f.pool.query('DELETE FROM ls_calendar.task_history WHERE workspace_id=$1 AND task_id=$2',[f.workspaceId,created.id])).rejects.toMatchObject({code:'23514'});
  expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[f.workspaceId])).rows[0].n).toBe(before);
 });
 test('verified CRM follow-ups reconcile one encrypted linked task without duplicate or provider effects',async()=>{
  const tasks=new InternalTaskService(f.db,Buffer.alloc(32,9)),dueDate=civilDate(f.at(72)),newDate=shiftDay(dueDate,1);
  const row={leadId:'LS-LEAD-SYNTHETIC-1',name:'Synthetic contact',nextAction:'Review synthetic inquiry',dueDate,
   caseId:f.first.id,stage:'New',outcome:''};
  const before=(await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[f.workspaceId])).rows[0].n;
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,[row])).toEqual({created:1,updated:0,resolved:0,unchanged:0});
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,[row])).toEqual({created:0,updated:0,resolved:0,unchanged:1});
  const first=(await tasks.list(f.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),null))[0]!;
  expect(first).toMatchObject({title:`${row.name} · ${row.nextAction}`,dueDate,dueTime:null,state:'open',sourceKind:'crm_followup',caseId:f.first.id});
  expect((await tasks.list(f.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),f.first.id)).map(item=>item.id)).toContain(first.id);
  expect(await tasks.list(f.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),f.second.id)).toEqual([]);
  expect(first.sourcePath).toContain('leadId=LS-LEAD-SYNTHETIC-1');
  const raw=(await f.pool.query('SELECT title_ciphertext,source_path_ciphertext,source_digest,source_revision FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[f.workspaceId,first.id])).rows[0];
  expect(JSON.stringify(raw)).not.toContain(row.leadId);expect(JSON.stringify(raw)).not.toContain(row.name);expect(JSON.stringify(raw)).not.toContain(row.nextAction);
  expect(raw.source_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(raw.source_digest).not.toBe(createHash('sha256').update(`${f.workspaceId}:crm_followup:${row.leadId}`).digest('hex'));
  const staleCaseId=randomUUID();
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,[{...row,nextAction:'Call on the next day',dueDate:newDate,caseId:staleCaseId}])).toEqual({created:0,updated:1,resolved:0,unchanged:0});
  const changed=(await tasks.list(f.practitioner.actor,dayStart(newDate),dayStart(shiftDay(newDate,1)),null))[0]!;
  expect(changed).toMatchObject({id:first.id,title:'Synthetic contact · Call on the next day',version:2,state:'open',caseId:null});
  const done=await tasks.complete(f.practitioner.actor,changed.id,randomUUID(),changed.version);
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,[{...row,nextAction:'Call on the next day',dueDate:newDate,caseId:staleCaseId}])).toEqual({created:0,updated:0,resolved:0,unchanged:1});
  expect((await tasks.list(f.practitioner.actor,dayStart(newDate),dayStart(shiftDay(newDate,1)),null))[0]?.state).toBe('done');
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,[{...row,nextAction:'',dueDate:''}])).toEqual({created:0,updated:0,resolved:1,unchanged:0});
  expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.tasks WHERE workspace_id=$1 AND source_kind=$2',[f.workspaceId,'crm_followup'])).rows[0].n).toBe(1);
  expect((await f.pool.query('SELECT action FROM ls_calendar.task_history WHERE workspace_id=$1 AND task_id=$2 ORDER BY version',[f.workspaceId,first.id])).rows.map((item:{action:string})=>item.action)).toEqual(['created','source_updated','completed','source_resolved']);
  await expect(tasks.syncCrmFollowups(f.parent.actor,[row])).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(tasks.syncCrmFollowups(f.practitioner.actor,[row,row])).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(tasks.syncCrmFollowups(f.practitioner.actor,[row,{...row,leadId:'LS-LEAD-SYNTHETIC-2',dueDate:null as unknown as string}])).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[f.workspaceId])).rows[0].n).toBe(before);
  expect(done.state).toBe('done');
 });
 test('bulk reconciliation keeps many same-action prospects distinct and replay-safe',async()=>{
  const tasks=new InternalTaskService(f.db,Buffer.alloc(32,9)),dueDate=civilDate(f.at(120));
  const rows=Array.from({length:120},(_,index)=>({
   leadId:`LS-LEAD-BATCH-${index}`,name:`Synthetic person ${index}`,nextAction:'Call',
   dueDate,caseId:'',stage:'New',outcome:'',
  }));
  const before=(await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[f.workspaceId])).rows[0].n;
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,rows)).toEqual({created:120,updated:0,resolved:0,unchanged:0});
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,rows)).toEqual({created:0,updated:0,resolved:0,unchanged:120});
  const listed=await tasks.list(f.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),null);
  expect(listed).toHaveLength(120);
  expect(new Set(listed.map(item=>item.title)).size).toBe(120);
  expect(listed.every(item=>item.sourceKind==='crm_followup'&&item.caseId===null)).toBe(true);
  const archived={...rows[0]!,stage:'Archived',dueDate:'not-a-date'};
  expect(await tasks.syncCrmFollowups(f.practitioner.actor,[archived])).toEqual({created:0,updated:0,resolved:1,unchanged:0});
  expect((await tasks.list(f.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),null)).find(item=>item.title==='Synthetic person 0 · Call')?.state).toBe('done');
  expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[f.workspaceId])).rows[0].n).toBe(before);
 });
 test('production adapter reconciles and lists more than1000 follow-ups completely, without duplicates or partial oversized writes',async()=>{
  const native=await fixture({demoFirst:true}),previousUrl=process.env.LS_DATABASE_URL,previousTls=process.env.LS_DATABASE_TLS;
  try{
   await closeDatabase();process.env.LS_DATABASE_URL=safeTestUrl();process.env.LS_DATABASE_TLS='disable';
   const tasks=new InternalTaskService(new CalendarStore(drizzleIdentityStore,native.keyring,native.db.clock),Buffer.alloc(32,9));
   const dueDate=civilDate(native.at(120)),rows=Array.from({length:1001},(_,index)=>({leadId:`LS-LEAD-LARGE-${index}`,name:`Synthetic large directory ${index}`,nextAction:'Synthetic follow-up',dueDate,caseId:'',stage:'New',outcome:''}));
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,rows)).toEqual({created:1001,updated:0,resolved:0,unchanged:0});
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,rows)).toEqual({created:0,updated:0,resolved:0,unchanged:1001});
   const listed=await tasks.list(native.practitioner.actor,dayStart(dueDate),dayStart(shiftDay(dueDate,1)),null);
   expect(listed).toHaveLength(1001);expect(new Set(listed.map(r=>r.id)).size).toBe(1001);expect(new Set(listed.map(r=>r.title)).size).toBe(1001);
   expect((await native.pool.query('SELECT count(*)::int AS n FROM ls_calendar.task_history WHERE workspace_id=$1',[native.workspaceId])).rows[0].n).toBe(1001);
   const oversized=Array.from({length:MAX_OPERATIONAL_PROSPECTS+1},(_,index)=>({...rows[0]!,leadId:`LS-LEAD-OVER-${index}`}));
   await expect(tasks.syncCrmFollowups(native.practitioner.actor,oversized)).rejects.toMatchObject({code:'UNAVAILABLE'});
   await expect(tasks.syncCrmFollowups(native.practitioner.actor,[...rows,rows[1000]!])).rejects.toMatchObject({code:'UNAVAILABLE'});
   await expect(tasks.syncCrmFollowups(native.parent.actor,rows)).rejects.toMatchObject({code:'FORBIDDEN'});
   expect((await native.pool.query('SELECT count(*)::int AS n FROM ls_calendar.tasks WHERE workspace_id=$1',[native.workspaceId])).rows[0].n).toBe(1001);
   expect((await native.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[native.workspaceId])).rows[0].n).toBe(0);
  }finally{
   await closeDatabase();await native.pool.end();
   if(previousUrl===undefined)delete process.env.LS_DATABASE_URL;else process.env.LS_DATABASE_URL=previousUrl;
   if(previousTls===undefined)delete process.env.LS_DATABASE_TLS;else process.env.LS_DATABASE_TLS=previousTls;
  }
 });
 test('production Drizzle binding reconciles, replays and resolves native follow-ups without admitting demo or unauthorized work',async()=>{
  const native=await fixture({demoFirst:true}),previousUrl=process.env.LS_DATABASE_URL,previousTls=process.env.LS_DATABASE_TLS;
  try{
   await closeDatabase();
   process.env.LS_DATABASE_URL=safeTestUrl();process.env.LS_DATABASE_TLS='disable';
   // Exercise the SAME adapter used by the production Calendar, not the raw-pg
   // fixture store. Only the server-only package marker is mocked above.
   const tasks=new InternalTaskService(new CalendarStore(drizzleIdentityStore,native.keyring,native.db.clock),Buffer.alloc(32,9));
   const dueDate=civilDate(native.at(168)),from=dayStart(dueDate),to=dayStart(shiftDay(dueDate,2));
   const row={leadId:'LS-LEAD-DRIZZLE-SYNTHETIC',name:'Synthetic binding contact',nextAction:'Review "quoted" synthetic inquiry',dueDate,caseId:native.second.id,stage:'New',outcome:''};
   const unlinked={...row,leadId:'LS-LEAD-DRIZZLE-UNLINKED',caseId:''};
   const demo={...row,leadId:'LS-LEAD-DRIZZLE-DEMO',caseId:native.first.id};
   // The current schema forbids attaching a free-form prospect demo marker.
   // Preserve that denial; use the fixture's genuine demo case provenance instead.
   await expect(native.pool.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id)
    VALUES($1,'ls-owner-20260925','prospect',$2,'calendar-drizzle-demo',$3)`,[native.workspaceId,demo.leadId,native.first.id])).rejects.toMatchObject({code:'23514'});
   const before=(await native.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[native.workspaceId])).rows[0].n;
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,[])).toEqual({created:0,updated:0,resolved:0,unchanged:0});
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,[row,unlinked,demo])).toEqual({created:2,updated:0,resolved:0,unchanged:1});
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,[row,unlinked,demo])).toEqual({created:0,updated:0,resolved:0,unchanged:3});
   const listed=await tasks.list(native.practitioner.actor,from,to,null);
   expect(listed).toHaveLength(2);expect(listed.map(item=>item.caseId)).toEqual(expect.arrayContaining([native.second.id,null]));
   expect(listed.every(item=>item.title===`${row.name} · ${row.nextAction}`&&item.version===1)).toBe(true);
   const linked=listed.find(item=>item.caseId===native.second.id)!;
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,[{...row,dueDate:shiftDay(dueDate,1),nextAction:'Updated synthetic action'}])).toEqual({created:0,updated:1,resolved:0,unchanged:0});
   expect((await tasks.list(native.practitioner.actor,from,to,native.second.id))[0]).toMatchObject({id:linked.id,version:2,state:'open',dueDate:shiftDay(dueDate,1),title:'Synthetic binding contact · Updated synthetic action'});
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,[{...row,stage:'Archived',dueDate:'not-a-date'}])).toEqual({created:0,updated:0,resolved:1,unchanged:0});
   expect((await tasks.list(native.practitioner.actor,from,to,native.second.id))[0]).toMatchObject({id:linked.id,version:3,state:'done'});
   await expect(tasks.syncCrmFollowups(native.parent.actor,[row])).rejects.toMatchObject({code:'FORBIDDEN'});
   await expect(tasks.syncCrmFollowups(native.outsider.actor,[row])).rejects.toMatchObject({code:'FORBIDDEN'});
   await expect(tasks.syncCrmFollowups(native.practitioner.actor,[row,row])).rejects.toMatchObject({code:'UNAVAILABLE'});
   expect((await native.pool.query('SELECT action FROM ls_calendar.task_history WHERE workspace_id=$1 AND task_id=$2 ORDER BY version',[native.workspaceId,linked.id])).rows.map((item:{action:string})=>item.action)).toEqual(['created','source_updated','source_resolved']);
   const encrypted=(await native.pool.query('SELECT title_ciphertext,source_path_ciphertext FROM ls_calendar.tasks WHERE workspace_id=$1',[native.workspaceId])).rows;
   expect(JSON.stringify(encrypted)).not.toContain(row.name);expect(JSON.stringify(encrypted)).not.toContain(row.leadId);
   expect((await native.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[native.workspaceId])).rows[0].n).toBe(before);
  }finally{
   await closeDatabase();await native.pool.end();
   if(previousUrl===undefined)delete process.env.LS_DATABASE_URL;else process.env.LS_DATABASE_URL=previousUrl;
   if(previousTls===undefined)delete process.env.LS_DATABASE_TLS;else process.env.LS_DATABASE_TLS=previousTls;
  }
 });
 test('full supported CRM directory leaves capacity for manual tasks in the same range',async()=>{
  const native=await fixture(),previousUrl=process.env.LS_DATABASE_URL,previousTls=process.env.LS_DATABASE_TLS;
  try{
   await closeDatabase();process.env.LS_DATABASE_URL=safeTestUrl();process.env.LS_DATABASE_TLS='disable';
   const tasks=new InternalTaskService(new CalendarStore(drizzleIdentityStore,native.keyring,native.db.clock),Buffer.alloc(32,9));
   const dueDate=civilDate(native.at(120)),from=dayStart(dueDate),to=dayStart(shiftDay(dueDate,1));
   const rows=Array.from({length:MAX_OPERATIONAL_PROSPECTS},(_,index)=>({leadId:`LS-LEAD-CAPACITY-${index}`,name:`Synthetic capacity ${index}`,nextAction:'Review synthetic inquiry',dueDate,caseId:'',stage:'New',outcome:''}));
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,rows)).toEqual({created:MAX_OPERATIONAL_PROSPECTS,updated:0,resolved:0,unchanged:0});
   const manual=await tasks.create(native.practitioner.actor,randomUUID(),{title:'Synthetic manual task alongside full CRM',note:null,sourcePath:null,caseId:null,dueDate,dueTime:null});
   const listed=await tasks.list(native.practitioner.actor,from,to,null);
   expect(listed).toHaveLength(MAX_OPERATIONAL_PROSPECTS+1);
   expect(listed.filter(row=>row.sourceKind==='crm_followup')).toHaveLength(MAX_OPERATIONAL_PROSPECTS);
   expect(listed.find(row=>row.id===manual.id)).toEqual(manual);
   expect(await tasks.syncCrmFollowups(native.practitioner.actor,rows)).toEqual({created:0,updated:0,resolved:0,unchanged:MAX_OPERATIONAL_PROSPECTS});
   await expect(tasks.list(native.parent.actor,from,to,null)).rejects.toMatchObject({code:'FORBIDDEN'});
   expect((await native.pool.query('SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1',[native.workspaceId])).rows[0].n).toBe(0);
   // Retain an explicit total safety gate, not a silently truncated success.
   // These overflow-only fixture rows are never returned/decrypted or sent.
   await native.pool.query(`INSERT INTO ls_calendar.tasks
    (workspace_id,id,created_by,title_ciphertext,due_date,created_at,updated_at)
    SELECT workspace_id,gen_random_uuid(),created_by,title_ciphertext,due_date,created_at,updated_at
    FROM ls_calendar.tasks CROSS JOIN generate_series(1,$3::int)
    WHERE workspace_id=$1 AND id=$2`,[native.workspaceId,manual.id,MAX_CALENDAR_TASKS-MAX_OPERATIONAL_PROSPECTS]);
   await expect(tasks.list(native.practitioner.actor,from,to,null)).rejects.toMatchObject({code:'UNAVAILABLE'});
  }finally{
   await closeDatabase();await native.pool.end();
   if(previousUrl===undefined)delete process.env.LS_DATABASE_URL;else process.env.LS_DATABASE_URL=previousUrl;
   if(previousTls===undefined)delete process.env.LS_DATABASE_TLS;else process.env.LS_DATABASE_TLS=previousTls;
  }
 },60000);
});
