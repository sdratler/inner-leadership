import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test,vi} from 'vitest';
import {migrate} from '../../src/db/migration-runner.ts';
import {readServiceInterestReleaseSnapshot,serviceInterestMigrationInventory,serviceInterestPlan,serviceInterestStateDigest} from '../../src/db/service-interest-release.ts';
import {historicalPracticeDatabase} from './home-practice/legacy-practice-fixture.ts';

let historical:Awaited<ReturnType<typeof historicalPracticeDatabase>>;
const tx=()=>({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{const result=await historical.pool.query<R>(sql,[...values]);return {rows:result.rows};}});
beforeAll(async()=>{historical=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql');},60000);
afterAll(async()=>{vi.unstubAllEnvs();await historical?.close();});

describe('service-interest migration 0127 native release proof',()=>{
 test('failed apply rolls back, exact apply/readback/repeat/verify succeeds and old group intake remains compatible',async()=>{
  const files=serviceInterestMigrationInventory(historical.inventory),baseline=files.slice(0,-1),migration=files.at(-1)!;
  expect(await migrate(tx(),baseline,false)).toEqual({applied:8,pending:0});
  await historical.pool.query('BEGIN');try{
   await historical.pool.query('ALTER TABLE ls_service_interest.inquiries DROP CONSTRAINT inquiries_payload_ciphertext_check');
   await expect(readServiceInterestReleaseSnapshot(tx())).rejects.toThrow('SERVICE_INTEREST_BASELINE_SCHEMA_CONFLICT');
  }finally{await historical.pool.query('ROLLBACK');}
  await historical.pool.query('BEGIN');try{
   await historical.pool.query(`CREATE FUNCTION ls_service_interest.check_service_interest_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
   await expect(readServiceInterestReleaseSnapshot(tx())).rejects.toThrow('SERVICE_INTEREST_SCHEMA_STATE_CONFLICT');
  }finally{await historical.pool.query('ROLLBACK');}
  const workspaceId=randomUUID(),adultId=randomUUID(),practitionerId=randomUUID(),minorId=randomUUID(),familyId=randomUUID(),inquiryId=randomUUID(),digest='a'.repeat(64);
  await historical.pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())",[workspaceId]);
  await historical.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic-adult',now()),($3,$2,'minor','synthetic-minor',now())",[adultId,workspaceId,minorId]);
  await historical.pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',now(),'synthetic',now(),now())",[practitionerId,workspaceId,'b'.repeat(64)]);
  await historical.pool.query("INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,'synthetic-family',now())",[familyId,workspaceId]);
  await historical.pool.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspaceId,familyId,minorId]);
  await historical.pool.query("INSERT INTO ls_service_interest.inquiries(workspace_id,id,recorded_by,request_digest,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,'synthetic-before',now())",[workspaceId,inquiryId,practitionerId,digest]);
  await historical.pool.query("INSERT INTO ls_service_interest.operations(workspace_id,operation_id,recorded_by,request_digest,inquiry_id) VALUES($1,$2,$3,$4,$5)",[workspaceId,randomUUID(),practitionerId,digest,inquiryId]);
  const history0=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot0=await readServiceInterestReleaseSnapshot(tx());expect(serviceInterestPlan(files,history0,snapshot0)).toMatchObject({stage:0,pending:[expect.objectContaining({name:'0127_ls_service_interests.sql'})]});
  const broken=[...baseline,{...migration,sql:migration.sql+'\nSELECT * FROM ls_missing_service_interest_table;'}];await expect(migrate(tx(),broken,false)).rejects.toThrow('MIGRATION_FAILED');
  expect(await readServiceInterestReleaseSnapshot(tx())).toMatchObject({stage:0,serviceRows:0,operationRows:0});expect((await historical.pool.query("SELECT count(*)::int AS n FROM ls_control.migrations WHERE name='0127_ls_service_interests.sql'")).rows[0]).toEqual({n:0});
  expect(await migrate(tx(),files,false)).toEqual({applied:1,pending:0});const history1=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot1=await readServiceInterestReleaseSnapshot(tx());expect(serviceInterestPlan(files,history1,snapshot1)).toMatchObject({stage:1,pending:[]});expect(snapshot1.catalogDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(await migrate(tx(),files,false)).toEqual({applied:0,pending:0});expect(await migrate(tx(),files,true)).toEqual({applied:0,pending:0});
  const secondId=randomUUID(),secondDigest='c'.repeat(64);await historical.pool.query("INSERT INTO ls_service_interest.inquiries(workspace_id,id,recorded_by,request_digest,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,'synthetic-after',now())",[workspaceId,secondId,practitionerId,secondDigest]);await historical.pool.query("INSERT INTO ls_service_interest.operations(workspace_id,operation_id,recorded_by,request_digest,inquiry_id) VALUES($1,$2,$3,$4,$5)",[workspaceId,randomUUID(),practitionerId,secondDigest,secondId]);
  expect((await historical.pool.query("SELECT payload_ciphertext FROM ls_service_interest.inquiries WHERE workspace_id=$1 ORDER BY payload_ciphertext",[workspaceId])).rows).toEqual([{payload_ciphertext:'synthetic-after'},{payload_ciphertext:'synthetic-before'}]);
  expect(serviceInterestStateDigest(history0,snapshot0)).not.toBe(serviceInterestStateDigest(history1,snapshot1));
 },60000);

 test('schema drift is rejected or changes the proof-bound catalog digest',async()=>{
  const ready=await readServiceInterestReleaseSnapshot(tx());expect(ready.stage).toBe(1);
  for(const sql of [
   'ALTER TABLE ls_service_interest.service_interests DROP CONSTRAINT service_interests_person_kind_fkey',
   'ALTER TABLE ls_service_interest.service_interests DISABLE TRIGGER service_interests_verified_child',
   'ALTER FUNCTION ls_service_interest.check_service_interest_child() SECURITY DEFINER',
   'GRANT SELECT ON ls_service_interest.service_interests TO PUBLIC',
   'ALTER TABLE ls_service_interest.service_interests ALTER COLUMN member_role DROP NOT NULL',
  ]){await historical.pool.query('BEGIN');try{await historical.pool.query(sql);await expect(readServiceInterestReleaseSnapshot(tx())).rejects.toThrow('SERVICE_INTEREST_SCHEMA_STATE_CONFLICT');}finally{await historical.pool.query('ROLLBACK');}}
  await historical.pool.query('BEGIN');try{
   await historical.pool.query("ALTER TABLE ls_service_interest.service_interests DROP CONSTRAINT service_interests_service_type_check,ADD CONSTRAINT service_interests_service_type_check CHECK(service_type IN ('group','tutoring','both'))");
   const changed=await readServiceInterestReleaseSnapshot(tx());expect(changed.stage).toBe(1);expect(changed.catalogDigest).not.toBe(ready.catalogDigest);
  }finally{await historical.pool.query('ROLLBACK');}
 });
});
