/** Only the Root-owned disposable loopback cluster. No business data read. */
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {safeTestUrl} from '../calendar/fixture.ts';
import {loadAcademySchemaSources,readAcademySchemaPreflight,type AcademySchemaConnection} from '../../../src/db/academy-schema-preflight.ts';
async function fixture(){
 const raw=safeTestUrl(),url=new URL(raw);if(process.env.LS_RM_PROGRAM_NATIVE_ALLOW!=='MAIN_REGISTERED_ONLY'||url.hostname!=='127.0.0.1'||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname))throw Error('ACADEMY_PREFLIGHT_OWNED_LOOPBACK_REQUIRED');
 const pool=new pg.Pool({connectionString:raw,ssl:false,max:1}),client=await pool.connect();try{const target=(await client.query('SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];if(target.database!==url.pathname.slice(1)||target.host!=='127.0.0.1'||target.port!==Number(url.port))throw Error('ACADEMY_PREFLIGHT_TARGET_MISMATCH');}catch(e){client.release();await pool.end();throw e;}
 const sources=await loadAcademySchemaSources(new URL('../../../',import.meta.url)).catch(async error=>{client.release();await pool.end();throw error;}),connection:AcademySchemaConnection={query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>client.query<R>(sql,[...values])};return {client,connection,sources,close:async()=>{client.release();await pool.end();}};
}
test('actual candidate catalog is repeatable, source-bound and inspected only in a read-only snapshot',async()=>{
 const f=await fixture();try{const first=await readAcademySchemaPreflight(f.connection,f.sources,null),second=await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256);expect(first.state).toBe('unreviewed');expect(second).toMatchObject({state:'match',baselineMatches:true,mutationAllowed:false,identity:{readonly:'on',isolation:'repeatable read'}});expect(second.catalogSha256).toBe(first.catalogSha256);expect(second.catalog.triggers.length).toBeGreaterThan(0);expect(second.catalog.functions.length).toBeGreaterThan(0);expect(second.owners).toHaveLength(2);expect((await f.client.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('off');}finally{await f.close();}
});

test.each(['block_acceptances','refund_cancellations','refund_fee_reservations'] as const)('a missing actual Owner03 table %s is partial and restoring it restores the exact catalog digest',async table=>{
 // Identifiers come only from this fixed allowlist; fixture verifies the owned
 // disposable loopback database before any test-only rename. No data is dropped.
 const f=await fixture(),temporary='synthetic_missing_'+table;let renamed=false;
 try{const before=await readAcademySchemaPreflight(f.connection,f.sources,null);expect(before.state).toBe('unreviewed');expect(f.sources.tables).toHaveLength(30);await f.client.query('ALTER TABLE ls_fishing_stage.'+table+' RENAME TO '+temporary);renamed=true;const partial=await readAcademySchemaPreflight(f.connection,f.sources,before.catalogSha256);expect(partial).toMatchObject({state:'partial',baselineMatches:true,mutationAllowed:false,identity:{readonly:'on',isolation:'repeatable read'}});expect(partial.catalogSha256).not.toBe(before.catalogSha256);await f.client.query('ALTER TABLE ls_fishing_stage.'+temporary+' RENAME TO '+table);renamed=false;expect(await readAcademySchemaPreflight(f.connection,f.sources,before.catalogSha256)).toMatchObject({state:'match',catalogSha256:before.catalogSha256,mutationAllowed:false});}
 finally{try{if(renamed)await f.client.query('ALTER TABLE ls_fishing_stage.'+temporary+' RENAME TO '+table);}finally{await f.close();}}
});
test('an extra real schema index is drift and its removal restores the same catalog digest',async()=>{
 const f=await fixture(),name='synthetic_preflight_'+randomUUID().replaceAll('-','');let created=false;try{const first=await readAcademySchemaPreflight(f.connection,f.sources,null);await f.client.query('CREATE INDEX '+name+' ON ls_fishing_stage.cohorts(workspace_id)');created=true;expect((await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256)).state).toBe('drift');await f.client.query('DROP INDEX ls_fishing_stage.'+name);created=false;expect((await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256)).state).toBe('match');}finally{if(created)await f.client.query('DROP INDEX ls_fishing_stage.'+name);await f.close();}
});
test('an unexpected PUBLIC table privilege is detected, with equivalent default ACL restored after revoke',async()=>{
 const f=await fixture();let granted=false;try{const first=await readAcademySchemaPreflight(f.connection,f.sources,null);await f.client.query('GRANT SELECT ON ls_fishing_stage.cohorts TO PUBLIC');granted=true;expect((await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256)).state).toBe('drift');await f.client.query('REVOKE SELECT ON ls_fishing_stage.cohorts FROM PUBLIC');granted=false;expect((await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256)).state).toBe('match');}finally{if(granted)await f.client.query('REVOKE SELECT ON ls_fishing_stage.cohorts FROM PUBLIC');await f.close();}
});
test('PostgreSQL enforces read-only inspection and failure rolls back without leaving a transaction',async()=>{
 const f=await fixture();let attempted=false;try{const first=await readAcademySchemaPreflight(f.connection,f.sources,null),connection:AcademySchemaConnection={query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{if(sql.startsWith('SELECT current_database()')){attempted=true;await f.client.query('CREATE TABLE ls_fishing_stage.synthetic_forbidden_preflight(id integer)');}return f.connection.query<R>(sql,values);}};await expect(readAcademySchemaPreflight(connection,f.sources,null)).rejects.toThrow(/read-only/);expect(attempted).toBe(true);expect((await f.client.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('off');expect((await f.client.query("SELECT to_regclass('ls_fishing_stage.synthetic_forbidden_preflight') AS found")).rows[0].found).toBeNull();expect((await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256)).state).toBe('match');}finally{await f.close();}
});


test('reference digest ignores internal FK trigger OIDs while retaining their enforced definition',async()=>{
 const f=await fixture();let restore:string|null=null;try{const first=await readAcademySchemaPreflight(f.connection,f.sources,null),row=(await f.client.query("SELECT oid,conname,pg_get_constraintdef(oid,false) AS definition FROM pg_constraint WHERE conrelid='ls_fishing_payments.customer_bindings'::regclass AND confrelid='ls_identity.accounts'::regclass AND contype='f'")).rows[0];if(!row||!/^customer_bindings_[a-z_]+_fkey$/.test(row.conname))throw Error('SYNTHETIC_EXPECTED_CUSTOMER_FK_REQUIRED');
  restore='ALTER TABLE ls_fishing_payments.customer_bindings ADD CONSTRAINT '+row.conname+' '+row.definition;await f.client.query('ALTER TABLE ls_fishing_payments.customer_bindings DROP CONSTRAINT '+row.conname);await f.client.query(restore);restore=null;const changed=(await f.client.query("SELECT oid FROM pg_constraint WHERE conrelid='ls_fishing_payments.customer_bindings'::regclass AND conname=$1",[row.conname])).rows[0];expect(changed.oid).not.toBe(row.oid);expect((await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256)).state).toBe('match');
 }finally{if(restore)await f.client.query(restore);await f.close();}
});


test('default privilege drift from a non-current creator role is visible and fully restored',async()=>{
 const f=await fixture(),role='synthetic_preflight_'+randomUUID().replaceAll('-','');let created=false;try{const first=await readAcademySchemaPreflight(f.connection,f.sources,null);await f.client.query('CREATE ROLE '+role+' NOLOGIN');created=true;await f.client.query('ALTER DEFAULT PRIVILEGES FOR ROLE '+role+' IN SCHEMA ls_fishing_stage GRANT SELECT ON TABLES TO PUBLIC');const changed=await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256);expect(changed.state).toBe('drift');expect(changed.catalog.defaults.some(row=>row.creator===role)).toBe(true);expect((await f.client.query('SELECT current_user AS role')).rows[0].role).not.toBe(role);await f.client.query('DROP OWNED BY '+role);await f.client.query('DROP ROLE '+role);created=false;expect((await readAcademySchemaPreflight(f.connection,f.sources,first.catalogSha256)).state).toBe('match');
 }finally{if(created){await f.client.query('DROP OWNED BY '+role);await f.client.query('DROP ROLE '+role);}await f.close();}
});
