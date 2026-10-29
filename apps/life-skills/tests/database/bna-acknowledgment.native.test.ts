import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {expect,it,vi} from "vitest";
import pg from "pg";
vi.mock("server-only",()=>({}));
import {historicalPracticeDatabase} from "./home-practice/legacy-practice-fixture.ts";
import {poolStore} from "./calendar/fixture.ts";
import {migrate} from "../../src/db/migration-runner.ts";
import {bnaEmailCatalogFingerprint,bnaEmailSchemaPlan,readBnaEmailSchemaStage} from "../../src/db/bna-email-schema-release.ts";
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM,type BnaCoopFields} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM} from "../../src/features/bna-inquiry/support-contract.ts";
import {BnaAcknowledgmentStore,configuredBnaAcknowledgmentQueue} from "../../src/features/bna-communications/acknowledgment-store.ts";
import {BNA_EMAIL_SOURCE,BNA_EMAIL_SENDER} from "../../src/features/bna-communications/delivery-policy.ts";
import type {BnaDispatchAdmission} from "../../src/features/bna-communications/dispatch-admission.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";

it("upgrades native inquiries without backfill, rolls back a failed upgrade, and claims concurrent delivery once with immutable history",async()=>{
 const db=await historicalPracticeDatabase("0118_ls_contact_delta_history.sql"),client=await db.pool.connect();
 const query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 const pool=new pg.Pool({connectionString:db.url,ssl:false,max:6});let tlsPool:pg.Pool|undefined;
 try{
  const index=db.inventory.findIndex(file=>file.name==="0146_ls_bna_communication_delivery.sql");expect(index).toBe(65);
  const baseline=db.inventory.slice(0,index),target=db.inventory.slice(0,index+1),migration=target.at(-1)!;
  await migrate({query},baseline,false);
  expect(await readBnaEmailSchemaStage({query})).toBe(0);
  const workspace=asId(randomUUID(),"workspace"),owner=randomUUID(),session="a".repeat(64),now=new Date("2026-10-29T18:00:00Z"),clock={now:()=>now};
  const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,19)}},key="synthetic-native-bna-mail-key-20261029";
  await query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
  await query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[owner,workspace,now]);
  await query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[owner,workspace,session,now]);
  await query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,owner]);
  await query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[session,workspace,owner,now,new Date("2035-01-01")]);
  const actor={id:owner,workspaceId:workspace,personId:owner,role:"practitioner",state:"active",locale:"en",sessionDigest:session,expiresAt:new Date("2035-01-01").getTime()} as Actor;
  const fields=():BnaCoopFields=>({name:"Synthetic native adult",contactChannel:"email",contact:randomUUID()+"@example.invalid",language:"he",siteLanguage:"en",emailUpdates:false,townOrZip:"Not in email",childAges:[10],question:"Not in email",permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"en"}});
  const original=new BnaInquiryStore(poolStore(pool),workspace,ring,key,owner,clock);
  const oldInput={operationId:randomUUID(),fields:fields()},old=await original.submit(oldInput,BNA_COOP_PROGRAM);
  const inquiriesBefore=(await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t ORDER BY id")).rows;
  const historyBefore=(await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows;
  expect(bnaEmailSchemaPlan(db.inventory,historyBefore,0).pending).toHaveLength(1);
  await expect(migrate({query},[...baseline,{...migration,sql:migration.sql+"\nSELECT 1/0;"}],false)).rejects.toThrow("MIGRATION_FAILED");
  expect((await query("SELECT to_regclass('ls_service_interest.bna_email_messages') AS relation")).rows).toEqual([{relation:null}]);
  expect((await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows).toEqual(historyBefore);
  expect(await migrate({query},target,false)).toEqual({applied:1,pending:0});
  expect(await bnaEmailCatalogFingerprint({query})).toBe("2d58993899404b9085189ed5bba553935eb358663e7f88a5c1ccc3a3c6a3adb0");
  expect(await readBnaEmailSchemaStage({query})).toBe(1);
  await query("BEGIN");try{
   await query("ALTER TABLE ls_service_interest.bna_email_delivery DISABLE TRIGGER bna_email_delivery_history");
   await expect(readBnaEmailSchemaStage({query})).rejects.toThrow("BNA_EMAIL_SCHEMA_CATALOG_CONFLICT");
  }finally{await query("ROLLBACK");}
  expect((await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t ORDER BY id")).rows).toEqual(inquiriesBefore);
  expect(await migrate({query},target,true)).toEqual({applied:0,pending:0});
  const env={LS_BNA_EMAIL_QUEUE_ENABLED:"true",LS_BNA_EMAIL_QUEUE_SINCE:"2026-10-29T17:00:00Z",LS_BNA_EMAIL_SOURCE_SHA256:BNA_EMAIL_SOURCE};
  const inquiries=new BnaInquiryStore(poolStore(pool),workspace,ring,key,owner,clock,configuredBnaAcknowledgmentQueue(env,ring,key));
  const mail=new BnaAcknowledgmentStore(poolStore(pool),workspace,owner,ring,key,clock);
  await inquiries.submit(oldInput,BNA_COOP_PROGRAM);expect(await mail.readForInquiry(actor,old.reference)).toEqual({state:"not_queued"});
  const input={operationId:randomUUID(),fields:fields()};
  const results=await Promise.all([inquiries.submit(input,BNA_COOP_PROGRAM),inquiries.submit(input,BNA_COOP_PROGRAM)]);
  expect(new Set(results.map(result=>result.reference)).size).toBe(1);expect(results.filter(result=>result.replayed)).toHaveLength(1);
  const saved=results[0]!,queued=await mail.readForInquiry(actor,saved.reference);if(!('messageId' in queued))throw Error("QUEUE_MISSING");
  expect(queued).toMatchObject({state:"queued",version:1,payload:{locale:"he",templateId:"EMAIL-B0"}});
  let calls=0,release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const adapter={mode:"controlled_test" as const,authorize:()=>true,send:async()=>{calls++;entered();await hold;return {state:"accepted" as const,providerId:"synthetic-native-provider-id"};}};
  const first=mail.dispatch(queued.messageId,adapter);await Promise.race([started,first.then(state=>{throw Error("DISPATCH_DID_NOT_REACH_PROVIDER_"+state);})]);
  expect(await mail.dispatch(queued.messageId,adapter)).toBe("unknown");expect(calls).toBe(1);release();expect(await first).toBe("sent");
  expect(await mail.dispatch(queued.messageId,adapter)).toBe("sent");expect(calls).toBe(1);
  expect(await mail.readForInquiry(actor,saved.reference)).toMatchObject({state:"sent",version:3,providerId:"synthetic-native-provider-id"});
  const support=await inquiries.submit({operationId:randomUUID(),fields:{name:"Synthetic native supporter",contactChannel:"email",contact:"synthetic-support@example.invalid",purpose:"support_conversation",language:"en",siteLanguage:"he",emailUpdates:false,permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"he"}}},BNA_SUPPORT_PROGRAM);
  const supportMail=await mail.readForInquiry(actor,support.reference);if(!('messageId' in supportMail))throw Error("QUEUE_MISSING");
  expect(supportMail).toMatchObject({state:"queued",payload:{templateId:"EMAIL-S0",locale:"en"}});
  await expect(query("UPDATE ls_service_interest.bna_email_delivery SET state='unknown',version=2,reserved_at=$3 WHERE workspace_id=$1 AND message_id=$2",[workspace,supportMail.messageId,now])).rejects.toThrow("BNA_EMAIL_DELIVERY_HISTORY_REQUIRED");
  expect((await mail.readForInquiry(actor,support.reference)).state).toBe("queued");
  await expect(query("DELETE FROM ls_service_interest.bna_email_delivery_events WHERE workspace_id=$1",[workspace])).rejects.toThrow();
  const policy:BnaDispatchAdmission={version:1,mode:"controlled_test",workspaceId:workspace,ownerAccountId:owner,sender:BNA_EMAIL_SENDER,sourceSha256:BNA_EMAIL_SOURCE,activatedAt:env.LS_BNA_EMAIL_QUEUE_SINCE,
   messageCopies:{"EMAIL-B0":"a".repeat(64),"EMAIL-S0":"b".repeat(64)},target:{projectId:randomUUID(),environmentId:randomUUID(),serviceId:randomUUID(),databaseSystemId:(await query("SELECT system_identifier::text AS id FROM pg_control_system()")).rows[0]!.id},releaseCommit:"c".repeat(40),expiresAt:"2026-10-29T20:00:00Z",references:[{inquiryId:saved.reference,templateId:"EMAIL-B0",locale:"he",recipientSha256:"d".repeat(64)}]};
  await expect(mail.assertDeliveryTarget(policy)).rejects.toMatchObject({code:"UNAVAILABLE"}); // Plain local PostgreSQL cannot authorize delivery.
  if(process.env.LS_BNA_NATIVE_TLS_CA){
   tlsPool=new pg.Pool({connectionString:db.url,ssl:{ca:readFileSync(process.env.LS_BNA_NATIVE_TLS_CA,"utf8"),rejectUnauthorized:true},max:1});
   const tlsMail=new BnaAcknowledgmentStore(poolStore(tlsPool),workspace,owner,ring,key,clock);
   await expect(tlsMail.assertDeliveryTarget(policy)).resolves.toBeUndefined();
   await expect(tlsMail.assertDeliveryTarget({...policy,target:{...policy.target,databaseSystemId:"9999999999999999"}})).rejects.toMatchObject({code:"UNAVAILABLE"});
   await expect(tlsMail.assertDeliveryTarget({...policy,ownerAccountId:randomUUID()})).rejects.toMatchObject({code:"UNAVAILABLE"});
  }
 }finally{await tlsPool?.end();await pool.end();client.release();await db.close();}
},60000);
