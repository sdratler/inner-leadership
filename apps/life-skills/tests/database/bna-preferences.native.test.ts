import {randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {expect,it,vi} from "vitest";
import pg from "pg";
vi.mock("server-only",()=>({}));
import {historicalPracticeDatabase} from "./home-practice/legacy-practice-fixture.ts";
import {poolStore} from "./calendar/fixture.ts";
import {migrate} from "../../src/db/migration-runner.ts";
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BnaPreferenceStore} from "../../src/features/bna-communications/preferences-store.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";

it("native additive preference upgrade rolls back safely, preserves inquiries and serializes conflicting owner controls",async()=>{
 const db=await historicalPracticeDatabase("0118_ls_contact_delta_history.sql"),client=await db.pool.connect();
 const query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 const pool=new pg.Pool({connectionString:db.url,ssl:false,max:6});
 try{
  await migrate({query},db.inventory,false);
  const workspace=asId(randomUUID(),"workspace"),owner=randomUUID(),session="a".repeat(64),now=new Date("2026-10-29T22:00:00Z"),clock={now:()=>now};
  const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,23)}},key="synthetic-native-bna-preference-private-key";
  await query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
  await query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[owner,workspace,now]);
  await query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[owner,workspace,session,now]);
  await query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,owner]);
  await query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[session,workspace,owner,now,new Date("2035-01-01")]);
  const actor={id:owner,workspaceId:workspace,personId:owner,role:"practitioner",state:"active",locale:"en",sessionDigest:session,expiresAt:new Date("2035-01-01").getTime()} as Actor;
  const inquiries=new BnaInquiryStore(poolStore(pool),workspace,ring,key,owner,clock);
  const inquiry=await inquiries.submit({operationId:randomUUID(),fields:{name:"Synthetic native adult",contactChannel:"email",contact:"synthetic@example.invalid",language:"he",siteLanguage:"en",emailUpdates:true,
   townOrZip:"DO NOT COPY TOWN",childAges:[10],question:"DO NOT COPY CHILD NOTE",permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"en"}}},BNA_COOP_PROGRAM);
  const before=(await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t ORDER BY id")).rows;
  const sql=readFileSync("migrations/proposals/0148_ls_bna_email_preferences.sql","utf8"),proposal={name:"0148_ls_bna_email_preferences.sql",checksum:createHash("sha256").update(sql).digest("hex"),sql};
  const ledger=(await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows;
  await expect(migrate({query},[...db.inventory,{...proposal,sql:sql+"\nSELECT 1/0;"}],false)).rejects.toThrow("MIGRATION_FAILED");
  expect((await query("SELECT to_regclass('ls_service_interest.bna_email_preference_events') AS relation")).rows).toEqual([{relation:null}]);
  expect((await query("SELECT name,checksum FROM ls_control.migrations ORDER BY name")).rows).toEqual(ledger);
  expect(await migrate({query},[...db.inventory,proposal],false)).toEqual({applied:1,pending:0});
  expect((await query("SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t ORDER BY id")).rows).toEqual(before);
  const prefs=new BnaPreferenceStore(poolStore(pool),workspace,owner,ring,key,clock,inquiries);
  const command={inquiryId:inquiry.reference,operationId:randomUUID(),expectedVersion:0,action:"pause_all" as const,note:"Synthetic owner pause"};
  const outcomes=await Promise.allSettled([prefs.updateOwner(actor,command),prefs.updateOwner(actor,{...command,operationId:randomUUID(),action:"withdraw_all"})]);
  expect(outcomes.filter(outcome=>outcome.status==="fulfilled")).toHaveLength(1);
  expect(outcomes.filter(outcome=>outcome.status==="rejected").map(outcome=>outcome.status==="rejected"?outcome.reason.code:null)).toEqual(["CONFLICT"]);
  const current=await prefs.readOwner(actor,inquiry.reference);expect(current.preferences.version).toBe(1);expect(current.history).toHaveLength(1);
  const winningOperation=current.history[0]!.operationId;
  const winning=winningOperation===command.operationId?command:{...command,operationId:winningOperation,action:"withdraw_all" as const};
  expect(await prefs.updateOwner(actor,winning)).toMatchObject({replayed:true,preferences:{version:1}});
  await expect(query("UPDATE ls_service_interest.bna_email_preference_events SET payload_ciphertext='changed'")).rejects.toThrow();
  await expect(query("TRUNCATE ls_service_interest.bna_email_preference_events")).rejects.toThrow();
  const counts=(await query(`SELECT (SELECT count(*)::int FROM ls_service_interest.bna_email_messages) AS messages,
   (SELECT count(*)::int FROM ls_service_interest.bna_email_preference_events) AS preferences`)).rows[0];
  expect(counts).toEqual({messages:0,preferences:1});
 }finally{await pool.end();client.release();await db.close();}
},30000);
