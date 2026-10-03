import {expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
import {fixture,poolStore,type Fixture} from '../calendar/fixture.ts';
import {historicalPracticeDatabase,legacyPracticeSeed} from '../home-practice/legacy-practice-fixture.ts';
import {migrate} from '../../../src/db/migration-runner.ts';
import {contactOpsMigrationPrefix} from '../../../src/db/contact-ops-production-guard.ts';
import {practiceReminderIntegrity,PRACTICE_REMINDER_MIGRATION} from '../../../src/db/practice-reminder-integrity.ts';
import {contactAcquisitionIntegrity,ACQUISITION_CANDIDATES_MIGRATION,ACQUISITION_DECISIONS_MIGRATION} from '../../../src/db/contact-acquisition-integrity.ts';
import {AcquisitionCandidateStore} from '../../../src/features/contact-ops/server/acquisition-store.ts';
import {AcquisitionDecisionStore} from '../../../src/features/contact-ops/server/acquisition-decisions.ts';
import {ContactCutoverStore,type CutoverEvidence} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {privateDigest} from '../../../src/features/contact-ops/server/digests.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';

const absent={objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,reviewedFunctions:false,permissions:false,referencesSound:false};
const applied={objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,reviewedFunctions:true,permissions:true,referencesSound:true};
test('populated34→35→36→37 preserves encrypted history/ledger, exact additive frames and immutable permission denials',async()=>{
 const historical=await historicalPracticeDatabase('0114_ls_practice_responsibilities.sql');let f:Fixture|undefined;
 try{
  vi.stubEnv('TEST_DATABASE_URL',historical.url);vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');f=await fixture();await legacyPracticeSeed(f);
  const client=await historical.pool.connect();try{
   const tx:SqlSession={query:async<R extends object>(sql:string,values:readonly unknown[]=[]) =>(await client.query<R>(sql,[...values])).rows},runner={query:async(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined)};
   const tables=['ls_identity.people','ls_identity.accounts','ls_cases.cases','ls_practice.practice_assignments','ls_practice.practice_assignment_versions','ls_practice.task_coordination_versions','ls_practice.practice_occurrences','ls_practice.completion_reports','ls_practice.action_history'];
   const snapshot=async()=>Promise.all(tables.map(async table=>(await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f!.workspaceId])).rows));
   const before=await snapshot(),ledger=(await client.query('SELECT * FROM ls_control.migrations ORDER BY name')).rows;
   const through35=contactOpsMigrationPrefix(historical.inventory,PRACTICE_REMINDER_MIGRATION.name),through36=contactOpsMigrationPrefix(historical.inventory,ACQUISITION_CANDIDATES_MIGRATION.name),through37=contactOpsMigrationPrefix(historical.inventory,ACQUISITION_DECISIONS_MIGRATION.name);
   expect([historical.files.length,through35.length,through36.length,through37.length]).toEqual([34,35,36,37]);
   expect((await practiceReminderIntegrity(tx,through35)).current.metadataAbsent).toBe(true);
   expect(await migrate(runner,through35,false)).toEqual({applied:1,pending:0});
   expect((await practiceReminderIntegrity(tx,through35)).current).toEqual({metadataAbsent:false,schemaCatalog:true,foreignKeys:true,permissions:true,reviewedFunctions:true,referencesSound:true});
   expect(await contactAcquisitionIntegrity(tx,through36,'candidate')).toEqual(absent);
   expect(await migrate(runner,through36,false)).toEqual({applied:1,pending:0});
   expect(await contactAcquisitionIntegrity(tx,through36,'candidate')).toEqual(applied);
   expect(await contactAcquisitionIntegrity(tx,through37,'decisions')).toEqual({...absent,reviewedFunctions:true});
   const key='synthetic-release-guard-integrity-only',db=poolStore(f.pool),candidates=new AcquisitionCandidateStore(db,f.keyring,key),inquiry={provider:'whapi' as const,channelId:'synthetic-release-guard',businessNumber:'+15558887000',providerEventId:'synthetic-guard-event',providerMessageId:'synthetic-guard-message',providerThreadId:'synthetic-guard-thread',eventType:'inbound_message' as const,fromMe:false as const,fromNumber:'+15558887777',pushName:'Synthetic guard contact',messageType:'text',messageText:'Synthetic guard body',occurredAt:'2026-10-03T02:00:00.000Z',media:[]};
   // Historical fixture uses the retained encrypted capture helper, not a
   // provider claim. No receipt/webhook integration is certified by this seed.
   await candidates.captureInTransaction(tx,f.workspaceId,inquiry,{binding:'a'.repeat(64),message:'b'.repeat(64),thread:'c'.repeat(64),messageDigest:'d'.repeat(64),sender:privateDigest({domain:'contact-endpoint-v1',workspace:f.workspaceId,phone:inquiry.fromNumber},key)});
   const candidateRows=(await client.query('SELECT * FROM ls_contact_ops.inbound_activity_candidates WHERE workspace_id=$1',[f.workspaceId])).rows;
   expect(candidateRows).toHaveLength(1);expect(candidateRows[0].metadata_ciphertext).not.toContain(inquiry.fromNumber);
   const ledger36=(await client.query('SELECT * FROM ls_control.migrations ORDER BY name')).rows;
   expect(await migrate(runner,through37,false)).toEqual({applied:1,pending:0});
   expect(await contactAcquisitionIntegrity(tx,through37,'candidate')).toEqual(applied);expect(await contactAcquisitionIntegrity(tx,through37,'decisions')).toEqual(applied);
   expect(await snapshot()).toEqual(before);
   expect((await client.query('SELECT * FROM ls_control.migrations WHERE name=ANY($1::text[]) ORDER BY name',[historical.files.map(file=>file.name)])).rows).toEqual(ledger);
   expect((await client.query('SELECT * FROM ls_control.migrations WHERE name=ANY($1::text[]) ORDER BY name',[through36.map(file=>file.name)])).rows).toEqual(ledger36);
   expect((await client.query('SELECT * FROM ls_contact_ops.inbound_activity_candidates WHERE workspace_id=$1',[f.workspaceId])).rows).toEqual(candidateRows);
   expect((await client.query('SELECT count(*)::int AS n FROM ls_notifications.notification_outbox')).rows[0].n).toBe(0);
   expect(await migrate(runner,through37,false)).toEqual({applied:0,pending:0});expect(await migrate(runner,through37,true)).toEqual({applied:0,pending:0});
   // Existing isolated authority recipe only, never live cutover evidence.
   const authority=new ContactCutoverStore(db,f.keyring,key),proof=(epoch:number):CutoverEvidence=>({batchId:'synthetic-guard',sourceFileId:'synthetic-sheet',sourceRevision:'synthetic-revision',expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
   for(const [action,epoch]of [['prepare',0],['freeze',1],['switch_native',2]]as const)await authority.advance(f.practitioner.actor,{action,proof:proof(epoch),operationId:action});
   const decisions=new AcquisitionDecisionStore(db,f.keyring,key),candidate=(await candidates.recent(f.practitioner.actor,1)).items[0]!;
   await decisions.decide(f.practitioner.actor,{action:'promote',candidateId:candidate.id,operationId:randomUUID(),expectedEpoch:3,fields:{name:'Synthetic guard contact',stage:'New inquiry',language:'en',note:'Synthetic preserved note',nextAction:'Review inbound inquiry',dueDate:'2026-10-03'}});
   expect(await contactAcquisitionIntegrity(tx,through37,'decisions')).toEqual(applied);
   for(const table of ['inbound_activity_candidates','lead_promotion_operations']){
    await expect(client.query(`UPDATE ls_contact_ops.${table} SET workspace_id=workspace_id WHERE workspace_id=$1`,[f.workspaceId])).rejects.toMatchObject({code:'23514'});
    await expect(client.query(`DELETE FROM ls_contact_ops.${table} WHERE workspace_id=$1`,[f.workspaceId])).rejects.toMatchObject({code:'23514'});
    await expect(client.query(`TRUNCATE ls_contact_ops.${table} CASCADE`)).rejects.toMatchObject({code:'23514'});
   }
   const drift=async(sql:string,phase:'candidate'|'decisions',key:keyof typeof applied)=>{
    await client.query('BEGIN');try{await client.query(sql);expect((await contactAcquisitionIntegrity(tx,through37,phase))[key]).toBe(false);}finally{await client.query('ROLLBACK');}
    expect(await contactAcquisitionIntegrity(tx,through37,phase)).toEqual(applied);
   };
   await drift('CREATE INDEX synthetic_guard_extra ON ls_contact_ops.inbound_activity_candidates(id)','candidate','schemaCatalog');
   await drift('GRANT SELECT ON ls_contact_ops.inbound_activity_candidates TO PUBLIC','candidate','permissions');
   await drift('GRANT SELECT(metadata_ciphertext) ON ls_contact_ops.inbound_activity_candidates TO PUBLIC','candidate','permissions');
   await drift('ALTER FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation() SECURITY DEFINER','candidate','reviewedFunctions');
   await drift('GRANT EXECUTE ON FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation() TO PUBLIC','decisions','permissions');
   await drift('DELETE FROM ls_contact_ops.acquisition_projection_status','decisions','referencesSound');
   await drift('ALTER TABLE ls_contact_ops.acquisition_projection_status ENABLE ROW LEVEL SECURITY','decisions','schemaCatalog');
   const role='synthetic_guard_denied_'+randomUUID().replaceAll('-','');await client.query(`CREATE ROLE ${role} NOLOGIN`);
   try{await client.query(`GRANT USAGE ON SCHEMA ls_contact_ops TO ${role}`);await client.query(`SET ROLE ${role}`);
    try{for(const table of ['inbound_activity_candidates','lead_promotion_operations','acquisition_projection_status'])await expect(client.query(`SELECT * FROM ls_contact_ops.${table}`)).rejects.toMatchObject({code:'42501'});}finally{await client.query('RESET ROLE');}
   }finally{await client.query(`REVOKE USAGE ON SCHEMA ls_contact_ops FROM ${role}`);await client.query(`DROP ROLE ${role}`);}
  }finally{client.release();}
 }finally{await f?.pool.end();vi.unstubAllEnvs();await historical.close();}
},30000);
