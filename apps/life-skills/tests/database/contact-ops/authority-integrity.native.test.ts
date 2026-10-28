import {afterAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture,type Fixture} from '../calendar/fixture.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';
import {contactAuthorityIntegrity} from '../../../src/db/contact-authority-integrity.ts';
import {contactOpsSchemaCatalogMatches} from '../../../src/db/contact-ops-production-guard.ts';
import {academyAuthorityDependents,legacyAuthorityFixtureStatements,legacyAuthorityMigration} from './authority-integrity-fixture.ts';
const files=[legacyAuthorityMigration];
const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
async function setup(){const f=await fixture();fixtures.push(f);return f;}
const present={objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,appendOnlyFunction:true,publicRevoked:true,referencesSound:true};
async function probe(f:Fixture,statements:readonly string[],work:(tx:SqlSession)=>Promise<void>){
 const client=await f.pool.connect();try{
  await client.query('BEGIN');
  for(const sql of statements)await client.query(sql);
  await work({query:async <R extends object>(sql:string,values:readonly unknown[]=[])=>
   (await client.query<R>(sql,[...values])).rows});
 }finally{await client.query('ROLLBACK');client.release();}
}
async function probeLegacyAuthority(f:Fixture,statements:readonly string[],work:(tx:SqlSession)=>Promise<void>){
 await probe(f,[...legacyAuthorityFixtureStatements(),...statements],work);
}

test('legacy authority catalog proves the exact pinned 0105 schema and keeps original CRM catalog exact',async()=>{
 const f=await setup();await probeLegacyAuthority(f,[],async tx=>{
  expect(await contactAuthorityIntegrity(tx,files)).toEqual(present);
  const columns=(await tx.query<{catalog:unknown}>(`SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY c.relname,a.attnum) AS catalog
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_contact_ops'
   AND c.relname IN ('profiles','legacy_links','command_receipts') AND a.attnum>0 AND NOT a.attisdropped`))[0]!.catalog;
  const constraints=(await tx.query<{catalog:unknown}>(`SELECT json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) AS catalog
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='ls_contact_ops' AND c.relname IN ('profiles','legacy_links','command_receipts')`))[0]!.catalog;
  expect(contactOpsSchemaCatalogMatches(columns,constraints)).toBe(true);
 });
});

test('legacy authority proof rejects the Academy 0138 catalog and historical probes restore the current schema',async()=>{
 const f=await setup();
 const current={...present,schemaCatalog:false};
 await probe(f,[],async tx=>expect(await contactAuthorityIntegrity(tx,files)).toEqual(current));
 await probeLegacyAuthority(f,[],async tx=>expect(await contactAuthorityIntegrity(tx,files)).toEqual(present));
 await probe(f,[],async tx=>{
  expect(await contactAuthorityIntegrity(tx,files)).toEqual(current);
  expect((await tx.query<{contacts:boolean;activity:boolean;admission:boolean}>(`SELECT
   to_regclass('ls_contact_ops.academy_crm_contacts') IS NOT NULL AS contacts,
   to_regclass('ls_contact_ops.academy_crm_activity') IS NOT NULL AS activity,
   to_regprocedure('ls_contact_ops.guard_academy_crm_admission()') IS NOT NULL AS admission`))[0])
   .toEqual({contacts:true,activity:true,admission:true});
 });
});

test('native authority readback distinguishes absent from partial objects without a write',async()=>{
 const f=await setup();
 await probe(f,[...academyAuthorityDependents,'DROP TABLE ls_contact_ops.cutover_history','DROP TABLE ls_contact_ops.cutover','DROP FUNCTION ls_contact_ops.deny_cutover_history_mutation()'],async tx=>{
  expect(await contactAuthorityIntegrity(tx,files)).toEqual({objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,appendOnlyFunction:false,publicRevoked:false,referencesSound:false});
 });
 await probe(f,[...academyAuthorityDependents,'DROP TABLE ls_contact_ops.cutover_history'],async tx=>{
  expect(await contactAuthorityIntegrity(tx,files)).toMatchObject({objectsAbsent:false,tables:false,schemaCatalog:false,historyImmutable:false});
 });
 await probeLegacyAuthority(f,[],async tx=>expect(await contactAuthorityIntegrity(tx,files)).toEqual(present));
});

test('native authority detects disabled history/FK protections, altered function and catalog',async()=>{
 const f=await setup();
 for(const [sql,key] of [
  ['ALTER TABLE ls_contact_ops.cutover_history DISABLE TRIGGER cutover_history_no_edit','historyImmutable'],
  ['ALTER TABLE ls_contact_ops.cutover_history DISABLE TRIGGER cutover_history_no_truncate','historyImmutable'],
  ['ALTER TABLE ls_contact_ops.cutover_history DISABLE TRIGGER ALL','foreignKeys'],
  ["CREATE OR REPLACE FUNCTION ls_contact_ops.deny_cutover_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END; $fn$",'appendOnlyFunction'],
  ['ALTER TABLE ls_contact_ops.cutover ALTER COLUMN state_ciphertext DROP NOT NULL','schemaCatalog'],
  ['ALTER TABLE ls_contact_ops.cutover ADD COLUMN unintended text','schemaCatalog'],
 ] as const)await probeLegacyAuthority(f,[sql],async tx=>expect((await contactAuthorityIntegrity(tx,files))[key]).toBe(false));
});

test('native authority detects table/column/function grants and invalid cross-workspace references',async()=>{
 const f=await setup();
 for(const sql of ['GRANT SELECT ON ls_contact_ops.cutover TO PUBLIC','GRANT SELECT(state_ciphertext) ON ls_contact_ops.cutover TO PUBLIC',
  'GRANT EXECUTE ON FUNCTION ls_contact_ops.deny_cutover_history_mutation() TO PUBLIC','GRANT USAGE ON SCHEMA ls_contact_ops TO PUBLIC'])
  await probeLegacyAuthority(f,[sql],async tx=>expect((await contactAuthorityIntegrity(tx,files)).publicRevoked).toBe(false));
 await probeLegacyAuthority(f,['ALTER TABLE ls_contact_ops.cutover DISABLE TRIGGER ALL'],async tx=>{
  await tx.query("INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,0,'sheet_active','synthetic-orphan')",[randomUUID()]);
  expect(await contactAuthorityIntegrity(tx,files)).toMatchObject({foreignKeys:false,referencesSound:false});
 });
 await probeLegacyAuthority(f,[],async tx=>expect(await contactAuthorityIntegrity(tx,files)).toEqual(present));
});
