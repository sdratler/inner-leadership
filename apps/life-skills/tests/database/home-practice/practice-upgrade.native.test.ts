/** Genuine 26 -> 27 upgrade, not a reset of a fully migrated ledger.
 * A fresh database is created ONLY inside the opted-in disposable loopback
 * cluster, then dropped by its exact generated name even if the test fails. */
import {expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {fixture,poolStore,safeTestUrl,type Fixture} from '../calendar/fixture.ts';
import {migrate} from '../../../src/db/migration-runner.ts';
import type {MigrationClient} from '../../../src/db/migration-runner.ts';
import type {Migration} from '../../../src/db/migration-plan.ts';
import {practiceSubjectIntegrity,PRACTICE_SUBJECT_GUARDS_MIGRATION} from '../../../src/db/practice-subject-integrity.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';
import {HomePracticeService} from '../../../src/features/home-practice/service.ts';
import {CheckInService} from '../../../src/features/checkins/service.ts';
import {systemClock,type Actor} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
import {seal,tokenDigest} from '../../../src/features/identity/crypto.ts';
import {asId} from '../../../src/lib/ids.ts';
import {legacyPracticeSeed,legacyCoordination} from './legacy-practice-fixture.ts';
import {practiceResponsibilityIntegrity} from '../../../src/db/practice-responsibility-integrity.ts';

test('native populated 26-to-27 upgrade preserves every historical row and admits only exact-subject future responsibility',async()=>{
 const cluster=new URL(safeTestUrl());
 // safeTestUrl also supports the exact frozen CI URL. Revalidate here before
 // granting this fixture any CREATE/DROP privilege on its temporary database.
 expect(['127.0.0.1','localhost','[::1]']).toContain(cluster.hostname);
 expect(cluster.search).toBe('');expect(cluster.hash).toBe('');
 const db='ls_calendar_test_practice_upgrade_'+randomBytes(8).toString('hex');
 if(!/^ls_calendar_test_practice_upgrade_[a-f0-9]{16}$/.test(db))throw new Error('PRACTICE_UPGRADE_DATABASE_NAME_INVALID');
 const adminUrl=new URL(cluster);adminUrl.pathname='/postgres';
 const testUrl=new URL(cluster);testUrl.pathname='/'+db;
 const admin=new pg.Pool({connectionString:adminUrl.toString(),ssl:false,max:1});
 const pool=new pg.Pool({connectionString:testUrl.toString(),ssl:false,max:1});
 let created=false,f:Fixture|undefined,client:pg.PoolClient|undefined;
 try{
  await admin.query(`CREATE DATABASE "${db}"`);created=true;
  const manifest=JSON.parse(readFileSync(new URL('../../../migrations/manifest.json',import.meta.url),'utf8')) as {name:string;sha256:string}[];
  const inventory:Migration[]=manifest.map(entry=>{
   const bytes=readFileSync(new URL(`../../../migrations/${entry.name}`,import.meta.url));
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
   return {name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')};
  });
  // Keep this historical upgrade's exact 26→27 scope when a later additive
  // migration is present. Every inventory checksum is still verified above.
  const files=inventory.slice(0,inventory.findIndex(file=>file.name===PRACTICE_SUBJECT_GUARDS_MIGRATION.name)+1);
  expect(files).toHaveLength(27);expect(files.at(-1)?.name).toBe(PRACTICE_SUBJECT_GUARDS_MIGRATION.name);
  client=await pool.connect();
  const migrationClient:MigrationClient={query:async(sql,values)=>(await client!.query(sql,values?[...values]:undefined))};
  expect(await migrate(migrationClient,files.slice(0,-1),false)).toEqual({applied:26,pending:0});
  vi.stubEnv('TEST_DATABASE_URL',testUrl.toString());vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');
  f=await fixture();
  const store=poolStore(f.pool),config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,
   csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
  const practice=new HomePracticeService(store,config,systemClock),checkins=new CheckInService(store,systemClock);
  const {saved,oldCoord,oldOccurrence}=await legacyPracticeSeed(f);
  const tx:SqlSession={query:async <R extends object>(sql:string,values:readonly unknown[]=[]) => (await client!.query<R>(sql,[...values])).rows};
  const oldProof={baselineFunctions:true,reviewedFunctions:false,immutableHistory:true,schemaCatalog:true,foreignKeys:true,permissions:true,referencesSound:true};
  expect(await practiceSubjectIntegrity(tx,files)).toEqual(oldProof);
  const historicalTables=['practice_assignments','practice_assignment_versions','task_coordination_versions','practice_occurrences','completion_reports','action_history'] as const;
  const snapshot=async()=>{
   const result:Record<string,unknown>={};
   for(const name of historicalTables)result[name]=(await client!.query(`SELECT to_jsonb(t) AS row FROM ls_practice.${name} t WHERE workspace_id=$1 ORDER BY id`,[f!.workspaceId])).rows;
   return result;
  };
  const before=await snapshot(),oldLedger=(await client.query('SELECT * FROM ls_control.migrations ORDER BY name')).rows;
  expect(await migrate(migrationClient,files,false)).toEqual({applied:1,pending:0});
  expect(await snapshot()).toEqual(before);
  expect((await client.query('SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name',[PRACTICE_SUBJECT_GUARDS_MIGRATION.name])).rows).toEqual(oldLedger);
  expect(await migrate(migrationClient,files,false)).toEqual({applied:0,pending:0});
  expect(await migrate(migrationClient,files,true)).toEqual({applied:0,pending:0});
  expect(await practiceSubjectIntegrity(tx,files)).toEqual({...oldProof,baselineFunctions:false,reviewedFunctions:true});

  const person=(await f.pool.query('SELECT person_id FROM ls_cases.clients cl JOIN ls_cases.cases c ON c.workspace_id=cl.workspace_id AND c.client_id=cl.id WHERE c.workspace_id=$1 AND c.id=$2',[f.workspaceId,f.first.id])).rows[0].person_id as string;
  const id=asId(randomUUID(),'account'),token=randomBytes(32).toString('base64url'),now=new Date();
  const child:Actor={id,workspaceId:f.workspaceId,personId:asId(person,'person'),role:'child',state:'active',locale:'en',sessionDigest:tokenDigest(token),expiresAt:Date.now()+3600000};
  await f.pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
   VALUES($1,$2,'child','active','en',$3,$4,$5,'synthetic-non-login-hash',$5,$5)`,[id,f.workspaceId,createHash('sha256').update(id).digest('hex'),seal('synthetic-upgrade@example.invalid',`email:${f.workspaceId}:${id}`,f.keyring),now]);
  await f.pool.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[f.workspaceId,id,person]);
  await f.pool.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[child.sessionDigest,f.workspaceId,id,now,new Date(child.expiresAt)]);
  await f.pool.query('INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,$5)',[f.workspaceId,f.first.id,f.first.audienceId,id,now]);
  // Prove the historical 0107 native actor gate BEFORE the later schema exists.
  await legacyCoordination(f,saved.assignmentId,f.parent.actor,[id],f.at(2));
  expect(await practiceSubjectIntegrity(tx,files)).toEqual({...oldProof,baselineFunctions:false,reviewedFunctions:true});
  // Now exercise the retained current services on the final schema, including
  // old unspecified metadata and exact-subject replay/permission behavior.
  expect(await migrate(migrationClient,inventory,false)).toEqual({applied:7,pending:0});
  const newCoord=await practice.coordinate(f.parent.actor,{assignmentId:saved.assignmentId,assigneeAccountIds:[id],completionMode:'any_assignee',reminderCandidateAccountIds:[],effectiveFrom:f.at(2)},randomUUID());
  const newOccurrence=await practice.schedule(f.practitioner.actor,{assignmentId:saved.assignmentId,occursOn:f.at(72).slice(0,10),period:'evening'},randomUUID());
  expect(newOccurrence.coordinationVersionId).toBe(newCoord.versionId);
  expect((await f.pool.query('SELECT coordination_version_id FROM ls_practice.practice_occurrences WHERE workspace_id=$1 AND id=$2',[f.workspaceId,oldOccurrence.id])).rows[0].coordination_version_id).toBe(oldCoord.versionId);
  const input={occurrenceId:newOccurrence.id,status:'done' as const,idempotencyKey:randomUUID()};
  await checkins.submit(child,input,randomUUID());await checkins.submit(child,input,randomUUID());
  await expect(checkins.submit(child,{...input,status:'not_done'},randomUUID())).rejects.toMatchObject({code:'CONFLICT'});
  await expect(checkins.submit(f.parent.actor,{...input,idempotencyKey:randomUUID()},randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
  const reports=await checkins.list(child,newOccurrence.id);expect(reports).toHaveLength(1);expect(reports[0]?.authorAccountId).toBe(id);
  const previous=(await checkins.list(f.parent.actor,oldOccurrence.id))[0]!;
  await checkins.submit(f.parent.actor,{occurrenceId:oldOccurrence.id,status:'partly_done',idempotencyKey:randomUUID(),correctsReportId:previous.reportId},randomUUID());
  expect(await checkins.list(f.parent.actor,oldOccurrence.id)).toEqual(expect.arrayContaining([previous,expect.objectContaining({revision:2,correctedReportId:previous.reportId,status:'partly_done'})]));
  expect((await practiceResponsibilityIntegrity(tx,inventory)).current).toEqual({metadataAbsent:false,schemaCatalog:true,foreignKeys:true,permissions:true,reviewedFunctions:true,immutableHistory:true,referencesSound:true});
 }finally{
  vi.unstubAllEnvs();await f?.pool.end();client?.release();await pool.end();
  if(created)await admin.query(`DROP DATABASE "${db}"`);
  await admin.end();
 }
},30000);
