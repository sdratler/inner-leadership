/** Isolated authenticated browser runner for the production-disabled Group Intake candidate.
 * Requires an already-migrated, disposable loopback PostgreSQL database. It never touches
 * production, creates CRM/case records for an inquiry, or calls a provider.
 */
import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {existsSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {once} from "node:events";
import {request as playwrightRequest} from "@playwright/test";
import {fixture,safeTestUrl} from "../../database/calendar/fixture.ts";

const project=process.env.LS_GROUP_INTEREST_TEST_PROJECT;
if(project!==undefined&&!['desktop','mobile'].includes(project))throw new Error("GROUP_INTEREST_BROWSER_PROJECT_NOT_SUPPORTED");
if(process.env.LS_GROUP_INTEREST_TEST_ALLOW!=="true")throw new Error("GROUP_INTEREST_BROWSER_OPT_IN_REQUIRED");
const appPort=project==="mobile"?3106:3105,origin=`https://localhost:${appPort}`;
safeTestUrl();
const folder=mkdtempSync(join(tmpdir(),"ls-group-interest-browser-"));
let app:ChildProcess|null=null,tests:ChildProcess|null=null;
let f:Awaited<ReturnType<typeof fixture>>|null=null,phase="fixture";
async function terminate(child:ChildProcess|null){if(!child||child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([once(child,"exit"),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill("SIGKILL");}
let cleanupPromise:Promise<void>|null=null;
function cleanup(){cleanupPromise??=(async()=>{await terminate(tests);await terminate(app);await f?.pool.end();rmSync(folder,{recursive:true,force:true});})();return cleanupPromise;}
process.once("SIGTERM",()=>{void cleanup().finally(()=>process.exit(143));});
process.once("SIGINT",()=>{void cleanup().finally(()=>process.exit(130));});

type WorkspaceSnapshot={count:number;snapshot:string};
type BoundaryCounts={inquiries:number;operations:number;otherWorkspaceState:Record<string,WorkspaceSnapshot>};
const quoteIdentifier=(value:string)=>`"${value.replaceAll('"','""')}"`;
async function counts():Promise<BoundaryCounts>{
 const allowed=new Set(["ls_service_interest.inquiries","ls_service_interest.operations"]);
 const inventory=await f!.pool.query<{schema:string;table:string}>(`SELECT c.table_schema AS schema,c.table_name AS table
  FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
  WHERE c.column_name='workspace_id' AND c.table_schema LIKE 'ls\\_%' ESCAPE '\\' AND t.table_type='BASE TABLE'
  ORDER BY c.table_schema,c.table_name`);
 const otherWorkspaceState:Record<string,WorkspaceSnapshot>={};
 for(const row of inventory.rows){const name=`${row.schema}.${row.table}`;if(allowed.has(name))continue;
  const result=await f!.pool.query<WorkspaceSnapshot>(`SELECT count(*)::integer AS count,
   COALESCE(jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text),'[]'::jsonb)::text AS snapshot
   FROM ${quoteIdentifier(row.schema)}.${quoteIdentifier(row.table)} AS source WHERE workspace_id=$1`,[f!.workspaceId]);
  otherWorkspaceState[name]=result.rows[0]??{count:0,snapshot:"[]"};
 }
 const result=await f!.pool.query<{inquiries:number;operations:number}>(`SELECT
  (SELECT count(*)::integer FROM ls_service_interest.inquiries WHERE workspace_id=$1) AS inquiries,
  (SELECT count(*)::integer FROM ls_service_interest.operations WHERE workspace_id=$1) AS operations`,[f!.workspaceId]);
 return {...result.rows[0]!,otherWorkspaceState};
}

try{
 const workspaceId=randomUUID(),dataKey=randomBytes(32),lookupKey=randomBytes(32),keyring={activeKeyId:"synthetic",keys:{synthetic:dataKey}};
 f=await fixture({workspaceId,keyring,termsVersion:"Synthetic Group Interest"});
 const baseline=await counts();
 if(baseline.inquiries!==0||baseline.operations!==0)throw new Error("GROUP_INTEREST_FIXTURE_NOT_EMPTY");
 const runtimePath=join(folder,"synthetic-runtime.json");
 writeFileSync(runtimePath,JSON.stringify({origin,workspaceId,practitioner:f.practitioner.token,parent:f.parent.token}),{mode:0o600});
 const key=join(folder,"tls.key"),cert=join(folder,"tls.crt");
 phase="tls-certificate";
 const gitOpenSsl="C:/Program Files/Git/mingw64/bin/openssl.exe",openssl=process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl";
 execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore"});
 phase="next-app-start";
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:origin,
  LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:"disable",LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_ENABLED:"true",LS_GROUP_INTEREST_CANDIDATE:"true",
  LS_IDENTITY_WORKSPACE_ID:workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:"synthetic",LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:dataKey.toString("base64url")}),
  LS_IDENTITY_CSRF_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:lookupKey.toString("base64url"),LS_IDENTITY_RATE_KEY:randomBytes(32).toString("base64url"),
  LS_GROUP_INTEREST_FIXTURE_PATH:runtimePath,LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE:"true"};
 app=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--experimental-https","--experimental-https-key",key,"--experimental-https-cert",cert,"--hostname","127.0.0.1","--port",String(appPort)],{env,stdio:"ignore"});
 phase="next-health";let healthy=false;const probe=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 try{for(let i=0;i<240;i++){if(app.exitCode!==null)throw new Error("ISOLATED_APP_START_FAILED");try{if((await probe.get("/api/health")).status()===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}}finally{await probe.dispose();}
 if(!healthy)throw new Error("ISOLATED_APP_HEALTH_TIMEOUT");
 phase="browser-tests";
 const selection=project?["--project",project,"--output",`tests/e2e/group-interest/test-results/isolated-${project}`]:[];
 tests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/group-interest/playwright.config.ts",...selection],{env,stdio:["ignore","inherit","inherit"]});
 const [code]=await once(tests,"exit");if(code!==0)throw new Error("GROUP_INTEREST_BROWSER_ACCEPTANCE_FAILED");
 phase="boundary-readback";
 const after=await counts();
 if(JSON.stringify(after.otherWorkspaceState)!==JSON.stringify(baseline.otherWorkspaceState))throw new Error("GROUP_INTEREST_WORKSPACE_SIDE_EFFECT");
 if(after.inquiries!==baseline.inquiries+2||after.operations!==baseline.operations+2)throw new Error("GROUP_INTEREST_RECEIPT_COUNT_MISMATCH");
 console.log(`GROUP_INTEREST_ACCEPTANCE_PASS project=${project??"all"} inquiries=2 replays=2 rejected=2 sideEffects=0`);
}catch(error){console.error(`Group Intake browser verification failed at ${phase} (${error instanceof Error?error.message:"unknown error"}). No production or provider state was used.`);process.exitCode=1;}
finally{await cleanup();}
