import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_INQUIRY_NOTICE,bnaInquiryFieldsSchema} from "../../src/features/bna-inquiry/contract.ts";
import {BNA_COOP_NOTICE,BNA_COOP_LEGACY_NOTICE,BNA_COOP_PROGRAM} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM,BNA_SUPPORT_UPDATES_NOTICE} from "../../src/features/bna-inquiry/support-contract.ts";
import {bnaLeadRow} from "../../src/features/people/lead-view.ts";
import {publicBnaInquiryHttp,privateBnaInquiryHttp} from "../../src/features/bna-inquiry/http.ts";
import {seal} from "../../src/features/identity/crypto.ts";
import {privateDigest} from "../../src/features/contact-ops/server/digests.ts";
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
 const origin="https://life-skills.example.invalid",token="a".repeat(43),parentToken="b".repeat(43);
 const deps={origin,actor:async(value:string)=>value===token?ownerActor:otherActor,csrf:()=>"synthetic",limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:"synthetic",store};
 const request=(cookie:string)=>new Request(`${origin}/api/private/bna-inquiries?operation=${operationId}`,{headers:{host:"life-skills.example.invalid","x-forwarded-proto":"https","x-forwarded-host":"life-skills.example.invalid",cookie}});
 const lookup=await privateBnaInquiryHttp(request(`__Host-ls-session=${token}`),async()=>deps);expect(lookup.status).toBe(200);
 expect((await lookup.json()).data).toMatchObject({found:true,detail:{id:saved.reference,program:"bna_torah_mornings"}});
 expect((await privateBnaInquiryHttp(request(`__Host-ls-session=${parentToken}`),async()=>deps)).status).toBe(404);
 expect((await privateBnaInquiryHttp(request(""),async()=>deps)).status).toBe(401);
 await expect(store.submit({operationId,fields,attribution:{source:"different"}})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await store.list(ownerActor)).items).toHaveLength(1);
 await expect(store.list(otherActor)).rejects.toMatchObject({code:"NOT_FOUND"});
 const detail=await store.read(ownerActor,saved.reference);
 expect(detail).toMatchObject({program:"bna_torah_mornings",fields,followup:{version:1,status:"new",nextAction:"Review inquiry"}});
 const command={operationId:randomUUID(),inquiryId:saved.reference,expectedVersion:1,status:"waiting" as const,note:"Called parent; waiting for preferred time",nextAction:"Call again",dueDate:"2026-11-02",waitingCondition:"Parent availability",sourceCorrection:{source:"Community referral",basis:"Parent stated this on the call"}};
 expect(await store.followup(ownerActor,command)).toMatchObject({version:2,status:"waiting",replayed:false});
 expect(await store.followup(ownerActor,command)).toMatchObject({version:2,status:"waiting",replayed:true});
 await expect(store.followup(ownerActor,{...command,operationId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
 const read=await store.read(ownerActor,saved.reference);
 expect(read.followup).toMatchObject({version:2,note:command.note,nextAction:command.nextAction});
 expect(read.attribution).toMatchObject({source:"bna_site"});expect(read.history[0]).toMatchObject({sourceCorrection:command.sourceCorrection,actorAccountId:ownerActor.id});
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

it("reads and replays an older co-op notice but never accepts it for a new operation",async()=>{
 const id=randomUUID(),operationId=randomUUID(),followupId=randomUUID(),legacyFields={name:"Synthetic legacy co-op",contactChannel:"email" as const,contact:"legacy-coop@example.invalid",language:"en" as const,siteLanguage:"en" as const,emailUpdates:false,townOrZip:"Florida",childAges:[9],permission:{confirmed:true as const,version:BNA_COOP_LEGACY_NOTICE.version,language:"en" as const}};
 const payload={program:BNA_COOP_PROGRAM,fields:legacyFields,attribution:null},digest=privateDigest({domain:"bna-inquiry/v1",workspace,payload},"synthetic-bna-private-digest-key");
 await db.query(`INSERT INTO ls_service_interest.bna_inquiries(workspace_id,id,program_key,owner_account_id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'en',$9)`,[workspace,id,BNA_COOP_PROGRAM,owner,"a".repeat(64),digest,seal(JSON.stringify(payload),`ls_service_interest/bna-inquiry/v1/${workspace}/${id}`,ring),BNA_COOP_LEGACY_NOTICE.version,now]);
 await db.query("INSERT INTO ls_service_interest.bna_inquiry_operations(workspace_id,operation_id,request_digest,inquiry_id) VALUES($1,$2,$3,$4)",[workspace,operationId,digest,id]);
 const state={status:"new",note:"Synthetic legacy",nextAction:"Review inquiry",dueDate:null,waitingCondition:null};
 await db.query("INSERT INTO ls_service_interest.bna_inquiry_followups(workspace_id,operation_id,inquiry_id,actor_account_id,version,request_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,1,$5,$6,$7)",[workspace,followupId,id,owner,"b".repeat(64),seal(JSON.stringify(state),`ls_service_interest/bna-followup/v1/${workspace}/${followupId}`,ring),now]);
 expect(await store.submit({operationId,fields:legacyFields},BNA_COOP_PROGRAM)).toMatchObject({reference:id,replayed:true});
 expect((await store.read(ownerActor,id)).fields.permission.version).toBe(BNA_COOP_LEGACY_NOTICE.version);
 await expect(store.submit({operationId:randomUUID(),fields:legacyFields},BNA_COOP_PROGRAM)).rejects.toMatchObject({code:"INVALID_REQUEST"});
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
it("previews the saved co-op acknowledgment only for the owner and selected email reply",async()=>{
 const input={operationId:randomUUID(),fields:{name:'Synthetic preview parent',contactChannel:'email' as const,contact:'preview@example.invalid',language:'he' as const,siteLanguage:'en' as const,emailUpdates:false,townOrZip:'Florida',childAges:[10],permission:{confirmed:true as const,version:BNA_COOP_NOTICE.version,language:'en' as const}}};
 const saved=await store.submit(input,BNA_COOP_PROGRAM),origin='https://life-skills.example.invalid',token='a'.repeat(43);
 const deps={origin,actor:async()=>ownerActor,csrf:()=>'',limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'synthetic',store};
 const request=(id:string)=>new Request(origin+'/api/private/bna-inquiries?'+new URLSearchParams({id,preview:'acknowledgment'}),{headers:{host:'life-skills.example.invalid','x-forwarded-proto':'https','x-forwarded-host':'life-skills.example.invalid',cookie:`__Host-ls-session=${token}`}});
 const result=await privateBnaInquiryHttp(request(saved.reference),async()=>deps);expect(result.status).toBe(200);expect((await result.json()).data).toMatchObject({available:true,deliveryState:'not_queued',recipient:input.fields.contact,candidate:{locale:'he',status:'review_candidate'}});
 expect((await privateBnaInquiryHttp(request(saved.reference),async()=>({...deps,actor:async()=>otherActor}))).status).toBe(404);
 const phone=await store.submit({...input,operationId:randomUUID(),fields:{...input.fields,contactChannel:'phone',contact:'+13055550123',secondaryContact:{channel:'email',value:'secondary@example.invalid'}}},BNA_COOP_PROGRAM);
 const phoneResult=await privateBnaInquiryHttp(request(phone.reference),async()=>deps);expect((await phoneResult.json()).data).toEqual({available:false,reason:'phone_reply_selected'});
});

it("preserves existing inquiries when admitting adult support intent, with separate purpose and exact replay",async()=>{
 const before=(await store.list(ownerActor)).items.map(item=>item.id),applicationCount=await db.query("SELECT count(*)::int AS n FROM ls_service_interest.public_applications");
 await db.exec(await readFile("migrations/proposals/0144_ls_bna_support_interest.sql","utf8"));
 expect((await store.list(ownerActor)).items.map(item=>item.id)).toEqual(before);
 const fields={name:"Synthetic support caller",contactChannel:"phone" as const,contact:"+12025550129",purpose:"support_conversation" as const,language:"en" as const,siteLanguage:"he" as const,emailUpdates:false,
  permission:{confirmed:true as const,version:BNA_SUPPORT_NOTICE.version,language:"he" as const}};
 const input={operationId:randomUUID(),fields},saved=await store.submit(input,BNA_SUPPORT_PROGRAM);
 expect(await store.submit(input,BNA_SUPPORT_PROGRAM)).toEqual({...saved,replayed:true});
 await expect(store.submit({...input,fields:{...fields,purpose:"project_updates"}},BNA_SUPPORT_PROGRAM)).rejects.toThrow();
 await expect(store.submit(input,BNA_COOP_PROGRAM)).rejects.toThrow();
 const detail=await store.read(ownerActor,saved.reference);expect(detail).toMatchObject({program:BNA_SUPPORT_PROGRAM,fields});
 expect(bnaLeadRow(detail).purposes).toEqual(["support"]);expect(detail.fields).not.toHaveProperty("childAges");
 expect(await store.findOperation(ownerActor,input.operationId)).toMatchObject({found:true,detail:{id:saved.reference,program:BNA_SUPPORT_PROGRAM}});
 await expect(store.read(otherActor,saved.reference)).rejects.toMatchObject({code:"NOT_FOUND"});
 await store.followup(ownerActor,{operationId:randomUUID(),inquiryId:saved.reference,expectedVersion:1,status:"waiting",note:"Synthetic support follow-up",nextAction:null,dueDate:null,waitingCondition:"Await support conversation"});
 expect((await store.read(ownerActor,saved.reference)).followup).toMatchObject({status:"waiting",waitingCondition:"Await support conversation"});
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.public_applications")).rows).toEqual(applicationCount.rows);
});

it("saves support via its own HTTP challenge and returns the same receipt without creating parent permissions",async()=>{
 let clock=now.getTime();const origin="https://life-skills.example.invalid",path="/api/public/bna-support-inquiries";
 const deps={enabled:true,environment:{LS_APP_ORIGIN:origin},challengeKey:"synthetic-bna-challenge-key-32-characters",now:()=>clock,limits:{consume:async()=>({count:1,retryAfterMs:0})},store};
 const request=(method:string,body?:unknown,route=path)=>new Request(origin+route,{method,headers:{host:"life-skills.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 expect((await publicBnaInquiryHttp(request("GET"),async()=>({...deps,enabled:false}),"support")).status).toBe(404);
 const offer=(await (await publicBnaInquiryHttp(request("GET"),async()=>deps,"support")).json()).data;expect(offer.notice).toEqual(BNA_SUPPORT_NOTICE);expect(offer.updatesNotice).toEqual(BNA_SUPPORT_UPDATES_NOTICE);
 const coop=(await (await publicBnaInquiryHttp(request("GET",undefined,"/api/public/bna-coop-inquiries"),async()=>deps,"coop")).json()).data;
 const fields={name:"Synthetic support update reader",contactChannel:"email",contact:"updates@example.invalid",purpose:"project_updates",language:"en",siteLanguage:"he",emailUpdates:true,
  permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"he"},updatesPermission:{confirmed:true,channel:"email",version:BNA_SUPPORT_UPDATES_NOTICE.version,language:"he"}};
 const body={operationId:randomUUID(),challenge:offer.challenge,fields,attribution:{source:"bna_site",landingPath:"/join"}};clock+=1500;
 const before=(await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_inquiries")).rows;
 expect((await publicBnaInquiryHttp(request("POST",{...body,challenge:coop.challenge}),async()=>deps,"support")).status).toBe(403);
 expect((await publicBnaInquiryHttp(request("POST",{...body,fields:{...fields,updatesPermission:undefined}}),async()=>deps,"support")).status).toBe(400);
 expect((await publicBnaInquiryHttp(request("POST",{...body,fields:{...fields,childAges:[10]}}),async()=>deps,"support")).status).toBe(400);
 const saved=await publicBnaInquiryHttp(request("POST",body),async()=>deps,"support");expect(saved.status).toBe(201);const receipt=(await saved.json()).data;
 const replay=await publicBnaInquiryHttp(request("POST",body),async()=>deps,"support");expect(replay.status).toBe(200);expect((await replay.json()).data).toEqual({...receipt,replayed:true});
 const after=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_service_interest.bna_inquiries")).rows;expect(after[0]!.n).toBe((before[0] as {n:number}).n+1);
 expect(await store.read(ownerActor,receipt.reference)).toMatchObject({program:BNA_SUPPORT_PROGRAM,fields,attribution:{source:"bna_site",landingPath:"/he/support"}});
 await expect(store.read(otherActor,receipt.reference)).rejects.toMatchObject({code:"NOT_FOUND"});
});
