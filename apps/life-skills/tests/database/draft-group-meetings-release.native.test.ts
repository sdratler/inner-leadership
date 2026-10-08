import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test,vi} from 'vitest';
import {migrate} from '../../src/db/migration-runner.ts';
import {draftGroupMeetingsMigrationInventory,draftGroupMeetingsPlan,draftGroupMeetingsStateDigest,readDraftGroupMeetingsReleaseSnapshot} from '../../src/db/draft-group-meetings-release.ts';
import {historicalPracticeDatabase} from './home-practice/legacy-practice-fixture.ts';

let historical:Awaited<ReturnType<typeof historicalPracticeDatabase>>;
const tx=()=>({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{const result=await historical.pool.query<R>(sql,[...values]);return {rows:result.rows};}});
beforeAll(async()=>{historical=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql');},60000);
afterAll(async()=>{vi.unstubAllEnvs();await historical?.close();});

describe('draft group meetings migration 0130 native release proof',()=>{
 test('failed apply rolls back; exact apply/readback/repeat preserves frozen 0129 and immutable meeting history',async()=>{
  const files=draftGroupMeetingsMigrationInventory(historical.inventory),baseline=files.slice(0,-1),migration=files.at(-1)!;
  expect(await migrate(tx(),baseline,false)).toEqual({applied:11,pending:0});
  const workspaceId=randomUUID(),practitionerId=randomUUID(),groupId=randomUUID();
  await historical.pool.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())',[workspaceId]);
  await historical.pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',now(),'synthetic',now(),now())",[practitionerId,workspaceId,'b'.repeat(64)]);
  await historical.pool.query("INSERT INTO ls_group_admin.draft_groups(workspace_id,id,label_ciphertext,recorded_by,request_digest,created_at) VALUES($1,$2,'synthetic-group',$3,$4,now())",[workspaceId,groupId,practitionerId,'c'.repeat(64)]);
  const history0=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot0=await readDraftGroupMeetingsReleaseSnapshot(tx());
  expect(draftGroupMeetingsPlan(files,history0,snapshot0)).toMatchObject({stage:0,pending:[expect.objectContaining({name:'0130_ls_draft_group_meetings.sql'})]});
  await historical.pool.query('BEGIN');try{await historical.pool.query('CREATE TABLE ls_group_admin.draft_meeting_revisions(id uuid)');await expect(readDraftGroupMeetingsReleaseSnapshot(tx())).rejects.toThrow('DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT');}finally{await historical.pool.query('ROLLBACK');}
  const broken=[...baseline,{...migration,sql:migration.sql+'\nSELECT * FROM ls_missing_meeting_table;'}];
  await expect(migrate(tx(),broken,false)).rejects.toThrow('MIGRATION_FAILED');
  expect(await readDraftGroupMeetingsReleaseSnapshot(tx())).toMatchObject({stage:0,revisionRows:0,operationRows:0});
  expect((await historical.pool.query("SELECT count(*)::int AS n FROM ls_control.migrations WHERE name='0130_ls_draft_group_meetings.sql'")).rows[0]).toEqual({n:0});
  expect(await migrate(tx(),files,false)).toEqual({applied:1,pending:0});
  const history1=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot1=await readDraftGroupMeetingsReleaseSnapshot(tx());
  expect(draftGroupMeetingsPlan(files,history1,snapshot1)).toMatchObject({stage:1,pending:[]});expect(snapshot1.catalogDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(await migrate(tx(),files,false)).toEqual({applied:0,pending:0});expect(await migrate(tx(),files,true)).toEqual({applied:0,pending:0});
  const revisionId=randomUUID(),operationId=randomUUID(),digest='d'.repeat(64);
  await historical.pool.query("INSERT INTO ls_group_admin.draft_meeting_revisions(workspace_id,id,occurrence_id,draft_group_id,previous_revision_id,state,time_zone,local_start,starts_at,ends_at,duration_minutes,venue_ciphertext,recorded_by,request_digest,created_at) VALUES($1,$2,$2,$3,NULL,'proposed','Asia/Jerusalem','2026-10-10T11:00','2026-10-10T08:00:00Z','2026-10-10T09:00:00Z',60,'synthetic-venue',$4,$5,now())",[workspaceId,revisionId,groupId,practitionerId,digest]);
  await historical.pool.query('INSERT INTO ls_group_admin.draft_meeting_operations(workspace_id,operation_id,recorded_by,request_digest,meeting_revision_id) VALUES($1,$2,$3,$4,$5)',[workspaceId,operationId,practitionerId,digest,revisionId]);
  await expect(historical.pool.query('DELETE FROM ls_group_admin.draft_meeting_revisions WHERE workspace_id=$1 AND id=$2',[workspaceId,revisionId])).rejects.toThrow(/GROUP_PLANNING_PROVENANCE_IMMUTABLE/);
  expect(await readDraftGroupMeetingsReleaseSnapshot(tx())).toMatchObject({stage:1,revisionRows:1,operationRows:1});expect(draftGroupMeetingsStateDigest(history0,snapshot0)).not.toBe(draftGroupMeetingsStateDigest(history1,snapshot1));
 },60000);

 test('successor and frozen predecessor catalog drift are rejected',async()=>{
  expect((await readDraftGroupMeetingsReleaseSnapshot(tx())).stage).toBe(1);
  for(const item of [
   {sql:'ALTER TABLE ls_group_admin.draft_meeting_revisions DROP CONSTRAINT draft_meeting_revisions_previous_fkey',error:'DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_group_admin.draft_meeting_revisions DISABLE TRIGGER draft_meeting_revisions_immutable',error:'DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT'},
   {sql:'GRANT SELECT ON ls_group_admin.draft_meeting_revisions TO PUBLIC',error:'DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_group_admin.draft_meeting_revisions ALTER COLUMN duration_minutes DROP NOT NULL',error:'DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT'},
   {sql:'DROP INDEX ls_group_admin.draft_meeting_revisions_group_history',error:'DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT'},
   {sql:"ALTER TABLE ls_group_admin.draft_meeting_revisions DROP CONSTRAINT draft_meeting_revisions_time_zone_check,ADD CONSTRAINT draft_meeting_revisions_time_zone_check CHECK(time_zone IN ('Asia/Jerusalem','UTC'))",error:'DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_group_admin.proposed_placement_moves DISABLE TRIGGER proposed_placement_moves_immutable',error:'DRAFT_GROUP_MEETINGS_BASELINE_SCHEMA_CONFLICT'},
  ]){await historical.pool.query('BEGIN');try{await historical.pool.query(item.sql);await expect(readDraftGroupMeetingsReleaseSnapshot(tx())).rejects.toThrow(item.error);}finally{await historical.pool.query('ROLLBACK');}}
 },60000);
});
