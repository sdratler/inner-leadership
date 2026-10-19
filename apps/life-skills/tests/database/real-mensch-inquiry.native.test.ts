import {randomUUID,randomBytes,createHash} from "node:crypto";
import {afterAll,beforeAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "./calendar/fixture.ts";
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {privateDigest} from "../../src/features/contact-ops/server/digests.ts";
import {publicGroupApplicationHttp} from "../../src/features/group-application/http.ts";
import {issueFloridaGroupApplicationChallenge} from "../../src/features/group-application/challenge.ts";
import {floridaGroupApplicationNotice,groupApplicationNotice,type FloridaParentApplicationFields} from "../../src/features/group-application/contract.ts";
import {seal,tokenDigest} from "../../src/features/identity/crypto.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {groupApplicationReviewHttp} from "../../src/features/group-application/review-http.ts";

const retained:Fixture[]=[];let f:Fixture,store:PublicGroupApplicationStore;
const key="synthetic-rm04-inquiry-integrity-key";
const effects=["ls_identity.people","ls_identity.accounts","ls_cases.cases","ls_calendar.tasks","ls_payments.payments",
 "ls_payments.charges","ls_contact_ops.profiles","ls_contact_ops.outbound_projections","ls_notifications.notification_outbox"];
const count=(table:string)=>(f.pool.query<{n:number}>(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[f.workspaceId])).then(r=>r.rows[0]!.n);
const before=()=>Promise.all(effects.map(count));
function command(contact="+13055550100"):{operationId:string;fields:FloridaParentApplicationFields}{
 return {operationId:randomUUID(),fields:{parentName:"Synthetic RM04 parent",contact,language:"en",cityArea:"Synthetic Florida",neighborhood:"Synthetic neighborhood",
  programId:"sunday_fishing_academy",scheduleContext:"program_format_interest",schedulePreference:["weekday_before_school","weekday_morning_homeschool"],
  academyFit:{version:"RM-FIT-20261014-04-v1",learners:[{approximateAge:10,gear:"needs_advice",experience:"new"},{approximateAge:13,gear:"has_gear",experience:"some"}],
   maximumDriveMinutes:30,parentDropoff:"yes"},permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}};
}
// Native denied-role records only, not a password-login or customer-grant proof.
async function deniedRole(role:"adult_client"|"child"):Promise<Actor>{
 const id=asId(randomUUID(),"account"),personId=asId(randomUUID(),"person"),now=new Date(),expiresAt=now.getTime()+3600000,
  token=randomBytes(32).toString("base64url"),sessionDigest=tokenDigest(token);
 await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)",
  [personId,f.workspaceId,role==="child"?"minor":"adult",seal(JSON.stringify({displayName:"Synthetic denied role"}),`person:${f.workspaceId}:${personId}`,f.keyring),now]);
 await f.pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)",
  [id,f.workspaceId,role,createHash("sha256").update(id).digest("hex"),seal("synthetic-role@example.invalid",`email:${f.workspaceId}:${id}`,f.keyring),now]);
 await f.pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[f.workspaceId,id,personId]);
 await f.pool.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[sessionDigest,f.workspaceId,id,now,new Date(expiresAt)]);
 return {id,workspaceId:f.workspaceId,personId,role,state:"active",locale:"en",sessionDigest,expiresAt};
}
beforeAll(async()=>{f=await fixture();retained.push(f);store=new PublicGroupApplicationStore(poolStore(f.pool),f.workspaceId,f.keyring,key);});
afterAll(async()=>{for(const item of retained)await item.pool.end();});

test("native owner search reopens an older durable inquiry through authenticated HTTP without CRM/send effects",async()=>{
 const baseline=await before(),stamp=Date.now();let tick=0;
 const history=new PublicGroupApplicationStore(poolStore(f.pool),f.workspaceId,f.keyring,key,{now:()=>new Date(stamp+tick++)});
 const target=await history.submit({...command("history-target@example.invalid"),fields:{...command().fields,contact:"history-target@example.invalid",parentName:"Synthetic durable history needle"}});
 for(let i=0;i<61;i++)await history.submit(command(`history-${i}@example.invalid`));
 expect((await history.list(f.practitioner.actor)).some(item=>item.id===target.item.id)).toBe(false);
 const origin="https://synthetic.example.invalid",headers={host:"synthetic.example.invalid","x-forwarded-host":"synthetic.example.invalid","x-forwarded-proto":"https",cookie:"__Host-ls-session="+"s".repeat(43)};
 const response=await groupApplicationReviewHttp(new Request(origin+"/api/private/group-applications?search=durable+history+needle",{headers}),async()=>({origin,actor:async()=>f.practitioner.actor,store:history}));
 expect(response.status).toBe(200);expect((await response.json()).data).toEqual({items:[target.item],nextCursor:null,emailSetup:null});
 const collected:string[]=[];let cursor:string|undefined;
 do{const page=await history.listPage(f.practitioner.actor,{cursor});collected.push(...page.items.map(item=>item.id));cursor=page.nextCursor??undefined;}while(cursor);
 expect(new Set(collected).size).toBe(collected.length);expect(collected).toContain(target.item.id);
 for(const actor of [f.parent.actor,{...f.practitioner.actor,workspaceId:asId(randomUUID(),"workspace")}])await expect(history.listPage(actor,{search:"needle"})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(await before()).toEqual(baseline);
});
test("native commit/reopen retains group-fit and narrow notice, encrypted at rest, with zero automatic effects",async()=>{
 const baseline=await before(),input=command(),saved=await store.submit(input);
 expect(saved).toMatchObject({saved:true,replayed:false,duplicate:false,item:{fields:input.fields}});
 const reopened=new PublicGroupApplicationStore(poolStore(f.pool),f.workspaceId,f.keyring,key);
 expect(await reopened.list(f.practitioner.actor)).toContainEqual(saved.item);
 expect(await poolStore(f.pool).transaction(tx=>reopened.readForOwnerInTransaction(tx,f.practitioner.actor,saved.item.id))).toEqual(saved.item);
 const raw=(await f.pool.query("SELECT payload_ciphertext,notice_version,notice_language FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2",[f.workspaceId,saved.item.id])).rows[0];
 expect(raw).toMatchObject({notice_version:floridaGroupApplicationNotice.version,notice_language:"en"});
 expect(raw.payload_ciphertext).not.toMatch(/Synthetic RM04 parent|3055550100|Synthetic neighborhood|approximateAge/);
 expect(await before()).toEqual(baseline);
});
test("lost-result retry, concurrent presses and a new-key duplicate bind every accepted operation",async()=>{
 const baseline=await before(),input=command("+13055550101");
 const saved=await store.submit(input); // Simulated caller loses this result AFTER real commit.
 const results=await Promise.all(Array.from({length:5},()=>store.submit(input)));
 expect(results.every(r=>r.replayed&&r.item.id===saved.item.id)).toBe(true);
 const alias={...input,operationId:randomUUID()},duplicate=await store.submit(alias);
 expect(duplicate).toMatchObject({duplicate:true,replayed:false,item:{id:saved.item.id}});
 expect(await store.submit(alias)).toMatchObject({replayed:true,item:{id:saved.item.id}});
 await expect(store.submit({...alias,fields:{...alias.fields,cityArea:"Changed synthetic area"}})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND application_id=$2",[f.workspaceId,saved.item.id])).rows[0].n).toBe(2);
 expect(await before()).toEqual(baseline);
});
test("new-key duplicate aliases are bounded without blocking an already saved exact retry",async()=>{
 const input=command("+13055550102"),saved=await store.submit(input);
 for(let i=0;i<99;i++)await store.submit({...input,operationId:randomUUID()});
 await expect(store.submit({...input,operationId:randomUUID()})).rejects.toMatchObject({code:"RATE_LIMITED"});
 expect(await store.submit(input)).toMatchObject({replayed:true,item:{id:saved.item.id}});
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND application_id=$2",[f.workspaceId,saved.item.id])).rows[0].n).toBe(100);
},15000);
test("parent/adult/child, wrong workspace and revoked practitioner cannot reopen a private receipt",async()=>{
 const input=command("+13055550103"),saved=await store.submit(input),roles=[f.parent.actor,await deniedRole("adult_client"),await deniedRole("child")],baseline=await before();
 for(const actor of roles)
  await expect(poolStore(f.pool).transaction(tx=>store.readForOwnerInTransaction(tx,actor,saved.item.id))).rejects.toMatchObject({code:"FORBIDDEN"});
 const other=await fixture();retained.push(other);
 await expect(poolStore(f.pool).transaction(tx=>store.readForOwnerInTransaction(tx,other.practitioner.actor,saved.item.id))).rejects.toMatchObject({code:"FORBIDDEN"});
 const otherStore=new PublicGroupApplicationStore(poolStore(other.pool),other.workspaceId,other.keyring,key);
 const otherSaved=await otherStore.submit(command("+13055550104"));
 await other.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[other.workspaceId,other.practitioner.actor.id]);
 await expect(poolStore(other.pool).transaction(tx=>otherStore.readForOwnerInTransaction(tx,other.practitioner.actor,otherSaved.item.id))).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 expect(await before()).toEqual(baseline);
});
test("old Florida and Israel saved fields remain exact and do not become new academy fit/enrollment",async()=>{
 const old=command("parent-legacy@example.invalid");delete old.fields.academyFit;delete old.fields.scheduleContext;
 old.fields.schedulePreference=["sunday"];old.fields.childAge="10";
 const saved=await store.submit(old);expect(saved.item.fields).toEqual(old.fields);
 const israel={operationId:randomUUID(),fields:{parentName:"Synthetic legacy Israel",parentPhone:"+972520009998",language:"he" as const,
  childAge:10,town:"Modiin",townChoice:"modiin" as const,neighborhood:"Synthetic neighborhood",schedulePreference:"evening" as const,observations:{},
  permission:{confirmed:true as const,version:groupApplicationNotice.version,language:"he" as const}}};
 const previous=await store.submit(israel);expect(previous.item.fields).toEqual(israel.fields);
 expect(await store.list(f.practitioner.actor)).toContainEqual(previous.item);
});
test("historically accepted mixed contact/notice language remains immutable and cannot break the owner list",async()=>{
 const fields={parentName:"Synthetic retained language tuple",contact:"synthetic-compatibility@example.invalid",language:"en" as const,
  childAge:"10",cityArea:"Synthetic Florida",programId:"sunday_fishing_academy" as const,schedulePreference:["sunday" as const],
  permission:{confirmed:true as const,version:floridaGroupApplicationNotice.version,language:"he" as const}},id=randomUUID(),operationId=randomUUID();
 const requestDigest=privateDigest({domain:"public-group-application/v1",workspace:f.workspaceId,fields},key),
  contactDigest=privateDigest({domain:"public-group-application-contact/v1",workspace:f.workspaceId,contact:fields.contact},key);
 // A pre-RM04 generation accepted this synthetic tuple. Seed only its actual
 // persisted shape to test retained reading, not current submit/receiver success.
 await f.pool.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,[f.workspaceId,id,contactDigest,requestDigest,
   seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${f.workspaceId}/${id}`,f.keyring),fields.permission.version,fields.permission.language]);
 await f.pool.query(`INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id)
  VALUES($1,$2,$3,$4)`,[f.workspaceId,operationId,requestDigest,id]);
 const snapshot=()=>f.pool.query("SELECT to_jsonb(a)::text AS snapshot FROM ls_service_interest.public_applications a WHERE workspace_id=$1 AND id=$2",[f.workspaceId,id]);
 const prior=(await snapshot()).rows,baseline=await before(),reader=new PublicGroupApplicationStore(poolStore(f.pool),f.workspaceId,f.keyring,key);
 const item=await poolStore(f.pool).transaction(tx=>reader.readForOwnerInTransaction(tx,f.practitioner.actor,id));
 expect(item.fields).toEqual(fields);expect(await reader.list(f.practitioner.actor)).toContainEqual(item);
 expect(await reader.submit({operationId,fields})).toMatchObject({replayed:true,duplicate:true,item:{id,fields}});
 await expect(store.submit({operationId:randomUUID(),fields})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(reader.submit({operationId,fields:{...fields,parentName:"Changed synthetic body"}})).rejects.toMatchObject({code:"CONFLICT"});
 const origin="https://synthetic.example.invalid",now=Date.now(),challenge=issueFloridaGroupApplicationChallenge(key,"sunday_fishing_academy",now-3000,randomUUID()),
  headers={host:"synthetic.example.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json"},
  dependencies=async()=>({enabled:true,environment:{NODE_ENV:"production",LS_APP_ORIGIN:origin,LS_IDENTITY_ENABLED:"true"},challengeKey:key,now:()=>now,
   limits:{consume:async()=>({count:1,retryAfterMs:1000})},store:reader});
 const send=(op:string,value:typeof fields)=>publicGroupApplicationHttp(new Request(origin+"/api/public/group-applications?program=sunday_fishing_academy",
  {method:"POST",headers,body:JSON.stringify({challenge,website:"",operationId:op,fields:value})}),dependencies);
 const replayed=await send(operationId,fields);expect(replayed.status).toBe(200);
 expect(await replayed.json()).toMatchObject({ok:true,data:{replayed:true,item:{id,fields}}});
 expect((await send(randomUUID(),fields)).status).toBe(400);
 expect((await send(operationId,{...fields,parentName:"Changed synthetic body"})).status).toBe(409);
 expect((await snapshot()).rows).toEqual(prior);expect(await before()).toEqual(baseline);
});
