import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {Owner305ConversationStore} from "../../src/features/conversation-305/store.ts";
import {CONVERSATION_305_LINE} from "../../src/features/conversation-305/contract.ts";
import {readOwner305SchemaStage} from "../../src/db/owner-305-schema-release.ts";
import {seal} from "../../src/features/identity/crypto.ts";
import {privateDigest} from "../../src/features/contact-ops/server/digests.ts";
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_INQUIRY_NOTICE} from "../../src/features/bna-inquiry/contract.ts";
import {Owner305InquiryLinkStore} from "../../src/features/conversation-305/inquiry-link-store.ts";
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {floridaGroupApplicationNotice} from "../../src/features/group-application/contract.ts";
import {readOwner305LinkSchemaStage} from "../../src/db/owner-305-link-schema-release.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";

const db=new PGlite(),ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,9)}};
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const now=new Date("2026-10-29T12:00:00Z"),workspace=asId(randomUUID(),"workspace"),owner=randomUUID();
const store=new Owner305ConversationStore(adapter,workspace,ring,"synthetic-305-private-digest-key",owner,{now:()=>now});
const account=async(id:string,role:"practitioner"|"parent")=>{const digest=id.replaceAll("-","").padEnd(64,"0");
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspace,role,digest,now]);
 await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
 await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date("2035-01-01")]);
 return {id,workspaceId:workspace,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:new Date("2035-01-01").getTime()} as Actor;};
let ownerActor:Actor,otherActor:Actor;
beforeAll(async()=>{await db.exec("CREATE SCHEMA ls_control");
 for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql",
  "0131_ls_public_group_applications.sql","0139_ls_bna_inquiries.sql","0140_ls_fishing_inquiry_followups.sql","0141_ls_owner_305_conversations.sql"])
  await db.exec(await readFile("migrations/"+name,"utf8"));
 expect(await readOwner305LinkSchemaStage({query:(sql,values)=>db.query(sql,values?[...values]:undefined)})).toBe(0);
 await db.exec(await readFile("migrations/0143_ls_owner_305_inquiry_links.sql","utf8"));
 expect(await readOwner305LinkSchemaStage({query:(sql,values)=>db.query(sql,values?[...values]:undefined)})).toBe(1);
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
 ownerActor=await account(owner,"practitioner");otherActor=await account(randomUUID(),"parent");},30000);
afterAll(async()=>db.close());
it("keeps manual 305 classification private, durable and independent of Person/contact identity",async()=>{
 expect(await readOwner305SchemaStage({query:(sql,values)=>db.query(sql,values?[...values]:undefined)})).toBe(1);
 const peopleBefore=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_identity.people")).rows[0]!.n;
 const create={kind:"create" as const,operationId:randomUUID(),channel:"whatsapp" as const,contactHint:"Synthetic caller ending 1234",
  followup:{classification:"both" as const,note:"Asked about both programs",nextAction:"Call back",dueDate:"2026-11-02",waitingCondition:null}};
 const saved=await store.save(ownerActor,create);expect(saved).toMatchObject({saved:true,replayed:false});
 expect(await store.save(ownerActor,create)).toEqual({...saved,replayed:true});
 await expect(store.save(ownerActor,{...create,contactHint:"Different hint"})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await store.list(ownerActor)).items).toHaveLength(1);
 await expect(store.list(otherActor)).rejects.toMatchObject({code:"NOT_FOUND"});
 const misboundStore=new Owner305ConversationStore(adapter,workspace,ring,"synthetic-305-private-digest-key",randomUUID(),{now:()=>now});
 await expect(misboundStore.list(ownerActor)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(misboundStore.save(ownerActor,{...create,operationId:randomUUID()})).rejects.toMatchObject({code:"NOT_FOUND"});
 const detail=await store.read(ownerActor,saved.id);expect(detail).toMatchObject({lineNumber:CONVERSATION_305_LINE,
  contactHint:create.contactHint,followup:{classification:"both",version:1}});
 const revise={kind:"revise" as const,operationId:randomUUID(),conversationId:saved.id,expectedVersion:1,
  followup:{classification:"bna" as const,note:"BNA timing is the priority",nextAction:null,dueDate:null,waitingCondition:"Await parent availability"}};
 expect(await store.save(ownerActor,revise)).toMatchObject({saved:true,replayed:false});
 expect(await store.save(ownerActor,revise)).toMatchObject({saved:true,replayed:true});
 await expect(store.save(ownerActor,{...create,operationId:revise.operationId})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(store.save(ownerActor,{...revise,operationId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
 const updated=await store.read(ownerActor,saved.id);expect(updated.followup).toMatchObject({classification:"bna",version:2});
 expect(updated.history.map(item=>item.version)).toEqual([2,1]);
 expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_identity.people")).rows[0]!.n).toBe(peopleBefore);
 await expect(db.query("DELETE FROM ls_service_interest.owner_305_conversations WHERE workspace_id=$1",[workspace])).rejects.toThrow();
});

it("preserves ambiguous historical 305 records while requiring an explicit support or provider choice",async()=>{
 const id=randomUUID(),operationId=randomUUID(),legacy={kind:"create" as const,operationId,channel:"phone" as const,contactHint:"Synthetic historical contact",followup:{classification:"support_provider" as const,note:"Historical purpose unknown",nextAction:null,dueDate:null,waitingCondition:"Await clarification"}};
 const digest=privateDigest({domain:"owner-305-conversation-operation/v1",workspace,actor:ownerActor.id,command:legacy},"synthetic-305-private-digest-key");
 const metadata={lineNumber:CONVERSATION_305_LINE,channel:legacy.channel,contactHint:legacy.contactHint};
 await db.query("INSERT INTO ls_service_interest.owner_305_conversations(workspace_id,id,owner_account_id,line_number,metadata_ciphertext,creation_digest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[workspace,id,owner,CONVERSATION_305_LINE,seal(JSON.stringify(metadata),`ls_service_interest/owner-305-conversation/v1/${workspace}/${id}`,ring),digest,now]);
 await db.query("INSERT INTO ls_service_interest.owner_305_conversation_operations(workspace_id,operation_id,creation_digest,conversation_id) VALUES($1,$2,$3,$4)",[workspace,operationId,digest,id]);
 await db.query("INSERT INTO ls_service_interest.owner_305_conversation_revisions(workspace_id,operation_id,conversation_id,owner_account_id,version,request_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,1,$5,$6,$7)",[workspace,operationId,id,owner,digest,seal(JSON.stringify(legacy.followup),`ls_service_interest/owner-305-revision/v1/${workspace}/${operationId}`,ring),now]);
 expect(await store.save(ownerActor,legacy)).toMatchObject({id,replayed:true});
 expect((await store.read(ownerActor,id)).followup.classification).toBe("support_provider");
 await expect(store.save(ownerActor,{...legacy,operationId:randomUUID()})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 for(const classification of ["support","provider"] as const){const item=await store.save(ownerActor,{...legacy,operationId:randomUUID(),followup:{...legacy.followup,classification}});expect((await store.read(ownerActor,item.id)).followup.classification).toBe(classification);}
 await store.save(ownerActor,{kind:"revise",operationId:randomUUID(),conversationId:id,expectedVersion:1,followup:{...legacy.followup,classification:"provider"}});
 const current=await store.read(ownerActor,id);expect(current.followup.classification).toBe("provider");expect(current.history.map(row=>row.classification)).toEqual(["provider","support_provider"]);
 await expect(store.read(otherActor,id)).rejects.toMatchObject({code:"NOT_FOUND"});
});

it("pages the owner register without losing older conversations or exposing an anchor",async()=>{
 const ids=new Set<string>();
 for(let n=0;n<101;n++){
  const saved=await store.save(ownerActor,{kind:"create",operationId:randomUUID(),channel:"phone",contactHint:`Synthetic caller ${n}`,followup:{classification:"unclassified",note:"Synthetic follow-up",nextAction:null,dueDate:null,waitingCondition:"Await response"}});
  ids.add(saved.id);
 }
 const first=await store.list(ownerActor);expect(first.items).toHaveLength(100);expect(first.nextCursor).toBeTruthy();expect(first.nextCursor).not.toMatch(/^[0-9a-f-]{36}$/i);
 const next=await store.list(ownerActor,first.nextCursor!);expect(next.nextCursor).toBeNull();
 const all=[...first.items,...next.items].map(item=>item.id);expect(new Set(all).size).toBe(all.length);for(const id of ids)expect(all).toContain(id);
 const bad=first.nextCursor!.slice(0,-1)+(first.nextCursor!.endsWith("A")?"B":"A");
 await expect(store.list(ownerActor,bad)).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(store.list(otherActor,first.nextCursor!)).rejects.toMatchObject({code:"NOT_FOUND"});
},30000);

it("proposal preserves link and unlink events without changing existing conversation revisions",async()=>{
 const bna=new BnaInquiryStore(adapter,workspace,ring,"synthetic-bna-private-digest-key",owner,{now:()=>now});
 const inquiry=await bna.submit({operationId:randomUUID(),fields:{name:"Synthetic parent",contactChannel:"email",contact:"link@example.invalid",language:"en",townOrZip:"Florida",childAges:[10],permission:{confirmed:true,version:BNA_INQUIRY_NOTICE.version,language:"en"}}});
 const conversation=await store.save(ownerActor,{kind:"create",operationId:randomUUID(),channel:"phone",contactHint:"Synthetic caller",followup:{classification:"bna",note:"Discussed inquiry",nextAction:null,dueDate:null,waitingCondition:"Await reply"}});
 const sql=`INSERT INTO ls_service_interest.owner_305_inquiry_link_events(workspace_id,operation_id,conversation_id,owner_account_id,version,request_digest,bna_inquiry_id,linked,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
 const values=[workspace,randomUUID(),conversation.id,owner,1,"a".repeat(64),inquiry.reference,true,now];await db.query(sql,values);
 await expect(db.query(sql,[workspace,randomUUID(),conversation.id,owner,1,"b".repeat(64),inquiry.reference,false,now])).rejects.toThrow();
 await db.query(sql,[workspace,randomUUID(),conversation.id,owner,2,"c".repeat(64),inquiry.reference,false,now]);
 expect((await db.query("SELECT linked FROM ls_service_interest.owner_305_inquiry_link_events WHERE conversation_id=$1 ORDER BY version",[conversation.id])).rows).toEqual([{linked:true},{linked:false}]);
 await expect(db.query("DELETE FROM ls_service_interest.owner_305_inquiry_link_events WHERE conversation_id=$1",[conversation.id])).rejects.toThrow();
 expect((await store.read(ownerActor,conversation.id)).history).toHaveLength(1);
});

it("links and unlinks only owner-authorized inquiries with stable operations",async()=>{
 const key="synthetic-private-digest-key-32-characters",links=new Owner305InquiryLinkStore(adapter,workspace,ring,key,owner,owner,{now:()=>now});
 const bna=new BnaInquiryStore(adapter,workspace,ring,key,owner,{now:()=>now});
 const inquiry=await bna.submit({operationId:randomUUID(),fields:{name:"Synthetic parent",contactChannel:"email",contact:"owner-link@example.invalid",language:"en",townOrZip:"Florida",childAges:[10],permission:{confirmed:true,version:BNA_INQUIRY_NOTICE.version,language:"en"}}});
 const applications=new PublicGroupApplicationStore(adapter,workspace,ring,key,{now:()=>now});
 const fishing=await applications.submit({operationId:randomUUID(),fields:{parentName:"Synthetic parent",contact:"owner-fish@example.invalid",language:"en",cityArea:"Florida",programId:"sunday_fishing_academy",schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}});
 const otherProgram=await applications.submit({operationId:randomUUID(),fields:{parentName:"Synthetic parent",contact:"other-program@example.invalid",language:"en",cityArea:"Florida",programId:"morning_torah_learning",schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}});
 const conversation=await store.save(ownerActor,{kind:"create",operationId:randomUUID(),channel:"phone",contactHint:"Synthetic caller",followup:{classification:"both",note:"Discussed programs",nextAction:null,dueDate:null,waitingCondition:"Await reply"}});
 const command={operationId:randomUUID(),conversationId:conversation.id,target:{kind:"bna_inquiry" as const,id:inquiry.reference},expectedVersion:0,linked:true};
 const saved=await links.save(ownerActor,command);expect(await links.save(ownerActor,command)).toEqual({...saved,replayed:true});
 await expect(links.save(ownerActor,{...command,linked:false})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(links.save(otherActor,{...command,operationId:randomUUID()})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(links.save(ownerActor,{...command,operationId:randomUUID(),target:{kind:"fishing_inquiry",id:otherProgram.item.id}})).rejects.toMatchObject({code:"NOT_FOUND"});
 const fish={...command,operationId:randomUUID(),target:{kind:"fishing_inquiry" as const,id:fishing.item.id}};await links.save(ownerActor,fish);
 expect((await links.list(ownerActor,conversation.id)).items.filter(item=>item.linked)).toHaveLength(2);
 await links.save(ownerActor,{...command,operationId:randomUUID(),expectedVersion:1,linked:false});
 const after=await links.list(ownerActor,conversation.id);expect(after.items).toHaveLength(2);expect(after.items.find(item=>item.target.kind==="bna_inquiry")).toMatchObject({linked:false,version:2});
 await expect(links.save(ownerActor,{...command,operationId:randomUUID(),expectedVersion:1,linked:false})).rejects.toMatchObject({code:"CONFLICT"});
 const noFishing=new Owner305InquiryLinkStore(adapter,workspace,ring,key,owner,"",{now:()=>now});
 expect((await noFishing.list(ownerActor,conversation.id)).items.every(item=>item.target.kind==="bna_inquiry")).toBe(true);
 await expect(noFishing.save(ownerActor,fish)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(noFishing.save(ownerActor,{...fish,operationId:randomUUID(),expectedVersion:1,linked:false})).rejects.toMatchObject({code:"NOT_FOUND"});
});

it("pages linked inquiry choices with owner and conversation-bound cursors",async()=>{
 const key="synthetic-private-digest-key-32-characters",links=new Owner305InquiryLinkStore(adapter,workspace,ring,key,owner,owner,{now:()=>now});
 const bna=new BnaInquiryStore(adapter,workspace,ring,key,owner,{now:()=>now});
 const conversation=await store.save(ownerActor,{kind:"create",operationId:randomUUID(),channel:"phone",contactHint:"Synthetic paging caller",followup:{classification:"bna",note:"Synthetic",nextAction:null,dueDate:null,waitingCondition:"Await reply"}});
 const ids=new Set<string>();for(let n=0;n<101;n++){
  const inquiry=await bna.submit({operationId:randomUUID(),fields:{name:`Synthetic ${n}`,contactChannel:"email",contact:`link-page-${n}@example.invalid`,language:"en",townOrZip:"Florida",childAges:[10],permission:{confirmed:true,version:BNA_INQUIRY_NOTICE.version,language:"en"}}});
  ids.add(inquiry.reference);await links.save(ownerActor,{operationId:randomUUID(),conversationId:conversation.id,target:{kind:"bna_inquiry",id:inquiry.reference},expectedVersion:0,linked:true});
 }
 const first=await links.list(ownerActor,conversation.id);expect(first.items).toHaveLength(100);expect(first.nextCursor).toBeTruthy();
 const second=await links.list(ownerActor,conversation.id,first.nextCursor!);expect(second.nextCursor).toBeNull();
 const all=[...first.items,...second.items].map(item=>item.target.id);expect(new Set(all).size).toBe(101);for(const id of ids)expect(all).toContain(id);
 const other=await store.save(ownerActor,{kind:"create",operationId:randomUUID(),channel:"phone",contactHint:"Another caller",followup:{classification:"unclassified",note:"Synthetic",nextAction:null,dueDate:null,waitingCondition:"Await reply"}});
 await expect(links.list(ownerActor,other.id,first.nextCursor!)).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(links.list(otherActor,conversation.id,first.nextCursor!)).rejects.toMatchObject({code:"NOT_FOUND"});
},30000);

it("rejects disabled append-only guards and unexpected grants in the link schema",async()=>{
 const stage=()=>readOwner305LinkSchemaStage({query:(sql,values)=>db.query(sql,values?[...values]:undefined)});
 await db.exec("ALTER TABLE ls_service_interest.owner_305_inquiry_link_events DISABLE TRIGGER owner_305_inquiry_link_no_edit");
 try{await expect(stage()).rejects.toThrow("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");}finally{await db.exec("ALTER TABLE ls_service_interest.owner_305_inquiry_link_events ENABLE TRIGGER owner_305_inquiry_link_no_edit");}
 await db.exec("GRANT SELECT ON ls_service_interest.owner_305_inquiry_link_events TO PUBLIC");
 try{await expect(stage()).rejects.toThrow("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");}finally{await db.exec("REVOKE SELECT ON ls_service_interest.owner_305_inquiry_link_events FROM PUBLIC");}
 expect(await stage()).toBe(1);
});

it("pages older 305 revisions while keeping the current conversation editable",async()=>{
 const saved=await store.save(ownerActor,{kind:"create",operationId:randomUUID(),channel:"phone",contactHint:"Synthetic history caller",followup:{classification:"bna",note:"Initial note",nextAction:null,dueDate:null,waitingCondition:"Await reply"}});
 for(let version=1;version<102;version++)await store.save(ownerActor,{kind:"revise",operationId:randomUUID(),conversationId:saved.id,expectedVersion:version,followup:{classification:"bna",note:`Revision ${version+1}`,nextAction:null,dueDate:null,waitingCondition:"Await reply"}});
 const first=await store.read(ownerActor,saved.id);expect(first.followup.version).toBe(102);expect(first.history).toHaveLength(100);expect(first.hasMoreHistory).toBe(true);
 const older=await store.read(ownerActor,saved.id,first.history[99]!.version);expect(older.followup.version).toBe(102);expect(older.history.map(item=>item.version)).toEqual([2,1]);expect(older.hasMoreHistory).toBe(false);
 await expect(store.read(otherActor,saved.id,3)).rejects.toMatchObject({code:"NOT_FOUND"});await expect(store.read(ownerActor,saved.id,0)).rejects.toMatchObject({code:"INVALID_REQUEST"});
 expect(await store.save(ownerActor,{kind:"revise",operationId:randomUUID(),conversationId:saved.id,expectedVersion:102,followup:{classification:"bna",note:"Revision 103",nextAction:null,dueDate:null,waitingCondition:"Await reply"}})).toMatchObject({saved:true});
},30000);
