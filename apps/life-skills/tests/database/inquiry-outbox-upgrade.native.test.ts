import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {historicalPracticeDatabase} from './home-practice/legacy-practice-fixture.ts';
import {migrate} from '../../src/db/migration-runner.ts';
import {planMigrations} from '../../src/db/migration-plan.ts';

for(const legacyLength of [51,52,53,54])test(`preserves populated legacy ${legacyLength} history through appended 0135 and current additive migrations`,async()=>{
 const db=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql');
 const client=await db.pool.connect(),query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 try{
  await migrate({query},db.inventory.slice(0,legacyLength),false);
  const workspace=randomUUID(),id=randomUUID();
  await query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())',[workspace]);
  await query("INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,'retained-encrypted-legacy','v1','en',now())",[workspace,id,'a'.repeat(64),'b'.repeat(64)]);
  const before=(await query('SELECT to_jsonb(t) AS row FROM ls_service_interest.public_applications t')).rows;
  const ledger=(await query('SELECT to_jsonb(t) AS row FROM ls_control.migrations t ORDER BY name')).rows;
  expect(await migrate({query},db.inventory,false)).toEqual({applied:db.inventory.length-legacyLength,pending:0});
  expect(await migrate({query},db.inventory,true)).toEqual({applied:0,pending:0});
  expect((await query('SELECT to_jsonb(t) AS row FROM ls_service_interest.public_applications t')).rows).toEqual(before);
  expect((await query('SELECT to_jsonb(t) AS row FROM ls_control.migrations t ORDER BY name')).rows.slice(0,legacyLength)).toEqual(ledger);
 }finally{client.release();await db.close();}
},60000);

test('early inquiry-only 0135 preserves inquiry, queued acknowledgment and ledger through interrupted deferred upgrade',async()=>{
 const db=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql'),client=await db.pool.connect();
 const query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 try{
  const files=db.inventory,early=[...files.slice(0,51),files[54]!];
  expect(files).toHaveLength(64);expect(files.slice(54).map(file=>file.name)).toEqual(['0135_ls_inquiry_email_outbox.sql','0136_ls_academy_founder.sql','0137_ls_academy_owner_notifications.sql','0138_ls_academy_crm.sql','0139_ls_bna_inquiries.sql','0140_ls_fishing_inquiry_followups.sql','0141_ls_owner_305_conversations.sql','0142_ls_bna_coop_interest.sql','0143_ls_owner_305_inquiry_links.sql','0144_ls_bna_support_interest.sql']);
  await migrate({query},early,false);
  const workspace=randomUUID(),id=randomUUID(),mail=randomUUID();
  await query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())',[workspace]);
  await query("INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,'retained-encrypted-early','v1','en',now())",[workspace,id,'a'.repeat(64),'b'.repeat(64)]);
  await query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,created_at) VALUES($1,$2,$3,'academy_inquiry_acknowledgment_v1','retained-encrypted-mail',now())",[workspace,mail,id]);
  const records=async()=>({inquiry:(await query('SELECT to_jsonb(t) AS row FROM ls_service_interest.public_applications t')).rows,mail:(await query("SELECT to_jsonb(t) - 'founder_id' - 'message_key' AS row FROM ls_service_interest.inquiry_email_outbox t")).rows});
  const before=await records(),ledger=(await query('SELECT to_jsonb(t) AS row FROM ls_control.migrations t ORDER BY name')).rows;
  const history=async()=>(await query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;
  expect(planMigrations(files,await history()).map(f=>f.name)).toEqual([...files.slice(51,54),...files.slice(55)].map(f=>f.name));
  await expect(migrate({query},files,true)).rejects.toThrow('MIGRATIONS_PENDING');
  // Inject execution failure without falsifying the checksum-checked inventory.
  const fault={query:async(sql:string,values?:readonly unknown[])=>query(sql===files[52]!.sql?sql+'\nSELECT * FROM ls_missing_upgrade_table;':sql,values)};
  await expect(migrate(fault,files,false)).rejects.toThrow('MIGRATION_FAILED');
  expect(planMigrations(files,await history()).map(f=>f.name)).toEqual(['0133_ls_fishing_lead_memberships.sql','0134_ls_education_lessons.sql','0136_ls_academy_founder.sql','0137_ls_academy_owner_notifications.sql','0138_ls_academy_crm.sql','0139_ls_bna_inquiries.sql','0140_ls_fishing_inquiry_followups.sql','0141_ls_owner_305_conversations.sql','0142_ls_bna_coop_interest.sql','0143_ls_owner_305_inquiry_links.sql','0144_ls_bna_support_interest.sql']);
  expect((await query("SELECT to_regclass('ls_contact_ops.fishing_lead_revisions') AS relation")).rows[0]?.relation).toBeNull();
  expect(await records()).toEqual(before);
  expect(await migrate({query},files,false)).toEqual({applied:11,pending:0});
  expect(await migrate({query},files,false)).toEqual({applied:0,pending:0});
  expect(await migrate({query},files,true)).toEqual({applied:0,pending:0});
  expect(await records()).toEqual(before);
  expect((await query('SELECT founder_id,message_key FROM ls_service_interest.inquiry_email_outbox')).rows).toEqual([{founder_id:null,message_key:null}]);
  const after=(await query('SELECT to_jsonb(t) AS row FROM ls_control.migrations t ORDER BY name')).rows;
  expect(after).toHaveLength(64);
  for(const row of ledger)expect(after).toContainEqual(row);
  expect((await query("SELECT count(*)::int AS sent FROM ls_service_interest.inquiry_email_outbox WHERE state='sent'")).rows[0]?.sent).toBe(0);
 }finally{client.release();await db.close();}
},60000);
