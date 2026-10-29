import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import {historicalPracticeDatabase} from "./home-practice/legacy-practice-fixture.ts";
import {migrate} from "../../src/db/migration-runner.ts";
import {readBnaCoopSchemaStage,bnaCoopSchemaPlan} from "../../src/db/bna-coop-schema-release.ts";
import {readOwner305LinkSchemaStage,owner305LinkSchemaPlan} from "../../src/db/owner-305-link-schema-release.ts";
it("migrates the exact co-op constraint without changing existing inquiry rows",async()=>{
 const db=await historicalPracticeDatabase("0118_ls_contact_delta_history.sql"),client=await db.pool.connect(),query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 try{
  const coopIndex=db.inventory.findIndex(file=>file.name==="0142_ls_bna_coop_interest.sql");expect(coopIndex).toBeGreaterThan(0);
  const baseline=db.inventory.slice(0,coopIndex),coopScope=db.inventory.slice(0,coopIndex+1);await migrate({query},baseline,false);
  const workspace=randomUUID(),owner=randomUUID(),id=randomUUID();
  await query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())",[workspace]);
  await query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',now(),'synthetic',now(),now())",[owner,workspace,'a'.repeat(64)]);
  await query("INSERT INTO ls_service_interest.bna_inquiries(workspace_id,id,program_key,owner_account_id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,'bna_torah_mornings',$3,$4,$5,'synthetic','v1','en',now())",[workspace,id,owner,'b'.repeat(64),'c'.repeat(64)]);
  const before=(await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t WHERE id=$1",[id])).rows;
  const hist=(await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows;
  expect(await readBnaCoopSchemaStage({query})).toBe(0);expect(bnaCoopSchemaPlan(db.inventory,hist,0).pending).toHaveLength(1);
  expect(await migrate({query},coopScope,false)).toEqual({applied:1,pending:0});
  expect(await readBnaCoopSchemaStage({query})).toBe(1);expect((await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t WHERE id=$1",[id])).rows).toEqual(before);
  const coopHistory=(await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows;
  expect(await readOwner305LinkSchemaStage({query})).toBe(0);expect(owner305LinkSchemaPlan(db.inventory,coopHistory,0).pending).toHaveLength(1);
  expect(db.inventory.slice(coopIndex+1).map(file=>file.name)).toEqual(['0143_ls_owner_305_inquiry_links.sql','0144_ls_bna_support_interest.sql','0145_ls_owner_305_inbound.sql','0146_ls_bna_communication_delivery.sql','0147_ls_fishing_marketing_snapshot.sql','0148_ls_bna_email_preferences.sql','0149_ls_bna_optional_calendar.sql']);
  expect(await migrate({query},db.inventory,false)).toEqual({applied:7,pending:0});expect(await readOwner305LinkSchemaStage({query})).toBe(1);
  const finalHistory=(await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows;
  expect(finalHistory.slice(0,coopHistory.length)).toEqual(coopHistory);
  expect(bnaCoopSchemaPlan(db.inventory,finalHistory,1).pending).toHaveLength(0);
  expect((await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t WHERE id=$1",[id])).rows).toEqual(before);
  expect(await migrate({query},db.inventory,true)).toEqual({applied:0,pending:0});
 }finally{client.release();await db.close();}
},60000);
