import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM,type BnaCoopFields} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM,type BnaSupportFields} from "../../src/features/bna-inquiry/support-contract.ts";
import {BnaAcknowledgmentStore,configuredBnaAcknowledgmentQueue} from "../../src/features/bna-communications/acknowledgment-store.ts";
import {BNA_EMAIL_SOURCE} from "../../src/features/bna-communications/delivery-policy.ts";
import {BNA_EMAIL_SENDER} from "../../src/features/bna-communications/delivery-policy.ts";
import {bnaEmailCandidates} from "../../src/features/bna-communications/email-candidates.ts";
import {bnaRecipientSha256,type BnaDispatchAdmission} from "../../src/features/bna-communications/dispatch-admission.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";

const db=new PGlite(),workspace=asId(randomUUID(),"workspace"),owner=randomUUID(),other=randomUUID();
const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,19)}},key="synthetic-bna-acknowledgment-private-key";
let now=new Date("2026-10-29T18:00:00Z");const clock={now:()=>now};
const databaseErrors:string[]=[];
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 {try{return (await tx.query<T>(sql,[...values])).rows;}catch(error){databaseErrors.push(error instanceof Error?error.message:"DB_ERROR");throw error;}}} as SqlSession))};
const env={LS_BNA_EMAIL_QUEUE_ENABLED:"true",LS_BNA_EMAIL_QUEUE_SINCE:"2026-10-29T17:00:00Z",LS_BNA_EMAIL_SOURCE_SHA256:BNA_EMAIL_SOURCE};
const inquiries=new BnaInquiryStore(adapter,workspace,ring,key,owner,clock,configuredBnaAcknowledgmentQueue(env,ring,key));
const mail=new BnaAcknowledgmentStore(adapter,workspace,owner,ring,key,clock);
const fields=():BnaCoopFields=>({name:"SYNTHETIC ADULT",contactChannel:"email",contact:randomUUID()+"@example.invalid",emailUpdates:false,
 language:"he",siteLanguage:"en",townOrZip:"DO NOT COPY TOWN",childAges:[10],question:"DO NOT COPY CHILD NOTE",
 permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"en"}});
const actor=(id:string)=>({id,workspaceId:workspace,personId:id,role:id===owner?"practitioner":"parent",state:"active",locale:"en",sessionDigest:id.replaceAll("-","").padEnd(64,"0"),expiresAt:new Date("2035-01-01").getTime()}) as Actor;
const ownerActor=actor(owner),otherActor=actor(other);
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");
 for(const file of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0131_ls_public_group_applications.sql","0139_ls_bna_inquiries.sql","0142_ls_bna_coop_interest.sql","0144_ls_bna_support_interest.sql","0146_ls_bna_communication_delivery.sql"])
  await db.exec(await readFile("migrations/"+file,"utf8"));
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
 for(const id of [owner,other]){
  const digest=id.replaceAll("-","").padEnd(64,"0");
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$5,'active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[id,workspace,digest,now,id===owner?"practitioner":"parent"]);
  await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
  await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date("2035-01-01")]);
 }
},30000);
afterAll(async()=>db.close());
it("queues one frozen B0 atomically with its inquiry, operation and initial follow-up; replay creates nothing",async()=>{
 const input={operationId:randomUUID(),fields:fields()},saved=await inquiries.submit(input,BNA_COOP_PROGRAM);
 expect(await inquiries.submit(input,BNA_COOP_PROGRAM)).toEqual({...saved,replayed:true});
 const delivery=await mail.readForInquiry(ownerActor,saved.reference);expect(delivery).toMatchObject({state:"queued",version:1,payload:{templateId:"EMAIL-B0",locale:"he",recipient:input.fields.contact}});
 if(!('messageId' in delivery))throw Error();
 const raw=(await db.query("SELECT payload_ciphertext FROM ls_service_interest.bna_email_messages WHERE workspace_id=$1 AND id=$2",[workspace,delivery.messageId])).rows[0];
 expect(JSON.stringify(raw)).not.toMatch(/SYNTHETIC ADULT|DO NOT COPY|example.invalid/);
 expect(JSON.stringify(delivery)).not.toMatch(/DO NOT COPY/);
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_email_messages")).rows).toEqual([{n:1}]);
 expect((await db.query("SELECT count(*)::int AS n FROM ls_identity.people")).rows).toEqual([{n:2}]);
 await expect(mail.readForInquiry(otherActor,saved.reference)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(inquiries.submit({...input,fields:{...input.fields,language:"en"}},BNA_COOP_PROGRAM)).rejects.toMatchObject({code:"CONFLICT"});
 await expect(db.query("DELETE FROM ls_service_interest.bna_email_messages WHERE workspace_id=$1",[workspace])).rejects.toThrow();
});
it("keeps phone-only interest valid, uses S0 for actual Support and never backfills a disabled/predating submission",async()=>{
 const phone=fields();phone.contactChannel="phone";phone.contact="+12025550123";
 const saved=await inquiries.submit({operationId:randomUUID(),fields:phone},BNA_COOP_PROGRAM);expect(await mail.readForInquiry(ownerActor,saved.reference)).toEqual({state:"not_queued"});
 const support:BnaSupportFields={name:"SYNTHETIC SUPPORT ADULT",contactChannel:"email",contact:randomUUID()+"@example.invalid",purpose:"support_conversation",language:"en",siteLanguage:"he",emailUpdates:false,
  permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"he"}};
 const actual=await inquiries.submit({operationId:randomUUID(),fields:support},BNA_SUPPORT_PROGRAM);expect(await mail.readForInquiry(ownerActor,actual.reference)).toMatchObject({state:"queued",payload:{templateId:"EMAIL-S0",locale:"en"}});
 const disabled=new BnaInquiryStore(adapter,workspace,ring,key,owner,clock,configuredBnaAcknowledgmentQueue({},ring,key));
 const input={operationId:randomUUID(),fields:fields()},old=await disabled.submit(input,BNA_COOP_PROGRAM);
 await inquiries.submit(input,BNA_COOP_PROGRAM);expect(await mail.readForInquiry(ownerActor,old.reference)).toEqual({state:"not_queued"});
 now=new Date("2026-10-29T16:00:00Z");const earlier=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM);now=new Date("2026-10-29T18:00:00Z");
 expect(await mail.readForInquiry(ownerActor,earlier.reference)).toEqual({state:"not_queued"});
});
it("a queue failure rolls back the complete new transaction rather than acknowledging a lost inquiry",async()=>{
 const failed=new BnaInquiryStore(adapter,workspace,ring,key,owner,clock,async()=>{throw Error("SYNTHETIC_OUTBOX_FAILURE");});
 const input={operationId:randomUUID(),fields:fields()};await expect(failed.submit(input,BNA_COOP_PROGRAM)).rejects.toThrow("SYNTHETIC_OUTBOX_FAILURE");
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_inquiry_operations WHERE workspace_id=$1 AND operation_id=$2",[workspace,input.operationId])).rows).toEqual([{n:0}]);
 const recovered=await inquiries.submit(input,BNA_COOP_PROGRAM);expect(await mail.readForInquiry(ownerActor,recovered.reference)).toMatchObject({state:"queued"});
});
it("commits UNKNOWN before an external effect and never retries it after a timeout or crash",async()=>{
 const saved=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM),queued=await mail.readForInquiry(ownerActor,saved.reference);if(!('messageId' in queued))throw Error();
 let calls=0;const transport={mode:"controlled_test" as const,authorize:()=>true,send:async()=>{calls++;throw Error("SYNTHETIC_RESPONSE_LOST");}};
 expect(await mail.dispatch(queued.messageId,transport)).toBe("unknown");expect(await mail.dispatch(queued.messageId,transport)).toBe("unknown");expect(calls).toBe(1);
 expect(await mail.readForInquiry(ownerActor,saved.reference)).toMatchObject({state:"unknown",version:2});
 await expect(db.query("UPDATE ls_service_interest.bna_email_delivery SET state='queued',version=version+1,reserved_at=NULL WHERE workspace_id=$1 AND message_id=$2",[workspace,queued.messageId])).rejects.toThrow();
});
it("retains provider acceptance as sent rather than delivered, distinguishes no-send failure, and records explicit cancellation",async()=>{
 databaseErrors.length=0;
 const saved=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM),queued=await mail.readForInquiry(ownerActor,saved.reference);if(!('messageId' in queued))throw Error();
 let calls=0;const accepted={mode:"controlled_test" as const,authorize:()=>true,send:async()=>{calls++;return {state:"accepted" as const,providerId:"synthetic-provider-id"};}};
 const outcome=await mail.dispatch(queued.messageId,accepted);expect({outcome,databaseErrors}).toEqual({outcome:"sent",databaseErrors:[]});expect(await mail.dispatch(queued.messageId,accepted)).toBe("sent");expect(calls).toBe(1);
 expect(await mail.readForInquiry(ownerActor,saved.reference)).toMatchObject({state:"sent",providerId:"synthetic-provider-id",version:3});
 const another=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM),next=await mail.readForInquiry(ownerActor,another.reference);if(!('messageId' in next))throw Error();
 expect(await mail.dispatch(next.messageId,{mode:"controlled_test",authorize:()=>true,send:async()=>({state:"not_attempted"})})).toBe("failed");
 const command={messageId:next.messageId,operationId:randomUUID(),expectedVersion:3};
 await expect(mail.cancel(otherActor,command)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(await mail.cancel(ownerActor,command)).toEqual({state:"canceled",replayed:false});expect(await mail.cancel(ownerActor,command)).toEqual({state:"canceled",replayed:true});
 await expect(mail.cancel(ownerActor,{...command,expectedVersion:4})).rejects.toMatchObject({code:"CONFLICT"});
});
it("database controls require a matching immutable state event and reject cross-program delivery facts",async()=>{
 const saved=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM),queued=await mail.readForInquiry(ownerActor,saved.reference);if(!('messageId' in queued))throw Error();
 await expect(db.query("UPDATE ls_service_interest.bna_email_delivery SET state='unknown',version=2,reserved_at=$3 WHERE workspace_id=$1 AND message_id=$2",[workspace,queued.messageId,now])).rejects.toThrow("BNA_EMAIL_DELIVERY_HISTORY_REQUIRED");
 expect(await mail.readForInquiry(ownerActor,saved.reference)).toMatchObject({state:"queued",version:1});
 await expect(db.query("INSERT INTO ls_service_interest.bna_email_delivery_events(workspace_id,message_id,version,operation_id,state,code,recorded_at) VALUES($1,$2,99,$3,'sent','FORGED_STATE',$4)",[workspace,queued.messageId,randomUUID(),now])).rejects.toThrow("BNA_EMAIL_EVENT_STATE_MISMATCH");
 await expect(db.query("UPDATE ls_service_interest.bna_email_messages SET program_key='bna_support_interest',template_id='EMAIL-S0' WHERE workspace_id=$1 AND id=$2",[workspace,queued.messageId])).rejects.toThrow();
 expect((await mail.readForInquiry(ownerActor,saved.reference)).state).toBe("queued");
});
it("an unadmitted job remains queued without reserving or calling a provider",async()=>{
 const saved=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM),queued=await mail.readForInquiry(ownerActor,saved.reference);if(!('messageId' in queued))throw Error();
 let calls=0;expect(await mail.dispatch(queued.messageId,{mode:"controlled_test",authorize:()=>false,send:async()=>{calls++;return {state:"unknown"};}})).toBe("held");
 expect(calls).toBe(0);expect(await mail.readForInquiry(ownerActor,saved.reference)).toMatchObject({state:"queued",version:1});
});
it("a cancellation during the provider request retains the eventual provider fact",async()=>{
 const saved=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM),queued=await mail.readForInquiry(ownerActor,saved.reference);if(!('messageId' in queued))throw Error();
 const messageId=queued.messageId;
 expect(await mail.dispatch(messageId,{mode:"controlled_test",authorize:()=>true,send:async()=>{
  await mail.cancel(ownerActor,{messageId,operationId:randomUUID(),expectedVersion:2});
  return {state:"accepted",providerId:"synthetic-after-cancel"};
 }})).toBe("sent");
 const read=await mail.readForInquiry(ownerActor,saved.reference);expect(read).toMatchObject({state:"sent",version:4,lastCode:"PROVIDER_ACCEPTED_AFTER_CANCEL",providerId:"synthetic-after-cancel"});
 expect('history' in read?read.history.map(item=>item.code):[]).toEqual(["PROVIDER_ACCEPTED_AFTER_CANCEL","OWNER_CANCELED_UNCONFIRMED","CONTROLLED_DELIVERY_RESERVED","INQUIRY_SAVED"]);
});
it("only a proven no-send failure can be explicitly retried; UNKNOWN cannot be requeued",async()=>{
 const saved=await inquiries.submit({operationId:randomUUID(),fields:fields()},BNA_COOP_PROGRAM),queued=await mail.readForInquiry(ownerActor,saved.reference);if(!('messageId' in queued))throw Error();
 expect(await mail.dispatch(queued.messageId,{mode:"controlled_test",authorize:()=>true,send:async()=>({state:"not_attempted"})})).toBe("failed");
 const command={messageId:queued.messageId,operationId:randomUUID(),expectedVersion:3};
 await expect(mail.retryNotAttempted(otherActor,command)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(await mail.retryNotAttempted(ownerActor,command)).toEqual({state:"queued",replayed:false});expect(await mail.retryNotAttempted(ownerActor,command)).toEqual({state:"queued",replayed:true});
 expect(await mail.readForInquiry(ownerActor,saved.reference)).toMatchObject({state:"queued",version:4});
 expect(await mail.dispatch(queued.messageId,{mode:"controlled_test",authorize:()=>true,send:async()=>({state:"unknown"})})).toBe("unknown");
 await expect(mail.retryNotAttempted(ownerActor,{...command,operationId:randomUUID(),expectedVersion:5})).rejects.toMatchObject({code:"CONFLICT"});
});
it("future intake needs two exact native controlled receipts, not an arbitrary proof ID or another program",async()=>{
 const email="controlled-owner@example.invalid",b0=await inquiries.submit({operationId:randomUUID(),fields:{...fields(),contact:email}},BNA_COOP_PROGRAM);
 const support:BnaSupportFields={name:"SYNTHETIC SUPPORT",contactChannel:"email",contact:email,purpose:"support_conversation",language:"en",siteLanguage:"en",emailUpdates:false,
  permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"en"}};
 const s0=await inquiries.submit({operationId:randomUUID(),fields:support},BNA_SUPPORT_PROGRAM);
 const b=await mail.readForInquiry(ownerActor,b0.reference),s=await mail.readForInquiry(ownerActor,s0.reference);if(!('messageId' in b)||!('messageId' in s))throw Error();
 const policy:BnaDispatchAdmission={version:1,mode:"future_requests",workspaceId:workspace,ownerAccountId:owner,sender:BNA_EMAIL_SENDER,sourceSha256:BNA_EMAIL_SOURCE,activatedAt:env.LS_BNA_EMAIL_QUEUE_SINCE,
  messageCopies:{"EMAIL-B0":bnaEmailCandidates.messages.find(item=>item.id==="EMAIL-B0")!.copySha256,"EMAIL-S0":bnaEmailCandidates.messages.find(item=>item.id==="EMAIL-S0")!.copySha256},
  target:{projectId:randomUUID(),environmentId:randomUUID(),serviceId:randomUUID(),databaseSystemId:"1234567890123456789"},controlledProofs:{b0:b.messageId,s0:s.messageId,inboxReadbackSha256:"a".repeat(64)}};
 await expect(mail.verifyControlledProofs(policy,bnaRecipientSha256(email))).rejects.toMatchObject({code:"UNAVAILABLE"});
 const transport={mode:"controlled_test" as const,authorize:()=>true,send:async()=>({state:"accepted" as const,providerId:randomUUID()})};
 await mail.dispatch(b.messageId,transport);await mail.dispatch(s.messageId,transport);await expect(mail.verifyControlledProofs(policy,bnaRecipientSha256(email))).resolves.toBeUndefined();
 await expect(mail.verifyControlledProofs({...policy,controlledProofs:{...policy.controlledProofs,b0:s.messageId}},bnaRecipientSha256(email))).rejects.toMatchObject({code:"UNAVAILABLE"});
 await expect(mail.verifyControlledProofs(policy,bnaRecipientSha256("other@example.invalid"))).rejects.toMatchObject({code:"UNAVAILABLE"});
 await expect(mail.verifyControlledProofs({...policy,messageCopies:{...policy.messageCopies,"EMAIL-B0":"0".repeat(64)}},bnaRecipientSha256(email))).rejects.toMatchObject({code:"UNAVAILABLE"});
});
