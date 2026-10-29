import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import pg from "pg";
vi.mock("server-only",()=>({}));
import {historicalPracticeDatabase} from "./home-practice/legacy-practice-fixture.ts";
import {poolStore} from "./calendar/fixture.ts";
import {migrate} from "../../src/db/migration-runner.ts";
import {bnaSupportSchemaPlan,readBnaSupportSchemaStage,BNA_SUPPORT_MIGRATION} from "../../src/db/bna-support-schema-release.ts";
import {readBnaCoopSchemaStage} from "../../src/db/bna-coop-schema-release.ts";
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_INQUIRY_NOTICE} from "../../src/features/bna-inquiry/contract.ts";
import {BNA_COOP_PROGRAM,BNA_COOP_NOTICE} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_SUPPORT_PROGRAM,BNA_SUPPORT_NOTICE} from "../../src/features/bna-inquiry/support-contract.ts";
import {publicBnaInquiryHttp} from "../../src/features/bna-inquiry/http.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";

it("upgrades native support atomically, preserves existing inquiries, and saves one owner-readable support inquiry through HTTP replay",async()=>{
 const db=await historicalPracticeDatabase("0118_ls_contact_delta_history.sql"),client=await db.pool.connect(),query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 const servicePool=new pg.Pool({connectionString:db.url,ssl:false,max:1});
 try{
  const index=db.inventory.findIndex(file=>file.name===BNA_SUPPORT_MIGRATION.name),baseline=db.inventory.slice(0,index),target=db.inventory.slice(0,index+1),migration=target.at(-1)!;expect(index).toBe(63);
  await migrate({query},baseline,false);
  const workspace=asId(randomUUID(),"workspace"),owner=randomUUID(),session="a".repeat(64),now=new Date("2026-10-29T13:00:00Z");
  await query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
  await query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[owner,workspace,now]);
  await query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[owner,workspace,session,now]);
  await query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,owner]);
  await query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[session,workspace,owner,now,new Date("2035-01-01")]);
  const actor={id:owner,workspaceId:workspace,personId:owner,role:"practitioner",state:"active",locale:"en",sessionDigest:session,expiresAt:new Date("2035-01-01").getTime()} as Actor;
  const store=new BnaInquiryStore(poolStore(servicePool),workspace,{activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,7)}},"7".repeat(64),owner,{now:()=>now});
  const common={name:"Synthetic retained parent",contactChannel:"email" as const,contact:"retained@example.invalid",language:"en" as const,townOrZip:"Florida",childAges:[10]};
  const torah=await store.submit({operationId:randomUUID(),fields:{...common,permission:{confirmed:true,version:BNA_INQUIRY_NOTICE.version,language:"en"}}});
  const coop=await store.submit({operationId:randomUUID(),fields:{...common,siteLanguage:"en",emailUpdates:false,permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"en"}}},BNA_COOP_PROGRAM);
  const history=async()=>(await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows;
  const rows=async()=>(await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t ORDER BY id")).rows;
  const before=await rows(),ledger=await history();expect(await readBnaSupportSchemaStage({query})).toBe(0);expect(bnaSupportSchemaPlan(db.inventory,ledger,0).pending).toHaveLength(1);
  await expect(migrate({query},[...baseline,{...migration,sql:migration.sql+"\nSELECT 1/0;"}],false)).rejects.toThrow("MIGRATION_FAILED");
  expect(await rows()).toEqual(before);expect(await history()).toEqual(ledger);expect(await readBnaSupportSchemaStage({query})).toBe(0);
  await query("BEGIN");try{
   await query("ALTER TABLE ls_service_interest.bna_inquiries DROP CONSTRAINT bna_inquiries_program_key_check");
   await query("ALTER TABLE ls_service_interest.bna_inquiries ADD CONSTRAINT bna_inquiries_program_key_check CHECK (program_key IN ('bna_torah_mornings','bna_learning_coop','unreviewed')) NOT VALID");
   await expect(readBnaSupportSchemaStage({query})).rejects.toThrow("BNA_SUPPORT_SCHEMA_CATALOG_CONFLICT");
  }finally{await query("ROLLBACK");}
  expect(await migrate({query},target,false)).toEqual({applied:1,pending:0});expect(await rows()).toEqual(before);
  expect(await readBnaSupportSchemaStage({query})).toBe(1);expect(await readBnaCoopSchemaStage({query})).toBe(1);
  expect(bnaSupportSchemaPlan(db.inventory,await history(),1).pending).toEqual([]);expect(await migrate({query},target,true)).toEqual({applied:0,pending:0});
  expect((await store.read(actor,torah.reference)).program).toBe("bna_torah_mornings");expect((await store.read(actor,coop.reference)).program).toBe(BNA_COOP_PROGRAM);
  const counts=async()=>(await query("SELECT (SELECT count(*)::int FROM ls_identity.people) AS people,(SELECT count(*)::int FROM ls_calendar.tasks) AS tasks,(SELECT count(*)::int FROM ls_service_interest.public_applications) AS fishing,(SELECT count(*)::int FROM ls_service_interest.inquiry_email_outbox) AS outbox")).rows;
  const countsBefore=await counts(),origin="https://support.example.invalid";let clock=now.getTime();
  const deps={enabled:true,environment:{LS_APP_ORIGIN:origin},challengeKey:"synthetic-native-support-challenge-key",now:()=>clock,limits:{consume:async()=>({count:1,retryAfterMs:0})},store};
  const request=(method:string,body?:unknown)=>new Request(origin+"/api/public/bna-support-inquiries",{method,headers:{host:"support.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const offer=(await (await publicBnaInquiryHttp(request("GET"),async()=>deps,"support")).json()).data;
  const fields={name:"Synthetic native support caller",contactChannel:"phone",contact:"+12025550129",purpose:"support_conversation",language:"he",siteLanguage:"en",emailUpdates:false,permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"en"}};
  const input={operationId:randomUUID(),challenge:offer.challenge,fields};clock+=1500;
  const saved=await publicBnaInquiryHttp(request("POST",input),async()=>deps,"support");expect(saved.status).toBe(201);const receipt=(await saved.json()).data;
  const replay=await publicBnaInquiryHttp(request("POST",input),async()=>deps,"support");expect(replay.status).toBe(200);expect((await replay.json()).data).toEqual({...receipt,replayed:true});
  expect(await store.read(actor,receipt.reference)).toMatchObject({program:BNA_SUPPORT_PROGRAM,fields,attribution:{landingPath:"/support"}});
  await expect(store.read({...actor,id:asId(randomUUID(),"account")},receipt.reference)).rejects.toMatchObject({code:"NOT_FOUND"});
  expect((await store.list(actor)).items).toHaveLength(3);expect(await counts()).toEqual(countsBefore);
  await expect(query("UPDATE ls_service_interest.bna_inquiries SET notice_language='he' WHERE id=$1",[receipt.reference])).rejects.toThrow();
 }finally{await servicePool.end();client.release();await db.close();}
},60000);
