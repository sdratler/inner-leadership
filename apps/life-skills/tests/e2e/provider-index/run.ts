/** Isolated authenticated R35 browser runner. Requires an already-migrated disposable loopback PostgreSQL database. */
import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {randomBytes} from "node:crypto";
import {once} from "node:events";
import {existsSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {request as playwrightRequest} from "@playwright/test";
import {fixture,safeTestUrl} from "../../database/calendar/fixture.ts";

const projects={desktop:3125,mobile390:3126,mobile340:3127} as const;
const project=process.env.LS_PROVIDER_INDEX_TEST_PROJECT as keyof typeof projects|undefined;
if(project!==undefined&&!(project in projects))throw new Error("R35_BROWSER_PROJECT_NOT_SUPPORTED");
if(process.env.LS_PROVIDER_INDEX_TEST_ALLOW!=="true")throw new Error("R35_BROWSER_OPT_IN_REQUIRED");
const appPort=projects[project??"desktop"],origin=`https://localhost:${appPort}`;
safeTestUrl();
const folder=mkdtempSync(join(tmpdir(),"ls-r35-browser-"));
let app:ChildProcess|null=null,tests:ChildProcess|null=null;
let f:Awaited<ReturnType<typeof fixture>>|null=null,phase="fixture";
async function terminate(child:ChildProcess|null){if(!child||child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([once(child,"exit"),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill("SIGKILL");}
let cleanupPromise:Promise<void>|null=null;
function cleanup(){cleanupPromise??=(async()=>{await terminate(tests);await terminate(app);await f?.pool.end();rmSync(folder,{recursive:true,force:true});})();return cleanupPromise;}
process.once("SIGTERM",()=>{void cleanup().finally(()=>process.exit(143));});process.once("SIGINT",()=>{void cleanup().finally(()=>process.exit(130));});

type WorkspaceSnapshot={count:number;snapshot:string};
const quoteIdentifier=(value:string)=>`"${value.replaceAll('"','""')}"`;
async function otherWorkspaceState(){
 const allowed=new Set(["ls_provider_index.entries","ls_provider_index.command_receipts","ls_provider_index.access_events","ls_provider_referrals.contexts"]),state:Record<string,WorkspaceSnapshot>={};
 const inventory=await f!.pool.query<{schema:string;table:string}>(`SELECT c.table_schema AS schema,c.table_name AS table
  FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
  WHERE c.column_name='workspace_id' AND c.table_schema LIKE 'ls\\_%' ESCAPE '\\' AND t.table_type='BASE TABLE' ORDER BY c.table_schema,c.table_name`);
 for(const row of inventory.rows){const name=`${row.schema}.${row.table}`;if(allowed.has(name))continue;
  const result=await f!.pool.query<WorkspaceSnapshot>(`SELECT count(*)::integer AS count,COALESCE(jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text),'[]'::jsonb)::text AS snapshot FROM ${quoteIdentifier(row.schema)}.${quoteIdentifier(row.table)} AS source WHERE workspace_id=$1`,[f!.workspaceId]);
  state[name]=result.rows[0]??{count:0,snapshot:"[]"};
 }
 return state;
}

try{
 f=await fixture();const baseline=await otherWorkspaceState();
 const runtimePath=join(folder,"synthetic-runtime.json");writeFileSync(runtimePath,JSON.stringify({origin,workspaceId:f.workspaceId,owner:f.practitioner.token,parent:f.parent.token,caseId:f.first.id}),{mode:0o600});
 const key=join(folder,"tls.key"),cert=join(folder,"tls.crt");phase="tls-certificate";
 const gitOpenSsl="C:/Program Files/Git/mingw64/bin/openssl.exe",openssl=process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl";
 execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore"});
 phase="next-app-start";const dataKey=f.keyring.keys[f.keyring.activeKeyId]!;
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:origin,LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:"disable",
  LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_ENABLED:"true",LS_PROVIDER_INDEX_ENABLED:"true",LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.practitioner.actor.id,
  LS_IDENTITY_WORKSPACE_ID:f.workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:f.keyring.activeKeyId,LS_IDENTITY_DATA_KEYS:JSON.stringify({[f.keyring.activeKeyId]:dataKey.toString("base64url")}),
  LS_IDENTITY_CSRF_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_RATE_KEY:randomBytes(32).toString("base64url"),
  LS_PROVIDER_INDEX_FIXTURE_PATH:runtimePath,LS_PROVIDER_INDEX_TEST_RUNNER_ACTIVE:"true"};
 app=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--experimental-https","--experimental-https-key",key,"--experimental-https-cert",cert,"--hostname","127.0.0.1","--port",String(appPort)],{env,stdio:"ignore"});
 phase="next-health";let healthy=false;const probe=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 try{for(let i=0;i<240;i++){if(app.exitCode!==null)throw new Error("R35_APP_START_FAILED");try{if((await probe.get("/api/health")).status()===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}}finally{await probe.dispose();}
 if(!healthy)throw new Error("R35_APP_HEALTH_TIMEOUT");
 phase="browser-tests";tests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/provider-index/playwright.config.ts","--project",project!,"--output",`tests/e2e/provider-index/test-results/isolated-${project}`],{env,stdio:["ignore","inherit","inherit"]});
 const [code]=await once(tests,"exit");if(code!==0)throw new Error("R35_BROWSER_ACCEPTANCE_FAILED");
 phase="boundary-readback";const after=await otherWorkspaceState();if(JSON.stringify(after)!==JSON.stringify(baseline))throw new Error("R35_NON_PROVIDER_SIDE_EFFECT");
 const counts=await f.pool.query<{providers:number;referrals:number;receipts:number}>(`SELECT (SELECT count(*)::integer FROM ls_provider_index.entries WHERE workspace_id=$1) AS providers,(SELECT count(*)::integer FROM ls_provider_referrals.contexts WHERE workspace_id=$1) AS referrals,(SELECT count(*)::integer FROM ls_provider_index.command_receipts WHERE workspace_id=$1) AS receipts`,[f.workspaceId]);
 if(counts.rows[0]?.providers!==2||counts.rows[0]?.referrals!==2||counts.rows[0]?.receipts!==4)throw new Error("R35_EXPECTED_WRITE_COUNTS_MISMATCH");
 console.log(`R35_BROWSER_ACCEPTANCE_PASS project=${project} providers=2 referrals=2 receipts=4 otherSideEffects=0`);
}catch(error){console.error(`R35 browser verification failed at ${phase} (${error instanceof Error?error.message:"unknown error"}). No production or provider state was used.`);process.exitCode=1;}
finally{await cleanup();}
