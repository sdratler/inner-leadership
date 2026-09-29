import {afterAll,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixture,type Fixture} from '../calendar/fixture.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';
import {practiceFunctionBody,practiceSubjectIntegrity,PRACTICE_SUBJECT_GUARDS_MIGRATION} from '../../../src/db/practice-subject-integrity.ts';
const files=['0040_ls_home_practice_20260911.sql',PRACTICE_SUBJECT_GUARDS_MIGRATION.name].map(name=>{
 const sql=readFileSync(new URL(`../../../migrations/${name}`,import.meta.url),'utf8');
 return {name,sql,checksum:createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex')};
});
const opened:Fixture[]=[];
afterAll(async()=>{for(const f of opened)await f.pool.end();});
async function setup(){const f=await fixture();opened.push(f);return f;}
const present={baselineFunctions:false,reviewedFunctions:true,immutableHistory:true,schemaCatalog:true,foreignKeys:true,permissions:true,referencesSound:true};
async function probe(f:Fixture,statements:readonly string[],work:(tx:SqlSession)=>Promise<void>){
 const client=await f.pool.connect();try{
  await client.query('BEGIN');for(const sql of statements)await client.query(sql);
  await work({query:async <R extends object>(sql:string,values:readonly unknown[]=[]) => (await client.query<R>(sql,[...values])).rows});
 }finally{await client.query('ROLLBACK');client.release();}
}
test('native reviewed participant bodies retain the complete 0040 catalog, invoker permissions and immutable history',async()=>{
 const f=await setup();expect(files[1]?.checksum).toBe(PRACTICE_SUBJECT_GUARDS_MIGRATION.sha256);
 await probe(f,[],async tx=>expect(await practiceSubjectIntegrity(tx,files)).toEqual(present));
});
test('native guard distinguishes the original body pair from a partial upgrade without changing its ledger',async()=>{
 const f=await setup(),baseline='0040_ls_home_practice_20260911.sql';
 const coordination=`CREATE OR REPLACE FUNCTION ls_practice.check_coordination_actor_and_assignees() RETURNS trigger LANGUAGE plpgsql AS $fn$${practiceFunctionBody(files,baseline,'ls_practice.check_coordination_actor_and_assignees')}$fn$;`;
 const completion=`CREATE OR REPLACE FUNCTION ls_practice.check_completion_author() RETURNS trigger LANGUAGE plpgsql AS $fn$${practiceFunctionBody(files,baseline,'ls_practice.check_completion_author')}$fn$;`;
 await probe(f,[coordination],async tx=>expect(await practiceSubjectIntegrity(tx,files)).toEqual({...present,baselineFunctions:false,reviewedFunctions:false}));
 await probe(f,[coordination,completion],async tx=>expect(await practiceSubjectIntegrity(tx,files)).toEqual({...present,baselineFunctions:true,reviewedFunctions:false}));
 await probe(f,[],async tx=>expect(await practiceSubjectIntegrity(tx,files)).toEqual(present));
});
test('native guard refuses changed participant bodies, security mode and historic snapshot functions',async()=>{
 const f=await setup();
 for(const [sql,key] of [
  ['ALTER FUNCTION ls_practice.check_completion_author() SECURITY DEFINER','reviewedFunctions'],
  ['ALTER FUNCTION ls_practice.check_coordination_actor_and_assignees() SET search_path=public','reviewedFunctions'],
  ["CREATE OR REPLACE FUNCTION ls_practice.check_completion_author() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END; $fn$",'reviewedFunctions'],
  ["CREATE OR REPLACE FUNCTION ls_practice.protect_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END; $fn$",'immutableHistory'],
  ['ALTER FUNCTION ls_practice.check_active_version() SECURITY DEFINER','immutableHistory'],
  ["CREATE OR REPLACE FUNCTION ls_practice.uuid_array_is_unique(value uuid[]) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$ SELECT true; $fn$",'immutableHistory'],
 ] as const)await probe(f,[sql],async tx=>expect((await practiceSubjectIntegrity(tx,files))[key]).toBe(false));
 await probe(f,[],async tx=>expect(await practiceSubjectIntegrity(tx,files)).toEqual(present));
});
test('native guard refuses disabled or conditional protections and every column/index/constraint drift',async()=>{
 const f=await setup();
 for(const sql of [
  'ALTER TABLE ls_practice.completion_reports DISABLE TRIGGER protect_completion_report',
  'ALTER TABLE ls_practice.task_coordination_versions DISABLE TRIGGER check_coordination_actor_and_assignees',
  'ALTER TABLE ls_practice.practice_assignments DISABLE TRIGGER check_active_version',
  'ALTER TABLE ls_practice.practice_occurrences ALTER COLUMN coordination_version_id DROP NOT NULL',
  'ALTER TABLE ls_practice.completion_reports ADD COLUMN unreviewed text',
  'ALTER TABLE ls_practice.completion_reports ADD CONSTRAINT unreviewed CHECK(true) NOT VALID',
  'DROP INDEX ls_practice.practice_occurrences_by_date',
  "DROP TRIGGER protect_completion_report ON ls_practice.completion_reports; CREATE TRIGGER protect_completion_report BEFORE UPDATE OR DELETE ON ls_practice.completion_reports FOR EACH ROW WHEN (OLD.status='done') EXECUTE FUNCTION ls_practice.protect_immutable_row()",
 ])await probe(f,[sql],async tx=>expect((await practiceSubjectIntegrity(tx,files)).schemaCatalog).toBe(false));
 await probe(f,['ALTER TABLE ls_practice.practice_occurrences DISABLE TRIGGER ALL'],async tx=>expect((await practiceSubjectIntegrity(tx,files)).foreignKeys).toBe(false));
});
test('native guard refuses expanded schema/table/column/function grants without mutating any real source',async()=>{
 const f=await setup();
 for(const sql of ['GRANT USAGE ON SCHEMA ls_practice TO PUBLIC','GRANT SELECT ON ls_practice.completion_reports TO PUBLIC','GRANT SELECT(instructions_ciphertext) ON ls_practice.practice_assignment_versions TO PUBLIC',
  'CREATE ROLE ls_practice_guard_probe NOLOGIN; GRANT EXECUTE ON FUNCTION ls_practice.check_completion_author() TO ls_practice_guard_probe'])
  await probe(f,[sql],async tx=>expect((await practiceSubjectIntegrity(tx,files)).permissions).toBe(false));
 await probe(f,[],async tx=>expect(await practiceSubjectIntegrity(tx,files)).toEqual(present));
});
