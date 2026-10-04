import {expect,test,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {fixture,poolStore,type Fixture} from '../calendar/fixture.ts';
import {historicalPracticeDatabase,legacyPracticeSeed} from '../home-practice/legacy-practice-fixture.ts';
import {migrate} from '../../../src/db/migration-runner.ts';
import {practiceReminderIntegrity,PRACTICE_REMINDER_MIGRATION} from '../../../src/db/practice-reminder-integrity.ts';
import {HomePracticeService} from '../../../src/features/home-practice/service.ts';
import {nativeResponsibility,nativeResponsibilityOccurrences,nativeOccurrenceId} from '../../../src/features/home-practice/responsibility-service.ts';
import {systemClock} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
import type {ResponsibilityInput} from '../../../src/features/home-practice/responsibility-input.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';
test('populated34-to35 preserves every historical row/ledger byte and neither backfills legacy nor timed occurrences',async()=>{
 const historical=await historicalPracticeDatabase('0114_ls_practice_responsibilities.sql');let f:Fixture|undefined;
 try{
  expect(historical.files).toHaveLength(34);expect(historical.inventory).toHaveLength(35);vi.stubEnv('TEST_DATABASE_URL',historical.url);vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');f=await fixture();await legacyPracticeSeed(f);
  const store=poolStore(f.pool),config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600},practice=new HomePracticeService(store,config,systemClock);
  const day=f.at(24).slice(0,10),end=f.at(240).slice(0,10),instructions='Synthetic pre-reminder timed source',responsibility:ResponsibilityInput={participant:'parent',period:'morning',assigneeAccountIds:[f.parent.actor.id],assistedByParentAccountIds:[],reminderRecipients:[{accountId:f.parent.actor.id,purpose:'self'}],completionMode:'any_assignee',weekdays:[0,1,2,3,4,5,6],localTime:'18:45',timezone:'UTC',timeOrigin:'practitioner',foldChoice:null};
  const saved=await practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:'Synthetic prior',templateVersion:'synthetic-v1',instructions,startsOn:day,endsOn:end,responsibility},randomUUID());await practice.publish(f.practitioner.actor,saved.assignmentId,saved.versionId,randomUUID());
  const person=(await f.pool.query('SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.id=$1',[f.first.id])).rows[0].person_id;
  const value=nativeResponsibility({workspaceId:f.workspaceId,caseId:f.first.id,assignmentId:saved.assignmentId,versionId:saved.versionId,version:1,instructions,startsOn:day,endsOn:end},person,responsibility,[f.parent.actor.id,f.parentTwo.actor.id]),planned=nativeResponsibilityOccurrences(value,responsibility,day,1).occurrences[0]!,id=nativeOccurrenceId(planned.id),coord=(await f.pool.query('SELECT id FROM ls_practice.task_coordination_versions WHERE workspace_id=$1 AND assignment_id=$2 ORDER BY version DESC LIMIT 1',[f.workspaceId,saved.assignmentId])).rows[0].id;
  // Only historical raw seed. The retained native source/coordination/time triggers remain enabled.
  await f.pool.query(`INSERT INTO ls_practice.practice_occurrences(id,workspace_id,assignment_id,practice_version_id,coordination_version_id,occurs_on,period,state,created_at,occurs_at) VALUES($1,$2,$3,$4,$5,$6,'morning','open',now(),$7)`,[id,f.workspaceId,saved.assignmentId,saved.versionId,coord,day,planned.startsAt]);
  const client=await historical.pool.connect();try{
   const tx:SqlSession={query:async<R extends object>(sql:string,values:readonly unknown[]=[]) =>(await client.query<R>(sql,[...values])).rows},runner={query:async(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined)};
   const beforeProof=await practiceReminderIntegrity(tx,historical.inventory);expect(beforeProof.prior.schemaCatalog).toBe(true);expect(beforeProof.current.metadataAbsent).toBe(true);expect(beforeProof.current.schemaCatalog).toBe(false);
   const tables=['practice_assignments','practice_assignment_versions','task_coordination_versions','practice_occurrences','completion_reports','action_history']as const;
   const snapshot=async()=>{const rows:Record<string,unknown>={};for(const table of tables)rows[table]=(await client.query(`SELECT to_jsonb(t) AS row FROM ls_practice.${table} t WHERE workspace_id=$1 ORDER BY id`,[f!.workspaceId])).rows;return rows;};
   const before=await snapshot(),ledger=(await client.query('SELECT * FROM ls_control.migrations ORDER BY name')).rows;
   expect(await migrate(runner,historical.inventory,false)).toEqual({applied:1,pending:0});expect(await snapshot()).toEqual(before);expect((await client.query('SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name',[PRACTICE_REMINDER_MIGRATION.name])).rows).toEqual(ledger);
   expect((await client.query('SELECT count(*)::int AS count FROM ls_notifications.notification_outbox')).rows[0].count).toBe(0);expect((await client.query('SELECT count(*)::int AS count FROM ls_notifications.message_deliveries')).rows[0].count).toBe(0);
   expect(await practice.schedule(f!.practitioner.actor,{assignmentId:saved.assignmentId,occursOn:day,period:'morning'},randomUUID())).toMatchObject({id,occursAt:planned.startsAt});expect(await snapshot()).toEqual(before);expect((await client.query('SELECT count(*)::int AS count FROM ls_notifications.notification_outbox')).rows[0].count).toBe(0);
   expect((await practiceReminderIntegrity(tx,historical.inventory)).current).toEqual({metadataAbsent:false,schemaCatalog:true,foreignKeys:true,permissions:true,reviewedFunctions:true,referencesSound:true});expect(await migrate(runner,historical.inventory,false)).toEqual({applied:0,pending:0});expect(await migrate(runner,historical.inventory,true)).toEqual({applied:0,pending:0});
   const next=new Date(Date.parse(day)+86400000).toISOString().slice(0,10);await practice.schedule(f!.practitioner.actor,{assignmentId:saved.assignmentId,occursOn:next,period:'morning'},randomUUID());expect((await client.query('SELECT count(*)::int AS count FROM ls_notifications.notification_outbox WHERE workspace_id=$1',[f!.workspaceId])).rows[0].count).toBe(4);
  }finally{client.release();}
 }finally{await f?.pool.end();vi.unstubAllEnvs();await historical.close();}
},30000);
