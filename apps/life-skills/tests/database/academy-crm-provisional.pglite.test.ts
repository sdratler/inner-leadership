import {randomUUID} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {asId} from "../../src/lib/ids.ts";
import {AcademyCrmStore} from "../../src/features/contact-ops/server/academy-crm-store.ts";
import {ContactCutoverStore} from "../../src/features/contact-ops/server/cutover-store.ts";
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {floridaGroupApplicationNotice} from "../../src/features/group-application/contract.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";

async function fixture(db:PGlite){
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
  const initialize=()=>new ContactCutoverStore(adapter,ring,key,clock).initializeAcademy(actor,{operationId:randomUUID(),expectedEpoch:0,
   observedNativeWritesSinceSwitch:0,decisionId:"ACADEMY-ONLY-CRM-20261028-01",evidence:{
   retiredSourcesFence:digest,retiredSchedulesFence:digest,retainedAcademyRecords:digest,queueReconciliation:digest,restorePlan:digest}});
  return {crm,actor,initialize,applications:new PublicGroupApplicationStore(adapter,workspace,ring,key,clock)};
}
it("saves, replays and reloads one provisional adult with private notes and no external effect",async()=>{
 const db=new PGlite();
 try{
  const {crm,actor,initialize}=await fixture(db);
  const input={action:"create" as const,operationId:randomUUID(),expectedEpoch:1,fields:{
   name:"Synthetic adult",language:"en" as const,relationship:"adult_partner" as const,phone:null,email:null,
   stage:"Interested",nextAction:"Verify phone",followUpDate:null,notes:"Discussed the program. Contact endpoint unconfirmed."}};
  await expect(crm().execute(actor,input)).rejects.toThrow("CONFLICT");
  await initialize();
  const saved=await crm().execute(actor,input);
  expect(saved.outboundEligible).toBe(false);
  expect(await crm().execute(actor,input)).toMatchObject({personId:saved.personId,replayed:true});
  const {contact,history}=await crm().read(actor,saved.personId,1);
  expect(contact).toMatchObject({origin:{kind:"manual",phone:null,email:null},fields:{notes:input.fields.notes,nextAction:"Verify phone"}});
  expect(history.map(entry=>entry.kind)).toEqual(["created"]);
  expect(contact.fields.leadSource).toBeUndefined();
  expect(contact.fields.conversationChannel).toBeUndefined();
  await expect(crm().execute(actor,{...input,operationId:randomUUID(),fields:{...input.fields,name:"  SYNTHETIC   adult  ",phone:"+13055550175"}})).rejects.toThrow("CONFLICT");
  const update={action:"update" as const,personId:saved.personId,expectedVersion:saved.version,operationId:randomUUID(),expectedEpoch:1,
   fields:{...contact.fields,conversationChannel:"whatsapp" as const,confirmedPhone:"+13055550175"}};
  const changed=await crm().execute(actor,update);
  const updated=await crm().read(actor,saved.personId,1);
  expect(updated.contact).toMatchObject({origin:{phone:null,email:null},fields:{confirmedPhone:"+13055550175",conversationChannel:"whatsapp"},outboundEligible:false});
  expect(updated.contact.fields.leadSource).toBeUndefined();
  expect(updated.history.find(entry=>entry.kind==="updated")?.fields).toMatchObject(update.fields);
  const oldClientEdit={...update,operationId:randomUUID(),expectedVersion:changed.version,fields:{...contact.fields,stage:"Follow up"}};
  const revised=await crm().execute(actor,oldClientEdit);
  expect((await crm().read(actor,saved.personId,1)).contact.fields).toMatchObject({confirmedPhone:"+13055550175",conversationChannel:"whatsapp",stage:"Follow up"});
  const tagged=await crm().execute(actor,{...oldClientEdit,operationId:randomUUID(),expectedVersion:revised.version,fields:{...oldClientEdit.fields,leadSource:"facebook"}});
  expect((await crm().list(actor,{search:"facebook"}))).toMatchObject({total:1,items:[{fields:{leadSource:"facebook",conversationChannel:"whatsapp"}}]});
  const untagged=await crm().execute(actor,{...oldClientEdit,operationId:randomUUID(),expectedVersion:tagged.version,fields:{...oldClientEdit.fields,leadSource:"unknown"}});
  expect((await crm().list(actor,{search:"facebook"}))).toMatchObject({total:0});
  await expect(crm().execute(actor,{...input,operationId:randomUUID(),fields:{...input.fields,name:"Different adult",phone:"+13055550175"}})).rejects.toThrow("CONFLICT");
  const clear={...oldClientEdit,operationId:randomUUID(),expectedVersion:untagged.version,fields:{...oldClientEdit.fields,confirmedPhone:null}};
  const cleared=await crm().execute(actor,clear);
  expect(await crm().execute(actor,clear)).toMatchObject({version:cleared.version,replayed:true});
  const afterClear=await crm().read(actor,saved.personId,1);
  expect(afterClear.contact).toMatchObject({origin:{phone:null},fields:{confirmedPhone:null,conversationChannel:"whatsapp"},outboundEligible:false});
  expect(afterClear.history.find(entry=>entry.operationId===clear.operationId)?.fields?.confirmedPhone).toBeNull();
  expect(await crm().list(actor,{search:"+13055550175"})).toMatchObject({total:0});
  const correct=await crm().execute(actor,{...input,operationId:randomUUID(),fields:{...input.fields,name:"Different adult",phone:"+13055550175"}});
  expect(await crm().list(actor,{search:"+13055550175"})).toMatchObject({total:1,items:[{personId:correct.personId}]});
  await expect(crm().execute(actor,{...clear,personId:correct.personId,operationId:randomUUID(),expectedVersion:correct.version})).rejects.toThrow("INVALID_REQUEST");
  expect((await crm().read(actor,correct.personId,1)).contact.origin.phone).toBe("+13055550175");
  expect((await db.query("SELECT count(*)::int AS n FROM ls_contact_ops.academy_crm_contacts")).rows).toEqual([{n:2}]);
  expect((await db.query("SELECT count(*)::int AS n FROM ls_contact_ops.outbound_projections")).rows).toEqual([{n:0}]);
 } finally {await db.close();}
},60000);

it("admits an owner-reviewed namesake only for the exact inquiry and current Academy collision set",async()=>{
 const db=new PGlite();
 try{
  const {crm,actor,initialize,applications}=await fixture(db);await initialize();
  const admin={stage:"Interested",nextAction:null,followUpDate:null,notes:"Synthetic conversation."};
  const create=(name:string,phone:string|null)=>crm().execute(actor,{action:"create",operationId:randomUUID(),expectedEpoch:1,
   fields:{...admin,name,phone,email:null,language:"en",relationship:"adult_partner"}});
  const original=await create("Synthetic namesake",null);
  async function preview(phone:string){
   const source=await applications.submit({operationId:randomUUID(),fields:{parentName:"Synthetic namesake",contact:phone,language:"en",
    cityArea:"Synthetic Florida",programId:"sunday_fishing_academy",schedulePreference:["sunday"],
    permission:{confirmed:true,language:"en",version:floridaGroupApplicationNotice.version}}});
   return crm().previewInquiry(actor,source.item.id,1);
  }
  const first=await preview("+13055550180"),other=await preview("+13055550181");
  expect(first.review?.contacts.map(c=>c.personId)).toEqual([original.personId]);
  const base={action:"from_inquiry" as const,operationId:first.review!.operationId,expectedEpoch:1,fields:admin,
   sourceApplicationId:first.sourceApplicationId,sourceDigest:first.sourceDigest};
  await expect(crm().execute(actor,base)).rejects.toThrow("CONFLICT");
  const reviewed={...base,differentAdultProof:first.review!.proof};
  await expect(crm().execute(actor,{...reviewed,sourceDigest:"0".repeat(64)})).rejects.toThrow("CONFLICT");
  await expect(crm().execute(actor,{...reviewed,sourceApplicationId:other.sourceApplicationId,sourceDigest:other.sourceDigest})).rejects.toThrow("CONFLICT");
  await expect(crm().execute(actor,{...reviewed,operationId:randomUUID()})).rejects.toThrow("CONFLICT");
  await expect(crm().execute(actor,{...reviewed,expectedEpoch:0})).rejects.toThrow("CONFLICT");
  await expect(crm().execute({...actor,workspaceId:asId(randomUUID(),"workspace")},reviewed)).rejects.toThrow();
  await db.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[actor.id]);
  await expect(crm().execute(actor,reviewed)).rejects.toThrow();
  await db.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE id=$1",[actor.id]);
  const changed=await crm().execute(actor,{action:"update",operationId:randomUUID(),expectedEpoch:1,expectedVersion:original.version,
   personId:original.personId,fields:{...admin,stage:"Archived"}});
  await expect(crm().execute(actor,reviewed)).rejects.toThrow("CONFLICT");
  expect((await crm().previewInquiry(actor,first.sourceApplicationId,1)).review).toBeNull();
  const current=await crm().execute(actor,{action:"update",operationId:randomUUID(),expectedEpoch:1,expectedVersion:changed.version,
   personId:original.personId,fields:admin});
  await expect(crm().execute(actor,reviewed)).rejects.toThrow("CONFLICT");
  const refreshed=await crm().previewInquiry(actor,first.sourceApplicationId,1);
  const decision={...base,operationId:refreshed.review!.operationId,differentAdultProof:refreshed.review!.proof};
  const added=await crm().execute(actor,decision);
  expect(await crm().execute(actor,decision)).toMatchObject({personId:added.personId,replayed:true,outboundEligible:false});
  expect(added.personId).not.toBe(original.personId);
  expect((await crm().read(actor,original.personId,1)).contact).toMatchObject({version:current.version,origin:{kind:"manual",phone:null}});
  const converted=await crm().read(actor,added.personId,1);
  expect(converted.contact.origin).toMatchObject({kind:"inquiry",sourceApplicationId:first.sourceApplicationId});
  expect(converted.history[0]).toMatchObject({recordedBy:actor.id,operationId:decision.operationId,differentAdult:{
   sourceApplicationId:first.sourceApplicationId,sourceDigest:first.sourceDigest,compared:[{personId:original.personId,version:current.version}]}});
  const pending=await crm().previewInquiry(actor,other.sourceApplicationId,1);
  await create("Another synthetic adult","+13055550181");
  await expect(crm().execute(actor,{...base,sourceApplicationId:other.sourceApplicationId,sourceDigest:other.sourceDigest,
   operationId:pending.review!.operationId,differentAdultProof:pending.review!.proof})).rejects.toThrow("CONFLICT");
  expect((await crm().previewInquiry(actor,other.sourceApplicationId,1)).review).toBeNull();
  expect(await crm().list(actor)).toMatchObject({total:3});
  expect((await db.query("SELECT count(*)::int AS n FROM ls_contact_ops.outbound_projections")).rows).toEqual([{n:0}]);
 }finally{await db.close();}
},60000);
