/** Actual populated 30→31 upgrade in a NEW disposable loopback database.
 * These persisted fixture actors exercise service authorization, not passwords;
 * ordinary login and UI are separately required by the retained browser recipe. */
import {expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {fixture,poolStore,safeTestUrl,type Fixture} from '../calendar/fixture.ts';
import {migrate,type MigrationClient} from '../../../src/db/migration-runner.ts';
import type {Migration} from '../../../src/db/migration-plan.ts';
import {practiceAdultCoordinationIntegrity,PRACTICE_ADULT_COORDINATION_MIGRATION} from '../../../src/db/practice-adult-coordination-integrity.ts';
import {practiceFunctionBody,PRACTICE_SUBJECT_GUARDS_MIGRATION} from '../../../src/db/practice-subject-integrity.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';
import {HomePracticeService} from '../../../src/features/home-practice/service.ts';
import {CheckInService} from '../../../src/features/checkins/service.ts';
import {systemClock,type Actor} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
import {seal,tokenDigest} from '../../../src/features/identity/crypto.ts';
import {asId} from '../../../src/lib/ids.ts';
import {legacyPracticeSeed,legacyCoordination} from './legacy-practice-fixture.ts';
import {practiceResponsibilityIntegrity} from '../../../src/db/practice-responsibility-integrity.ts';

test('native populated 30-to-31 preserves immutable history and old checksums while enabling only exact adult self coordination',async()=>{
 const cluster=new URL(safeTestUrl());expect(['127.0.0.1','localhost','[::1]']).toContain(cluster.hostname);expect(cluster.search).toBe('');expect(cluster.hash).toBe('');
 const db='ls_calendar_test_adult_upgrade_'+randomBytes(8).toString('hex');
 if(!/^ls_calendar_test_adult_upgrade_[a-f0-9]{16}$/.test(db))throw new Error('ADULT_UPGRADE_DATABASE_NAME_INVALID');
 const adminUrl=new URL(cluster);adminUrl.pathname='/postgres';const testUrl=new URL(cluster);testUrl.pathname='/'+db;
 const admin=new pg.Pool({connectionString:adminUrl.toString(),ssl:false,max:1}),pool=new pg.Pool({connectionString:testUrl.toString(),ssl:false,max:1});
 let created=false,f:Fixture|undefined,client:pg.PoolClient|undefined;
 try{
  await admin.query(`CREATE DATABASE "${db}"`);created=true;
  const manifest=JSON.parse(readFileSync(new URL('../../../migrations/manifest.json',import.meta.url),'utf8')) as {name:string;sha256:string}[];
  const inventory:Migration[]=manifest.map(entry=>{const bytes=readFileSync(new URL(`../../../migrations/${entry.name}`,import.meta.url));expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);return {name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')};});
  const files=inventory.slice(0,inventory.findIndex(file=>file.name===PRACTICE_ADULT_COORDINATION_MIGRATION.name)+1);
  expect(files).toHaveLength(31);expect(files.at(-1)?.checksum).toBe(PRACTICE_ADULT_COORDINATION_MIGRATION.sha256);
  client=await pool.connect();const migrationClient:MigrationClient={query:async(sql,values)=>(await client!.query(sql,values?[...values]:undefined))};
  expect(await migrate(migrationClient,files.slice(0,-1),false)).toEqual({applied:30,pending:0});
  vi.stubEnv('TEST_DATABASE_URL',testUrl.toString());vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');f=await fixture();
  const store=poolStore(f.pool),config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
  const practice=new HomePracticeService(store,config,systemClock),checkins=new CheckInService(store,systemClock);
  const {saved,oldCoord,oldOccurrence}=await legacyPracticeSeed(f);
  const person=asId((await f.pool.query('SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2',[f.workspaceId,f.first.id])).rows[0].person_id as string,'person');
  const id=asId(randomUUID(),'account'),token=randomBytes(32).toString('base64url'),now=new Date();
  const adult:Actor={id,workspaceId:f.workspaceId,personId:person,role:'adult_client',state:'active',locale:'en',sessionDigest:tokenDigest(token),expiresAt:Date.now()+3600000};
  await f.pool.query("UPDATE ls_identity.people SET kind='adult' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,person]);
  await f.pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
   VALUES($1,$2,'adult_client','active','en',$3,$4,$5,'synthetic-non-login-hash',$5,$5)`,[id,f.workspaceId,createHash('sha256').update(id).digest('hex'),seal('synthetic-adult-upgrade@example.invalid',`email:${f.workspaceId}:${id}`,f.keyring),now]);
  await f.pool.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[f.workspaceId,id,person]);
  await f.pool.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[adult.sessionDigest,f.workspaceId,id,now,new Date(adult.expiresAt)]);
  await f.pool.query('INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,$5)',[f.workspaceId,f.first.id,f.first.audienceId,id,now]);
  const tx:SqlSession={query:async <R extends object>(sql:string,values:readonly unknown[]=[]) => (await client!.query<R>(sql,[...values])).rows};
  const sound={baselineFunctions:false,reviewedFunctions:true,immutableHistory:true,schemaCatalog:true,foreignKeys:true,permissions:true,referencesSound:true};
  expect(await practiceAdultCoordinationIntegrity(tx,files)).toEqual({prior:sound,current:{...sound,reviewedFunctions:false}});
  const self={assignmentId:saved.assignmentId,assigneeAccountIds:[id],completionMode:'any_assignee' as const,reminderCandidateAccountIds:[id],effectiveFrom:f.at(2)};
  await expect(legacyCoordination(f,saved.assignmentId,adult,[id],f.at(2))).rejects.toMatchObject({code:'23514',message:'LS_PRACTICE_PARENT_REQUIRED'});
  const tables=['practice_assignments','practice_assignment_versions','task_coordination_versions','practice_occurrences','completion_reports','action_history'] as const;
  const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of tables)result[table]=(await client!.query(`SELECT to_jsonb(t) AS row FROM ls_practice.${table} t WHERE workspace_id=$1 ORDER BY id`,[f!.workspaceId])).rows;return result;};
  const before=await snapshot(),ledger=(await client.query('SELECT * FROM ls_control.migrations ORDER BY name')).rows;
  expect(await migrate(migrationClient,files,false)).toEqual({applied:1,pending:0});expect(await snapshot()).toEqual(before);
  expect((await client.query('SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name',[PRACTICE_ADULT_COORDINATION_MIGRATION.name])).rows).toEqual(ledger);
  expect(await migrate(migrationClient,files,false)).toEqual({applied:0,pending:0});expect(await migrate(migrationClient,files,true)).toEqual({applied:0,pending:0});
  const proof={prior:{...sound,reviewedFunctions:false},current:sound};expect(await practiceAdultCoordinationIntegrity(tx,files)).toEqual(proof);
  // Inspect all historical drift probes on the ACTUAL31 frame, then migrate
  // forward and test the retained services against the final native schema.
  for(const [statement,key] of [
   ['ALTER FUNCTION ls_practice.check_coordination_actor_and_assignees() SECURITY DEFINER','reviewedFunctions'],
   ['ALTER TABLE ls_practice.task_coordination_versions DISABLE TRIGGER check_coordination_actor_and_assignees','schemaCatalog'],
   ['GRANT SELECT ON ls_practice.completion_reports TO PUBLIC','permissions'],
  ] as const){await client.query('BEGIN');try{await client.query(statement);expect((await practiceAdultCoordinationIntegrity(tx,files)).current[key]).toBe(false);}finally{await client.query('ROLLBACK');}}
  await legacyCoordination(f,saved.assignmentId,adult,[id],f.at(2));
  expect(await practiceAdultCoordinationIntegrity(tx,files)).toEqual(proof);
  expect(await migrate(migrationClient,inventory,false)).toEqual({applied:4,pending:0});
  const modernProof={metadataAbsent:false,schemaCatalog:true,foreignKeys:true,permissions:true,reviewedFunctions:true,immutableHistory:true,referencesSound:true};
  const changed=await practice.coordinate(adult,self,randomUUID());
  const newOccurrence=await practice.schedule(f.practitioner.actor,{assignmentId:saved.assignmentId,occursOn:f.at(72).slice(0,10),period:'evening'},randomUUID());expect(newOccurrence.coordinationVersionId).toBe(changed.versionId);
  expect((await f.pool.query('SELECT coordination_version_id FROM ls_practice.practice_occurrences WHERE workspace_id=$1 AND id=$2',[f.workspaceId,oldOccurrence.id])).rows[0].coordination_version_id).toBe(oldCoord.versionId);
  const checkin={occurrenceId:newOccurrence.id,status:'done' as const,idempotencyKey:randomUUID()};await checkins.submit(adult,checkin,randomUUID());await checkins.submit(adult,checkin,randomUUID());expect(await checkins.list(adult,newOccurrence.id)).toHaveLength(1);
  await expect(practice.coordinate(adult,{...self,assigneeAccountIds:[f.parent.actor.id]},randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(checkins.submit(f.parent.actor,{...checkin,idempotencyKey:randomUUID()},randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
  expect((await practiceResponsibilityIntegrity(tx,inventory)).current).toEqual(modernProof);
  // Preserve the same attacks against the final frame too.
  for(const [statement,key] of [
   ['ALTER FUNCTION ls_practice.check_coordination_actor_and_assignees() SECURITY DEFINER','reviewedFunctions'],
   ['ALTER TABLE ls_practice.task_coordination_versions DISABLE TRIGGER check_coordination_actor_and_assignees','schemaCatalog'],
   ['GRANT SELECT ON ls_practice.completion_reports TO PUBLIC','permissions'],
  ] as const){await client.query('BEGIN');try{await client.query(statement);expect((await practiceResponsibilityIntegrity(tx,inventory)).current[key]).toBe(false);}finally{await client.query('ROLLBACK');}}
  expect((await practiceResponsibilityIntegrity(tx,inventory)).current).toEqual(modernProof);
  // The original source's immutable body and checksum remain accessible, not rewritten.
  expect(files.find(file=>file.name===PRACTICE_SUBJECT_GUARDS_MIGRATION.name)?.checksum).toBe(PRACTICE_SUBJECT_GUARDS_MIGRATION.sha256);
  expect(practiceFunctionBody(files,PRACTICE_SUBJECT_GUARDS_MIGRATION.name,'ls_practice.check_coordination_actor_and_assignees')).not.toBe(practiceFunctionBody(files,PRACTICE_ADULT_COORDINATION_MIGRATION.name,'ls_practice.check_coordination_actor_and_assignees'));
 }finally{
  vi.unstubAllEnvs();await f?.pool.end();client?.release();await pool.end();if(created)await admin.query(`DROP DATABASE "${db}"`);await admin.end();
 }
},30000);
