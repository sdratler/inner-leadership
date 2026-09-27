/** Disposable, already-migrated native PostgreSQL only; no provider adapters. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { InternalTaskService } from '../../../src/features/calendar/tasks.ts';
import { civilDate, dayStart, shiftDay } from '../../../src/features/calendar/time.ts';
import { fixture, type Fixture } from './fixture.ts';

let f:Fixture;
beforeAll(async()=>{f=await fixture();},30000);
afterAll(async()=>{await f?.pool.end();});
describe('internal task PostgreSQL contract',()=>{
 test('manual task is encrypted, practitioner-only, idempotent, all-day and has no provider/payment effect',async()=>{
  const tasks=new InternalTaskService(f.db),dueDate=civilDate(f.at(48)),from=dayStart(dueDate),to=dayStart(shiftDay(dueDate,1));
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
});
