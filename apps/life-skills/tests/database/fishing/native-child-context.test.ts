import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {randomBytes,randomUUID,createHash} from "node:crypto";
import pg from "pg";
import {asId} from "../../../src/lib/ids.ts";
import {seal,type Keyring} from "../../../src/features/identity/crypto.ts";
import type {Actor,AccountRole,PersonId} from "../../../src/features/identity/types.ts";
import {NativeEducationalChildContexts,readEducationalChildContexts} from "../../../src/features/fishing/native-child-context.ts";
import {poolStore,safeTestUrl} from "../calendar/fixture.ts";

const pools:pg.Pool[]=[];
afterEach(async()=>{await Promise.all(pools.splice(0).map(pool=>pool.end()));});
async function fixture(){
 const raw=safeTestUrl(),url=new URL(raw);
 // Reuse only the existing frozen secret-free CI allowlist, never DATABASE_URL.
 const ci=process.env.CI==="true"&&raw==="postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test";
 if(!ci&&(process.env.LS_RM_GUARDIAN_NATIVE_ALLOW!=="MAIN_REGISTERED_ONLY"||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname)))throw Error("MAIN_REGISTERED_GUARDIAN_TARGET_REQUIRED");
 if(url.hostname!=="127.0.0.1"||!url.port||!url.username||!url.password||url.search||url.hash)throw Error("GUARDIAN_TARGET_NOT_EXACT_LOOPBACK");
 const pool=new pg.Pool({connectionString:raw,ssl:false,max:4});pools.push(pool);
 const target=(await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port")).rows[0];
 if(target.database!==url.pathname.slice(1)||target.host!=="127.0.0.1"||target.port!==Number(url.port))throw Error("GUARDIAN_ACTUAL_TARGET_MISMATCH");
 const workspaceId=asId(randomUUID(),"workspace"),now=new Date(),ago=new Date(now.valueOf()-3600000),ring:Keyring={activeKeyId:"synthetic",keys:{synthetic:randomBytes(32)}},db=poolStore(pool);
 await pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,ago]);
 async function person(kind:"minor"|"adult",displayName:string,extra:Record<string,string>={}){
  const id=asId(randomUUID(),"person");await pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)",[id,workspaceId,kind,seal(JSON.stringify({displayName,...extra}),`person:${workspaceId}:${id}`,ring),ago]);return id;
 }
 async function account(role:AccountRole):Promise<Actor>{
  const id=asId(randomUUID(),"account"),personId=await person(role==="child"?"minor":"adult","Synthetic account"),sessionDigest=createHash("sha256").update(randomBytes(32)).digest("hex"),expiresAt=now.valueOf()+3600000;
  await pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-not-a-login-hash',$6,$6)",[id,workspaceId,role,createHash("sha256").update(id).digest("hex"),seal(`${id}@example.invalid`,`email:${workspaceId}:${id}`,ring),ago]);
  await pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[workspaceId,id,personId]);
  await pool.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[sessionDigest,workspaceId,id,ago,new Date(expiresAt)]);
  return {id,workspaceId,personId,role,state:"active",locale:"en",sessionDigest,expiresAt};
 }
 const operator=await account("practitioner"),parent=await account("parent"),other=await account("parent");
 async function guardian(learnerId:PersonId,who:Actor=parent,verifiedAt=ago,verifier:Actor=operator){await pool.query("INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,$4,'synthetic-verified-guardian-source',$5)",[workspaceId,learnerId,who.id,verifiedAt,verifier.id]);}
 async function revoke(learnerId:PersonId|null,accountId:string|null,moduleId:string|null=null,version:string|null=null){await pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,module_id,version,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[workspaceId,randomUUID(),accountId,learnerId,moduleId,version,operator.id]);}
 return {pool,db,ring,workspaceId,parent,other,operator,person,account,guardian,revoke,reader:new NativeEducationalChildContexts(db,ring)};
}

test("reads exact own child IDs/names without a child account or any clinical/enrollment effect; null never picks first",async()=>{
 const f=await fixture(),one=await f.person("minor","אותו שם",{privateNote:"PRIVATE_PROFILE_CANARY"}),two=await f.person("minor","אותו שם");await f.guardian(one);await f.guardian(two);
 const result=await f.reader.read(f.parent);expect(result.children).toHaveLength(2);expect(new Set(result.children.map(x=>x.learnerId))).toEqual(new Set([one,two]));expect(result.selectedLearnerId).toBeNull();expect(result.children.map(x=>x.displayName)).toEqual(["אותו שם","אותו שם"]);
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PROFILE_CANARY|privateNote|source_reference|verified_by/);
 expect((await f.reader.read(f.parent,two)).selectedLearnerId).toBe(two);
 await expect(f.reader.read(f.parent,"not-an-id")).rejects.toMatchObject({code:"INVALID_REQUEST"});
 const rows=(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_identity.accounts WHERE workspace_id=$1 AND role='child') AS children,(SELECT count(*)::integer FROM ls_cases.cases WHERE workspace_id=$1) AS cases,(SELECT count(*)::integer FROM ls_education.educational_assignments WHERE workspace_id=$1) AS assignments",[f.workspaceId])).rows[0];
 expect(rows).toEqual({children:0,cases:0,assignments:0});
});
test("wrong-family selection is not found even with the same name; another workspace/session cannot substitute",async()=>{
 const f=await fixture(),ours=await f.person("minor","Same name"),theirs=await f.person("minor","Same name");await f.guardian(ours);await f.guardian(theirs,f.other);
 expect((await f.reader.read(f.parent)).children.map(x=>x.learnerId)).toEqual([ours]);expect((await f.reader.read(f.other)).children.map(x=>x.learnerId)).toEqual([theirs]);
 await expect(f.reader.read(f.parent,theirs)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(f.reader.read({...f.parent,workspaceId:asId(randomUUID(),"workspace")})).rejects.toMatchObject({code:"UNAVAILABLE"});
 await expect(f.reader.read({...f.parent,sessionDigest:f.other.sessionDigest})).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
test("checks actual native role rather than the captured role; separately enabled child/adult/operator are not parent readers",async()=>{
 const f=await fixture();for(const actor of [f.operator,await f.account("child"),await f.account("adult_client")])await expect(f.reader.read({...actor,role:"parent"})).rejects.toMatchObject({code:"FORBIDDEN"});
});
test("revoked sessions, unverified parent and disabled native account deny before child context",async()=>{
 const f=await fixture(),learner=await f.person("minor","Synthetic child");await f.guardian(learner);
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.parent.sessionDigest]);await expect(f.reader.read(f.parent)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 // The real schema itself forbids active/unverified accounts. Preserve that
 // constraint, then exercise the legitimate unverified invitation state.
 await expect(f.pool.query("UPDATE ls_identity.accounts SET email_verified_at=NULL WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.other.id])).rejects.toMatchObject({code:"23514",constraint:"accounts_check"});
 await f.pool.query("UPDATE ls_identity.accounts SET state='invited',email_verified_at=NULL WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.other.id]);await expect(f.reader.read(f.other)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 const disabled=await f.account("parent");await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,disabled.id]);await expect(f.reader.read(disabled)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
test("current guardian removal and global revocation hide context; lesson-only revocation does not redefine guardianship",async()=>{
 const f=await fixture(),learner=await f.person("minor","Synthetic child");await f.guardian(learner);
 await f.revoke(learner,f.parent.id,"RM-101","v1");expect((await f.reader.read(f.parent,learner)).selectedLearnerId).toBe(learner);
 await f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2",[f.workspaceId,learner]);expect((await f.reader.read(f.parent)).children).toEqual([]);await expect(f.reader.read(f.parent,learner)).rejects.toMatchObject({code:"NOT_FOUND"});
 await f.pool.query("UPDATE ls_education.guardian_authorities SET active=true WHERE workspace_id=$1 AND learner_id=$2",[f.workspaceId,learner]);await f.revoke(learner,f.parent.id);expect((await f.reader.read(f.parent)).children).toEqual([]);
});
test("future/unverified source, adult subject and missing guardian are not children; broad workspace revocation wins",async()=>{
 const f=await fixture(),valid=await f.person("minor","Valid child"),future=await f.person("minor","Not yet verified"),adult=await f.person("adult","Not a child"),wrongVerifier=await f.person("minor","Unverified source");
 await f.guardian(valid);await f.guardian(future,f.parent,new Date(Date.now()+3600000));await f.guardian(adult);await f.guardian(wrongVerifier,f.parent,new Date(Date.now()-1000),f.other);await f.person("minor","No binding");
 expect((await f.reader.read(f.parent)).children.map(x=>x.learnerId)).toEqual([valid]);await f.revoke(null,null);expect((await f.reader.read(f.parent)).children).toEqual([]);
});
test("malformed ciphertext fails safely and the SQL-bound reader works inside the caller's native transaction",async()=>{
 const f=await fixture(),learner=await f.person("minor","Synthetic child");await f.guardian(learner);
 expect((await f.db.transaction(tx=>readEducationalChildContexts(tx,f.parent,f.ring,new Date(),learner))).selectedLearnerId).toBe(learner);
 await f.pool.query("UPDATE ls_identity.people SET profile_ciphertext='PRIVATE_INVALID_CIPHERTEXT_CANARY' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,learner]);
 await expect(f.reader.read(f.parent)).rejects.toMatchObject({code:"UNAVAILABLE",message:"UNAVAILABLE"});
});
test("more than100 authorized children fails rather than silently returning a partial or synthetic selector",async()=>{
 const f=await fixture();for(let i=0;i<101;i++)await f.guardian(await f.person("minor",`Synthetic child ${i}`));
 await expect(f.reader.read(f.parent)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
