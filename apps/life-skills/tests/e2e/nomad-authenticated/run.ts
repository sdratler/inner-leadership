import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {once} from "node:events";
import {writeFileSync,createWriteStream,existsSync,mkdirSync,readFileSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {ownedDatabase,origin} from "./guards.ts";
import {request} from "@playwright/test";
import {fixture,poolStore,safeTestUrl} from "../../database/calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {AcquisitionDecisionStore} from "../../../src/features/contact-ops/server/acquisition-decisions.ts";
import {CallEventsStore} from "../../../src/features/contact-ops/server/call-events-store.ts";
import {callEventSchema} from "../../../src/features/contact-ops/core/call-events.ts";
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
process.chdir(appRoot);
const root=ownedDatabase(process.env,safeTestUrl()),folder=join(root,"browser");mkdirSync(folder);
const source=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const openssl=process.env.R18_OPENSSL;
if(!openssl||!existsSync(openssl))throw Error("R18_OPENSSL_BINARY_REQUIRED");
let app:ChildProcess|null=null,tests:ChildProcess|null=null,f:Awaited<ReturnType<typeof fixture>>|null=null;
async function stop(p:ChildProcess|null){if(!p||p.exitCode!==null)return;p.kill("SIGTERM");await Promise.race([once(p,"exit"),new Promise(r=>setTimeout(r,5000))]);if(p.exitCode===null)p.kill("SIGKILL");}
const q=(s:string)=>'"'+s.replaceAll('"','""')+'"';
async function snapshot(){const out:Record<string,string>={};const tables=await f!.pool.query<{schema:string;table:string}>(`SELECT c.table_schema AS schema,c.table_name AS table FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.column_name='workspace_id' AND c.table_schema LIKE 'ls_%' AND t.table_type='BASE TABLE' ORDER BY 1,2`);for(const t of tables.rows){const r=await f!.pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text),'[]'::jsonb)::text AS state FROM ${q(t.schema)}.${q(t.table)} s WHERE workspace_id=$1`,[f!.workspaceId]);out[t.schema+"."+t.table]=r.rows[0].state;}return out;}
try{
 const lookupKey=randomBytes(32),key=lookupKey.toString("hex");
 f=await fixture();const db=poolStore(f.pool),actor=f.practitioner.actor,authority=new ContactCutoverStore(db,f.keyring,key),crm=new OperationalNativeCrmStore(db,f.keyring,key),decisions=new AcquisitionDecisionStore(db,f.keyring,key);
 const proof=(epoch:number):CutoverEvidence=>({batchId:"synthetic-r18-auth",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
 for(const [i,action] of ["prepare","freeze","switch_native"].entries())await authority.advance(actor,{action:action as "prepare"|"freeze"|"switch_native",proof:proof(i),operationId:"synthetic-"+action});
 const cases:Record<string,{candidateId:string;personId:string;phone:string;name:string}>={};
 const create=(phone:string,name:string)=>crm.createContact(actor,{name,phone,language:"he",source:"Owner entered",notes:"Synthetic preserved note",nextAction:"Keep synthetic next action",dueDate:"2026-10-09"},randomUUID(),3);
 await create("+15550001999","Synthetic unrelated control");
 let n=0;
 for(const project of ["desktop","mobile390"])for(const locale of ["en","he"]){n++;const phone="+97255555010"+n,name="Synthetic "+project+" "+locale;
 const person=await create(phone,name);const calls=new CallEventsStore(db,f.workspaceId,"00000000-0000-4000-8000-000000000018",f.keyring,key);
 await calls.capture(callEventSchema.parse({source:"android_nomad",from:phone,contact:name,timestamp:String(Date.now()-60000*n),duration:"0"}));
 const found=(await decisions.list(actor,3,{page:1,search:phone})).items[0]!;
 if(found.state!=="NEEDS_REVIEW"||found.matching.people[0]?.personId!==person.personId)throw Error("INITIAL_QUARANTINE_FAILED");
 cases[project+"-"+locale]={candidateId:found.id,personId:person.personId,phone,name};}
 if((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.call_activity_links WHERE workspace_id=$1",[f.workspaceId])).rows[0].n!==0)throw Error("AUTO_LINK_DETECTED");
 const before=await snapshot();writeFileSync(join(folder,"before.private.json"),JSON.stringify(before));
 const runtimePath=join(folder,"runtime.private.json");writeFileSync(runtimePath,JSON.stringify({kind:"r18-authenticated-local",origin,practitioner:f.practitioner.token,parent:f.parent.token,cases}),{mode:0o600});
 const keyFile=join(folder,"tls.key"),cert=join(folder,"tls.crt");execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyFile,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore"});
 const env:NodeJS.ProcessEnv={...process.env};for(const k of Object.keys(env))if(k.startsWith("LS_")||/DATABASE_URL|WHAPI|GOOGLE|OPENAI|ANTHROPIC|RAILWAY|TOKEN|SECRET|API_KEY/i.test(k))delete env[k];
 Object.assign(env,{NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:origin,LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:"disable",LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_ENABLED:"true",LS_IDENTITY_WORKSPACE_ID:f.workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:f.keyring.activeKeyId,LS_IDENTITY_DATA_KEYS:JSON.stringify({[f.keyring.activeKeyId]:f.keyring.keys[f.keyring.activeKeyId]!.toString("base64url")}),LS_IDENTITY_CSRF_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:lookupKey.toString("base64url"),LS_IDENTITY_RATE_KEY:randomBytes(32).toString("base64url"),R18_FIXTURE:runtimePath,R18_EGRESS_LOG:join(folder,"egress.log")});
 const log=createWriteStream(join(folder,"app.log"));app=spawn(process.execPath,["--require",resolve("tests/e2e/nomad-authenticated/egress.cjs"),resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--experimental-https","--experimental-https-key",keyFile,"--experimental-https-cert",cert,"--hostname","127.0.0.1","--port","3487"],{env,stdio:["ignore","pipe","pipe"]});app.stdout!.pipe(log);app.stderr!.pipe(log);
 const probe=await request.newContext({baseURL:origin,ignoreHTTPSErrors:true});let ready=false;try{for(let i=0;i<240;i++){if(app.exitCode!==null)throw Error("APP_START_FAILED");try{if((await probe.get("/api/health",{timeout:1000})).status()===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}}finally{await probe.dispose();}if(!ready)throw Error("APP_HEALTH_TIMEOUT");
 tests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/nomad-authenticated/playwright.config.ts"],{env,stdio:["ignore","inherit","inherit"]});
 const [code]=await once(tests,"exit");
 const after=await snapshot();writeFileSync(join(folder,"after.private.json"),JSON.stringify(after));
 const changed=Object.keys(before).filter(k=>before[k]!==after[k]),allowed=["ls_contact_ops.call_activity_links","ls_contact_ops.lead_promotion_operations","ls_contact_ops.acquisition_projection_status","ls_contact_ops.cutover"];
 const unintended=changed.filter(k=>!allowed.includes(k));
 const links=await f.pool.query("SELECT candidate_id,person_id FROM ls_contact_ops.call_activity_links WHERE workspace_id=$1 ORDER BY candidate_id",[f.workspaceId]);
 const counts=await f.pool.query("SELECT (SELECT count(*)::int FROM ls_contact_ops.lead_promotion_operations WHERE workspace_id=$1) AS operations,(SELECT count(*)::int FROM ls_contact_ops.acquisition_projection_status WHERE workspace_id=$1 AND state='pending' AND reason='provider_not_verified') AS pending",[f.workspaceId]);
 const expected=Object.values(cases).map(x=>({candidate_id:x.candidateId,person_id:x.personId})).sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id));
 const summary={source,browserExit:code,changedTables:changed,unintendedTables:unintended,links:links.rows,expectedLinks:expected,counts:counts.rows[0],externalServerAttempts:existsSync(join(folder,"egress.log"))?readFileSync(join(folder,"egress.log"),"utf8"):"",pendingReview:(await decisions.list(actor,3,{page:1,search:""})).total};
 writeFileSync(join(folder,"result.json"),JSON.stringify(summary,null,2));if(code!==0||unintended.length||JSON.stringify(links.rows)!==JSON.stringify(expected)||counts.rows[0].operations!==4||counts.rows[0].pending!==8||summary.externalServerAttempts.split("\n").filter(Boolean).some(line=>line!=="BLOCKED registry.npmjs.org"))throw Error("ACCEPTANCE_OR_BOUNDARY_FAILED");
 console.log("R18_AUTHENTICATED_ACCEPTANCE_PASS four matches, four exact replays, no unrelated workspace changes");
}catch(e){console.error(e instanceof Error?e.stack:e);process.exitCode=1;}
finally{await stop(tests);await stop(app);await f?.pool.end();console.log("R18_APP_AND_BROWSER_STOPPED");}
