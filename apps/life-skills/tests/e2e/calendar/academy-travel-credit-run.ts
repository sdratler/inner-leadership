/** Owned disposable test host. Actual Next UI/session/native HTTP and SQL.
 * The merchant is synthetic only inside this bounded loopback transport. */
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:https';
import {mkdtempSync,existsSync,readFileSync,rmSync,realpathSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import net from 'node:net';
import {chromium,expect,request as playwrightRequest} from '@playwright/test';
import {travelCreditBrowserFixture,sharedCalendarBrowserFixture} from './academy-travel-credit-fixture.ts';
import {travelCreditJourney,sharedCalendarJourney} from './academy-travel-credit.journey.ts';
import {handleFishingCalendar} from '../../../src/features/fishing/program-calendar-http.ts';
import {safeTestUrl} from '../../database/calendar/fixture.ts';

const projects={desktop:{port:3107,width:1440,height:900},mobile390:{port:3108,width:390,height:900},mobile340:{port:3107,width:340,height:900},tablet768:{port:3108,width:768,height:900}} as const;
const project=process.env.LS_GROUP_INTEREST_TEST_PROJECT as keyof typeof projects|undefined,sharedMode=process.env.LS_ACADEMY_SHARED_CALENDAR_BROWSER==='SYNTHETIC_LOOPBACK_ONLY';
if(process.env.LS_ACADEMY_TRAVEL_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY'||(!project||!Object.hasOwn(projects,project)))throw Error('EXCLUSIVE_TRAVEL_BROWSER_PROJECT_REQUIRED');
const {port,width,height}=projects[project],origin=`https://localhost:${port}`;safeTestUrl();
const probe=net.createServer();await new Promise<void>((ok,no)=>{probe.once('error',no);probe.listen(port,'127.0.0.1',ok);});await new Promise<void>((ok,no)=>probe.close(e=>e?no(e):ok()));
const folder=mkdtempSync(join(tmpdir(),'ls-travel-credit-browser-')),artifacts=resolve('tests/e2e/calendar/test-results/'+(sharedMode?'shared-service-calendar-':'travel-credit-')+project);mkdirSync(artifacts,{recursive:true});
let app:ChildProcess|null=null,browser:Awaited<ReturnType<typeof chromium.launch>>|null=null,f:Awaited<ReturnType<typeof travelCreditBrowserFixture>>|Awaited<ReturnType<typeof sharedCalendarBrowserFixture>>|null=null,adapter:ReturnType<typeof createServer>|null=null,phase='fixture';
async function stopApp(){
 if(app&&app.exitCode===null&&app.signalCode===null){const child=app,exited=once(child,'exit');if(process.platform==='win32'&&app.pid){const killer=spawn('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await Promise.race([Promise.all([once(killer,'close'),exited]),new Promise((_,no)=>setTimeout(()=>no(Error('OWNED_NEXT_EXIT_UNCONFIRMED')),10000))]);}else{app.kill('SIGTERM');await exited;}}app=null;
}
try{
 const key=join(folder,'tls.key'),cert=join(folder,'tls.crt'),openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/mingw64/bin/openssl.exe')?'C:/Program Files/Git/mingw64/bin/openssl.exe':'openssl';execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 adapter=createServer({key:readFileSync(key),cert:readFileSync(cert)},(incoming,outgoing)=>{void(async()=>{
  const url=new URL(incoming.url??'/',origin),path=url.pathname.split('/').at(-1)!,sharedRead=sharedMode&&['plan','family-home'].includes(path)&&incoming.method==='GET';if(!f||!(sharedRead||['travel-credit','travel-change','travel-declaration'].includes(path))||url.pathname!=='/api/calendar/fishing/'+path||!['GET','POST'].includes(incoming.method??'')){outgoing.writeHead(404).end();return;}
  const chunks:Buffer[]=[];let size=0;for await(const chunk of incoming){size+=chunk.length;if(size>20000){outgoing.writeHead(413).end();return;}chunks.push(Buffer.from(chunk));}
  const headers=new Headers();for(const [name,value]of Object.entries(incoming.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
  const request=new Request(origin+url.pathname+url.search,{method:incoming.method!,headers,...(incoming.method==='POST'?{body:Buffer.concat(chunks).toString('utf8')}:{})}),response=await handleFishingCalendar(request,[path],async()=>({runtime:sharedRead&&'sharedReadRuntime'in f!?f!.sharedReadRuntime:f!.runtime,store:f!.db,...(sharedRead?{}:{merchant:f!.merchant})}));outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
 })().catch(()=>{if(!outgoing.headersSent)outgoing.writeHead(500);outgoing.end();});});
 await new Promise<void>((ok,no)=>{adapter!.once('error',no);adapter!.listen(0,'127.0.0.1',ok);});const address=adapter.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1')throw Error('EXACT_OWNED_TRAVEL_ADAPTER_REQUIRED');const gateway=`https://127.0.0.1:${address.port}`;
 browser=await chromium.launch({headless:true});const results=[];
 for(const locale of ['en','he']as const){
  phase='fixture-'+locale;f=sharedMode?await sharedCalendarBrowserFixture(origin,locale):await travelCreditBrowserFixture(origin,locale);const before=await f.protectedSnapshot(),oldReceipts=(await f.pool.query('SELECT command_id,to_jsonb(r) AS row FROM ls_fishing_stage.command_receipts r WHERE workspace_id=$1 ORDER BY command_id',[f.workspaceId])).rows;
  const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',LS_APP_MODE:'foundation_preview',LS_APP_ORIGIN:origin,LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:'disable',LS_PRIVATE_APP_ENABLED:'true',LS_IDENTITY_ENABLED:'true',LS_GROUP_INTEREST_CANDIDATE:'true',LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:'true',LS_IDENTITY_WORKSPACE_ID:f.workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:'synthetic',LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:f.ring.keys.synthetic!.toString('base64url')}),LS_IDENTITY_CSRF_KEY:f.config.csrfKey.toString('base64url'),LS_IDENTITY_LOOKUP_KEY:f.config.lookupKey.toString('base64url'),LS_IDENTITY_RATE_KEY:Buffer.from(f.config.rateLimitKey,'hex').toString('base64url'),LS_AUTH_EMAIL_ENABLED:'false',LS_CHILD_ACCOUNTS_ENABLED:'false',LS_CALENDAR_ENABLED:'true'};
  phase='next-start-'+locale;let diagnostic='';app=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--experimental-https','--experimental-https-key',key,'--experimental-https-cert',cert,'--hostname','127.0.0.1','--port',String(port)],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});const capture=(b:Buffer)=>{diagnostic=(diagnostic+b.toString()).slice(-12000);};app.stdout?.on('data',capture);app.stderr?.on('data',capture);
  const health=await playwrightRequest.newContext({ignoreHTTPSErrors:true});try{let ready=false;for(let i=0;i<240;i++){if(app.exitCode!==null)throw Error('OWNED_NEXT_EXITED');try{if((await health.get(origin+'/api/health')).status()===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('OWNED_NEXT_HEALTH_TIMEOUT');}finally{await health.dispose();}
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height}}),parentContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height}});
  try{phase='actual-browser-'+locale;const page=await context.newPage(),parentPage=await parentContext.newPage();expect(page.viewportSize()).toEqual({width,height});expect(parentPage.viewportSize()).toEqual({width,height});page.setDefaultTimeout(20000);parentPage.setDefaultTimeout(20000);results.push('eventId'in f?await sharedCalendarJourney(page,parentPage,{origin,gateway,locale,project,artifacts,fixture:f}):await travelCreditJourney(page,parentPage,{origin,gateway,locale,project,artifacts,fixture:f}));}
  finally{await parentContext.close();await context.close();writeFileSync(join(artifacts,'next-'+locale+'.log'),diagnostic.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g,'[DISPOSABLE_URL]'));}
  phase='native-readback-'+locale;const after=await f.protectedSnapshot();expect(after.filter(t=>t.table!=='ls_fishing_stage.seat_reservations')).toEqual(before.filter(t=>t.table!=='ls_fishing_stage.seat_reservations'));const oldSeats=before.find(t=>t.table==='ls_fishing_stage.seat_reservations')!,seats=after.find(t=>t.table===oldSeats.table)!;for(const row of oldSeats.rows)expect(seats.rows).toContainEqual(row);expect(seats.rows).toHaveLength(oldSeats.rows.length+(sharedMode?0:1));
  const receipts=(await f.pool.query('SELECT command_id,to_jsonb(r) AS row FROM ls_fishing_stage.command_receipts r WHERE workspace_id=$1 ORDER BY command_id',[f.workspaceId])).rows;for(const row of oldReceipts)expect(receipts.find(r=>r.command_id===row.command_id)).toEqual(row);
  for(const table of ['academy_session_credits','academy_session_credit_events','academy_travel_declarations','academy_travel_changes'])expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_fishing_stage.'+table+' WHERE workspace_id=$1',[f.workspaceId])).rows[0]!.n).toBe(table==='academy_session_credits'?1:sharedMode?2:3);
  await stopApp();await f.close();f=null;
 }
 writeFileSync(join(artifacts,'native-browser-proof.json'),JSON.stringify({scope:sharedMode?'ACTUAL_SYNTHETIC_SHARED_CALENDAR_FAMILY_SERVICE_UI_WITH_CONTROLLED_FUTURE_READ_CLOCK_NOT_ADOPTION_OR_RELEASE':'ACTUAL_SYNTHETIC_LOOPBACK_TRAVEL_UI_NATIVE_HTTP_NOT_REAL_SOURCE_MERCHANT_OR_SCHEMA_ADOPTION',project,viewport:{width,height},results,protectedNonSeatTablesUnchanged:17,existingSeatsAndStageReceiptsPreserved:true,newMakeupSeatsPerLocale:sharedMode?0:1,oneCreditAndThreeDistinctResponseOutcomesPerLocale:!sharedMode,sharedPhysicalTravelRootAndLocalAlternative:sharedMode,actualFamilyHomeAndCalendarService:sharedMode,completedServiceClock:'owned_native_read_transport_only_mounted_next_clock_unchanged',productionAdmission:false,providerOrFinancialEffects:false},null,2));
 console.log(`ACADEMY_${sharedMode?'SHARED_CALENDAR':'TRAVEL'}_BROWSER_PASS project=${project} locales=en,he actualNativeHttp=true committedLossExactRetry=true ordinaryMakeupConfirmation=${!sharedMode} draftNavigationGuards=true defaultMerchantDenied=true noProviderOrFinancialEffect=true`);
}catch(error){console.error(`ACADEMY_TRAVEL_BROWSER_FAILED phase=${phase} error=${error instanceof Error?error.stack:'unknown'}`);process.exitCode=1;}
finally{
 await browser?.close();await stopApp();if(adapter){adapter.closeAllConnections();await new Promise<void>((ok,no)=>adapter!.close(e=>e?no(e):ok()));}await f?.close();
 if(lstatSync(folder).isSymbolicLink()||dirname(realpathSync(folder))!==realpathSync(tmpdir())||basename(folder)!==basename(realpathSync(folder))||!basename(folder).startsWith('ls-travel-credit-browser-'))throw Error('OWNED_TRAVEL_TEMP_TARGET_MISMATCH');rmSync(folder,{recursive:true,force:true});
}
