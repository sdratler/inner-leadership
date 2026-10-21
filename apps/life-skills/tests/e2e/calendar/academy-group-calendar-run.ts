/** Owned synthetic loopback Next/browser host. No transport or source importer. */
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,existsSync,realpathSync,lstatSync,mkdirSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import net from 'node:net';
import {chromium,expect,request as playwrightRequest} from '@playwright/test';
import {groupCalendarBrowserFixture} from './academy-group-calendar-fixture.ts';
import {groupCalendarJourney} from './academy-group-calendar.journey.ts';
import {safeTestUrl} from '../../database/calendar/fixture.ts';

const project=process.env.LS_GROUP_INTEREST_TEST_PROJECT;
if(process.env.LS_ACADEMY_GROUP_CALENDAR_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY'||!['desktop','mobile390'].includes(project??''))throw Error('EXCLUSIVE_GROUP_CALENDAR_PROJECT_REQUIRED');
const port=project==='desktop'?3107:3108,origin=`https://localhost:${port}`;safeTestUrl();
const probe=net.createServer();await new Promise<void>((ok,no)=>{probe.once('error',no);probe.listen(port,'127.0.0.1',ok);});await new Promise<void>((ok,no)=>probe.close(e=>e?no(e):ok()));
const folder=mkdtempSync(join(tmpdir(),'ls-group-calendar-browser-')),artifacts=resolve('tests/e2e/calendar/test-results/group-calendar-'+project);mkdirSync(artifacts,{recursive:true});
let app:ChildProcess|null=null,browser:Awaited<ReturnType<typeof chromium.launch>>|null=null,f:Awaited<ReturnType<typeof groupCalendarBrowserFixture>>|null=null,phase='fixture';
async function stopApp(){if(app&&app.exitCode===null&&app.signalCode===null){const child=app,exited=once(child,'exit');if(process.platform==='win32'&&child.pid){const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await Promise.race([Promise.all([once(kill,'close'),exited]),new Promise((_,no)=>setTimeout(()=>no(Error('OWNED_NEXT_EXIT_UNCONFIRMED')),10000))]);}else{child.kill('SIGTERM');await exited;}}app=null;}
try{
 const key=join(folder,'tls.key'),cert=join(folder,'tls.crt'),openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/mingw64/bin/openssl.exe')?'C:/Program Files/Git/mingw64/bin/openssl.exe':'openssl';execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 browser=await chromium.launch({headless:true});const results=[];
 for(const locale of ['en','he'] as const){
  phase='fixture-'+locale;f=await groupCalendarBrowserFixture(origin);const before=await f.snapshot();
  const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',LS_APP_MODE:'foundation_preview',LS_APP_ORIGIN:origin,LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:'disable',LS_PRIVATE_APP_ENABLED:'true',LS_IDENTITY_ENABLED:'true',LS_GROUP_INTEREST_CANDIDATE:'true',LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:'true',LS_IDENTITY_WORKSPACE_ID:f.workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:'synthetic',LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:f.ring.keys.synthetic!.toString('base64url')}),LS_IDENTITY_CSRF_KEY:f.config.csrfKey.toString('base64url'),LS_IDENTITY_LOOKUP_KEY:f.config.lookupKey.toString('base64url'),LS_IDENTITY_RATE_KEY:Buffer.from(f.config.rateLimitKey,'hex').toString('base64url'),LS_AUTH_EMAIL_ENABLED:'false',LS_CHILD_ACCOUNTS_ENABLED:'false',LS_CALENDAR_ENABLED:'true'};
  phase='next-'+locale;let diagnostic='';app=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--experimental-https','--experimental-https-key',key,'--experimental-https-cert',cert,'--hostname','127.0.0.1','--port',String(port)],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});const capture=(b:Buffer)=>{diagnostic=(diagnostic+b.toString()).slice(-12000);};app.stdout?.on('data',capture);app.stderr?.on('data',capture);
  const health=await playwrightRequest.newContext({ignoreHTTPSErrors:true});try{let ready=false;for(let i=0;i<240;i++){if(app.exitCode!==null)throw Error('OWNED_NEXT_EXITED');try{if((await health.get(origin+'/api/health')).status()===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('OWNED_NEXT_HEALTH_TIMEOUT');}finally{await health.dispose();}
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:project==='desktop'?1440:390,height:900}});
  try{phase='browser-'+locale;const page=await context.newPage();page.setDefaultTimeout(20000);try{results.push(await groupCalendarJourney(page,{origin,locale,project:project as 'desktop'|'mobile390',artifacts,fixture:f}));}catch(error){const root=page.locator('[data-academy-calendar]');if(await root.count())await root.screenshot({path:join(artifacts,locale+'-'+project+'-failed.png')}).catch(()=>{});throw error;}}
  finally{await context.close();writeFileSync(join(artifacts,'next-'+locale+'.log'),diagnostic.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g,'[DISPOSABLE_URL]'));}
  phase='readback-'+locale;expect(Object.keys(before)).toHaveLength(15);expect(await f.snapshot()).toEqual(results.at(-1)!.expectedFinalStageSnapshot);await stopApp();await f.close();f=null;
 }
 writeFileSync(join(artifacts,'native-browser-proof.json'),JSON.stringify({scope:'FULL44_WIP_NATIVE_OWNER_VIEWS_AND_EVENT_DRAFTS_NOT_PUBLICATION_RIGHTS_OR_PARENT_ACCEPTANCE',project,results,namedStageTablesPreserved:15,actualProviderOrFinancialEffects:false,productionAdmission:false},null,2));console.log(`ACADEMY_GROUP_CALENDAR_BROWSER_PASS project=${project} locales=en,he actualNativeHttp=true completeYear=true fourWeeks=true noProviderEffects=true`);
}catch(error){console.error(`ACADEMY_GROUP_CALENDAR_BROWSER_FAILED phase=${phase} error=${error instanceof Error?error.stack:'unknown'}`);process.exitCode=1;}
finally{await browser?.close();await stopApp();await f?.close();if(lstatSync(folder).isSymbolicLink()||dirname(realpathSync(folder))!==realpathSync(tmpdir())||basename(folder)!==basename(realpathSync(folder))||!basename(folder).startsWith('ls-group-calendar-browser-'))throw Error('OWNED_GROUP_CALENDAR_TEMP_MISMATCH');for(const name of ['tls.key','tls.crt']){const file=join(folder,name);if(existsSync(file))unlinkSync(file);}rmdirSync(folder);}
