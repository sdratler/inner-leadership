import {afterAll,expect,test,vi} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
import pg from "pg";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,safeTestUrl,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {nativeProfileHttp} from "../../../src/features/contact-ops/server/profile-http.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import {seal} from "../../../src/features/identity/crypto.ts";
import {crmProfileAad} from "../../../src/features/contact-ops/server/native-store.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const origin="https://synthetic.invalid",integrityKey="synthetic-profile-http-integrity-key";
// These isolated receipts only exercise the state machine. They are NOT live
// writer/delta/browser proof, and cannot authorize any production cutover.
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-profile-batch",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",
 expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,
 allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,
 consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
const fields={stage:"New inquiry",nextAction:"Follow up tomorrow",followUpDate:"2026-09-29",notes:"Synthetic administrative note — הערה שמורה"};
async function setup(){
 const f=await fixture();fixtures.push(f);const db=poolStore(f.pool);
 // Fixture accounts have real sessions/roles but a non-login synthetic password
 // hash. This is a native authorization proof, not password/provider acceptance.
 const config={workspaceId:f.workspaceId,csrfKey:randomBytes(32)} as IdentityConfig;
 const sessions=new IdentitySessions(db,config,systemClock);
 const store=new OperationalNativeCrmStore(db,f.keyring,integrityKey);
 const authority=new ContactCutoverStore(db,f.keyring,integrityKey);
 const deps=async()=>({origin,actor:(token:string)=>sessions.actor(token),csrf:(token:string)=>sessions.csrf(token),store});
 const personId=f.practitioner.actor.personId;
 const request=(method="GET",body:unknown=null,token=f.practitioner.token,epoch=3,id:string=personId)=>new Request(
  `http://127.0.0.1:8080/api/private/contact-profiles${method==="GET"?`?personId=${id}&expectedEpoch=${epoch}`:""}`,{
   method,headers:{cookie:`${SESSION_COOKIE}=${token}`,"x-forwarded-host":"synthetic.invalid","x-forwarded-proto":"https",
    ...(method==="POST"?{"content-type":"application/json",origin,"x-csrf-token":sessions.csrf(token)}:{})},
   ...(method==="POST"?{body:JSON.stringify(body)}:{})});
 const command=(overrides:Record<string,unknown>={})=>({action:"update",personId,expectedEpoch:3,expectedVersion:1,operationId:randomUUID(),fields,...overrides});
 return {f,db,config,sessions,store,authority,deps,personId,request,command};
}
async function activate(s:Awaited<ReturnType<typeof setup>>){
 for(const [epoch,action] of (["prepare","freeze","switch_native"] as const).entries())
  await s.authority.advance(s.f.practitioner.actor,{action,proof:proof(epoch),operationId:randomUUID()});
 await s.store.create(s.f.practitioner.actor,{personId:s.personId,...fields,legacyIds:["LS-LEAD-synthetic-preserved"]},randomUUID(),3);
}

test("ordinary HTTP requests cannot activate or fall back from legacy, frozen or stale authority",async()=>{
 const s=await setup();
 for(const [epoch,phase] of [[0,"sheet_active"],[1,"shadow_ready"],[2,"frozen"]] as const){
  expect(await s.authority.read(s.f.practitioner.actor)).toMatchObject({phase,epoch});
  expect((await nativeProfileHttp(s.request("GET",null,s.f.practitioner.token,epoch),s.deps)).status).toBe(409);
  expect((await nativeProfileHttp(s.request("POST",s.command({expectedEpoch:epoch})),s.deps)).status).toBe(409);
  if(epoch<2)await s.authority.advance(s.f.practitioner.actor,{action:epoch===0?"prepare":"freeze",proof:proof(epoch),operationId:randomUUID()});
 }
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
 expect((await s.authority.read(s.f.practitioner.actor)).nativeWritesSinceSwitch).toBe(0);
});

test("actual native HTTP save/read/replay preserves notes, encrypted storage and server-owned links",async()=>{
 const s=await setup();await activate(s);
 const first=await nativeProfileHttp(s.request(),s.deps);expect(first.status).toBe(200);
 const raw=await first.text();expect(JSON.parse(raw).data).toEqual({personId:s.personId,...fields,version:1,authorityEpoch:3});
 expect(raw).not.toContain("legacyIds");expect(raw).not.toContain("LS-LEAD-synthetic-preserved");
 const changed={...fields,stage:"Intake submitted",notes:fields.notes+"\nSynthetic second recorded activity — retained"};
 const command=s.command({fields:changed});
 for(const replayed of [false,true]){
  const saved=await nativeProfileHttp(s.request("POST",command),s.deps);expect(saved.status).toBe(200);
  expect((await saved.json()).data).toEqual({personId:s.personId,authorityEpoch:3,version:2,replayed});
 }
 expect(await s.store.read(s.f.practitioner.actor,s.personId,3)).toMatchObject({profile:{...changed,legacyIds:["LS-LEAD-synthetic-preserved"]},version:2});
 const reloaded=await nativeProfileHttp(s.request(),s.deps);expect((await reloaded.json()).data).toMatchObject({...changed,version:2});
 const ciphertext=(await s.f.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,s.personId])).rows[0].payload_ciphertext;
 expect(ciphertext).not.toContain(changed.notes);expect(ciphertext).not.toContain(changed.stage);
 expect((await s.authority.read(s.f.practitioner.actor)).nativeWritesSinceSwitch).toBe(3);
 const reused=await nativeProfileHttp(s.request("POST",{...command,fields:{...changed,notes:"Unauthorized retry replacement"}}),s.deps);
 expect(reused.status).toBe(409);expect((await s.authority.read(s.f.practitioner.actor)).nativeWritesSinceSwitch).toBe(3);
 expect((await s.store.read(s.f.practitioner.actor,s.personId,3))?.profile.notes).toBe(changed.notes);
});

test("concurrent real HTTP saves have one winner; stale version/epoch never overwrites it",async()=>{
 const s=await setup();await activate(s);
 const commands=["Synthetic candidate one","Synthetic candidate two"].map(notes=>s.command({fields:{...fields,notes}}));
 const responses=await Promise.all(commands.map(command=>nativeProfileHttp(s.request("POST",command),s.deps)));
 expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
 const winner=commands[responses.findIndex(r=>r.status===200)]!;
 expect((await s.store.read(s.f.practitioner.actor,s.personId,3))?.profile.notes).toBe(winner.fields.notes);
 expect((await nativeProfileHttp(s.request("POST",s.command()),s.deps)).status).toBe(409);
 expect((await nativeProfileHttp(s.request("GET",null,s.f.practitioner.token,2),s.deps)).status).toBe(409);
 expect((await nativeProfileHttp(s.request("POST",s.command({expectedEpoch:2,expectedVersion:2})),s.deps)).status).toBe(409);
 expect((await s.authority.read(s.f.practitioner.actor)).nativeWritesSinceSwitch).toBe(2);
 expect((await s.store.read(s.f.practitioner.actor,s.personId,3))?.profile.notes).toBe(winner.fields.notes);
});

test("real fresh roles, revoked sessions and workspace isolation deny read/write including replay",async()=>{
 const s=await setup();await activate(s);const command=s.command();
 expect((await nativeProfileHttp(s.request("POST",command),s.deps)).status).toBe(200);
 for(const role of ["parent","child","adult_client"]){
  await s.f.pool.query("UPDATE ls_identity.accounts SET role=$2 WHERE id=$1",[s.f.parent.actor.id,role]);
  for(const method of ["GET","POST"])expect((await nativeProfileHttp(s.request(method,command,s.f.parent.token),s.deps)).status).toBe(403);
 }
 const other=await setup();await activate(other);
 expect((await nativeProfileHttp(s.request("GET",null,s.f.practitioner.token,3,other.personId),s.deps)).status).toBe(404);
 expect((await nativeProfileHttp(s.request("POST",s.command({personId:other.personId})),s.deps)).status).toBe(404);
 expect((await nativeProfileHttp(s.request("GET",null,other.f.practitioner.token),s.deps)).status).toBe(401);
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[s.f.practitioner.actor.sessionDigest]);
 for(const method of ["GET","POST"])expect((await nativeProfileHttp(s.request(method,command),s.deps)).status).toBe(401);
 expect((await other.store.read(other.f.practitioner.actor,other.personId,3))?.version).toBe(1);
});

test("actual PostgreSQL permission denial stays a sanitized service error, not success or empty CRM",async()=>{
 const s=await setup();await activate(s);
 const role="ls_profile_denied_"+randomBytes(6).toString("hex"),password=randomBytes(24).toString("hex");
 await s.f.pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
 const url=new URL(safeTestUrl());url.username=role;url.password=password;
 const denied=new pg.Pool({connectionString:url.toString(),max:1});
 try{
  await expect(denied.query("SELECT token_digest FROM ls_identity.sessions")).rejects.toMatchObject({code:"42501"});
  const db=poolStore(denied),sessions=new IdentitySessions(db,s.config,systemClock);
  const deps=async()=>({origin,actor:(token:string)=>sessions.actor(token),csrf:(token:string)=>sessions.csrf(token),
   store:new OperationalNativeCrmStore(db,s.f.keyring,integrityKey)});
  for(const method of ["GET","POST"]){
   const result=await nativeProfileHttp(s.request(method,s.command()),deps);expect(result.status).toBe(503);
   const raw=await result.text();expect(JSON.parse(raw).ok).toBe(false);
   for(const detail of [role,password,"ls_identity","42501",fields.notes])expect(raw).not.toContain(detail);
  }
  expect((await s.store.read(s.f.practitioner.actor,s.personId,3))?.version).toBe(1);
  expect((await s.authority.read(s.f.practitioner.actor)).nativeWritesSinceSwitch).toBe(1);
 }finally{await denied.end();await s.f.pool.query(`DROP ROLE "${role}"`);}
});

test.each([
 {followUpDate:"2026-02-30"},
 {stage:["New inquiry"]},
 {notes:["Synthetic note pretending to be a string"]},
 {nextAction:{length:1}},
 {unexpectedPersistedNote:"Must not be silently removed"},
 {legacyIds:["LS-LEAD-synthetic-preserved","LS-LEAD-synthetic-preserved"]},
 {legacyIds:[12]},
 {notes:null}
])("malformed encrypted administrative data %j fails closed before success or a replacement write",async invalid=>{
 const s=await setup();await activate(s);
 // Corrupt ONLY this disposable fixture, with authentic encryption but invalid
 // profile shape. A decryptable payload is not sufficient evidence of validity.
 const malformed={personId:s.personId,...fields,legacyIds:["LS-LEAD-synthetic-preserved"],...invalid};
 await s.f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",
  [s.f.workspaceId,s.personId,seal(JSON.stringify(malformed),crmProfileAad(s.f.workspaceId,s.personId),s.f.keyring)]);
 for(const method of ["GET","POST"]){
  const result=await nativeProfileHttp(s.request(method,s.command()),s.deps);expect(result.status).toBe(503);
  expect((await result.json()).ok).toBe(false);
 }
 expect((await s.authority.read(s.f.practitioner.actor)).nativeWritesSinceSwitch).toBe(1);
 expect((await s.f.pool.query("SELECT version FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[s.f.workspaceId,s.personId])).rows[0].version).toBe(1);
});
