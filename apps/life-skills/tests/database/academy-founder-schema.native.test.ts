import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
import {academyTestDatabase} from './academy-free-registration-fixture.ts';
import {migrate} from '../../src/db/migration-runner.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';

let db:Awaited<ReturnType<typeof academyTestDatabase>>;
beforeAll(async()=>{db=await academyTestDatabase('before_founder');},60000);
afterAll(async()=>{await db?.close();});

test('full manifest adopts 0136 once: exact legacy queued/unknown/sent/canceled rows survive rollback and apply',async()=>{
 const workspace=randomUUID(),ring={activeKeyId:'synthetic',keys:{synthetic:randomBytes(32)}},at=new Date(),client=await db.pool.connect();
 const query=async(sql:string,values:readonly unknown[]=[])=>client.query(sql,[...values]);
 try{
  expect(db.inventory).toHaveLength(56);expect(db.inventory.filter(m=>m.name.startsWith('0136_')).map(m=>m.name)).toEqual(['0136_ls_academy_founder.sql']);expect(db.inventory.every(m=>!m.name.includes('proposals/'))).toBe(true);
  await query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,at]);
  for(const state of ['queued','unknown','sent','canceled']){
   const application=randomUUID(),id=randomUUID(),payload=seal(JSON.stringify({synthetic:true,state}),`ls_service_interest/inquiry_email/v1/${workspace}/${id}`,ring);
   await query("INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,'synthetic-legacy','en',$6)",[workspace,application,'a'.repeat(64),application.replaceAll('-','').repeat(2),payload,at]);
   await query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at,reserved_at,completed_at,provider_id) VALUES($1,$2,$3,'academy_inquiry_acknowledgment_v1',$4,$5,$6,$7,$8,$9)",[workspace,id,application,payload,state,at,['unknown','sent'].includes(state)?at:null,['sent','canceled'].includes(state)?at:null,state==='sent'?'synthetic-legacy-provider-receipt':null]);
  }
  const oldColumns='workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at,reserved_at,completed_at,reconciled_by,provider_id';
  const oldRows=async()=>(await query(`SELECT ${oldColumns} FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 ORDER BY id`,[workspace])).rows;
  const history=async()=>(await query('SELECT name,checksum,applied_at FROM ls_control.migrations ORDER BY name')).rows;
  const before=await oldRows(),historyBefore=await history();expect(historyBefore).toHaveLength(55);expect(before.map(row=>row.state).sort()).toEqual(['canceled','queued','sent','unknown']);
  await expect(migrate({query},db.inventory,true)).rejects.toThrow('MIGRATIONS_PENDING');
  const last=db.inventory.at(-1)!;
  const fault={query:async(sql:string,values?:readonly unknown[])=>query(sql===last.sql?sql+'\nSELECT 1/0;':sql,values)};
  await expect(migrate(fault,db.inventory,false)).rejects.toThrow('MIGRATION_FAILED');
  expect(await oldRows()).toEqual(before);expect(await history()).toEqual(historyBefore);
  expect((await query("SELECT to_regclass('ls_service_interest.academy_founder_families') AS family,to_regclass('ls_service_interest.academy_founder_families_submission_sequence_seq') AS sequence")).rows[0]).toEqual({family:null,sequence:null});
  expect((await query("SELECT column_name FROM information_schema.columns WHERE table_schema='ls_service_interest' AND table_name='inquiry_email_outbox' AND column_name IN ('founder_id','message_key')")).rows).toEqual([]);
  expect(await migrate({query},db.inventory,false)).toEqual({applied:1,pending:0});
  expect(await oldRows()).toEqual(before);expect((await query('SELECT founder_id,message_key FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 ORDER BY id',[workspace])).rows).toEqual(before.map(()=>({founder_id:null,message_key:null})));
  for(const row of await oldRows())expect(JSON.parse(unseal(row.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${row.id}`,ring))).toEqual({synthetic:true,state:row.state});
  const applied=await history();expect(applied).toHaveLength(56);expect(applied.slice(0,55)).toEqual(historyBefore);expect(applied.at(-1)).toMatchObject({name:last.name,checksum:last.checksum});
  expect(await migrate({query},db.inventory,false)).toEqual({applied:0,pending:0});expect(await migrate({query},db.inventory,true)).toEqual({applied:0,pending:0});expect(await history()).toEqual(applied);expect(await oldRows()).toEqual(before);
  const drift=db.inventory.map(file=>file.name===last.name?{...file,checksum:'0'.repeat(64)}:file);
  await expect(migrate({query},drift,true)).rejects.toThrow('MIGRATION_HISTORY_DIVERGED');expect(await history()).toEqual(applied);expect(await oldRows()).toEqual(before);
  expect((await query("SELECT count(*)::int AS n FROM ls_control.migrations WHERE name LIKE '0136%'")).rows[0].n).toBe(1);
  expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.academy_founder_families')).rows[0].n).toBe(0);
 }finally{client.release();}
},60000);
