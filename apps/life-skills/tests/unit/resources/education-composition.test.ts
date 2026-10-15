import {expect,test,vi} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
vi.mock("server-only",()=>({}));
import {composeEducationResources,educationRehearsalEnabled} from "../../../src/features/resources/education-runtime.ts";
import {parseIdentityConfig} from "../../../src/features/identity/config.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {educationBrowserTestEnvironment} from "../../e2e/resources/education-fixture.ts";
import {safeTestUrl} from "../../database/calendar/fixture.ts";
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
 const originalTarget=env.LS_DATABASE_URL;
 const transaction=vi.fn(async()=>{throw Error("UNEXPECTED_SYNTHETIC_SQL");});
 const store:IdentityStore&{transaction:typeof transaction}={transaction,bindDatabaseTarget:url=>url===originalTarget?store:null};
 return {config,clock:systemClock,store,
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
test("RM-EDU-COMPOSITION-CACHED-TARGET-01: cached A before admission of valid B is denied without SQL",async()=>{
 const env=environment(),identity=runtime(env),regular={handle:vi.fn(async()=>new Response(null,{status:404}))};
 env.LS_DATABASE_URL=db.replace("fixture","target_b");env.TEST_DATABASE_URL=env.LS_DATABASE_URL;env.LS_MIGRATION_DATABASE_URL=env.LS_DATABASE_URL;
 expect(educationRehearsalEnabled(env)).toBe(true);expect(composeEducationResources(regular,identity,env)).toBe(regular);
 expect(identity.store.transaction).not.toHaveBeenCalled();
});
test("absent driver provenance is not replaced with current environment assertions",()=>{
 const env=environment(),identity=runtime(env),regular={handle:vi.fn(async()=>new Response(null,{status:404}))};
 delete identity.store.bindDatabaseTarget;expect(composeEducationResources(regular,identity,env)).toBe(regular);expect(identity.store.transaction).not.toHaveBeenCalled();
});

function fixtureUrl(env:Record<string,string|undefined>){
 const keys=["CI","TEST_DATABASE_URL","LS_MIGRATION_DATABASE_URL","LS_APP_MODE","LS_DATABASE_TLS","LS_CALENDAR_TEST_ALLOW"]as const;
 try{for(const key of keys)vi.stubEnv(key,env[key]);return safeTestUrl();}finally{vi.unstubAllEnvs();}
}
test("CI browser tests retain the strict exact fixture fallback while the app keeps its raw target",()=>{
 const ci="postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test";
 const fixture={CI:"true",NODE_ENV:"test",LS_APP_MODE:"foundation_locked",LS_DATABASE_TLS:"disable",LS_MIGRATION_DATABASE_URL:ci,LS_CALENDAR_TEST_ALLOW:"true"};
 const app={...fixture,NODE_ENV:"development",LS_APP_MODE:"foundation_preview",TEST_DATABASE_URL:ci};
 expect(()=>fixtureUrl(app)).toThrow("CALENDAR_TEST_DATABASE_NOT_DISPOSABLE_LOOPBACK");
 const browser=educationBrowserTestEnvironment(app,fixture);
 expect(Object.hasOwn(browser,"TEST_DATABASE_URL")).toBe(false);expect(browser.LS_APP_MODE).toBe("foundation_locked");expect(browser.NODE_ENV).toBe("test");expect(fixtureUrl(browser)).toBe(ci);
 expect(app.TEST_DATABASE_URL).toBe(ci);expect(app.LS_APP_MODE).toBe("foundation_preview");
});
test("local browser fixture retains its original admitted URL without changing the app",()=>{
 const fixture={NODE_ENV:"test",LS_APP_MODE:"foundation_locked",TEST_DATABASE_URL:db,LS_CALENDAR_TEST_ALLOW:"true"};
 const app={...fixture,NODE_ENV:"development",LS_APP_MODE:"foundation_preview"};
 expect(fixtureUrl(educationBrowserTestEnvironment(app,fixture))).toBe(db);expect(app.NODE_ENV).toBe("development");
});
test("restored test inputs do not admit remote or non-exact CI targets",()=>{
 const fixture={CI:"true",LS_APP_MODE:"foundation_locked",LS_DATABASE_TLS:"disable",LS_MIGRATION_DATABASE_URL:db,LS_CALENDAR_TEST_ALLOW:"true"};
 const app={...fixture,LS_APP_MODE:"foundation_preview",TEST_DATABASE_URL:db};
 expect(()=>fixtureUrl(educationBrowserTestEnvironment(app,fixture))).toThrow("CALENDAR_CI_DATABASE_NOT_EXACT_DISPOSABLE_TARGET");
 expect(()=>fixtureUrl(educationBrowserTestEnvironment(app, {...fixture,TEST_DATABASE_URL:db.replace("127.0.0.1","db.example.invalid")}))).toThrow("CALENDAR_TEST_DATABASE_NOT_DISPOSABLE_LOOPBACK");
});
test("ordinary Group Intake loader reaches its opt-in gate without importing education server-only code",()=>{
 const env:NodeJS.ProcessEnv={...Object.fromEntries(["PATH","Path","SystemRoot","WINDIR","TEMP","TMP","COMSPEC","PATHEXT"].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),NODE_ENV:"test"};
 let stderr="";try{execFileSync(process.execPath,["--import","tsx","tests/e2e/group-interest/run.ts"],{env,stdio:"pipe",timeout:10000});throw Error("GROUP_OPT_IN_GATE_MISSING");}
 catch(error){stderr=String((error as {stderr?:unknown}).stderr??"");}
 expect(stderr).toContain("GROUP_INTEREST_BROWSER_OPT_IN_REQUIRED");expect(stderr).not.toContain("This module cannot be imported from a Client Component");
});
