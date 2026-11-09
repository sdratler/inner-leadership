import {randomUUID} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {asId} from "../../src/lib/ids.ts";
import {AcademyCrmStore} from "../../src/features/contact-ops/server/academy-crm-store.ts";
import {ContactCutoverStore} from "../../src/features/contact-ops/server/cutover-store.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";

it("saves, replays and reloads one provisional adult with private notes and no external effect",async()=>{
 const db=new PGlite();
 try{
  await db.exec("CREATE SCHEMA ls_control");
  const migrations=(await readdir("migrations")).filter(name=>/^\d{4}_.*\.sql$/.test(name)&&Number(name.slice(0,4))<=138).sort();
  for(const name of migrations)await db.exec(await readFile("migrations/"+name,"utf8"));
  const adapter:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>(
   await tx.query<T>(sql,[...values])).rows} as SqlSession))};
  const workspace=asId(randomUUID(),"workspace"),operator=asId(randomUUID(),"account"),person=asId(randomUUID(),"person");
  const now=new Date("2026-11-09T12:00:00Z"),digest="1".repeat(64);
  const actor:Actor={workspaceId:workspace,id:operator,personId:person,role:"practitioner",state:"active",locale:"en",
   sessionDigest:digest,expiresAt:new Date("2035-01-01").getTime()};
  await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[person,workspace,now]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[operator,workspace,digest,now]);
  await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[workspace,operator,person]);
  await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,operator,now,new Date("2035-01-01")]);
  const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,9)}},clock={now:()=>now},key="local-synthetic-integrity-key-only";
  const crm=()=>new AcademyCrmStore(adapter,ring,key,clock);
  const input={action:"create" as const,operationId:randomUUID(),expectedEpoch:1,fields:{
   name:"Synthetic adult",language:"en" as const,relationship:"adult_partner" as const,phone:null,email:null,
   stage:"Interested",nextAction:"Verify phone",followUpDate:null,notes:"Discussed the program. Contact endpoint unconfirmed."}};
  await expect(crm().execute(actor,input)).rejects.toThrow("CONFLICT");
  await new ContactCutoverStore(adapter,ring,key,clock).initializeAcademy(actor,{operationId:randomUUID(),expectedEpoch:0,
   observedNativeWritesSinceSwitch:0,decisionId:"ACADEMY-ONLY-CRM-20261028-01",evidence:{
   retiredSourcesFence:digest,retiredSchedulesFence:digest,retainedAcademyRecords:digest,queueReconciliation:digest,restorePlan:digest}});
  const saved=await crm().execute(actor,input);
  expect(saved.outboundEligible).toBe(false);
  expect(await crm().execute(actor,input)).toMatchObject({personId:saved.personId,replayed:true});
  const {contact,history}=await crm().read(actor,saved.personId,1);
  expect(contact).toMatchObject({origin:{kind:"manual",phone:null,email:null},fields:{notes:input.fields.notes,nextAction:"Verify phone"}});
  expect(history.map(entry=>entry.kind)).toEqual(["created"]);
  await expect(crm().execute(actor,{...input,operationId:randomUUID(),fields:{...input.fields,name:"  SYNTHETIC   adult  ",phone:"+13055550175"}})).rejects.toThrow("CONFLICT");
  expect((await db.query("SELECT count(*)::int AS n FROM ls_contact_ops.academy_crm_contacts")).rows).toEqual([{n:1}]);
  expect((await db.query("SELECT count(*)::int AS n FROM ls_contact_ops.outbound_projections")).rows).toEqual([{n:0}]);
 } finally {await db.close();}
},60000);
