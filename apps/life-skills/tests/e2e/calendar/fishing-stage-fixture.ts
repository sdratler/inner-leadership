/** Authoring-only until the exact source/SQL/runner/target recipe is admitted.
 * No schema/cluster/provider setup. Ordinary synthetic credentials, not sessions. */
import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {request as httpsRequest} from "node:https";
import {createServer as netServer} from "node:net";
import {randomUUID,createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync,lstatSync,rmSync} from "node:fs";
import {resolve,join,dirname,basename} from "node:path";
import {once} from "node:events";
import {programFixture,type ProgramFixture} from "../../database/fishing/native-program-fixture.ts";
import {safeTestUrl} from "../../database/calendar/fixture.ts";
import {fishingCivilTime,type FishingCalendarSelection} from "../../../src/features/fishing/program-calendar-contract.ts";
import {opaqueRateLimitKey} from "../../../src/lib/security/rate-limit.ts";
import {FISHING_STAGE_PROJECTS,parseFishingStageReport,runFishingStageIsolation,type FishingStageGroupResult,type FishingStageScope,type FishingStageSelectedReport} from "./fishing-stage-isolation.ts";

export type FishingStageBrowserData={origin:string;workspaceId:string;occurrenceId:string;pastOccurrenceId:string;date:string;lessonSourceSha256:string;
 credentials:{role:string;email:string;password:string;accountId:string}[];families:Record<string,{selection:FishingCalendarSelection;otherLearnerId:string}>};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const protectedTables=["ls_cases.cases","ls_cases.case_guardians","ls_calendar.appointments","ls_payments.charges","ls_payments.credit_events","ls_fishing_payments.outbox","ls_education.account_grants","ls_contact_ops.profiles","ls_contact_ops.outbound_projections","ls_onboarding.first_session_orders","ls_identity.auth_mail_outbox"];
async function snapshot(f:ProgramFixture){return Promise.all(protectedTables.map(async table=>({table,digest:hash(JSON.stringify((await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows))})));}
async function freePort(port:number){const s=netServer();await new Promise<void>((ok,no)=>{s.once("error",no);s.listen(port,"127.0.0.1",ok);});await new Promise<void>((ok,no)=>s.close(error=>error?no(error):ok()));}
async function terminate(child:ChildProcess|null){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 if(process.platform==="win32"&&child.pid){
  // taskkill may report a nonzero status after the owned child has exited.
  // Keep its exit event flowing and require both processes to finish.
  let onExit=()=>{},onClose=()=>{},onError:(error:Error)=>void=()=>{},timer:ReturnType<typeof setTimeout>|undefined,killer:ChildProcess|null=null;
  const exited=new Promise<void>(ok=>{onExit=ok;child.once("exit",onExit);});
  try{
   killer=spawn("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
   const closed=new Promise<void>((ok,no)=>{onClose=ok;onError=no;killer!.once("close",onClose);killer!.once("error",onError);});
   await Promise.race([Promise.all([closed,exited]),new Promise<never>((_,no)=>{timer=setTimeout(()=>no(Error("FISHING_OWNED_CHILD_EXIT_UNCONFIRMED")),5000);})]);
  }finally{if(timer)clearTimeout(timer);child.removeListener("exit",onExit);if(killer){killer.removeListener("close",onClose);killer.removeListener("error",onError);if(killer.exitCode===null&&killer.signalCode===null)killer.kill();}}
  return;
 }
 const waitForExit=async()=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  let timer:ReturnType<typeof setTimeout>|undefined;const exited=once(child,"exit");
  try{await Promise.race([exited,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(Error("FISHING_OWNED_CHILD_EXIT_UNCONFIRMED")),5000);})]);}finally{if(timer)clearTimeout(timer);}
 };
 child.kill("SIGTERM");try{await waitForExit();}catch{if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");await waitForExit();}
}
/** Only this invocation's validated fresh temp tree, never its parent or DB. */
function removeOwnedTemp(folder:string,parent:string){
 const realParent=realpathSync(parent),real=realpathSync(folder);
 if(lstatSync(folder).isSymbolicLink()||dirname(real)!==realParent||!/^stage-browser-[A-Za-z0-9_-]+$/.test(basename(real)))throw Error("FISHING_TEMP_CLEANUP_SCOPE_INVALID");
 rmSync(real,{recursive:true,force:false});
}
async function learnerAccess(f:ProgramFixture,learners:readonly {parentId:string;learnerId:string}[]){
 const moduleId="RM-101",version="synthetic-lesson-v1";
 const row=(await f.pool.query<{module_id:string;sourceSha256:string}>("SELECT module_id,source_sha256 AS \"sourceSha256\" FROM ls_education.catalog_versions WHERE workspace_id=$1 AND module_id=$2 AND version=$3 AND approval_provenance='SYNTHETIC_READABLE_NOT_REAL_APPROVAL'",[f.workspaceId,moduleId,version])).rows;
 if(row.length!==1||!/^[a-f0-9]{64}$/.test(row[0]!.sourceSha256))throw Error("INSERT_FIRST_SYNTHETIC_CATALOG_REQUIRED");
 for(const learner of learners){
  await f.pool.query("INSERT INTO ls_education.educational_assignments(workspace_id,learner_id,module_id,version,active,assigned_by) VALUES($1,$2,$3,$4,true,$5)",[f.workspaceId,learner.learnerId,moduleId,version,f.owner.id]);
  for(const[accountId,permissions]of[[learner.parentId,["submit","read_learner","read_parent"]],[f.owner.id,["observe","publish_parent_summary","read_teacher"]]]as const)
   await f.pool.query("INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,$4,$5,true,$6::text[],$7)",[f.workspaceId,accountId,learner.learnerId,moduleId,version,[...permissions],f.owner.id]);
 }
 return row[0]!.sourceSha256;
}
export async function runFishingStageBrowser(){
 if(process.env.LS_RM_FISHING_STAGE_UI_ONLY!=="true"||process.env.LS_CALENDAR_TEST_SHARED_ROUTES_ACCEPTED!=="true"||process.env.LS_RM_PROGRAM_NATIVE_ALLOW!=="MAIN_REGISTERED_ONLY")throw Error("REGISTERED_FISHING_UI_RECIPE_REQUIRED");
 const requestedProject=process.env.LS_CALENDAR_TEST_PROJECT,index=(FISHING_STAGE_PROJECTS as readonly string[]).indexOf(requestedProject??"");if(index<0)throw Error("EXACT_FISHING_BROWSER_PROJECT_REQUIRED");const project=FISHING_STAGE_PROJECTS[index]!;
 const database=safeTestUrl(),target=new URL(database);if(target.username!=="ls_synthetic")throw Error("EXACT_SYNTHETIC_DATABASE_ROLE_REQUIRED");
 // Next loads dotenv independently of child environment. Refuse, do not edit it.
 for(const root of[resolve("."),resolve("../..")])for(const name of[".env",".env.local",".env.development",".env.development.local"])if(existsSync(join(root,name)))throw Error("DOTENV_MUST_BE_ABSENT_BEFORE_SYNTHETIC_APP");
 const port=3143+index,tlsPort=3445+index,origin=`https://127.0.0.1:${tlsPort}`;
 const outputParent=resolve("tests/e2e/calendar/test-results");mkdirSync(outputParent,{recursive:true});const output=join(outputParent,`fishing-stage-${project}-${randomUUID()}`);mkdirSync(output,{recursive:false});
 return runFishingStageIsolation(project,async(group,admitScope)=>{
 await freePort(port);await freePort(tlsPort);
 const groupOutput=join(output,group.id);mkdirSync(groupOutput,{recursive:false});
 const parent="D:/life-skills-fishing-fixtures-20261012";mkdirSync(parent,{recursive:true});const folder=mkdtempSync(join(parent,"stage-browser-"));
 let app:ChildProcess|null=null,tests:ChildProcess|null=null,f:ProgramFixture|null=null,baseline:Awaited<ReturnType<typeof snapshot>>|null=null;
 let stopTestsPromise:Promise<void>|null=null,stopAppPromise:Promise<void>|null=null,cleanupPromise:Promise<void>|null=null;
 let interrupted=false,primaryFailed=false,primary:unknown,cleanupFailed=0,cleanupFirst:unknown;
 let scope:FishingStageScope|undefined,report:FishingStageSelectedReport|undefined,networkBucket:FishingStageGroupResult["networkBucket"]|undefined;
 const protectedEffects={tableCount:protectedTables.length,success:false,closeout:false},cleaned={tests:false,app:false,fixture:false,privateTemp:false};
 const stopTests=()=>stopTestsPromise??=terminate(tests),stopApp=()=>stopAppPromise??=terminate(app);
 const ensureActive=()=>{if(interrupted)throw Error("FISHING_STAGE_BROWSER_INTERRUPTED");};
 // An interrupt requests termination of the current owned children. The normal
 // finally still awaits setup/work settlement, both readback/cleanup boundaries,
 // and every cleanup step. It never races pool/temp teardown against setup.
 const signal=()=>{interrupted=true;if(tests)void stopTests().catch(()=>undefined);if(app)void stopApp().catch(()=>undefined);};
 process.once("SIGTERM",signal);process.once("SIGINT",signal);
 const cleanup=()=>cleanupPromise??=(async()=>{
  const attempt=async(work:()=>Promise<void>|void)=>{try{await work();}catch(error){if(cleanupFailed===0)cleanupFirst=error;cleanupFailed++;}};
  await attempt(async()=>{await stopTests();cleaned.tests=true;});
  await attempt(async()=>{await stopApp();cleaned.app=true;});
  // Keep the second eleven-table comparison, now after owned child shutdown.
  await attempt(async()=>{if(f&&baseline){if(JSON.stringify(await snapshot(f))!==JSON.stringify(baseline))throw Error("FISHING_STAGE_PROTECTED_EFFECT_CHANGED_ON_CLOSEOUT");protectedEffects.closeout=true;}});
  await attempt(async()=>{await f?.close();cleaned.fixture=true;});
  await attempt(()=>{removeOwnedTemp(folder,parent);cleaned.privateTemp=true;});
 })();
 let phase="fixture-program-catalog";
 try{
  f=await programFixture({capacity:2,childAccountsEnabled:true,confirmation:{kind:"all_native_dues_paid"},readableRm101:"SYNTHETIC_ONLY"});ensureActive();
  // programFixture creates both values randomly for this complete group. Only a
  // one-way fingerprint leaves this closure; no midjourney key rotation or
  // rate-counter mutation. The retained setup-session revocation stays below.
  scope={workspaceId:f.workspaceId,rateScopeFingerprint:hash(f.config.rateLimitKey)};admitScope(scope);
  const fixture=f,plan=await f.createPlan(),credentials:FishingStageBrowserData["credentials"]=[{role:"practitioner",accountId:f.owner.id,email:`${f.owner.id}@example.invalid`,password:"Ab12cd"}],families:FishingStageBrowserData["families"]={},learners:{parentId:string;learnerId:string}[]=[];
  phase="fixture-families";
  const outsiders=await f.family();
  for(const locale of["en","he"]){
   ensureActive();
   const family=await f.family(),purchase=await f.prepare(family);await f.settle(purchase);const enrollment=await f.enroll(purchase),child=await f.account("child",family.learnerId);
   // The native server derives lesson hrefs from the current account locale.
   // Credential labels alone do not make this a Hebrew family.
   const accounts=await f.pool.query<{id:string;role:string;locale:string}>("UPDATE ls_identity.accounts SET locale=$3 WHERE workspace_id=$1 AND id=ANY($2::uuid[]) RETURNING id,role,locale",[f.workspaceId,[family.parent.id,child.id],locale]);
   if(accounts.rows.length!==2||![[family.parent.id,"parent"],[child.id,"child"]].every(([id,role])=>accounts.rows.some(row=>row.id===id&&row.role===role&&row.locale===locale)))throw Error("FISHING_STAGE_FIXTURE_ACCOUNT_LOCALE_MISMATCH");
   for(const[role,actor]of[["parent-"+locale,family.parent],["child-"+locale,child]]as const)credentials.push({role,accountId:actor.id,email:`${actor.id}@example.invalid`,password:"Ab12cd"});
   families[locale]={selection:{learnerId:family.learnerId,enrollmentId:enrollment.result.id,reference:f.ref},otherLearnerId:outsiders.learnerId};learners.push({parentId:family.parent.id,learnerId:family.learnerId});
  }
  const adult=await f.account("adult_client");credentials.push({role:"adult_client",accountId:adult.id,email:`${adult.id}@example.invalid`,password:"Ab12cd"});
  phase="fixture-materials-access";const lessonSourceSha256=await learnerAccess(f,learners);phase="fixture-schedule";const startsAt=f.at(48);await f.revise(plan.occurrences[0]!.id,startsAt,f.at(49));await f.revise(plan.occurrences[1]!.id,f.at(-.5),f.at(-.1));await f.publish();
  // Both locale families belong to THIS group's one shared cohort. In the
  // operator group their final readbacks therefore compare the same revision.
  if(!["en","he"].every(locale=>families[locale]?.selection.reference.cohortId===f!.ref.cohortId&&families[locale]?.selection.reference.stageId===f!.ref.stageId))throw Error("FISHING_STAGE_SHARED_COHORT_REQUIRED");
  const data:FishingStageBrowserData={origin,lessonSourceSha256,workspaceId:f.workspaceId,credentials,families,occurrenceId:plan.occurrences[0]!.id,pastOccurrenceId:plan.occurrences[1]!.id,date:fishingCivilTime(startsAt).date};baseline=await snapshot(f);ensureActive();
  // Revoke setup-service sessions: each browser role must log in ordinarily.
  await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1",[f.workspaceId]);
  const runtimeFile=join(folder,"private-runtime.json");writeFileSync(runtimeFile,JSON.stringify(data),{mode:0o600,flag:"wx"});
  const key=join(folder,"tls.key"),cert=join(folder,"tls.crt"),gitOpenSsl="C:/Program Files/Git/mingw64/bin/openssl.exe";phase="local-tls";
  execFileSync(process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore",windowsHide:true});
  const env:NodeJS.ProcessEnv={NODE_ENV:"development"};for(const name of["SystemRoot","WINDIR","TEMP","TMP","PATH","ComSpec","PATHEXT","USERPROFILE","LOCALAPPDATA","APPDATA","ProgramFiles","ProgramFiles(x86)"])if(process.env[name])env[name]=process.env[name];
  Object.assign(env,{NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:origin,LS_DATABASE_URL:database,TEST_DATABASE_URL:database,LS_MIGRATION_DATABASE_URL:database,LS_DATABASE_TLS:"disable",LS_PRIVATE_APP_ENABLED:"true",LS_CALENDAR_ENABLED:"true",LS_IDENTITY_ENABLED:"true",LS_CHILD_ACCOUNTS_ENABLED:"true",LS_EDUCATION_SYNTHETIC_LOOPBACK:"true",LS_IDENTITY_WORKSPACE_ID:f.workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:f.ring.activeKeyId,LS_IDENTITY_DATA_KEYS:JSON.stringify(Object.fromEntries(Object.entries(f.ring.keys).map(([id,value])=>[id,value.toString("base64url")]))),LS_IDENTITY_CSRF_KEY:f.config.csrfKey.toString("base64url"),LS_IDENTITY_LOOKUP_KEY:f.config.lookupKey.toString("base64url"),LS_IDENTITY_RATE_KEY:Buffer.from(f.config.rateLimitKey,"hex").toString("base64url")});
  // Next owns TLS AND development WebSocket upgrades, as in the retained
  // group-interest harness. No HTTP-only proxy or custom upgrade implementation.
  phase="retained-next-source";ensureActive();app=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"dev","--experimental-https","--experimental-https-key",key,"--experimental-https-cert",cert,"--hostname","127.0.0.1","--port",String(tlsPort)],{env,stdio:"ignore",windowsHide:true});
  let appSpawnFailed=false;app.once("error",()=>{appSpawnFailed=true;});
  const healthCa=readFileSync(cert),probeHealth=()=>new Promise<boolean>((ok,no)=>{const probe=httpsRequest(new URL("/api/health",origin),{ca:healthCa},response=>{response.resume();ok(response.statusCode===200);});probe.once("error",no);probe.setTimeout(2000,()=>probe.destroy(Error("SYNTHETIC_HEALTH_PROBE_TIMEOUT")));probe.end();});
  let healthy=false;for(let i=0;i<200;i++){ensureActive();if(appSpawnFailed||app.exitCode!==null||app.signalCode!==null)throw Error("SYNTHETIC_NEXT_EXITED");try{if(await probeHealth()){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!healthy)throw Error("SYNTHETIC_NEXT_HEALTH_TIMEOUT");ensureActive();
  phase="ordinary-role-browser";const reportFile=join(groupOutput,"report.json");
  const testEnv:NodeJS.ProcessEnv={...env,NODE_ENV:"test",LS_RM_FISHING_STAGE_UI_ONLY:"true",LS_FISHING_STAGE_FIXTURE_PATH:runtimeFile,LS_CALENDAR_TEST_PROJECT:project,LS_CALENDAR_TEST_ALLOW:"true",LS_RM_PROGRAM_NATIVE_ALLOW:"MAIN_REGISTERED_ONLY",PLAYWRIGHT_JSON_OUTPUT_FILE:reportFile};
  if(process.env.LS_APP_MODE===undefined)delete testEnv.LS_APP_MODE;else testEnv.LS_APP_MODE=process.env.LS_APP_MODE;
  ensureActive();const startedTests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/calendar/playwright.config.ts","--project",project,"--grep",group.grep,"--max-failures=1","--reporter=list,json","--output",join(groupOutput,"results")],{env:testEnv,stdio:["ignore","inherit","inherit"],windowsHide:true});tests=startedTests;const[code]=await once(startedTests,"close");ensureActive();if(code!==0)throw Error("FISHING_STAGE_BROWSER_FAILED");
  phase="selected-report-readback";report=parseFishingStageReport(JSON.parse(readFileSync(reportFile,"utf8")),group,project);
  phase="network-bucket-readback";
  // Exact default network subject and production HMAC helper. Parameterized
  // read only; never print the key, reset/expire a row or change a rate limit.
  const networkRows=(await fixture.pool.query<{count:number;windowMs:number}>("SELECT count,window_ms AS \"windowMs\" FROM ls_identity.rate_counters WHERE key_digest=$1",[opaqueRateLimitKey("network:unattributed-shared-network",fixture.config.rateLimitKey)])).rows;
  if(networkRows.length!==1||!Number.isSafeInteger(networkRows[0]!.count)||networkRows[0]!.count<1||networkRows[0]!.count>200||networkRows[0]!.windowMs!==900000)throw Error("FISHING_STAGE_NETWORK_BUCKET_INVALID");
  networkBucket={count:networkRows[0]!.count,windowMs:networkRows[0]!.windowMs};
  phase="protected-effects-readback";if(JSON.stringify(await snapshot(fixture))!==JSON.stringify(baseline))throw Error("FISHING_STAGE_PROTECTED_EFFECT_CHANGED");protectedEffects.success=true;
 }catch(error){primaryFailed=true;primary=error;}
 finally{try{await cleanup();}finally{process.removeListener("SIGTERM",signal);process.removeListener("SIGINT",signal);}}
 if(cleanupFailed)console.log("SYNTHETIC_FISHING_GROUP_CLEANUP "+JSON.stringify({group:group.id,failedSteps:cleanupFailed,primaryFailed}));
 if(primaryFailed||cleanupFailed||interrupted){
  const error=primaryFailed?primary:cleanupFailed?cleanupFirst:Error("FISHING_STAGE_BROWSER_INTERRUPTED");
  const code=error!==null&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)?error.code:'UNCLASSIFIED';
  throw new Error(`FISHING_STAGE_BROWSER_FAILED group=${group.id} phase=${primaryFailed?phase:interrupted?"interrupted":"owned-cleanup"} sqlstate=${code}; inspect synthetic assertions; no credentials printed`,{cause:error instanceof Error?new Error(error.name):undefined});
 }
 if(!scope||!report||!networkBucket)throw Error("FISHING_STAGE_GROUP_RECEIPT_MISSING");
 return {project,group:group.id,scope,report,protectedEffects,cleanup:cleaned,networkBucket};
 },marker=>console.log(marker));
}
