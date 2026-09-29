import {afterAll,expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
vi.mock('server-only',()=>({}));
import {fixture,poolStore,safeTestUrl,type Fixture} from '../calendar/fixture.ts';
import {migrate,type MigrationClient} from '../../../src/db/migration-runner.ts';
import type {Migration} from '../../../src/db/migration-plan.ts';
import {seal} from '../../../src/features/identity/crypto.ts';
import {ContactInboundStore,inboundBindingDigest} from '../../../src/features/contact-ops/server/inbound-store.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';
import {contactInboundProjectionIntegrity,CONTACT_INBOUND_PROJECTION_MIGRATION} from '../../../src/db/contact-inbound-projection-integrity.ts';
import {contactInboundIntegrity} from '../../../src/db/contact-inbound-integrity.ts';
import {CONTACT_INBOUND_MIGRATION} from '../../../src/db/contact-ops-production-guard.ts';
const files=[CONTACT_INBOUND_MIGRATION,CONTACT_INBOUND_PROJECTION_MIGRATION].map(m=>({name:m.name,checksum:m.sha256,
 sql:readFileSync(new URL(`../../../migrations/${m.name}`,import.meta.url),'utf8')}));
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
async function setup(options:{demoFirst?:boolean}={}){const f=await fixture(options);fixtures.push(f);return f;}
const present={objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,livePersonGuards:true,reviewedFunctions:true,permissions:true,referencesSound:true};
async function probe(f:Fixture,statements:readonly string[],work:(tx:SqlSession)=>Promise<void>){
 const client=await f.pool.connect();try{await client.query('BEGIN');for(const sql of statements)await client.query(sql);
  await work({query:async <R extends object>(sql:string,values:readonly unknown[]=[])=>
   (await client.query<R>(sql,[...values])).rows});
 }finally{await client.query('ROLLBACK');client.release();}
}
test('actual native catalog/function/FK/ACL proof binds exact0109 and leaves0106 protections intact',async()=>{
 const f=await setup();for(const file of files)expect(createHash('sha256').update(file.sql.replace(/\r\n/g,'\n')).digest('hex')).toBe(file.checksum);
 await probe(f,[],async tx=>{expect(await contactInboundProjectionIntegrity(tx,files)).toEqual(present);
  expect(await contactInboundIntegrity(tx,files)).toEqual({objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,appendOnlyFunction:true,publicRevoked:true,referencesSound:true});});
});
test('fully absent versus partial projection objects is exact and never repaired by inspection',async()=>{
 const f=await setup();await probe(f,['DROP TABLE ls_contact_ops.inbound_projections','DROP TABLE ls_contact_ops.inbound_threads',
  'DROP FUNCTION ls_contact_ops.require_inbound_live_person()','DROP FUNCTION ls_contact_ops.deny_inbound_projection_mutation()'],async tx=>{
   expect(await contactInboundProjectionIntegrity(tx,files)).toEqual({objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,livePersonGuards:false,reviewedFunctions:false,permissions:false,referencesSound:false});});
 await probe(f,['DROP TABLE ls_contact_ops.inbound_projections'],async tx=>expect(await contactInboundProjectionIntegrity(tx,files)).toMatchObject({objectsAbsent:false,tables:false,schemaCatalog:false,reviewedFunctions:true}));
 await probe(f,[],async tx=>expect(await contactInboundProjectionIntegrity(tx,files)).toEqual(present));
});
test('disabled/conditional/extra protections, altered bodies and catalog drift fail closed',async()=>{
 const f=await setup();for(const [sql,key] of [
  ['ALTER TABLE ls_contact_ops.inbound_threads DISABLE TRIGGER inbound_threads_no_edit','historyImmutable'],
  ['ALTER TABLE ls_contact_ops.inbound_projections DISABLE TRIGGER inbound_projections_no_truncate','historyImmutable'],
  ['ALTER TABLE ls_contact_ops.inbound_threads DISABLE TRIGGER inbound_thread_live_person','livePersonGuards'],
  ['ALTER TABLE ls_contact_ops.inbound_projections DISABLE TRIGGER ALL','foreignKeys'],
  ["CREATE OR REPLACE FUNCTION ls_contact_ops.require_inbound_live_person() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$ BEGIN RETURN NEW; END; $fn$",'reviewedFunctions'],
  ['ALTER FUNCTION ls_contact_ops.deny_inbound_projection_mutation() SECURITY DEFINER','reviewedFunctions'],
  ['ALTER FUNCTION ls_contact_ops.require_inbound_live_person() RESET search_path','reviewedFunctions'],
  ['ALTER TABLE ls_contact_ops.inbound_projections ALTER COLUMN resolution_ciphertext DROP NOT NULL','schemaCatalog'],
  ['ALTER TABLE ls_contact_ops.inbound_threads ADD COLUMN unintended text','schemaCatalog'],
  ['ALTER TABLE ls_contact_ops.inbound_threads ADD CONSTRAINT unreviewed CHECK(true) NOT VALID','schemaCatalog'],
  ['CREATE TRIGGER unreviewed BEFORE UPDATE ON ls_contact_ops.inbound_threads FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_inbound_projection_mutation()','historyImmutable'],
  ["DROP TRIGGER inbound_threads_no_edit ON ls_contact_ops.inbound_threads; CREATE TRIGGER inbound_threads_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.inbound_threads FOR EACH ROW WHEN (OLD.person_id IS NOT NULL) EXECUTE FUNCTION ls_contact_ops.deny_inbound_projection_mutation()",'historyImmutable'],
 ] as const)await probe(f,[sql],async tx=>expect((await contactInboundProjectionIntegrity(tx,files))[key]).toBe(false));
});
test('table/column/function/schema grants and orphaned relationships are refused, then rollback restores proof',async()=>{
 const f=await setup();for(const sql of ['GRANT SELECT ON ls_contact_ops.inbound_projections TO PUBLIC',
  'GRANT SELECT(resolution_ciphertext) ON ls_contact_ops.inbound_projections TO PUBLIC',
  'GRANT EXECUTE ON FUNCTION ls_contact_ops.require_inbound_live_person() TO PUBLIC','GRANT USAGE ON SCHEMA ls_contact_ops TO PUBLIC'])
   await probe(f,[sql],async tx=>expect((await contactInboundProjectionIntegrity(tx,files)).permissions).toBe(false));
 await probe(f,['ALTER TABLE ls_contact_ops.inbound_threads DISABLE TRIGGER ALL'],async tx=>{
  await tx.query(`INSERT INTO ls_contact_ops.inbound_threads(workspace_id,provider_binding_id,provider_thread_key,sender_endpoint_key,person_id)
   VALUES($1,$2,$3,$4,$5)`,[f.workspaceId,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),randomUUID()]);
  expect(await contactInboundProjectionIntegrity(tx,files)).toMatchObject({foreignKeys:false,livePersonGuards:false,referencesSound:false});
 });await probe(f,[],async tx=>expect(await contactInboundProjectionIntegrity(tx,files)).toEqual(present));
});
test('actual PostgreSQL rejects demo thread binding, cross-workspace binding and projection mutation',async()=>{
 const f=await setup({demoFirst:true}),person=f.parent.actor.personId,binding='a'.repeat(64),thread='b'.repeat(64),event='c'.repeat(64),message='d'.repeat(64);
 await f.pool.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode) VALUES($1,$2,'synthetic-test-only-profile','live')",[f.workspaceId,person]);
 await f.pool.query(`INSERT INTO ls_contact_ops.message_receipts(workspace_id,channel,provider_binding_id,provider_event_key,provider_message_key,event_type,payload_digest,payload_ciphertext,occurred_at)
  VALUES($1,'whatsapp',$2,$3,$4,'inbound_message',$5,'synthetic-test-only-receipt',clock_timestamp())`,[f.workspaceId,binding,event,message,'e'.repeat(64)]);
 await f.pool.query('INSERT INTO ls_contact_ops.inbound_threads(workspace_id,provider_binding_id,provider_thread_key,sender_endpoint_key,person_id) VALUES($1,$2,$3,$4,$5)',[f.workspaceId,binding,thread,'f'.repeat(64),person]);
 await f.pool.query(`INSERT INTO ls_contact_ops.inbound_projections(workspace_id,channel,provider_binding_id,provider_message_key,provider_event_key,provider_thread_key,message_digest,state,reason,person_id,authority_epoch,resolution_ciphertext)
  VALUES($1,'whatsapp',$2,$3,$4,$5,$6,'projected','known_thread',$7,3,'synthetic-test-only-resolution')`,[f.workspaceId,binding,message,event,thread,'e'.repeat(64),person]);
 for(const table of ['inbound_threads','inbound_projections']){
  await expect(f.pool.query(`UPDATE ls_contact_ops.${table} SET person_id=$2 WHERE workspace_id=$1`,[f.workspaceId,person])).rejects.toThrow('CONTACT_INBOUND_PROJECTION_APPEND_ONLY');
  await expect(f.pool.query(`DELETE FROM ls_contact_ops.${table} WHERE workspace_id=$1`,[f.workspaceId])).rejects.toThrow('CONTACT_INBOUND_PROJECTION_APPEND_ONLY');
  await expect(f.pool.query(`TRUNCATE ls_contact_ops.${table}`)).rejects.toThrow('CONTACT_INBOUND_PROJECTION_APPEND_ONLY');
 }
 await expect(f.pool.query('INSERT INTO ls_contact_ops.inbound_threads(workspace_id,provider_binding_id,provider_thread_key,sender_endpoint_key,person_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),binding,'1'.repeat(64),'2'.repeat(64),person])).rejects.toThrow('CONTACT_INBOUND_LIVE_PERSON_REQUIRED');
 const demoPerson=f.parentTwo.actor.personId;
 await f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,$2,'person',$3,$4,$5)",[f.workspaceId,'ls-owner-20260925',demoPerson,'synthetic-demo-person',f.parentTwo.actor.id]);
 await f.pool.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,'synthetic-test-only-demo-profile','demo',$3)",[f.workspaceId,demoPerson,'ls-owner-20260925']);
 await expect(f.pool.query('INSERT INTO ls_contact_ops.inbound_threads(workspace_id,provider_binding_id,provider_thread_key,sender_endpoint_key,person_id) VALUES($1,$2,$3,$4,$5)',[f.workspaceId,binding,'3'.repeat(64),'4'.repeat(64),demoPerson])).rejects.toThrow('CONTACT_INBOUND_LIVE_PERSON_REQUIRED');
});
test('genuine populated28→29 preserves encrypted CRM/receipts/identity/cases and old ledger; first/repeat/verify are exact',async()=>{
 const cluster=new URL(safeTestUrl());expect(['127.0.0.1','localhost','[::1]']).toContain(cluster.hostname);expect(cluster.search).toBe('');expect(cluster.hash).toBe('');
 const database='ls_calendar_test_inbound_upgrade_'+randomBytes(8).toString('hex');
 if(!/^ls_calendar_test_inbound_upgrade_[a-f0-9]{16}$/.test(database))throw Error('INBOUND_UPGRADE_DATABASE_NAME_INVALID');
 const adminUrl=new URL(cluster);adminUrl.pathname='/postgres';const testUrl=new URL(cluster);testUrl.pathname='/'+database;
 const admin=new pg.Pool({connectionString:adminUrl.toString(),ssl:false,max:1}),pool=new pg.Pool({connectionString:testUrl.toString(),ssl:false,max:1});
 let created=false,f:Fixture|undefined,client:pg.PoolClient|undefined;
 try{
  await admin.query(`CREATE DATABASE "${database}"`);created=true;
  const manifest=JSON.parse(readFileSync(new URL('../../../migrations/manifest.json',import.meta.url),'utf8')) as {name:string;sha256:string}[];
  const inventory:Migration[]=manifest.map(entry=>{const bytes=readFileSync(new URL(`../../../migrations/${entry.name}`,import.meta.url));
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);return {name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')};});
  const tested=inventory.slice(0,inventory.findIndex(file=>file.name===CONTACT_INBOUND_PROJECTION_MIGRATION.name)+1);
  expect(tested).toHaveLength(29);expect(tested.at(-1)).toMatchObject({name:CONTACT_INBOUND_PROJECTION_MIGRATION.name,checksum:CONTACT_INBOUND_PROJECTION_MIGRATION.sha256});
  client=await pool.connect();const adapter:MigrationClient={query:async(sql,values)=>await client!.query(sql,values?[...values]:undefined)};
  const tx:SqlSession={query:async <R extends object>(sql:string,values:readonly unknown[]=[])=> (await client!.query<R>(sql,[...values])).rows};
  expect(await migrate(adapter,tested.slice(0,-1),false)).toEqual({applied:28,pending:0});
  vi.stubEnv('TEST_DATABASE_URL',testUrl.toString());vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');f=await fixture({demoFirst:true});
  const personId=f.outsider.actor.personId,profile={personId,stage:'New inquiry',notes:'Synthetic retained authored note\nSecond paragraph',nextAction:'Synthetic retained action',followUpDate:'2026-10-01',legacyIds:[]};
  await f.pool.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode) VALUES($1,$2,$3,'live')",[f.workspaceId,personId,seal(JSON.stringify(profile),`ls_contact_ops/profile/v1/${f.workspaceId}/${personId}`,f.keyring)]);
  const inquiry={provider:'whapi',channelId:'synthetic-upgrade-channel',businessNumber:'+972501234567',providerEventId:'synthetic-upgrade-event',providerMessageId:'synthetic-upgrade-message',providerThreadId:'synthetic-upgrade-thread',eventType:'inbound_message',fromMe:false,fromNumber:'+972501234568',pushName:'Synthetic inquiry',messageType:'text',messageText:'Synthetic retained incoming message',occurredAt:'2026-09-28T02:00:00Z',media:[]} as const;
  const store=new ContactInboundStore(poolStore(f.pool),f.workspaceId,f.keyring,'synthetic-inbound-upgrade-integrity-key-20260929',inboundBindingDigest(inquiry));
  await store.capture(inquiry);expect((await store.recent(f.practitioner.actor))).toHaveLength(1);
  const tables=['ls_contact_ops.profiles','ls_contact_ops.legacy_links','ls_contact_ops.command_receipts','ls_contact_ops.message_receipts','ls_contact_ops.cutover','ls_contact_ops.cutover_history',
   'ls_identity.people','ls_identity.accounts','ls_identity.account_subjects','ls_identity.sessions','ls_cases.cases','ls_cases.case_guardians','ls_demo.records','ls_demo.batches'] as const;
  const snapshot=async()=>{const rows:Record<string,unknown>={};for(const table of tables)rows[table]=(await client!.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f!.workspaceId])).rows;return rows;};
  const before=await snapshot(),ledger=(await client.query('SELECT * FROM ls_control.migrations ORDER BY name')).rows;
  expect(await contactInboundProjectionIntegrity(tx,tested)).toEqual({objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,livePersonGuards:false,reviewedFunctions:false,permissions:false,referencesSound:false});
  expect(await migrate(adapter,tested,false)).toEqual({applied:1,pending:0});expect(await snapshot()).toEqual(before);
  expect((await client.query('SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name',[CONTACT_INBOUND_PROJECTION_MIGRATION.name])).rows).toEqual(ledger);
  expect(await migrate(adapter,tested,false)).toEqual({applied:0,pending:0});expect(await migrate(adapter,tested,true)).toEqual({applied:0,pending:0});
  expect(await contactInboundProjectionIntegrity(tx,tested)).toEqual(present);expect(await snapshot()).toEqual(before);
  expect((await store.recent(f.practitioner.actor))[0]?.inquiry.messageText).toBe(inquiry.messageText);
 }finally{vi.unstubAllEnvs();await f?.pool.end();client?.release();await pool.end();if(created)await admin.query(`DROP DATABASE "${database}"`);await admin.end();}
},30000);
