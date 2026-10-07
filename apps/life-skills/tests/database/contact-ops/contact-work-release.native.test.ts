import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test,vi} from 'vitest';
import {migrate} from '../../../src/db/migration-runner.ts';
import {classifyContactWork,contactWorkPlan,readContactWorkSnapshot,CONTACT_WORK_MIGRATIONS} from '../../../src/db/contact-work-release.ts';
import {historicalPracticeDatabase} from '../home-practice/legacy-practice-fixture.ts';
import {fixture,type Fixture} from '../calendar/fixture.ts';

let historical:Awaited<ReturnType<typeof historicalPracticeDatabase>>,f:Fixture;
beforeAll(async()=>{historical=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql');vi.stubEnv('TEST_DATABASE_URL',historical.url);vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');f=await fixture();},60000);
afterAll(async()=>{await f?.pool.end();vi.unstubAllEnvs();await historical?.close();});

describe('contact work migration-before-code release',()=>{
 test('upgrades a populated 0118 database through every resumable stage with exact readback',async()=>{
  const id=randomUUID();await historical.pool.query(`INSERT INTO ls_calendar.tasks(workspace_id,id,created_by,case_id,title_ciphertext,due_date,state) VALUES($1,$2,$3,$4,'synthetic-ciphertext','2026-10-08','open')`,[f.workspaceId,id,f.practitioner.actor.id,f.first.id]);
  await historical.pool.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at) VALUES($1,$2,$3,1,'created',$4,now())`,[f.workspaceId,randomUUID(),id,f.practitioner.actor.id]);
  const client=await historical.pool.connect(),query={query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{const result=await client.query<R>(sql,[...values]);return {rows:result.rows};}};try{
   let history=(await client.query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;const initial=await readContactWorkSnapshot(query);expect(classifyContactWork(initial)).toBe(0);expect(contactWorkPlan(historical.inventory,history,initial).pending).toHaveLength(5);
   for(let stage=1;stage<=5;stage++){
    const migration=CONTACT_WORK_MIGRATIONS[stage-1]!,index=historical.inventory.findIndex(file=>file.name===migration.name),prefix=historical.inventory.slice(0,index+1);
    if(stage===2){const broken=prefix.map(file=>file.name===migration.name?{...file,sql:file.sql+'\nSELECT * FROM ls_missing_contact_work_table;'}:file);await expect(migrate(query,broken,false)).rejects.toThrow('MIGRATION_FAILED');expect(classifyContactWork(await readContactWorkSnapshot(query))).toBe(1);expect((await client.query("SELECT count(*)::int AS n FROM ls_control.migrations WHERE name=$1",[migration.name])).rows[0].n).toBe(0);}
    expect(await migrate(query,prefix,false)).toEqual({applied:1,pending:0});history=(await client.query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;const snapshot=await readContactWorkSnapshot(query);expect(classifyContactWork(snapshot)).toBe(stage);expect(contactWorkPlan(historical.inventory,history,snapshot).pending).toHaveLength(5-stage);expect((await client.query('SELECT state,title_ciphertext FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[f.workspaceId,id])).rows[0]).toEqual({state:'open',title_ciphertext:'synthetic-ciphertext'});
   }
   expect(await migrate(query,historical.inventory,false)).toEqual({applied:0,pending:0});expect(await migrate(query,historical.inventory,true)).toEqual({applied:0,pending:0});
   await expect(client.query('UPDATE ls_calendar.task_history SET action=action WHERE workspace_id=$1 AND task_id=$2',[f.workspaceId,id])).rejects.toMatchObject({code:'23514'});
  }finally{client.release();}
 },60000);
});
