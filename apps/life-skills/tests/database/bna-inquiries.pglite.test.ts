import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_INQUIRY_NOTICE,bnaInquiryFieldsSchema} from "../../src/features/bna-inquiry/contract.ts";
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM} from "../../src/features/bna-inquiry/coop-contract.ts";
import {publicBnaInquiryHttp} from "../../src/features/bna-inquiry/http.ts";
import {readBnaCoopSchemaStage} from "../../src/db/bna-coop-schema-release.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";

const db=new PGlite(),ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,7)}};
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const now=new Date("2026-10-28T12:00:00Z"),workspace=asId(randomUUID(),"workspace"),owner=randomUUID();
const store=new BnaInquiryStore(adapter,workspace,ring,"synthetic-bna-private-digest-key",owner,{now:()=>now});
const fields=bnaInquiryFieldsSchema.parse({name:"Synthetic Parent",contactChannel:"email",contact:"parent@example.invalid",
 language:"en",townOrZip:"Jerusalem",childAges:[9],permission:{confirmed:true,version:BNA_INQUIRY_NOTICE.version,language:"en"}});
const account=async(id:string,role:"practitioner"|"parent")=>{
 const digest=id.replaceAll("-","").padEnd(64,"0");
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspace,role,digest,now]);
 await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
 await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date("2035-01-01")]);
 return {id,workspaceId:workspace,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:new Date("2035-01-01").getTime()} as Actor;
};
let ownerActor:Actor,otherActor:Actor;
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");
 for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql",
  "0131_ls_public_group_applications.sql","0139_ls_bna_inquiries.sql"])
  await db.exec(await readFile("migrations/"+name,"utf8"));
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
 ownerActor=await account(owner,"practitioner");otherActor=await account(randomUUID(),"parent");
},30000);
afterAll(async()=>db.close());
it("saves a BNA inquiry in the existing DB, replays exactly, and gives one owner durable follow-up readback",async()=>{
 const operationId=randomUUID(),saved=await store.submit({operationId,fields,attribution:{source:"bna_site"}});
 expect(saved).toMatchObject({saved:true,replayed:false});
 expect(await store.submit({operationId,fields,attribution:{source:"bna_site"}})).toEqual({...saved,replayed:true});
 expect(await store.findOperation(ownerActor,operationId)).toMatchObject({found:true,detail:{id:saved.reference,program:"bna_torah_mornings"}});
 expect(await store.findOperation(ownerActor,randomUUID())).toEqual({found:false});
 await expect(store.findOperation(otherActor,operationId)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(store.findOperation(ownerActor,"invalid")).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(store.submit({operationId,fields,attribution:{source:"different"}})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await store.list(ownerActor)).items).toHaveLength(1);
 await expect(store.list(otherActor)).rejects.toMatchObject({code:"NOT_FOUND"});
 const detail=await store.read(ownerActor,saved.reference);
 expect(detail).toMatchObject({program:"bna_torah_mornings",fields,followup:{version:1,status:"new",nextAction:"Review inquiry"}});
 const command={operationId:randomUUID(),inquiryId:saved.reference,expectedVersion:1,status:"waiting" as const,note:"Called parent; waiting for preferred time",nextAction:"Call again",dueDate:"2026-11-02",waitingCondition:"Parent availability"};
 expect(await store.followup(ownerActor,command)).toMatchObject({version:2,status:"waiting",replayed:false});
 expect(await store.followup(ownerActor,command)).toMatchObject({version:2,status:"waiting",replayed:true});
 await expect(store.followup(ownerActor,{...command,operationId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
 const read=await store.read(ownerActor,saved.reference);
 expect(read.followup).toMatchObject({version:2,note:command.note,nextAction:command.nextAction});
 expect(read.history.map(event=>event.version)).toEqual([2,1]);
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_inquiries")).rows).toEqual([{n:1}]);
 await expect(db.query("DELETE FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1",[workspace])).rejects.toThrow();
});
it("a new operation never reveals prior exact-content submissions through a reused reference",async()=>{
 const first=await store.submit({operationId:randomUUID(),fields,attribution:{source:"bna_site"}});
 const second=await store.submit({operationId:randomUUID(),fields,attribution:{source:"bna_site"}});
 expect(first.reference).not.toBe(second.reference);
 expect(first.replayed).toBe(false);expect(second.replayed).toBe(false);
});

it("saves general co-op interest separately while retaining historical purpose and independent notice language",async()=>{
 const before=(await store.list(ownerActor)).items.map(item=>item.id);
 expect(await readBnaCoopSchemaStage({query:(sql,values)=>db.query(sql,values?[...values]:undefined)})).toBe(0);
 await db.exec(await readFile("migrations/0142_ls_bna_coop_interest.sql","utf8"));
 expect(await readBnaCoopSchemaStage({query:(sql,values)=>db.query(sql,values?[...values]:undefined)})).toBe(1);
 expect((await store.list(ownerActor)).items.map(item=>item.id)).toEqual(before);
 const old=await store.submit({operationId:randomUUID(),fields});
 const input={operationId:randomUUID(),fields:{name:"Synthetic co-op parent",contactChannel:"phone" as const,contact:"+13055550123",language:"en" as const,siteLanguage:"he" as const,emailUpdates:false,townOrZip:"Florida",childAges:[10],permission:{confirmed:true as const,version:BNA_COOP_NOTICE.version,language:"he" as const}}};
 await expect(store.submit({...input,operationId:randomUUID(),fields:{...input.fields,emailUpdates:true}},BNA_COOP_PROGRAM)).rejects.toThrow();
 const withEmail={...input,operationId:randomUUID(),fields:{...input.fields,emailUpdates:true,secondaryContact:{channel:"email" as const,value:"parent@example.invalid"}}};
 const opted=await store.submit(withEmail,BNA_COOP_PROGRAM);expect((await store.read(ownerActor,opted.reference))).toMatchObject({fields:{emailUpdates:true,secondaryContact:withEmail.fields.secondaryContact}});
 const saved=await store.submit(input,BNA_COOP_PROGRAM);expect(await store.submit(input,BNA_COOP_PROGRAM)).toEqual({...saved,replayed:true});
 expect(await store.findOperation(ownerActor,input.operationId)).toMatchObject({found:true,detail:{id:saved.reference,program:BNA_COOP_PROGRAM}});
 expect((await store.read(ownerActor,saved.reference))).toMatchObject({program:"bna_learning_coop",fields:input.fields});
 expect((await store.read(ownerActor,old.reference)).program).toBe("bna_torah_mornings");
 await expect(store.read(otherActor,saved.reference)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(store.submit({...input,operationId:randomUUID(),fields:{...input.fields,permission:{...input.fields.permission,language:"en"}}},BNA_COOP_PROGRAM)).rejects.toThrow();
 const command={operationId:randomUUID(),inquiryId:saved.reference,expectedVersion:1,status:"waiting" as const,note:"Synthetic owner note",nextAction:null,dueDate:null,waitingCondition:"Await reply"};
 await store.followup(ownerActor,command);expect((await store.read(ownerActor,saved.reference)).followup).toMatchObject({note:command.note,waitingCondition:command.waitingCondition});
});

it("accepts a co-op HTTP submission into durable owner-visible storage and replays it once",async()=>{
 const origin="https://life-skills.example.invalid",path="/api/public/bna-coop-inquiries";
 let clock=now.getTime();
 const deps={enabled:true,environment:{LS_APP_ORIGIN:origin},challengeKey:"synthetic-bna-challenge-key-32-characters",now:()=>clock,
  limits:{consume:async()=>({count:1,retryAfterMs:0})},store};
 const request=(method:string,body?:unknown)=>new Request(origin+path,{method,
  headers:{host:"life-skills.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json"},
  ...(body?{body:JSON.stringify(body)}:{})});
 const offer=await publicBnaInquiryHttp(request("GET"),async()=>deps,"coop");
 const challenge=(await offer.json()).data.challenge;
 const submission={challenge,operationId:randomUUID(),website:"",fields:{name:"Synthetic HTTP parent",contactChannel:"email",
  contact:"http-parent@example.invalid",language:"en",siteLanguage:"he",emailUpdates:false,townOrZip:"Florida",childAges:[10],
  permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"he"}},attribution:{source:"bna_site"}};
 clock+=1500;
 const before=(await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_inquiries")).rows[0] as {n:number};
 const rejected=await publicBnaInquiryHttp(request("POST",{...submission,fields:{...submission.fields,permission:{...submission.fields.permission,confirmed:false}}}),async()=>deps,"coop");
 expect(rejected.status).toBe(400);
 const saved=await publicBnaInquiryHttp(request("POST",submission),async()=>deps,"coop");
 expect(saved.status).toBe(201);const receipt=(await saved.json()).data;
 const replay=await publicBnaInquiryHttp(request("POST",submission),async()=>deps,"coop");
 expect(replay.status).toBe(200);expect((await replay.json()).data).toEqual({...receipt,replayed:true});
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_inquiries")).rows).toEqual([{n:before.n+1}]);
 const detail=await store.read(ownerActor,receipt.reference);
 expect(detail).toMatchObject({program:BNA_COOP_PROGRAM,fields:submission.fields,attribution:{source:"bna_site",landingPath:"/he/join"}});
 await expect(store.read(otherActor,receipt.reference)).rejects.toMatchObject({code:"NOT_FOUND"});
});


it("keeps a frequently updated inquiry readable and pages its complete follow-up history",async()=>{
 const saved=await store.submit({operationId:randomUUID(),fields:{...fields,contact:"history@example.invalid"}});
 for(let version=1;version<=101;version++)await store.followup(ownerActor,{operationId:randomUUID(),inquiryId:saved.reference,expectedVersion:version,status:"waiting",note:`Synthetic note ${version}`,nextAction:null,dueDate:null,waitingCondition:"Await reply"});
 const recent=await store.read(ownerActor,saved.reference);expect(recent.followup.version).toBe(102);expect(recent.history).toHaveLength(100);expect(recent.hasMoreHistory).toBe(true);
 const older=await store.read(ownerActor,saved.reference,recent.history.at(-1)!.version);expect(older.followup.version).toBe(102);expect(older.history.map(item=>item.version)).toEqual([2,1]);expect(older.hasMoreHistory).toBe(false);
 expect((await store.list(ownerActor)).items.some(item=>item.id===saved.reference&&item.followup.version===102)).toBe(true);
 await store.followup(ownerActor,{operationId:randomUUID(),inquiryId:saved.reference,expectedVersion:102,status:"closed",note:"Synthetic closure",nextAction:null,dueDate:null,waitingCondition:null});
 await expect(store.read(otherActor,saved.reference,3)).rejects.toMatchObject({code:"NOT_FOUND"});
},30000);

it("reaches older BNA inquiries through an owner-bound cursor without duplicates",async()=>{
 const ids=new Set<string>();
 for(let n=0;n<101;n++){const saved=await store.submit({operationId:randomUUID(),fields:{...fields,contact:`paging-${n}@example.invalid`}});ids.add(saved.reference);}
 const first=await store.list(ownerActor);expect(first.items).toHaveLength(100);expect(first.nextCursor).toBeTruthy();expect(first.nextCursor).not.toMatch(/^[0-9a-f-]{36}$/i);
 const second=await store.list(ownerActor,first.nextCursor!);expect(second.nextCursor).toBeNull();
 const all=[...first.items,...second.items].map(item=>item.id);expect(new Set(all).size).toBe(all.length);for(const id of ids)expect(all).toContain(id);
 const bad=first.nextCursor!.slice(0,-1)+(first.nextCursor!.endsWith("A")?"B":"A");await expect(store.list(ownerActor,bad)).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(store.list(otherActor,first.nextCursor!)).rejects.toMatchObject({code:"NOT_FOUND"});
},30000);
