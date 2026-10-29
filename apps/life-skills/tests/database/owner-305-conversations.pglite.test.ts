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
