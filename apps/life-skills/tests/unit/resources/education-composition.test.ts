import {expect,test,vi} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {composeEducationResources,educationRehearsalEnabled} from "../../../src/features/resources/education-runtime.ts";
import {parseIdentityConfig} from "../../../src/features/identity/config.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
const db="postgresql://ls_synthetic:synthetic-only@127.0.0.1:54329/ls_calendar_test_education_fixture_test";
const environment=()=>({NODE_ENV:"development",LS_APP_MODE:"foundation_preview",LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_ENABLED:"true",
 LS_APP_ORIGIN:"https://localhost:3105",LS_EDUCATION_SYNTHETIC_LOOPBACK:"true",LS_DATABASE_TLS:"disable",LS_DATABASE_URL:db,
 TEST_DATABASE_URL:db,LS_MIGRATION_DATABASE_URL:db});
test("explicit disposable development HTTPS loopback gate does not confer identity or grant",()=>{
 expect(educationRehearsalEnabled(environment())).toBe(true);expect(educationRehearsalEnabled({})).toBe(false);
});
test.each([
 {NODE_ENV:"production"},{NODE_ENV:"test"},{LS_APP_MODE:"foundation_locked"},{LS_PRIVATE_APP_ENABLED:"false"},{LS_IDENTITY_ENABLED:"false"},
 {LS_EDUCATION_SYNTHETIC_LOOPBACK:"false"},{LS_DATABASE_TLS:"verify"},{LS_APP_ORIGIN:"https://life-skills.bneineviimacademy.org"},
 {LS_APP_ORIGIN:"http://localhost:3105"},{LS_APP_ORIGIN:"https://user:password@localhost:3105"},{LS_APP_ORIGIN:"https://localhost:3105/private"},
 {LS_APP_ORIGIN:"https://localhost:3105?bypass=true"},{LS_APP_ORIGIN:"not a URL"},{LS_DATABASE_URL:db.replace("127.0.0.1","db.example.invalid")},
 {LS_DATABASE_URL:db.replace("_fixture_test","_production")},{LS_DATABASE_URL:db+"?sslmode=disable"},{TEST_DATABASE_URL:""},
 {LS_MIGRATION_DATABASE_URL:db.replace("fixture","other")},{LS_DATABASE_URL:db.replace("ls_synthetic:","postgres:")},
])("unadmitted or mixed configuration %j is closed",delta=>expect(educationRehearsalEnabled({...environment(),...delta})).toBe(false));
test("only the existing exact credential-free CI fixture can use its migration test name",()=>{
 const url="postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test";
 const env={...environment(),CI:"true",LS_DATABASE_URL:url,TEST_DATABASE_URL:url,LS_MIGRATION_DATABASE_URL:url};
 expect(educationRehearsalEnabled(env)).toBe(true);expect(educationRehearsalEnabled({...env,CI:"false"})).toBe(false);
});
function runtime(env:ReturnType<typeof environment>){
 const key=()=>randomBytes(32).toString("base64url");
 const config=parseIdentityConfig({...env,LS_IDENTITY_WORKSPACE_ID:randomUUID(),LS_IDENTITY_ACTIVE_KEY_ID:"synthetic",
  LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:key()}),LS_IDENTITY_CSRF_KEY:key(),LS_IDENTITY_LOOKUP_KEY:key(),LS_IDENTITY_RATE_KEY:key()});
 return {config,clock:systemClock,store:{transaction:vi.fn(async()=>{throw Error("UNEXPECTED_SYNTHETIC_SQL");})},
  services:{sessions:{actor:vi.fn(async()=>{throw Error("UNEXPECTED_SYNTHETIC_SESSION");}),csrf:()=>"synthetic"},
   limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:1000}))},audit:{write:vi.fn(async()=>{})}}};
}
test("production/mismatched origin composition stays the original handler without SQL",async()=>{
 const env=environment(),identity=runtime(env),regular={handle:vi.fn(async()=>new Response(null,{status:404}))};
 expect(composeEducationResources(regular,identity,{...env,NODE_ENV:"production"})).toBe(regular);
 identity.config={...identity.config,origin:"https://wrong.example.invalid"};expect(composeEducationResources(regular,identity,env)).toBe(regular);
 expect(identity.store.transaction).not.toHaveBeenCalled();
});
test("ordinary resource URLs pass through unchanged; education never bypasses the ordinary session",async()=>{
 const env=environment(),identity=runtime(env),regular={handle:vi.fn(async()=>new Response("regular",{status:404}))},composed=composeEducationResources(regular,identity,env);
 const ordinary=new Request(env.LS_APP_ORIGIN+"/api/resources");expect(await (await composed.handle(ordinary)).text()).toBe("regular");expect(regular.handle).toHaveBeenCalledWith(ordinary);
 expect((await composed.handle(new Request(env.LS_APP_ORIGIN+"/api/resources/education/lesson"))).status).toBe(401);
 expect(identity.store.transaction).not.toHaveBeenCalled();expect(identity.services.sessions.actor).not.toHaveBeenCalled();
});
test("a changed but otherwise valid disposable target cannot reuse a cached composition",async()=>{
 const env=environment(),identity=runtime(env),regular={handle:vi.fn(async()=>new Response(null,{status:404}))},composed=composeEducationResources(regular,identity,env);
 env.LS_DATABASE_URL=db.replace("fixture","other");env.TEST_DATABASE_URL=env.LS_DATABASE_URL;env.LS_MIGRATION_DATABASE_URL=env.LS_DATABASE_URL;
 expect(educationRehearsalEnabled(env)).toBe(true);expect((await composed.handle(new Request(env.LS_APP_ORIGIN+"/api/resources/education/lesson"))).status).toBe(404);
 expect(regular.handle).toHaveBeenCalledOnce();expect(identity.store.transaction).not.toHaveBeenCalled();
});
