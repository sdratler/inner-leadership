import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test,vi} from 'vitest';
import {migrate} from '../../src/db/migration-runner.ts';
import {fishingPracticeMigrationInventory,fishingPracticePlan,fishingPracticeStateDigest,readFishingPracticeReleaseSnapshot} from '../../src/db/fishing-practice-release.ts';
import {historicalPracticeDatabase} from './home-practice/legacy-practice-fixture.ts';

let historical:Awaited<ReturnType<typeof historicalPracticeDatabase>>;
const tx=()=>({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{const result=await historical.pool.query<R>(sql,[...values]);return {rows:result.rows};}});
beforeAll(async()=>{historical=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql');},60000);
afterAll(async()=>{vi.unstubAllEnvs();await historical?.close();});

describe('fishing practice migration 0132 native release proof',()=>{
 test('failed apply rolls back; exact apply/readback/repeat preserves append-only synthetic evidence',async()=>{
  const files=fishingPracticeMigrationInventory(historical.inventory),baseline=files.filter(f=>f.name!=='0132_ls_fishing_practice_revisions.sql'),migration=files.find(f=>f.name==='0132_ls_fishing_practice_revisions.sql')!;
  expect(await migrate(tx(),baseline,false)).toEqual({applied:14,pending:0});
  const workspaceId=randomUUID(),practitionerId=randomUUID(),minorId=randomUUID(),familyId=randomUUID(),inquiryId=randomUUID(),interestId=randomUUID(),groupId=randomUUID(),placementId=randomUUID();
  await historical.pool.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())',[workspaceId]);
  await historical.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','synthetic-minor',now())",[minorId,workspaceId]);
  await historical.pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',now(),'synthetic',now(),now())",[practitionerId,workspaceId,'b'.repeat(64)]);
  await historical.pool.query("INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,'synthetic-family',now())",[familyId,workspaceId]);
  await historical.pool.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspaceId,familyId,minorId]);
  await historical.pool.query("INSERT INTO ls_service_interest.inquiries(workspace_id,id,recorded_by,request_digest,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,'synthetic-inquiry',now())",[workspaceId,inquiryId,practitionerId,'c'.repeat(64)]);
  await historical.pool.query("INSERT INTO ls_service_interest.service_interests(workspace_id,id,family_id,person_id,member_role,person_kind,service_type,source_inquiry_id,recorded_by,request_digest,created_at) VALUES($1,$2,$3,$4,'child','minor','group',$5,$6,$7,now())",[workspaceId,interestId,familyId,minorId,inquiryId,practitionerId,'d'.repeat(64)]);
  await historical.pool.query("INSERT INTO ls_group_admin.draft_groups(workspace_id,id,label_ciphertext,recorded_by,request_digest,created_at) VALUES($1,$2,'synthetic-group',$3,$4,now())",[workspaceId,groupId,practitionerId,'e'.repeat(64)]);
  await historical.pool.query("INSERT INTO ls_group_admin.proposed_placements(workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id,recorded_by,request_digest,created_at) VALUES($1,$2,$3,$4,'group',$5,$6,$7,$8,now())",[workspaceId,placementId,groupId,interestId,familyId,minorId,practitionerId,'f'.repeat(64)]);
  const history0=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot0=await readFishingPracticeReleaseSnapshot(tx());
  expect(fishingPracticePlan(files,history0,snapshot0)).toMatchObject({stage:0,pending:[expect.objectContaining({name:'0132_ls_fishing_practice_revisions.sql'})]});
  await historical.pool.query('BEGIN');try{await historical.pool.query('CREATE TABLE ls_group_admin.fishing_practice_revisions(id uuid)');await expect(readFishingPracticeReleaseSnapshot(tx())).rejects.toThrow('FISHING_PRACTICE_SCHEMA_STATE_CONFLICT');}finally{await historical.pool.query('ROLLBACK');}
  const fault={query:async(sql:string,values?:readonly unknown[])=>tx().query(sql===migration.sql?sql+'\nSELECT * FROM ls_missing_fishing_table;':sql,values)};
  await expect(migrate(fault,files,false)).rejects.toThrow('MIGRATION_FAILED');
  expect(await readFishingPracticeReleaseSnapshot(tx())).toMatchObject({stage:0,revisionRows:0,operationRows:0});
  expect(await migrate(tx(),files,false)).toEqual({applied:1,pending:0});
  const history1=(await historical.pool.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,snapshot1=await readFishingPracticeReleaseSnapshot(tx());
  expect(fishingPracticePlan(files,history1,snapshot1)).toMatchObject({stage:1,pending:[]});expect(await migrate(tx(),files,false)).toEqual({applied:0,pending:0});expect(await migrate(tx(),files,true)).toEqual({applied:0,pending:0});
  const revisionId=randomUUID(),operationId=randomUUID(),digest='1'.repeat(64);
  await historical.pool.query("INSERT INTO ls_group_admin.fishing_practice_revisions(workspace_id,id,draft_group_id,proposed_placement_id,program_key,module_key,evidence_state,note_ciphertext,previous_revision_id,recorded_by,request_digest,created_at) VALUES($1,$2,$3,$4,'fishing_lessons','knots','practice_observed','synthetic-ciphertext',NULL,$5,$6,now())",[workspaceId,revisionId,groupId,placementId,practitionerId,digest]);
  await historical.pool.query('INSERT INTO ls_group_admin.fishing_practice_operations(workspace_id,operation_id,recorded_by,request_digest,practice_revision_id) VALUES($1,$2,$3,$4,$5)',[workspaceId,operationId,practitionerId,digest,revisionId]);
  await expect(historical.pool.query('DELETE FROM ls_group_admin.fishing_practice_revisions WHERE workspace_id=$1 AND id=$2',[workspaceId,revisionId])).rejects.toThrow(/GROUP_PLANNING_PROVENANCE_IMMUTABLE/);
  expect(await readFishingPracticeReleaseSnapshot(tx())).toMatchObject({stage:1,revisionRows:1,operationRows:1});expect(fishingPracticeStateDigest(history0,snapshot0)).not.toBe(fishingPracticeStateDigest(history1,snapshot1));
 },60000);

 test('successor and frozen predecessor drift are rejected',async()=>{
  expect((await readFishingPracticeReleaseSnapshot(tx())).stage).toBe(1);
  for(const item of [
   {sql:'ALTER TABLE ls_group_admin.fishing_practice_revisions DROP CONSTRAINT fishing_practice_revisions_placement_fkey',error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_group_admin.fishing_practice_revisions DISABLE TRIGGER fishing_practice_revisions_immutable',error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:'DROP TRIGGER fishing_practice_revisions_immutable ON ls_group_admin.fishing_practice_revisions;CREATE TRIGGER fishing_practice_revisions_immutable BEFORE UPDATE ON ls_group_admin.fishing_practice_revisions FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation()',error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:"CREATE SCHEMA synthetic_trigger_drift;CREATE FUNCTION synthetic_trigger_drift.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END; $$;DROP TRIGGER fishing_practice_revisions_immutable ON ls_group_admin.fishing_practice_revisions;CREATE TRIGGER fishing_practice_revisions_immutable BEFORE UPDATE OR DELETE ON ls_group_admin.fishing_practice_revisions FOR EACH ROW EXECUTE FUNCTION synthetic_trigger_drift.reject_mutation()",error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_group_admin.draft_groups ADD CONSTRAINT proposed_placements_fishing_practice_identity_key CHECK(length(label_ciphertext)>0)',error:'FISHING_PRACTICE_BASELINE_SCHEMA_CONFLICT'},
   {sql:'GRANT SELECT ON ls_group_admin.fishing_practice_revisions TO PUBLIC',error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_group_admin.fishing_practice_revisions ALTER COLUMN note_ciphertext DROP NOT NULL',error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:"ALTER TABLE ls_group_admin.fishing_practice_revisions DROP CONSTRAINT fishing_practice_revisions_evidence_state_check,ADD CONSTRAINT fishing_practice_revisions_evidence_state_check CHECK(evidence_state <> '__never_used__')",error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:'DROP INDEX ls_group_admin.fishing_practice_revisions_history',error:'FISHING_PRACTICE_SCHEMA_STATE_CONFLICT'},
   {sql:'ALTER TABLE ls_service_interest.public_applications DISABLE TRIGGER public_group_application_immutable',error:'FISHING_PRACTICE_BASELINE_SCHEMA_CONFLICT'},
  ]){await historical.pool.query('BEGIN');try{await historical.pool.query(item.sql);await expect(readFishingPracticeReleaseSnapshot(tx())).rejects.toThrow(item.error);}finally{await historical.pool.query('ROLLBACK');}}
 },60000);
});
