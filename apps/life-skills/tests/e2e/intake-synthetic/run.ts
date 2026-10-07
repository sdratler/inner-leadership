import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {createServer as httpsServer} from "node:https";
import {request as httpRequest} from "node:http";
import {randomBytes,randomUUID} from "node:crypto";
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {once} from "node:events";
import {fixture,safeTestUrl} from "../../database/calendar/fixture.ts";

if(process.env.LS_INTAKE_SYNTHETIC_BROWSER_ALLOW!=="true")throw new Error("R43_BROWSER_EXPLICIT_OPT_IN_REQUIRED");
const port=3131,tlsPort=3471,origin=`https://127.0.0.1:${tlsPort}`,databaseUrl=safeTestUrl();
const folder=mkdtempSync(join(tmpdir(),"ls-r43-intake-browser-"));
let app:ChildProcess|null=null,tests:ChildProcess|null=null,tls:ReturnType<typeof httpsServer>|null=null,f:Awaited<ReturnType<typeof fixture>>|null=null,phase="fixture",bridgeCalls=0;
async function terminate(child:ChildProcess|null){if(!child||child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([once(child,"exit"),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill("SIGKILL");}
let cleanupPromise:Promise<void>|null=null;function cleanup(){cleanupPromise??=(async()=>{await terminate(tests);if(tls){tls.closeAllConnections();await new Promise<void>(r=>tls!.close(()=>r()));}await terminate(app);await f?.pool.end();rmSync(folder,{recursive:true,force:true});})();return cleanupPromise;}
process.once("SIGTERM",()=>{void cleanup().finally(()=>process.exit(143));});process.once("SIGINT",()=>{void cleanup().finally(()=>process.exit(130));});
try{
 const workspaceId=randomUUID(),dataKey=randomBytes(32),lookupKey=randomBytes(32),keyring={activeKeyId:"synthetic",keys:{synthetic:dataKey}};
 f=await fixture({workspaceId,keyring,demoFirst:true});
 const effectTables=["ls_calendar.availability","ls_calendar.appointments","ls_calendar.notices","ls_calendar.credit_exceptions","ls_calendar.events","ls_calendar.commands","ls_calendar.history","ls_calendar.tasks","ls_calendar.task_history","ls_payments.charges","ls_payments.payments","ls_payments.allocations","ls_payments.credit_blocks","ls_payments.credit_events","ls_payments.refunds","ls_payments.calendar_receipts","ls_payments.commands","ls_contact_ops.profiles","ls_contact_ops.legacy_links","ls_contact_ops.command_receipts","ls_contact_ops.cutover","ls_contact_ops.cutover_history","ls_contact_ops.message_receipts","ls_contact_ops.inbound_threads","ls_contact_ops.inbound_projections","ls_contact_ops.outbound_projections","ls_contact_ops.inbound_activity_candidates","ls_contact_ops.lead_promotion_operations","ls_contact_ops.acquisition_projection_status","ls_contact_ops.delta_operations","ls_contact_ops.delta_history"];
 async function effects(){const result:Record<string,unknown>={};for(const table of effectTables)result[table]=(await f!.pool.query<{rows:unknown}>(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t WHERE workspace_id=$1`,[workspaceId])).rows[0]!.rows;return result;}
 const baseline=await effects();
 const fixturePath=join(folder,"synthetic-runtime.json");writeFileSync(fixturePath,JSON.stringify({origin,practitioner:f.practitioner.token,parent:f.parent.token}),{mode:0o600});
 const key=join(folder,"tls.key"),cert=join(folder,"tls.crt"),gitOpenSsl="C:/Program Files/Git/mingw64/bin/openssl.exe",openssl=process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl";
 phase="tls-certificate";execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore"});
 const consent={version:"synthetic-browser-intake-20261008",sourceHashes:["a".repeat(64),"b".repeat(64)],displayText:["פסקת הסכמה סינתטית לבדיקה בלבד."],acknowledgements:["הצהרה אחת.","הצהרה שתיים.","הצהרה שלוש."],translations:{en:{displayText:["Synthetic consent text for testing only."],acknowledgements:["Statement one.","Statement two.","Statement three."]}}};
 const env:NodeJS.ProcessEnv={...process.env};for(const name of Object.keys(env))if(/(?:BRIDGE|WHAPI|WHATSAPP|GREEN_INVOICE|MORNING|GOOGLE|OPENAI|APIFY|SMTP|RESEND|SENDGRID|TWILIO|NOMAD)/i.test(name))delete env[name];
 Object.assign(env,{NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:origin,LS_DATABASE_URL:databaseUrl,LS_DATABASE_TLS:"disable",LS_IDENTITY_ENABLED:"true",LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_WORKSPACE_ID:workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:"synthetic",LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:dataKey.toString("base64url")}),LS_IDENTITY_CSRF_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:lookupKey.toString("base64url"),LS_IDENTITY_RATE_KEY:randomBytes(32).toString("base64url"),LS_INTAKE_REAL_DATA_RELEASE:"true",LS_INTAKE_PUBLIC_CONSENT_JSON:JSON.stringify(consent),LS_INTAKE_SYNTHETIC_FIXTURE_ENABLED:"true",LS_INTAKE_SYNTHETIC_FIXTURE_BINDING_JSON:JSON.stringify({batch:"ls-owner-20260925",accountId:f.parent.actor.id}),LS_INTAKE_SYNTHETIC_BROWSER_FIXTURE_PATH:fixturePath,LIFE_SKILLS_CRM_BRIDGE_ORIGIN:origin,LIFE_SKILLS_APP_BRIDGE_SECRET:randomBytes(32).toString("base64url")});
 phase="next-app-start";app=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{env,stdio:"ignore"});
 phase="next-health";let healthy=false;for(let i=0;i<120;i++){if(app.exitCode!==null)throw new Error("R43_APP_START_FAILED");try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!healthy)throw new Error("R43_APP_HEALTH_TIMEOUT");
 phase="tls-proxy";tls=httpsServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{if(req.url?.startsWith("/api/bna/life-skills-app/")){bridgeCalls++;res.writeHead(418,{"content-type":"application/json"});res.end('{"success":false}');return;}const upstream=httpRequest({hostname:"127.0.0.1",port,path:req.url,method:req.method,headers:{...req.headers,"x-forwarded-proto":"https"}},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});upstream.on("error",()=>{if(res.headersSent)res.destroy();else{res.writeHead(502);res.end("Isolated upstream unavailable");}});req.pipe(upstream);});tls.listen(tlsPort,"127.0.0.1");await once(tls,"listening");
 phase="browser-tests";tests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/intake-synthetic/playwright.config.ts"],{env,stdio:["ignore","inherit","inherit"]});const [code]=await once(tests,"exit");if(code!==0)throw new Error("R43_BROWSER_ACCEPTANCE_FAILED");
 const after=await effects();if(JSON.stringify(after)!==JSON.stringify(baseline))throw new Error("R43_UNEXPECTED_SIDE_EFFECT");if(bridgeCalls!==0)throw new Error("R43_CRM_EGRESS_ATTEMPTED");
 const totals=(await f.pool.query(`SELECT
  (SELECT count(*)::int FROM ls_intake.pre_enrollment_receipts WHERE workspace_id=$1) AS receipts,
  (SELECT count(*)::int FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='submission') AS markers,
  (SELECT count(*)::int FROM ls_onboarding.prospect_journeys WHERE workspace_id=$1 AND state='awaiting_payment') AS journeys`,[workspaceId])).rows[0];
 console.log(`R43_BROWSER_ACCEPTANCE_PASS ${JSON.stringify({matrix:"EN/HE x 1440/390/340",...totals,otherSideEffects:0})}`);
}catch(error){console.error(`R43 browser verification failed at ${phase}: ${error instanceof Error?error.message:"unknown"}`);process.exitCode=1;}finally{await cleanup();}
