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
import { MAX_OPERATIONAL_PROSPECTS } from '../../../src/features/contact-ops/core/limits.ts';

let f:Fixture;
beforeAll(async()=>{f=await fixture();},30000);
afterAll(async()=>{await f?.pool.end();});
describe('internal task PostgreSQL contract',()=>{
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
});
