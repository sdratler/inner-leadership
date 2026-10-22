import {randomBytes,randomUUID} from "node:crypto";
import pg from "pg";
import {admitNativeCi} from '../native-ci-admission.ts';
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {asId} from "../../../src/lib/ids.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {blindEmail,hashPassword,seal} from "../../../src/features/identity/crypto.ts";
import {IdentityAuthService} from "../../../src/features/identity/auth-service.ts";
import {IdentityAccountService} from "../../../src/features/identity/account-service.ts";
import {IdentityPreferenceService} from "../../../src/features/identity/preferences.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {IdentityHttp} from "../../../src/features/identity/http.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {durableAuditSink} from "../../../src/features/identity/history.ts";
import {systemClock,type AccountRole} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {CaseService} from "../../../src/features/cases/service.ts";
import {NativeEducationalChildContexts} from "../../../src/features/fishing/native-child-context.ts";
import {fishingChildContextHttp} from "../../../src/features/fishing/child-context-http.ts";
import {poolStore,safeTestUrl} from "../calendar/fixture.ts";

const pools:pg.Pool[]=[];
afterEach(async()=>{await Promise.all(pools.splice(0).map(pool=>pool.end()));});
async function fixture(){
 const native=await admitNativeCi(['base']),raw=safeTestUrl(),url=new URL(raw);
 const ci=process.env.CI==="true"&&raw==="postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test";
 if(!native&&!ci&&(process.env.LS_RM_GUARDIAN_NATIVE_ALLOW!=="MAIN_REGISTERED_ONLY"||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname)))throw Error("MAIN_REGISTERED_GUARDIAN_TARGET_REQUIRED");
 if(url.hostname!=="127.0.0.1"||!url.port||!url.username||!url.password||url.search||url.hash)throw Error("GUARDIAN_TARGET_NOT_EXACT_LOOPBACK");
 const pool=new pg.Pool({connectionString:raw,ssl:false,max:4});pools.push(pool);
 const target=(await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port")).rows[0];
 if(target.database!==url.pathname.slice(1)||target.host!==(native?.serverAddress??"127.0.0.1")||target.port!==Number(url.port))throw Error("GUARDIAN_ACTUAL_TARGET_MISMATCH");
 const workspaceId=asId(randomUUID(),"workspace"),ago=new Date(Date.now()-3600000),db=poolStore(pool),origin="https://synthetic.invalid";
 const config:IdentityConfig={enabled:true,origin,workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),keyring:{activeKeyId:"synthetic",keys:{synthetic:randomBytes(32)}},sessionSeconds:28800};
 await pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,ago]);
 // Fixture establishes verified synthetic account facts, not an invitation proof.
 // Sessions are NEVER inserted here: each one must come from ordinary login.
 const password="Ab12cd",encoded=await hashPassword(password);
 async function person(kind:"minor"|"adult",displayName:string){
  const id=asId(randomUUID(),"person");await pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)",[id,workspaceId,kind,seal(JSON.stringify({displayName,privateNote:"PRIVATE_SYNTHETIC_PROFILE"}),`person:${workspaceId}:${id}`,config.keyring),ago]);return id;
 }
 async function account(role:AccountRole){
  const id=asId(randomUUID(),"account"),personId=await person(role==="child"?"minor":"adult","Synthetic account"),email=`${id}@example.invalid`;
  await pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','he',$4,$5,$6,$7,$6,$6)",[id,workspaceId,role,blindEmail(email,config.lookupKey),seal(email,`email:${workspaceId}:${id}`,config.keyring),ago,encoded]);
  await pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[workspaceId,id,personId]);return {id,personId,email};
 }
 const operator=await account("practitioner"),parent=await account("parent"),other=await account("parent"),ours=await person("minor","שם זהה / Same name"),theirs=await person("minor","שם זהה / Same name");
 for(const [learner,guardian] of [[ours,parent.id],[theirs,other.id]])await pool.query("INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,$4,'synthetic-native-http-guardian',$5)",[workspaceId,learner,guardian,ago,operator.id]);
 function runtime(){
  const sessions=new IdentitySessions(db,config,systemClock),limits=new PostgresIdentityRateStore(db),audit=durableAuditSink(db);
  const services={auth:new IdentityAuthService(db,config,systemClock),accounts:new IdentityAccountService(db,config,systemClock),preferences:new IdentityPreferenceService(db,config,systemClock),sessions,cases:new CaseService(db,config,systemClock),limits,audit};
  return {identity:new IdentityHttp(config,systemClock,services),runtime:{config,sessions,limits,audit,clock:systemClock},children:new NativeEducationalChildContexts(db,config.keyring,systemClock)};
 }
 async function login(email:string,attempt=password){
  const http=runtime().identity,preauth=await http.handle(new Request(origin+"/api/identity/csrf")),csrf=(await preauth.json()).data.csrfToken;
  expect(preauth.status).toBe(200);const preCookie=preauth.headers.getSetCookie()[0]!.split(";")[0]!;
  const response=await http.handle(new Request(origin+"/api/identity/login",{method:"POST",headers:{cookie:preCookie,origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify({email,password:attempt})}));
  if(attempt!==password){expect(response.status).toBe(401);return null;}
  expect(response.status).toBe(200);const set=response.headers.getSetCookie().find(value=>value.startsWith(SESSION_COOKIE+"="));expect(set).toMatch(/HttpOnly; Secure; SameSite=Lax/);
  return {cookie:set!.split(";")[0]!,csrf:(await response.json()).data.csrfToken as string};
 }
 async function read(cookie:string,learnerId:string|null=null){
  return fishingChildContextHttp(new Request(origin+"/api/private/fishing/children"+(learnerId===null?"":"?learnerId="+learnerId),{headers:{cookie}}),async()=>{
   const r=runtime();return {runtime:r.runtime,children:r.children};
  });
 }
 return {pool,workspaceId,origin,parent,other,operator,ours,theirs,runtime,login,read};
}

test("real six-character password login, native child read/selection and reconstructed services preserve exact own context without a child login/case",async()=>{
 const f=await fixture();await f.login(f.parent.email,"wrong-password");const auth=(await f.login(f.parent.email))!;
 const response=await f.read(auth.cookie),first=await response.json();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
 expect(first.data).toEqual({children:[{learnerId:f.ours,displayName:"שם זהה / Same name"}],selectedLearnerId:null});expect(JSON.stringify(first)).not.toContain("PRIVATE_SYNTHETIC_PROFILE");
 const selected=await f.read(auth.cookie,f.ours);expect(selected.status).toBe(200);expect((await selected.json()).data.selectedLearnerId).toBe(f.ours);
 // Every call constructs fresh normal services; the cookie/native facts survive.
 expect((await (await f.read(auth.cookie)).json()).data).toEqual(first.data);
 const counts=(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_identity.sessions WHERE workspace_id=$1) AS sessions,(SELECT count(*)::integer FROM ls_identity.accounts WHERE workspace_id=$1 AND role='child') AS children,(SELECT count(*)::integer FROM ls_cases.cases WHERE workspace_id=$1) AS cases,(SELECT count(*)::integer FROM ls_education.educational_assignments WHERE workspace_id=$1) AS assignments,(SELECT count(*)::integer FROM ls_identity.action_history WHERE workspace_id=$1 AND action='login_succeeded') AS logins",[f.workspaceId])).rows[0];
 expect(counts).toEqual({sessions:1,children:0,cases:0,assignments:0,logins:1});
});
test("two ordinarily logged-in families with same-name children cannot select each other's child; current role and guardian revocation recheck",async()=>{
 const f=await fixture(),a=(await f.login(f.parent.email))!,b=(await f.login(f.other.email))!;
 expect((await f.read(a.cookie,f.theirs)).status).toBe(404);expect((await f.read(b.cookie,f.ours)).status).toBe(404);
 expect((await (await f.read(b.cookie)).json()).data.children).toEqual([{learnerId:f.theirs,displayName:"שם זהה / Same name"}]);
 await f.pool.query("UPDATE ls_identity.accounts SET role='adult_client' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.parent.id]);expect((await f.read(a.cookie)).status).toBe(403);
 await f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.parent.id]);
 await f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND account_id=$2",[f.workspaceId,f.parent.id]);
 expect((await (await f.read(a.cookie)).json()).data).toEqual({children:[],selectedLearnerId:null});expect((await f.read(a.cookie,f.ours)).status).toBe(404);
 const denied=(await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.foundation_audit WHERE workspace_id=$1 AND kind='access_denied' AND outcome='denied'",[f.workspaceId])).rows[0];expect(denied.n).toBeGreaterThanOrEqual(4);
});
test("ordinary logout, native session expiry and non-parent ordinary login cannot reuse the child endpoint",async()=>{
 const f=await fixture(),auth=(await f.login(f.parent.email))!;
 const logout=await f.runtime().identity.handle(new Request(f.origin+"/api/identity/logout",{method:"POST",headers:{cookie:auth.cookie,origin:f.origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":auth.csrf},body:"{}"}));expect(logout.status).toBe(200);expect((await f.read(auth.cookie)).status).toBe(401);
 const second=(await f.login(f.parent.email))!;await f.pool.query("UPDATE ls_identity.sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE workspace_id=$1 AND revoked_at IS NULL",[f.workspaceId]);expect((await f.read(second.cookie)).status).toBe(401);
 const operator=(await f.login(f.operator.email))!;expect((await f.read(operator.cookie)).status).toBe(403);
 expect((await f.read(SESSION_COOKIE+"="+"s".repeat(43))).status).toBe(401);
});
