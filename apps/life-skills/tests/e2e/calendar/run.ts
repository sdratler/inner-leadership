/** Complete isolated browser runner. PREPARED ONLY: Codex runs after accepted shared route wiring.
 * Requires npm dependencies/build and approved migrations already completed in a separate disposable DB.
 * Does NOT edit the proxy, migrate, merge, deploy, send messages, or read real-client data.
 */
import { spawn,execFileSync, type ChildProcess } from 'node:child_process';
import { createServer as httpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { once } from 'node:events';
import { fixture,safeTestUrl } from '../../database/calendar/fixture.ts';
import { civilDate } from '../../../src/features/calendar/time.ts';
const project=process.env.LS_CALENDAR_TEST_PROJECT;
if(project!==undefined&&!['desktop','mobile'].includes(project))throw new Error('CALENDAR_BROWSER_PROJECT_NOT_SUPPORTED');
const tlsPort=project==='mobile'?3446:3445,port=project==='mobile'?3104:3103,origin=`https://127.0.0.1:${tlsPort}`;
if(process.env.LS_CALENDAR_TEST_SHARED_ROUTES_ACCEPTED!=='true')throw new Error('IR_LS030_PROXY_ACCEPTANCE_REQUIRED_NO_BYPASS');
const databaseUrl=safeTestUrl(),folder=mkdtempSync(join(tmpdir(),'ls030-private-browser-'));
let app:ChildProcess|null=null,tests:ChildProcess|null=null,tls:ReturnType<typeof httpsServer>|null=null,f:Awaited<ReturnType<typeof fixture>>|null=null;
async function terminate(child:ChildProcess|null){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}
let cleanupPromise:Promise<void>|null=null;
function cleanup(){
 cleanupPromise??=(async()=>{
  await terminate(tests);
  if(tls){tls.closeAllConnections();await new Promise<void>(r=>tls!.close(()=>r()));}
  await terminate(app);await f?.pool.end();rmSync(folder,{recursive:true,force:true});
 })();
 return cleanupPromise;
}
process.once('SIGTERM',()=>{void cleanup().finally(()=>process.exit(143));});
process.once('SIGINT',()=>{void cleanup().finally(()=>process.exit(130));});
try{
 const workspaceId=randomUUID(),dataKey=randomBytes(32),keyring={activeKeyId:'synthetic',keys:{synthetic:dataKey}};
 f=await fixture({workspaceId,keyring,termsVersion:'Product2.3'});
 const chargeId=randomUUID(),blockId=randomUUID(),creditAt=new Date(Date.now()-6*86_400_000);
 await f.pool.query(`INSERT INTO ls_payments.charges(id,workspace_id,case_id,kind,amount_minor,currency,status,due_on,created_by,created_at,paid_at)
  VALUES($1,$2,$3,'four_appointment_block',220000,'ILS','paid',$4,$5,$6,$6)`,[chargeId,workspaceId,f.first.id,creditAt.toISOString().slice(0,10),f.practitioner.actor.id,creditAt]);
 await f.pool.query(`INSERT INTO ls_payments.credit_blocks(id,workspace_id,case_id,charge_id,credits_purchased,purchase_amount_minor,currency,terms_version,purchased_at)
  VALUES($1,$2,$3,$4,4,220000,'ILS','Product2.3',$5)`,[blockId,workspaceId,f.first.id,chargeId,creditAt]);
 await f.pool.query(`INSERT INTO ls_payments.credit_events(id,workspace_id,case_id,credit_block_id,kind,delta_credits,value_minor,event_key,reason_code,actor_account_id,occurred_at)
  VALUES($1,$2,$3,$4,'purchase',4,220000,$5,'synthetic_purchase',$6,$7)`,[randomUUID(),workspaceId,f.first.id,blockId,`synthetic-credit-purchase:${blockId}`,f.practitioner.actor.id,creditAt]);
 const cases:Record<string,{futureId:string;pastId:string;futureDate:string;pastDate:string}>={};
 for(const [index,name] of ['desktop:he','desktop:en','mobile:he','mobile:en'].entries()){
  const future=f.at(72+index*3),past=f.at(-12-index*3);
  cases[name]={futureId:await f.seed(future),pastId:await f.seed(past),futureDate:civilDate(future),pastDate:civilDate(past)};
 }
 const foreignId=await f.seed(f.at(140),f.second);
 const auth=join(folder,'synthetic-runtime.json');
 // Generated test-session material exists only in a mode-0600 temporary file. Never attach it to reports.
 writeFileSync(auth,JSON.stringify({origin,cases,caseId:f.first.id,foreignId,parent:f.parent.token,practitioner:f.practitioner.token}),{mode:0o600});
 const key=join(folder,'tls.key'),cert=join(folder,'tls.crt');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',LS_APP_MODE:'foundation_preview',LS_APP_ORIGIN:origin,LS_DATABASE_URL:databaseUrl,LS_DATABASE_TLS:'disable',LS_IDENTITY_ENABLED:'true',LS_CALENDAR_ENABLED:'true',LS_IDENTITY_WORKSPACE_ID:workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:'synthetic',LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:dataKey.toString('base64url')}),LS_IDENTITY_CSRF_KEY:randomBytes(32).toString('base64url'),LS_IDENTITY_LOOKUP_KEY:randomBytes(32).toString('base64url'),LS_IDENTITY_RATE_KEY:randomBytes(32).toString('base64url'),LS_CALENDAR_FIXTURE_PATH:auth};
 const startedApp=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'ignore'});app=startedApp;
 let healthy=false;
 for(let i=0;i<100;i++){if(startedApp.exitCode!==null)throw new Error('ISOLATED_APP_START_FAILED');try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 if(!healthy)throw new Error('ISOLATED_APP_HEALTH_TIMEOUT');
 tls=httpsServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
  const upstream=httpRequest({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https'}},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
  upstream.on('error',()=>{if(res.headersSent)res.destroy();else{res.writeHead(502);res.end('Isolated upstream unavailable');}});req.pipe(upstream);
 });tls.listen(tlsPort,'127.0.0.1');await once(tls,'listening');
 env.LS_CALENDAR_TEST_RUNNER_ACTIVE='true';
 const selection=project?['--project',project,'--output',`tests/e2e/calendar/test-results/isolated-${project}`]:[];
 const startedTests=spawn(process.execPath,[resolve('node_modules/@playwright/test/cli.js'),'test','--config','tests/e2e/calendar/playwright.config.ts',...selection],{env,stdio:['ignore','inherit','inherit']});tests=startedTests;
 const [code]=await once(startedTests,'exit');if(code!==0)throw new Error('CALENDAR_BROWSER_ACCEPTANCE_FAILED');
 console.log('LS-030 isolated browser suite completed. Only synthetic fixtures used; no deployment.');
}catch{console.error('LS-030 browser verification failed. Inspect sanitized test assertions; no runtime credentials are printed.');process.exitCode=1;}
finally{await cleanup();}
