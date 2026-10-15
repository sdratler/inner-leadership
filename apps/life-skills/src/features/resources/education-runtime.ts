import "server-only";
import type {identityRuntime} from "../identity/runtime.ts";
import {FishingLessonHttp} from "./fishing-lesson-http.ts";
import {FishingLessonJourney} from "./fishing-lesson-journey.ts";
import {FishingLessonNativeStore} from "./fishing-lesson-native-store.ts";
import {IdentitySessions} from "../identity/session-adapter.ts";
import {PostgresIdentityRateStore} from "../identity/rate-store.ts";
import {durableAuditSink} from "../identity/history.ts";

type Environment=Record<string,string|undefined>;
type Handler={handle(request:Request):Promise<Response>};
type EducationRuntime=Pick<Awaited<ReturnType<typeof identityRuntime>>,"config"|"store"|"clock">;
export const educationLessonPath="/api/resources/education/lesson";
const availabilityKeys=["NODE_ENV","CI","LS_APP_MODE","LS_APP_ORIGIN","LS_PRIVATE_APP_ENABLED","LS_IDENTITY_ENABLED",
 "LS_EDUCATION_SYNTHETIC_LOOPBACK","LS_DATABASE_URL","LS_DATABASE_TLS","TEST_DATABASE_URL","LS_MIGRATION_DATABASE_URL"] as const;
const signature=(env:Environment)=>JSON.stringify(availabilityKeys.map(key=>env[key]??null));

/** Availability only: never supplies an actor, source approval or access grant.
 * No production activation, fallback database, migration or provider action. */
export function educationRehearsalEnabled(env:Environment=process.env):boolean{
 try{
  if(env.NODE_ENV!=="development"||env.LS_APP_MODE!=="foundation_preview"||env.LS_PRIVATE_APP_ENABLED!=="true"||
   env.LS_IDENTITY_ENABLED!=="true"||env.LS_EDUCATION_SYNTHETIC_LOOPBACK!=="true"||env.LS_DATABASE_TLS!=="disable")return false;
  const origin=new URL(env.LS_APP_ORIGIN??""),database=new URL(env.LS_DATABASE_URL??"");
  if(origin.protocol!=="https:"||!["localhost","127.0.0.1"].includes(origin.hostname)||origin.username||origin.password||
   origin.pathname!=="/"||origin.search||origin.hash)return false;
  if(!["postgres:","postgresql:"].includes(database.protocol)||database.hostname!=="127.0.0.1"||database.search||database.hash||
   !database.username||!database.password||!database.port||Number(database.port)<1024)return false;
  const dedicated=database.username==="ls_synthetic"&&/^\/ls_calendar_test_[A-Za-z0-9_]+_test$/.test(database.pathname);
  const ci=env.CI==="true"&&env.LS_DATABASE_URL==="postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test";
  if(!dedicated&&!ci)return false;
  return env.TEST_DATABASE_URL===env.LS_DATABASE_URL&&
   (!env.LS_MIGRATION_DATABASE_URL||env.LS_MIGRATION_DATABASE_URL===env.LS_DATABASE_URL);
 }catch{return false;}
}

/** Uses the retained native store/identity and exact catch-all, not a test API. */
export function composeEducationResources(regular:Handler,identity:EducationRuntime,env:Environment=process.env):Handler{
 if(!educationRehearsalEnabled(env)||identity.config.origin!==new URL(env.LS_APP_ORIGIN!).origin)return regular;
 const boundStore=identity.store.bindDatabaseTarget?.(env.LS_DATABASE_URL!);
 if(!boundStore)return regular;
 const admittedSignature=signature(env);
 const education=new FishingLessonHttp({config:identity.config,sessions:new IdentitySessions(boundStore,identity.config,identity.clock),limits:new PostgresIdentityRateStore(boundStore),
  audit:durableAuditSink(boundStore),clock:identity.clock},actor=>new FishingLessonJourney(
   new FishingLessonNativeStore(boundStore,identity.config.keyring,actor,identity.clock,{childAccountsEnabled:identity.config.childAccountsEnabled===true}),
   ()=>identity.clock.now()));
 return {handle(request){
  // Do not continue on cached native/config identity after availability drift.
  if(!educationRehearsalEnabled(env)||signature(env)!==admittedSignature||new URL(request.url).pathname!==educationLessonPath)
   return regular.handle(request);
  return education.handle(request);
 }};
}
