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
  const throughContactWork=historical.inventory.slice(0,historical.inventory.findIndex(file=>file.name==='0126_ls_audience_interest.sql')+1);
  expect(throughContactWork.at(-1)?.name).toBe('0126_ls_audience_interest.sql');
  const client=await historical.pool.connect(),query={query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{const result=await client.query<R>(sql,[...values]);return {rows:result.rows};}};try{
   let history=(await client.query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;const initial=await readContactWorkSnapshot(query);expect(classifyContactWork(initial)).toBe(0);expect(contactWorkPlan(throughContactWork,history,initial).pending).toHaveLength(8);
   for(let stage=1;stage<=8;stage++){
    const migration=CONTACT_WORK_MIGRATIONS[stage-1]!,index=throughContactWork.findIndex(file=>file.name===migration.name),prefix=throughContactWork.slice(0,index+1);
    if(stage===2){const broken=prefix.map(file=>file.name===migration.name?{...file,sql:file.sql+'\nSELECT * FROM ls_missing_contact_work_table;'}:file);await expect(migrate(query,broken,false)).rejects.toThrow('MIGRATION_FAILED');expect(classifyContactWork(await readContactWorkSnapshot(query))).toBe(1);expect((await client.query("SELECT count(*)::int AS n FROM ls_control.migrations WHERE name=$1",[migration.name])).rows[0].n).toBe(0);}
    expect(await migrate(query,prefix,false)).toEqual({applied:1,pending:0});history=(await client.query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;const snapshot=await readContactWorkSnapshot(query);let classified:number;try{classified=classifyContactWork(snapshot);}catch(error){throw new Error(`CONTACT_WORK_STAGE_${stage}_READBACK_FAILED ${JSON.stringify(snapshot)}`,{cause:error});}expect(classified).toBe(stage);expect(contactWorkPlan(throughContactWork,history,snapshot).pending).toHaveLength(8-stage);expect((await client.query('SELECT state,title_ciphertext FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[f.workspaceId,id])).rows[0]).toEqual({state:'open',title_ciphertext:'synthetic-ciphertext'});
   }
   expect(await migrate(query,throughContactWork,false)).toEqual({applied:0,pending:0});expect(await migrate(query,throughContactWork,true)).toEqual({applied:0,pending:0});
   const clean=await readContactWorkSnapshot(query);expect(classifyContactWork(clean)).toBe(8);expect(clean.extensionDigest).toMatch(/^[a-f0-9]{64}$/);
   await expect(client.query('UPDATE ls_calendar.task_history SET action=action WHERE workspace_id=$1 AND task_id=$2',[f.workspaceId,id])).rejects.toMatchObject({code:'23514'});
   await client.query('BEGIN');try{
    await client.query("ALTER TABLE ls_calendar.tasks DROP CONSTRAINT tasks_source_tuple_check, ADD CONSTRAINT tasks_source_tuple_check CHECK(source_kind IS NULL OR source_kind IN ('booking_followup','calendar_notice','creative_approval','crm_followup','form_review','intake_followup','publishing_failure','report_review','session_observations','update_review','unauthorized_source'))");
    const drift=await readContactWorkSnapshot(query);expect(drift.sourceKinds).toContain('unauthorized_source');expect(()=>classifyContactWork(drift)).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
   }finally{await client.query('ROLLBACK');}
   await client.query('BEGIN');try{
    await client.query('ALTER TABLE ls_contact_ops.call_activity_links DROP CONSTRAINT call_activity_links_workspace_id_candidate_id_fkey, ADD CONSTRAINT synthetic_wrong_call_reference FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id)');
    const drift=await readContactWorkSnapshot(query);expect(drift.callLinksForeignKeys).toBe(true);expect(drift.callLinksReferencesSound).toBe(false);expect(()=>classifyContactWork(drift)).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
   }finally{await client.query('ROLLBACK');}
   await client.query('BEGIN');try{
    const result=await client.query("SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('ls_provider_referrals.contexts') AND contype='f' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('ls_provider_referrals.contexts') AND attname='workspace_id'),(SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('ls_provider_referrals.contexts') AND attname='case_id'),(SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('ls_provider_referrals.contexts') AND attname='owner_account_id')]::smallint[]");
    expect(result.rows).toEqual([{conname:'contexts_workspace_id_case_id_owner_account_id_fkey'}]);
    await client.query('ALTER TABLE ls_provider_referrals.contexts DROP CONSTRAINT contexts_workspace_id_case_id_owner_account_id_fkey, ADD CONSTRAINT contexts_workspace_id_case_id_owner_account_id_fkey FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id)');
    const drift=await readContactWorkSnapshot(query);expect(drift.providerIndexReady).toBe(false);expect(drift.extensionDigest).not.toBe(clean.extensionDigest);expect(()=>classifyContactWork(drift)).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
   }finally{await client.query('ROLLBACK');}
   await client.query('BEGIN');try{
    const result=await client.query("SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.audience_interests') AND conname='audience_interests_topic_check'");expect(result.rows).toEqual([{conname:'audience_interests_topic_check'}]);
    await client.query("ALTER TABLE ls_contact_ops.audience_interests DROP CONSTRAINT audience_interests_topic_check, ADD CONSTRAINT audience_interests_topic_check CHECK(topic IS NOT NULL)");
    const drift=await readContactWorkSnapshot(query);expect(drift.audienceInterestReady).toBe(false);expect(drift.extensionDigest).not.toBe(clean.extensionDigest);expect(()=>classifyContactWork(drift)).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
   }finally{await client.query('ROLLBACK');}
   await client.query('BEGIN');try{
    await client.query("ALTER TABLE ls_contact_ops.audience_interests DROP CONSTRAINT audience_interests_topic_check, ADD CONSTRAINT audience_interests_topic_check CHECK(topic='BNA_CONTENT')");
    const drift=await readContactWorkSnapshot(query);expect(drift.audienceInterestReady).toBe(false);expect(drift.extensionDigest).not.toBe(clean.extensionDigest);expect(()=>classifyContactWork(drift)).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
   }finally{await client.query('ROLLBACK');}
   await client.query('BEGIN');try{
    await client.query('ALTER TABLE ls_contact_ops.audience_interests ALTER COLUMN payload_ciphertext DROP NOT NULL');
    const drift=await readContactWorkSnapshot(query);expect(drift.audienceInterestReady).toBe(false);expect(drift.extensionDigest).not.toBe(clean.extensionDigest);expect(()=>classifyContactWork(drift)).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
   }finally{await client.query('ROLLBACK');}
  }finally{client.release();}
 },60000);
});
