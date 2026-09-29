import {afterAll,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fixture,type Fixture} from '../calendar/fixture.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';
import {contactInboundIntegrity} from '../../../src/db/contact-inbound-integrity.ts';
import {contactAuthorityIntegrity} from '../../../src/db/contact-authority-integrity.ts';
import {CONTACT_AUTHORITY_MIGRATION,CONTACT_INBOUND_MIGRATION} from '../../../src/db/contact-ops-production-guard.ts';
const files=[CONTACT_AUTHORITY_MIGRATION,CONTACT_INBOUND_MIGRATION].map(migration=>({name:migration.name,checksum:migration.sha256,
 sql:readFileSync(new URL(`../../../migrations/${migration.name}`,import.meta.url),'utf8')}));
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

test('native inquiry proof binds exact migration, complete receipt catalog and intact authority baseline',async()=>{
 const f=await setup();
 for(const file of files)expect(createHash('sha256').update(file.sql.replace(/\r\n/g,'\n')).digest('hex')).toBe(file.checksum);
 await probe(f,[],async tx=>{
  expect(await contactInboundIntegrity(tx,files)).toEqual(present);
  expect(await contactAuthorityIntegrity(tx,files)).toEqual(present);
 });
});

test('native inquiry proof distinguishes fully absent from partial objects and makes no repair',async()=>{
 const f=await setup();
 const dependentTables=['DROP TABLE ls_contact_ops.inbound_projections','DROP TABLE ls_contact_ops.inbound_threads'];
 await probe(f,[...dependentTables,'DROP TABLE ls_contact_ops.message_receipts','DROP FUNCTION ls_contact_ops.deny_message_receipt_mutation()'],async tx=>{
  expect(await contactInboundIntegrity(tx,files)).toEqual({objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,appendOnlyFunction:false,publicRevoked:false,referencesSound:false});
 });
 await probe(f,[...dependentTables,'DROP TABLE ls_contact_ops.message_receipts'],async tx=>{
  expect(await contactInboundIntegrity(tx,files)).toMatchObject({objectsAbsent:false,tables:false,schemaCatalog:false,historyImmutable:false,appendOnlyFunction:true});
 });
 await probe(f,[],async tx=>expect(await contactInboundIntegrity(tx,files)).toEqual(present));
});

test('native inquiry proof refuses disabled protections, altered function, conditional triggers and catalog drift',async()=>{
 const f=await setup();
 for(const [sql,key] of [
  ['ALTER TABLE ls_contact_ops.message_receipts DISABLE TRIGGER message_receipts_no_edit','historyImmutable'],
  ['ALTER TABLE ls_contact_ops.message_receipts DISABLE TRIGGER message_receipts_no_truncate','historyImmutable'],
  ['ALTER TABLE ls_contact_ops.message_receipts DISABLE TRIGGER ALL','foreignKeys'],
  ["CREATE OR REPLACE FUNCTION ls_contact_ops.deny_message_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END; $fn$",'appendOnlyFunction'],
  ['ALTER FUNCTION ls_contact_ops.deny_message_receipt_mutation() SECURITY DEFINER','appendOnlyFunction'],
  ['ALTER TABLE ls_contact_ops.message_receipts ALTER COLUMN payload_ciphertext DROP NOT NULL','schemaCatalog'],
  ['ALTER TABLE ls_contact_ops.message_receipts ADD COLUMN unintended text','schemaCatalog'],
  ['ALTER TABLE ls_contact_ops.message_receipts ADD CONSTRAINT unreviewed CHECK(true) NOT VALID','schemaCatalog'],
  ['CREATE TRIGGER unreviewed BEFORE UPDATE ON ls_contact_ops.message_receipts FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_message_receipt_mutation()','historyImmutable'],
  ["DROP TRIGGER message_receipts_no_edit ON ls_contact_ops.message_receipts; CREATE TRIGGER message_receipts_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.message_receipts FOR EACH ROW WHEN (OLD.channel='whatsapp') EXECUTE FUNCTION ls_contact_ops.deny_message_receipt_mutation()",'historyImmutable'],
 ] as const)await probe(f,[sql],async tx=>expect((await contactInboundIntegrity(tx,files))[key]).toBe(false));
});

test('native inquiry proof detects data/function/schema grants and orphaned receipt references',async()=>{
 const f=await setup();
 for(const sql of ['GRANT SELECT ON ls_contact_ops.message_receipts TO PUBLIC','GRANT SELECT(payload_ciphertext) ON ls_contact_ops.message_receipts TO PUBLIC',
  'GRANT EXECUTE ON FUNCTION ls_contact_ops.deny_message_receipt_mutation() TO PUBLIC','GRANT USAGE ON SCHEMA ls_contact_ops TO PUBLIC'])
  await probe(f,[sql],async tx=>expect((await contactInboundIntegrity(tx,files)).publicRevoked).toBe(false));
 await probe(f,['ALTER TABLE ls_contact_ops.message_receipts DISABLE TRIGGER ALL'],async tx=>{
  await tx.query(`INSERT INTO ls_contact_ops.message_receipts(workspace_id,channel,provider_binding_id,provider_event_key,provider_message_key,event_type,payload_digest,payload_ciphertext,occurred_at)
   VALUES($1,'whatsapp',$2,$3,$4,'inbound_message',$5,'synthetic-orphan',clock_timestamp())`,[randomUUID(),'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),'d'.repeat(64)]);
  expect(await contactInboundIntegrity(tx,files)).toMatchObject({foreignKeys:false,referencesSound:false});
 });
 await probe(f,[],async tx=>expect(await contactInboundIntegrity(tx,files)).toEqual(present));
});
