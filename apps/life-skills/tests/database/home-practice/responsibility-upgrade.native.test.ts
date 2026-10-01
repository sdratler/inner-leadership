import {expect,test,vi} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {historicalPracticeDatabase,legacyPracticeSeed} from "./legacy-practice-fixture.ts";
import {migrate} from "../../../src/db/migration-runner.ts";
import {practiceResponsibilityIntegrity,PRACTICE_RESPONSIBILITY_MIGRATION} from "../../../src/db/practice-responsibility-integrity.ts";
import {HomePracticeService} from "../../../src/features/home-practice/service.ts";
import {CheckInService} from "../../../src/features/checkins/service.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import type {SqlSession} from "../../../src/features/identity/store.ts";

test("populated33-to34 keeps every historical value/digest/receipt and ledger byte; new metadata is only NULL",async()=>{
 const historical=await historicalPracticeDatabase("0113_ls_speaker_correction_receipts.sql");let f:Fixture|undefined;
 try{
  expect(historical.files).toHaveLength(33);expect(historical.inventory).toHaveLength(34);
  vi.stubEnv("TEST_DATABASE_URL",historical.url);vi.stubEnv("LS_CALENDAR_TEST_ALLOW","true");f=await fixture();
  const {saved,oldOccurrence}=await legacyPracticeSeed(f),client=await historical.pool.connect();
  try{
   const tx:SqlSession={query:async <R extends object>(sql:string,values:readonly unknown[]=[]) => (await client.query<R>(sql,[...values])).rows},runner={query:async(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined)};
   const beforeProof=await practiceResponsibilityIntegrity(tx,historical.inventory);
   expect(beforeProof.prior).toEqual({baselineFunctions:false,reviewedFunctions:true,immutableHistory:true,schemaCatalog:true,foreignKeys:true,permissions:true,referencesSound:true});
   expect(beforeProof.current).toEqual({metadataAbsent:true,reviewedFunctions:false,immutableHistory:true,schemaCatalog:false,foreignKeys:false,permissions:false,referencesSound:false});
   // A partial/wrong-type installation does not masquerade as either frame.
   await client.query("BEGIN");try{await client.query("ALTER TABLE ls_practice.practice_assignment_versions ADD COLUMN responsibility text");const partial=await practiceResponsibilityIntegrity(tx,historical.inventory);expect(partial.prior.schemaCatalog).toBe(false);expect(partial.current.metadataAbsent).toBe(false);expect(partial.current.schemaCatalog).toBe(false);}finally{await client.query("ROLLBACK");}
   const nullable:Record<string,Record<string,null>>={practice_assignments:{},practice_assignment_versions:{responsibility:null},task_coordination_versions:{responsibility_version_id:null,participant:null,assisted_parent_account_ids:null},practice_occurrences:{occurs_at:null,cancelled_at:null,superseded_by_version_id:null},completion_reports:{subject_person_id:null,authorship:null,note_ciphertext:null},action_history:{}};
   const before:Record<string,{row:Record<string,unknown>}[]>={};for(const table of Object.keys(nullable))before[table]=(await client.query(`SELECT to_jsonb(t) AS row FROM ls_practice.${table} t WHERE workspace_id=$1 ORDER BY id`,[f.workspaceId])).rows;
   const ledger=(await client.query("SELECT * FROM ls_control.migrations ORDER BY name")).rows;
   expect(await migrate(runner,historical.inventory,false)).toEqual({applied:1,pending:0});
   for(const table of Object.keys(nullable)){const after=(await client.query(`SELECT to_jsonb(t) AS row FROM ls_practice.${table} t WHERE workspace_id=$1 ORDER BY id`,[f.workspaceId])).rows;expect(after).toEqual(before[table]!.map(value=>({row:{...value.row,...nullable[table]}})));}
   expect((await client.query("SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name",[PRACTICE_RESPONSIBILITY_MIGRATION.name])).rows).toEqual(ledger);
   expect(await migrate(runner,historical.inventory,false)).toEqual({applied:0,pending:0});expect(await migrate(runner,historical.inventory,true)).toEqual({applied:0,pending:0});
   expect((await practiceResponsibilityIntegrity(tx,historical.inventory)).current).toEqual({metadataAbsent:false,reviewedFunctions:true,immutableHistory:true,schemaCatalog:true,foreignKeys:true,permissions:true,referencesSound:true});
   const store=poolStore(f.pool),config:IdentityConfig={enabled:true,origin:"https://synthetic.example.invalid",workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600},practice=new HomePracticeService(store,config,systemClock),checkins=new CheckInService(store,systemClock,f.keyring);
   const managed=(await practice.management(f.practitioner.actor,f.first.id,f.first.audienceId)).items.find(row=>row.versionId===saved.versionId)!;
   expect(managed.instructions).toBe("Synthetic retained practice instruction");expect(managed).not.toHaveProperty("responsibility");
   const page=await practice.occurrences(f.parent.actor,f.first.id,f.first.audienceId,oldOccurrence.occursOn,new Date(Date.parse(oldOccurrence.occursOn)+86400000).toISOString().slice(0,10));
   expect(page.items[0]!.occurrence).not.toHaveProperty("occursAt");expect(page.items[0]).not.toHaveProperty("schedule");expect(page.items[0]!.ownReport).not.toHaveProperty("attribution");
   const own=(await checkins.list(f.parent.actor,oldOccurrence.id,true))[0]!;expect(own).not.toHaveProperty("attribution");
   await checkins.submit(f.parent.actor,{occurrenceId:oldOccurrence.id,status:own.status,idempotencyKey:own.idempotencyKey},randomUUID());expect(await checkins.list(f.parent.actor,oldOccurrence.id,true)).toEqual([own]);
  }finally{client.release();}
 }finally{await f?.pool.end();vi.unstubAllEnvs();await historical.close();}
},30000);
