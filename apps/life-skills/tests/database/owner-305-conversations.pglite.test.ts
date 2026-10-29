import {createHmac,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {Owner305ConversationStore} from "../../src/features/conversation-305/store.ts";
import {Owner305InboundStore} from "../../src/features/conversation-305/inbound-store.ts";
import {inboundBindingDigest} from "../../src/features/contact-ops/server/inbound-store.ts";
import {receive305} from "../../src/features/conversation-305/inbound-http.ts";
import {inboundAcknowledgementDigest} from "../../src/features/contact-ops/server/inbound-http.ts";
import {inboundInquirySchema} from "../../src/features/contact-ops/core/inbound.ts";
import {inbound305InquirySchema} from "../../src/features/conversation-305/inbound-contract.ts";
import {canonical} from "../../src/features/contact-ops/core/validation.ts";
import {CONVERSATION_305_LINE} from "../../src/features/conversation-305/contract.ts";
import {readOwner305SchemaStage} from "../../src/db/owner-305-schema-release.ts";
import {readInbound305SchemaStage} from "../../src/db/owner-305-inbound-schema-release.ts";
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
  "0131_ls_public_group_applications.sql","0139_ls_bna_inquiries.sql","0140_ls_fishing_inquiry_followups.sql","0141_ls_owner_305_conversations.sql","0142_ls_owner_305_inbound.sql"])
  await db.exec(await readFile("migrations/"+name,"utf8"));
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
it("stores exact 305 provider receipts once and exposes them only to the owner",async()=>{
 expect(await readInbound305SchemaStage({query:(sql,values)=>db.query(sql,values?[...values]:undefined)})).toBe(1);
 const inquiry={provider:"whapi" as const,channelId:"synthetic-channel",businessNumber:CONVERSATION_305_LINE,
  providerEventId:"synthetic-event",providerMessageId:"synthetic-message",providerThreadId:"15555550123@s.whatsapp.net",
  eventType:"inbound_message" as const,fromMe:false as const,fromNumber:"+15555550123",pushName:"Synthetic",
  messageType:"text",messageText:"Synthetic private inquiry",occurredAt:now.toISOString(),media:[]};
 const inbound=new Owner305InboundStore(adapter,workspace,ring,"synthetic-305-private-digest-key",inboundBindingDigest(inquiry),owner,{now:()=>now});
 const missingOwner=new Owner305InboundStore(adapter,workspace,ring,"synthetic-305-private-digest-key",inboundBindingDigest(inquiry),randomUUID(),{now:()=>now});
 await expect(missingOwner.capture(inquiry)).rejects.toMatchObject({code:"UNAVAILABLE"});
 const peopleBefore=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_identity.people")).rows[0]!.n;
 expect(await inbound.capture(inquiry)).toMatchObject({replayed:false});expect(await inbound.capture(inquiry)).toMatchObject({replayed:true});
 await expect(inbound.capture({...inquiry,messageText:"changed"})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(inbound.capture({...inquiry,providerEventId:"other-event"})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(inbound.capture({...inquiry,channelId:"other-channel"})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(inbound.capture({...inquiry,businessNumber:"+15555550124"})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(inbound.list(otherActor)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(inbound.list({...otherActor,role:"practitioner"})).rejects.toMatchObject({code:"NOT_FOUND"});
 const item=(await inbound.list(ownerActor)).items[0]!;expect(item).toMatchObject({fromNumber:inquiry.fromNumber,messageText:inquiry.messageText,linkedConversationId:null});
 const linkedStore=new Owner305ConversationStore(adapter,workspace,ring,"synthetic-305-private-digest-key",owner,{now:()=>now},inboundBindingDigest(inquiry));
 const command={kind:"create" as const,operationId:randomUUID(),channel:"whatsapp" as const,contactHint:"Synthetic sender",sourceReceiptKey:item.id,
  followup:{classification:"fishing" as const,note:"Asked about Fishing",nextAction:null,dueDate:null,waitingCondition:"Await availability"}};
 const linked=await linkedStore.save(ownerActor,command);expect(await linkedStore.save(ownerActor,command)).toMatchObject({id:linked.id,replayed:true});
 await expect(linkedStore.save(ownerActor,{...command,operationId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(linkedStore.save(ownerActor,{...command,operationId:randomUUID(),sourceReceiptKey:"f".repeat(64)})).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await linkedStore.read(ownerActor,linked.id)).sourceReceiptKey).toBe(item.id);
 expect((await inbound.list(ownerActor)).items[0]!.linkedConversationId).toBe(linked.id);
 const stored=(await db.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_service_interest.owner_305_inbound_receipts")).rows[0]!;
 expect(stored.payload_ciphertext).not.toContain(inquiry.messageText);
 expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_identity.people")).rows[0]!.n).toBe(peopleBefore);
 await expect(db.query("DELETE FROM ls_service_interest.owner_305_inbound_receipts WHERE workspace_id=$1",[workspace])).rejects.toThrow();
 await expect(db.query("DELETE FROM ls_service_interest.owner_305_inbound_links WHERE workspace_id=$1",[workspace])).rejects.toThrow();
});
it("acknowledges the authenticated gateway payload only after the encrypted receipt commits",async()=>{
 const inquiry={provider:"whapi" as const,channelId:"synthetic-channel",businessNumber:CONVERSATION_305_LINE,providerEventId:"gateway-event",providerMessageId:"gateway-message",providerThreadId:"15555550123@s.whatsapp.net",eventType:"inbound_message" as const,fromMe:false as const,fromNumber:"+15555550123",pushName:"Synthetic",messageType:"text",messageText:"Synthetic gateway inquiry",occurredAt:now.toISOString(),media:[]};
 const secret="synthetic-bridge-secret-not-real-305",binding=inboundBindingDigest(inquiry),inbound=new Owner305InboundStore(adapter,workspace,ring,"synthetic-305-private-digest-key",binding,owner,{now:()=>now});
 const env={LS_305_INBOUND_ENABLED:"true",LS_305_CLASSIFICATION_ENABLED:"true",LS_BNA_OWNER_ACCOUNT_ID:owner,LS_305_INBOUND_BINDING_SHA256:binding,LIFE_SKILLS_APP_BRIDGE_SECRET:secret};
 const request=(payload:unknown)=>new Request("https://synthetic.invalid/api/private/owner-305-inbound",{method:"POST",headers:{"content-type":"application/json","x-life-skills-bridge-secret":secret},body:JSON.stringify(payload)});
 const first=await receive305(request(inquiry),env,async()=>inbound);expect(first.status).toBe(201);
 expect((await first.json()).data.ackDigest).toBe(inboundAcknowledgementDigest(inboundInquirySchema.parse(inquiry),secret));
 const replay=await receive305(request(inquiry),env,async()=>inbound);expect(replay.status).toBe(200);expect((await replay.json()).data.replayed).toBe(true);
 expect((await receive305(request({...inquiry,messageText:"changed"}),env,async()=>inbound)).status).toBe(409);
 expect((await inbound.list(ownerActor)).items.filter(item=>item.messageText===inquiry.messageText)).toHaveLength(1);
});
it("stores an opaque LID without inventing a phone number or merging a person",async()=>{
 const inquiry={provider:"whapi" as const,channelId:"synthetic-channel",businessNumber:CONVERSATION_305_LINE,providerEventId:"lid-event",providerMessageId:"lid-message",providerThreadId:"123456789@lid",eventType:"inbound_message" as const,fromMe:false as const,fromNumber:null,pushName:"Synthetic LID",messageType:"text",messageText:"Synthetic LID inquiry",occurredAt:now.toISOString(),media:[]};
 const secret="synthetic-bridge-secret-not-real-305",binding=inboundBindingDigest(inquiry),inbound=new Owner305InboundStore(adapter,workspace,ring,"synthetic-305-private-digest-key",binding,owner,{now:()=>now});
 const env={LS_305_INBOUND_ENABLED:"true",LS_305_CLASSIFICATION_ENABLED:"true",LS_BNA_OWNER_ACCOUNT_ID:owner,LS_305_INBOUND_BINDING_SHA256:binding,LIFE_SKILLS_APP_BRIDGE_SECRET:secret};
 const request=new Request("https://synthetic.invalid/api/private/owner-305-inbound",{method:"POST",headers:{"content-type":"application/json","x-life-skills-bridge-secret":secret},body:JSON.stringify(inquiry)});
 const response=await receive305(request,env,async()=>inbound);expect(response.status).toBe(201);
 expect((await response.json()).data.ackDigest).toBe(createHmac("sha256",secret).update("life-skills-inbound-ack/v1\n").update(canonical(inbound305InquirySchema.parse(inquiry))).digest("hex"));
 expect((await inbound.list(ownerActor)).items.find(item=>item.messageText===inquiry.messageText)).toMatchObject({fromNumber:null,pushName:"Synthetic LID"});
 await expect(inbound.capture({...inquiry,providerEventId:"other",providerMessageId:"other",fromNumber:"+15555550123"})).rejects.toMatchObject({code:"INVALID_REQUEST"});
});
