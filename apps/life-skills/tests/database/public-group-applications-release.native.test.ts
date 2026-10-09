import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test,vi} from 'vitest';
import {migrate} from '../../src/db/migration-runner.ts';
import {publicGroupApplicationsMigrationInventory,publicGroupApplicationsPlan,publicGroupApplicationsStateDigest,readPublicGroupApplicationsReleaseSnapshot} from '../../src/db/public-group-applications-release.ts';
import {historicalPracticeDatabase} from './home-practice/legacy-practice-fixture.ts';

let historical:Awaited<ReturnType<typeof historicalPracticeDatabase>>;
const tx=()=>({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{const result=await historical.pool.query<R>(sql,[...values]);return {rows:result.rows};}});
beforeAll(async()=>{historical=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql');},60000);
afterAll(async()=>{vi.unstubAllEnvs();await historical?.close();});

describe('public group applications migration 0131 native release proof',()=>{
 test('failed apply rolls back; exact apply/readback/repeat preserves append-only private receipts',async()=>{
  const files=publicGroupApplicationsMigrationInventory(historical.inventory),baseline=files.slice(0,-1),migration=files.at(-1)!;
  expect(await migrate(tx(),baseline,false)).toEqual({applied:12,pending:0});
  const history0=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot0=await readPublicGroupApplicationsReleaseSnapshot(tx());
  expect(publicGroupApplicationsPlan(files,history0,snapshot0)).toMatchObject({stage:0,pending:[expect.objectContaining({name:'0131_ls_public_group_applications.sql'})]});
  await historical.pool.query('BEGIN');try{await historical.pool.query('CREATE TABLE ls_service_interest.public_applications(id uuid)');await expect(readPublicGroupApplicationsReleaseSnapshot(tx())).rejects.toThrow('PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT');}finally{await historical.pool.query('ROLLBACK');}
  const broken=[...baseline,{...migration,sql:migration.sql+'\nSELECT * FROM ls_missing_public_group_table;'}];await expect(migrate(tx(),broken,false)).rejects.toThrow('MIGRATION_FAILED');
  expect(await readPublicGroupApplicationsReleaseSnapshot(tx())).toMatchObject({stage:0,applicationRows:0,operationRows:0});
  expect(await migrate(tx(),files,false)).toEqual({applied:1,pending:0});
  const history1=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot1=await readPublicGroupApplicationsReleaseSnapshot(tx());
  expect(publicGroupApplicationsPlan(files,history1,snapshot1)).toMatchObject({stage:1,pending:[]});expect(await migrate(tx(),files,false)).toEqual({applied:0,pending:0});expect(await migrate(tx(),files,true)).toEqual({applied:0,pending:0});
  const workspaceId=randomUUID(),applicationId=randomUUID(),operationId=randomUUID(),requestDigest='a'.repeat(64),contactDigest='b'.repeat(64);
  await historical.pool.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())',[workspaceId]);
  await historical.pool.query("INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,'synthetic-ciphertext','2026-10-09','en',now())",[workspaceId,applicationId,contactDigest,requestDigest]);
  await historical.pool.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',[workspaceId,operationId,requestDigest,applicationId]);
  await expect(historical.pool.query('DELETE FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[workspaceId,applicationId])).rejects.toThrow(/public_group_application_append_only/);
  expect(await readPublicGroupApplicationsReleaseSnapshot(tx())).toMatchObject({stage:1,applicationRows:1,operationRows:1});expect(publicGroupApplicationsStateDigest(history0,snapshot0)).not.toBe(publicGroupApplicationsStateDigest(history1,snapshot1));
 },60000);

 test('successor and frozen predecessor drift are rejected',async()=>{
  expect((await readPublicGroupApplicationsReleaseSnapshot(tx())).stage).toBe(1);
  for(const item of [
   {sql:'ALTER TABLE ls_service_interest.public_applications DROP CONSTRAINT public_applications_workspace_id_fkey',error:'PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_service_interest.public_applications DISABLE TRIGGER public_group_application_immutable',error:'PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT'},
   {sql:'GRANT SELECT ON ls_service_interest.public_applications TO PUBLIC',error:'PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_service_interest.public_applications ALTER COLUMN payload_ciphertext DROP NOT NULL',error:'PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT'},
   {sql:'DROP INDEX ls_service_interest.public_group_application_recent',error:'PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT'},
   {sql:'GRANT EXECUTE ON FUNCTION ls_service_interest.reject_public_application_mutation() TO PUBLIC',error:'PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_group_admin.draft_meeting_revisions DISABLE TRIGGER draft_meeting_revisions_immutable',error:'PUBLIC_GROUP_APPLICATIONS_BASELINE_SCHEMA_CONFLICT'},
  ]){await historical.pool.query('BEGIN');try{await historical.pool.query(item.sql);await expect(readPublicGroupApplicationsReleaseSnapshot(tx())).rejects.toThrow(item.error);}finally{await historical.pool.query('ROLLBACK');}}
 },60000);
});
