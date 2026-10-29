import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM,type BnaCoopFields} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM} from "../../src/features/bna-inquiry/support-contract.ts";
import {BnaPreferenceStore} from "../../src/features/bna-communications/preferences-store.ts";
import {BNA_PREFERENCE_NOTICE} from "../../src/features/bna-communications/preferences-contract.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
const db=new PGlite(),workspace=asId(randomUUID(),"workspace"),owner=randomUUID(),other=randomUUID();
const ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,23)}},key="synthetic-bna-preferences-private-key";
let now=new Date("2026-10-29T21:00:00Z");const clock={now:()=>now};
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const inquiries=new BnaInquiryStore(adapter,workspace,ring,key,owner,clock),prefs=new BnaPreferenceStore(adapter,workspace,owner,ring,key,clock,inquiries);
const actor=(id:string)=>({id,workspaceId:workspace,personId:id,role:id===owner?"practitioner":"parent",state:"active",locale:"en",sessionDigest:id.replaceAll("-","").padEnd(64,"0"),expiresAt:new Date("2035-01-01").getTime()}) as Actor;
const ownerActor=actor(owner),otherActor=actor(other);
const fields=(email=randomUUID()+"@example.invalid",updates=false):BnaCoopFields=>({name:"SYNTHETIC ADULT",contactChannel:"email",contact:email,emailUpdates:updates,
 language:"he",siteLanguage:"en",townOrZip:"DO NOT COPY TOWN",childAges:[10],question:"DO NOT COPY CHILD NOTE",permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"en"}});
async function inquiry(email?:string,updates=false){return (await inquiries.submit({operationId:randomUUID(),fields:fields(email,updates)},BNA_COOP_PROGRAM)).reference;}
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");
 for(const file of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0131_ls_public_group_applications.sql","0139_ls_bna_inquiries.sql","0142_ls_bna_coop_interest.sql","0144_ls_bna_support_interest.sql","0148_ls_bna_email_preferences.sql"])
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
it("reads captured permission without a write, no child/address disclosure or token side effect",async()=>{
 const id=await inquiry(),before=(await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_email_preference_events")).rows;
 const own=await prefs.readOwner(ownerActor,id);expect(own).toMatchObject({preferences:{version:0,permissionGrantedAt:null,withdrawn:false},history:[]});
 const cap=await prefs.issueCapability(ownerActor,id),read=await prefs.readRecipient(cap.token);
 expect(read).toMatchObject({inquiryId:id,canSubscribe:true,preferences:{program:BNA_COOP_PROGRAM,locale:"he",updates:false,deliveryPaused:false}});
 expect(JSON.stringify(read)).not.toMatch(/SYNTHETIC|DO NOT COPY|example.invalid|recipientKey|ownerAccount/);
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_email_preference_events")).rows).toEqual(before);
});
it("owner pause/reply/withdraw commands replay once, reject changed intent and cannot invent permission",async()=>{
 const id=await inquiry(),command={inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:"record_reply" as const,note:"Synthetic owner observed reply"};
 await expect(prefs.updateOwner(otherActor,command)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(await prefs.updateOwner(ownerActor,command)).toMatchObject({replayed:false,preferences:{version:1,replyPending:true,permissionGrantedAt:null}});
 expect(await prefs.updateOwner(ownerActor,command)).toMatchObject({replayed:true,preferences:{version:1}});
 await expect(prefs.updateOwner(ownerActor,{...command,note:"Different intent"})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(prefs.updateOwner(ownerActor,{...command,operationId:randomUUID(),expectedVersion:0})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await prefs.readOwner(ownerActor,id)).history).toHaveLength(1);
 await expect(prefs.updateOwner(ownerActor,{...command,action:"grant_permission"} as never)).rejects.toThrow();
});
it("same adult in co-op and support shares global suppression but retains distinct permissions and reply triage",async()=>{
 const email=randomUUID()+"@example.invalid",co=await inquiry(email,true);
 const support=(await inquiries.submit({operationId:randomUUID(),fields:{name:"SYNTHETIC SUPPORTER",contactChannel:"email",contact:email,emailUpdates:false,purpose:"support_conversation",language:"en",siteLanguage:"en",
  permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"en"}}},BNA_SUPPORT_PROGRAM)).reference;
 const cap=await prefs.issueCapability(ownerActor,co);
 await prefs.updateOwner(ownerActor,{inquiryId:co,operationId:randomUUID(),expectedVersion:0,action:"record_reply",note:"Synthetic reply observed"});
 expect((await prefs.readOwner(ownerActor,support)).preferences).toMatchObject({version:1,permissionGrantedAt:null,replyPending:false});
 await prefs.updateRecipient(cap.token,{inquiryId:co,operationId:randomUUID(),expectedVersion:1,action:"unsubscribe_all"});
 expect((await prefs.readOwner(ownerActor,support)).preferences.withdrawn).toBe(true);
 now=new Date(now.getTime()+1000);
 await prefs.updateRecipient(cap.token,{inquiryId:co,operationId:randomUUID(),expectedVersion:2,action:"set_preferences",updates:true,locale:"en",noticeVersion:BNA_PREFERENCE_NOTICE.version,noticeLanguage:"en"});
 expect((await prefs.readOwner(ownerActor,co)).preferences).toMatchObject({permissionGrantedAt:now.toISOString(),withdrawn:false,replyPending:true});
 expect((await prefs.readOwner(ownerActor,support)).preferences).toMatchObject({withdrawn:true,permissionGrantedAt:null});
});
it("language changes do not restart permission timing and global pause cannot be undone by a relationship resume",async()=>{
 const id=await inquiry(undefined,true),original=now.toISOString(),cap=await prefs.issueCapability(ownerActor,id);
 now=new Date(now.getTime()+1000);
 await prefs.updateRecipient(cap.token,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:"set_preferences",updates:true,locale:"en",noticeVersion:BNA_PREFERENCE_NOTICE.version,noticeLanguage:"he"});
 expect((await prefs.readOwner(ownerActor,id)).preferences).toMatchObject({locale:"en",permissionGrantedAt:original});
 await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:1,action:"pause_all",note:"Synthetic global hold"});
 await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:2,action:"resume_relationship",note:"Synthetic local resume"});
 expect((await prefs.readOwner(ownerActor,id)).preferences.paused).toBe(true);
});
it("a lost response replays the original mutation while returning newer durable suppression",async()=>{
 const id=await inquiry(),cap=await prefs.issueCapability(ownerActor,id),command={inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:"unsubscribe_all" as const};
 await prefs.updateRecipient(cap.token,command);
 await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:1,action:"record_complaint",note:"Synthetic owner complaint record"});
 expect(await prefs.updateRecipient(cap.token,command)).toMatchObject({replayed:true,preferences:{version:2,withdrawn:true,complaint:true}});
 await expect(prefs.updateRecipient(cap.token,{...command,inquiryId:randomUUID()})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(prefs.readRecipient(cap.token.slice(0,-8)+"aaaaaaaa")).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("old links still unsubscribe after their opt-in capability expires",async()=>{
 const id=await inquiry(undefined,true),cap=await prefs.issueCapability(ownerActor,id),earlier=now;
 now=new Date(now.getTime()+31*86400000);
 expect((await prefs.readRecipient(cap.token)).canSubscribe).toBe(false);
 await expect(prefs.updateRecipient(cap.token,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:"set_preferences",updates:true,locale:"en",noticeVersion:BNA_PREFERENCE_NOTICE.version,noticeLanguage:"en"})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(await prefs.updateRecipient(cap.token,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:"unsubscribe_all"})).toMatchObject({preferences:{withdrawn:true}});
 now=earlier;
});
it("an already committed permission command still reconciles after its opt-in window expires",async()=>{
 const id=await inquiry(),cap=await prefs.issueCapability(ownerActor,id),earlier=now;
 const command={inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:"set_preferences" as const,updates:true,locale:"en" as const,noticeVersion:BNA_PREFERENCE_NOTICE.version,noticeLanguage:"en" as const};
 await prefs.updateRecipient(cap.token,command);now=new Date(now.getTime()+31*86400000);
 expect(await prefs.updateRecipient(cap.token,command)).toMatchObject({replayed:true,preferences:{version:1,permissionGrantedAt:earlier.toISOString()}});
 now=earlier;
});
it("journal is encrypted/immutable and database rejects skipped versions or mismatched programs",async()=>{
 const id=await inquiry();await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:"pause_relationship",note:"PRIVATE SYNTHETIC NOTE"});
 const row=(await db.query<{recipient_key:string;payload_ciphertext:string}>("SELECT recipient_key,payload_ciphertext FROM ls_service_interest.bna_email_preference_events WHERE inquiry_id=$1",[id])).rows[0]!;
 expect(row.payload_ciphertext).not.toMatch(/PRIVATE SYNTHETIC|example.invalid/);
 await expect(db.query("UPDATE ls_service_interest.bna_email_preference_events SET payload_ciphertext='changed' WHERE inquiry_id=$1",[id])).rejects.toThrow();
 await expect(db.query("DELETE FROM ls_service_interest.bna_email_preference_events WHERE inquiry_id=$1",[id])).rejects.toThrow();
 await expect(db.query("TRUNCATE ls_service_interest.bna_email_preference_events")).rejects.toThrow();
 await expect(db.query(`INSERT INTO ls_service_interest.bna_email_preference_events(workspace_id,recipient_key,version,operation_id,inquiry_id,owner_account_id,actor_account_id,source,program_key,request_digest,payload_ciphertext,recorded_at)
  VALUES($1,$2,3,$3,$4,$5,$5,'owner','bna_learning_coop',$6,'synthetic',$7)`,[workspace,row.recipient_key,randomUUID(),id,owner,"a".repeat(64),now])).rejects.toThrow("BNA_EMAIL_PREFERENCE_HISTORY_REQUIRED");
 await expect(db.query(`INSERT INTO ls_service_interest.bna_email_preference_events(workspace_id,recipient_key,version,operation_id,inquiry_id,owner_account_id,actor_account_id,source,program_key,request_digest,payload_ciphertext,recorded_at)
  VALUES($1,$2,2,$3,$4,$5,$5,'owner','bna_support_interest',$6,'synthetic',$7)`,[workspace,row.recipient_key,randomUUID(),id,owner,"a".repeat(64),now])).rejects.toThrow("BNA_EMAIL_PREFERENCE_INQUIRY_MISMATCH");
});
