import {afterAll,expect,test,vi} from "vitest";
import {randomUUID,randomBytes} from "node:crypto";
import pg from "pg";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,safeTestUrl,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {peopleHttp} from "../../../src/features/contact-ops/server/people-http.ts";
import {nativeProfileHttp} from "../../../src/features/contact-ops/server/profile-http.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const origin="https://synthetic.invalid",key="synthetic-native-people-integrity-key";
// These synthetic phase proofs do not authorize production authority changes.
const proof=(epoch:number):CutoverEvidence=>({batchId:"synthetic-people",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
async function setup(){const f=await fixture();fixtures.push(f);const db=poolStore(f.pool),config={workspaceId:f.workspaceId,csrfKey:randomBytes(32)} as IdentityConfig,sessions=new IdentitySessions(db,config,systemClock),authority=new ContactCutoverStore(db,f.keyring,key),directory=new OperationalNativeCrmStore(db,f.keyring,key);const deps=async()=>({origin,now:()=>new Date(),actor:(t:string)=>sessions.actor(t),authority,directory});const request=(query="",token=f.practitioner.token)=>new Request("http://127.0.0.1:8080/api/private/people"+query,{headers:{cookie:`${SESSION_COOKIE}=${token}`,"x-forwarded-proto":"https","x-forwarded-host":"synthetic.invalid"}});return {f,db,config,sessions,authority,directory,deps,request};}
async function activate(s:Awaited<ReturnType<typeof setup>>){for(const [epoch,action] of (["prepare","freeze","switch_native"] as const).entries())await s.authority.advance(s.f.practitioner.actor,{action,proof:proof(epoch),operationId:randomUUID()});}
test("actual native authority selects Sheet, then freezes without exposing the shadow or writing",async()=>{const s=await setup();for(const [epoch,action] of (["prepare","freeze"] as const).entries()){const r=await peopleHttp(s.request(),s.deps);expect(r.status).toBe(200);expect((await r.json()).data).toEqual({source:"sheet",authorityEpoch:epoch});await s.authority.advance(s.f.practitioner.actor,{action,proof:proof(epoch),operationId:randomUUID()});}expect((await peopleHttp(s.request(),s.deps)).status).toBe(409);expect((await s.authority.read(s.f.practitioner.actor)).nativeWritesSinceSwitch).toBe(0);});
test("real native list and versioned save/reload preserve one canonical person and actual case links",async()=>{
 const s=await setup();await activate(s);
 const personId=(await s.f.pool.query("SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2",[s.f.workspaceId,s.f.first.id])).rows[0].person_id;
 const fields={stage:"Synthetic follow-up",nextAction:"Respond today",followUpDate:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(new Date()),notes:"Original synthetic note\nהערה סינתטית"};
 await s.directory.create(s.f.practitioner.actor,{personId,...fields,legacyIds:[]},randomUUID(),3);
 const r=await peopleHttp(s.request(),s.deps);expect(r.status).toBe(200);
 const data=(await r.json()).data;expect(data.source).toBe("native");expect(data.page.total).toBe(2);
 expect(new Set(data.page.items.map((p:{personId:string})=>p.personId)).size).toBe(2);
 expect(data.page.items.find((p:{personId:string})=>p.personId===personId)).toMatchObject({version:1,notes:fields.notes,caseLinks:[{caseId:s.f.first.id,state:"active"}]});
 expect(data.page.items.filter((p:{version:number|null})=>p.version===null)).toHaveLength(1);
 const changed={...fields,notes:fields.notes+"\nSecond synthetic admin activity preserved"};
 const command={action:"update",personId,expectedEpoch:3,expectedVersion:1,operationId:randomUUID(),fields:changed};
 const save=new Request("http://127.0.0.1:8080/api/private/contact-profiles",{method:"POST",headers:{
  cookie:`${SESSION_COOKIE}=${s.f.practitioner.token}`,origin,"x-forwarded-host":"synthetic.invalid","x-forwarded-proto":"https",
  "x-csrf-token":s.sessions.csrf(s.f.practitioner.token),"content-type":"application/json"},body:JSON.stringify(command)});
 expect((await nativeProfileHttp(save,async()=>({origin,actor:(t:string)=>s.sessions.actor(t),csrf:(t:string)=>s.sessions.csrf(t),store:s.directory}))).status).toBe(200);
 const exact=await peopleHttp(s.request(`?personId=${personId}&due=today`),s.deps);
 expect((await exact.json()).data.page).toMatchObject({total:1,items:[{personId,version:2,notes:changed.notes}]});
 const profiles=(await s.f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n;
 expect(profiles).toBe(1);
});
test("fresh customer roles, workspace and revoked sessions never expose People",async()=>{const s=await setup();await activate(s);for(const role of ["parent","child","adult_client"]){await s.f.pool.query("UPDATE ls_identity.accounts SET role=$2 WHERE id=$1",[s.f.parent.actor.id,role]);expect((await peopleHttp(s.request("?mode=demo",s.f.parent.token),s.deps)).status).toBe(403);}const other=await setup();expect((await peopleHttp(s.request("",other.f.practitioner.token),s.deps)).status).toBe(401);await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[s.f.practitioner.actor.sessionDigest]);expect((await peopleHttp(s.request(),s.deps)).status).toBe(401);});
test("multiple actual assigned cases stay one person, active beats archived, and unassigned case links are absent",async()=>{
 const s=await setup();await activate(s);
 const archivedId="00000000-0000-4000-8000-000000000001",unassignedId=randomUUID();
 for(const [id,state,owner] of [[archivedId,"archived",s.f.practitioner.actor.id],[unassignedId,"active",s.f.outsider.actor.id]])
  await s.f.pool.query(`INSERT INTO ls_cases.cases(id,workspace_id,client_id,family_id,practitioner_account_id,state,created_at,updated_at)
   SELECT $1,workspace_id,client_id,family_id,$2,$3,created_at,updated_at FROM ls_cases.cases WHERE workspace_id=$4 AND id=$5`,[id,owner,state,s.f.workspaceId,s.f.first.id]);
 const response=await peopleHttp(s.request("?view=active"),s.deps);expect(response.status).toBe(200);
 const rows=(await response.json()).data.page.items;
 expect(rows).toHaveLength(2);
 const person=rows.find((r:{caseLinks:{caseId:string}[]})=>r.caseLinks.some(c=>c.caseId===s.f.first.id));
 expect(person).toMatchObject({stage:"active",archived:false,version:null});
 expect(person.caseLinks.map((c:{caseId:string})=>c.caseId).sort()).toEqual([archivedId,s.f.first.id].sort());
 expect(JSON.stringify(rows)).not.toContain(unassignedId);
 await s.f.pool.query("UPDATE ls_cases.cases SET state='completed' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.first.id]);
 const archived=await peopleHttp(s.request("?view=archived"),s.deps);
 expect((await archived.json()).data.page).toMatchObject({total:1,items:[{personId:person.personId,archived:true,version:null}]});
});
test("native failure from actual PostgreSQL permission denial is503, never Sheet or empty success",async()=>{const s=await setup();await activate(s);const role="ls_people_denied_"+randomBytes(5).toString("hex"),password=randomBytes(24).toString("hex");await s.f.pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);const url=new URL(safeTestUrl());url.username=role;url.password=password;const denied=new pg.Pool({connectionString:url.toString(),max:1});try{await expect(denied.query("SELECT token_digest FROM ls_identity.sessions")).rejects.toMatchObject({code:"42501"});const db=poolStore(denied),sessions=new IdentitySessions(db,s.config,systemClock),deps=async()=>({origin,now:()=>new Date(),actor:(t:string)=>sessions.actor(t),authority:new ContactCutoverStore(db,s.f.keyring,key),directory:new OperationalNativeCrmStore(db,s.f.keyring,key)});const r=await peopleHttp(s.request(),deps);expect(r.status).toBe(503);const raw=await r.text();for(const value of [role,password,"42501","ls_identity",'"source":"sheet"'])expect(raw).not.toContain(value);expect(JSON.parse(raw).ok).toBe(false);}finally{await denied.end();await s.f.pool.query(`DROP ROLE "${role}"`);}});
