/** Run only with a migrated, disposable loopback PostgreSQL database and synthetic identities. */
import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {request as playwrightRequest,type APIRequestContext} from '@playwright/test';
import {parseIdentityConfig,type IdentityConfig} from '../../src/features/identity/config.ts';
import {IdentityAccountService} from '../../src/features/identity/account-service.ts';
import {IdentityAuthService} from '../../src/features/identity/auth-service.ts';
import {dispatchOneAuthMail,processResetRequests} from '../../src/providers/email/dispatch.ts';
import {SyntheticAuthEmailSink} from '../../src/providers/email/sink.ts';
import {opaqueToken,tokenDigest} from '../../src/features/identity/crypto.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {migrate,type MigrationClient} from '../../src/db/migration-runner.ts';

const origin='https://localhost:3003';
const practitionerEmail='practitioner-http@example.invalid';
const parentAEmail='parent-http-a@example.invalid';
const parentBEmail='parent-http-b@example.invalid';
const practitionerPassword=opaqueToken();
const parentAPassword=opaqueToken();
const parentBPassword=opaqueToken();
const replacementPassword=opaqueToken();
const clock={now:()=>new Date()};
const sink=new SyntheticAuthEmailSink('synthetic-test');
let pool:Pool;
let store:IdentityStore;
let config:IdentityConfig;
let auth:IdentityAuthService;
let accounts:IdentityAccountService;
let server:ChildProcess|undefined;

async function dispatchAll():Promise<void>{
 for(let index=0;index<100;index++)if(await dispatchOneAuthMail(store,config,clock,sink,'service@example.invalid')==='idle')return;
 throw new Error('SYNTHETIC_QUEUE_NOT_DRAINED');
}
function tokenFromMail(to:string,mode:'invite'|'reset'):string{
 const message=[...sink.messages].reverse().find(item=>item.to===to&&item.text.includes(`/auth/${mode}#token=`));
 const value=message?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
 assert.ok(value,'synthetic token should be delivered only to the in-memory sink');
 return value;
}
async function waitForServer():Promise<void>{
 const probe=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 try{
  for(let attempt=0;attempt<240;attempt++){
   if(server?.exitCode!==null)throw new Error('HTTPS_TEST_SERVER_EXITED');
   try{if((await probe.get('/api/health')).status()===200)return;}catch{}
   await new Promise(resolveWait=>setTimeout(resolveWait,250));
  }
  throw new Error('HTTPS_TEST_SERVER_TIMEOUT');
 }finally{await probe.dispose();}
}
async function csrf(context:APIRequestContext):Promise<string>{
 const response=await context.get('/api/identity/csrf',{headers:{Origin:origin}});
 const body=await response.json();
 assert.equal(response.status(),200,`csrf failed with ${body.error?.code??'unknown'}`);
 assert.equal(body.ok,true);
 assert.match(response.headers()['set-cookie']??'',/^__Host-ls-preauth=.*; Path=\/; Max-Age=900; HttpOnly; Secure; SameSite=Lax/i);
 return body.data.csrfToken as string;
}
async function login(context:APIRequestContext,email:string,password:string):Promise<string>{
 const preauthCsrf=await csrf(context);
 const response=await context.post('/api/identity/login',{headers:{Origin:origin,'X-CSRF-Token':preauthCsrf},data:{email,password}});
 assert.equal(response.status(),200);
 const body=await response.json();
 assert.equal(body.ok,true);
 const cookies=(await context.storageState()).cookies;
 const session=cookies.find(item=>item.name==='__Host-ls-session');
 assert.ok(session?.secure&&session.httpOnly&&session.sameSite==='Lax');
 assert.equal(cookies.some(item=>item.name==='__Host-ls-preauth'&&item.value),false,'login must rotate away the preauth credential');
 return body.data.csrfToken as string;
}
async function accept(context:APIRequestContext,token:string,password:string):Promise<void>{
 const preauthCsrf=await csrf(context);
 const response=await context.post('/api/identity/invites/accept',{headers:{Origin:origin,'X-CSRF-Token':preauthCsrf},data:{token,password}});
 assert.equal(response.status(),200);
}
async function authorizedPost(context:APIRequestContext,path:string,sessionCsrf:string,data:unknown){
 return context.post(path,{headers:{Origin:origin,'X-CSRF-Token':sessionCsrf},data});
}

before(async()=>{
 const raw=process.env.LS_DATABASE_URL;
 if(!raw||process.env.LS_IDENTITY_TEST_ALLOW_DISPOSABLE!=='true')throw new Error('EXPLICIT_DISPOSABLE_DATABASE_REQUIRED');
 const httpsKey=process.env.LS_TEST_HTTPS_KEY,httpsCert=process.env.LS_TEST_HTTPS_CERT;
 if(!httpsKey||!httpsCert)throw new Error('EXPLICIT_TEST_CERTIFICATE_REQUIRED');
 const databaseUrl=new URL(raw);
 if(!['127.0.0.1','localhost','[::1]'].includes(databaseUrl.hostname)||!/_test$/.test(databaseUrl.pathname)||databaseUrl.search)throw new Error('LOOPBACK_DISPOSABLE_DATABASE_REQUIRED');
 if(process.env.NODE_ENV!=='development'||process.env.LS_APP_ORIGIN!==origin)throw new Error('LOCAL_HTTPS_DEVELOPMENT_REQUIRED');
 pool=new Pool({connectionString:raw,ssl:false,max:6});
 const files=await Promise.all(['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql'].map(async name=>{const sql=await readFile(resolve('migrations',name),'utf8');return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};}));
 const migrationClient=await pool.connect();
 try{
  const adapter:MigrationClient={query:async(text,values)=>migrationClient.query(text,values?[...values]:undefined)};
  await migrate(adapter,files,false);
 }finally{migrationClient.release();}
 const state=await pool.query("SELECT (SELECT count(*)::integer FROM ls_identity.accounts) AS accounts,(SELECT count(*)::integer FROM ls_control.migrations) AS migrations");
 assert.equal(state.rows[0]?.accounts,0,'disposable HTTP database must contain no accounts');
 assert.equal(state.rows[0]?.migrations,2,'disposable HTTP database must have both signed migrations');
 store={async transaction(work){const client=await pool.connect();try{await client.query('BEGIN');const tx:SqlSession={async query<T extends object>(text:string,values:readonly unknown[]=[]){return (await client.query(text,[...values])).rows as T[];}};const value=await work(tx);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
 config=parseIdentityConfig(process.env);auth=new IdentityAuthService(store,config,clock);accounts=new IdentityAccountService(store,config,clock);
 await accounts.bootstrapPractitioner({email:practitionerEmail,displayName:'Synthetic HTTPS Practitioner',locale:'he'},true,randomUUID());
 await dispatchAll();
 await auth.consumePasswordToken('invite',tokenFromMail(practitionerEmail,'invite'),practitionerPassword,randomUUID());
 const nextBin=resolve('node_modules/next/dist/bin/next');
 const serverEnv={...process.env,LS_APP_MODE:'foundation_preview'};
 server=spawn(process.execPath,[nextBin,'dev','--experimental-https','--experimental-https-key',httpsKey,'--experimental-https-cert',httpsCert,'--hostname','127.0.0.1','--port','3003'],{cwd:process.cwd(),env:serverEnv,stdio:['ignore','ignore','ignore']});
 await waitForServer();
});

after(async()=>{
 sink.clear();
 if(server&&server.exitCode===null){server.kill();await Promise.race([once(server,'exit'),new Promise(resolveWait=>setTimeout(resolveWait,5000))]);}
 if(pool)await pool.end();
});

test('mounted HTTPS identity routes enforce credential, case and denial boundaries',async()=>{
 const practitioner=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 const practitionerSecondTab=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 const parentA=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 const parentB=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 const anonymous=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 try{
  const practitionerCsrf=await login(practitioner,practitionerEmail,practitionerPassword);
  const session=await practitioner.get('/api/identity/session');assert.equal(session.status(),200);assert.equal((await session.json()).data.role,'practitioner');
  const caseAResponse=await authorizedPost(practitioner,'/api/identity/cases',practitionerCsrf,{kind:'minor',displayName:'Synthetic HTTPS Minor A',familyLabel:'Synthetic HTTPS Family A'});
  const caseBResponse=await authorizedPost(practitioner,'/api/identity/cases',practitionerCsrf,{kind:'minor',displayName:'Synthetic HTTPS Minor B',familyLabel:'Synthetic HTTPS Family B'});
  assert.equal(caseAResponse.status(),200);assert.equal(caseBResponse.status(),200);
  const caseA=(await caseAResponse.json()).data.caseId as string;
  const caseB=(await caseBResponse.json()).data.caseId as string;
  const inviteA=await authorizedPost(practitioner,'/api/identity/invites/parent',practitionerCsrf,{caseId:caseA,email:parentAEmail,displayName:'Synthetic HTTPS Parent A',locale:'he'});
  const inviteB=await authorizedPost(practitioner,'/api/identity/invites/parent',practitionerCsrf,{caseId:caseB,email:parentBEmail,displayName:'Synthetic HTTPS Parent B',locale:'en'});
  assert.equal(inviteA.status(),200);assert.equal(inviteB.status(),200);
  await dispatchAll();
  await accept(parentA,tokenFromMail(parentAEmail,'invite'),parentAPassword);
  await accept(parentB,tokenFromMail(parentBEmail,'invite'),parentBPassword);
  await login(parentA,parentAEmail,parentAPassword);
  await login(parentB,parentBEmail,parentBPassword);
  const visibleCases=await parentA.get('/api/identity/cases');assert.equal(visibleCases.status(),200);
  assert.deepEqual((await visibleCases.json()).data.map((item:{id:string})=>item.id),[caseA]);
  const audienceResponse=await authorizedPost(practitioner,'/api/identity/audiences',practitionerCsrf,{caseId:caseB,visibility:'family_full',published:true});
  assert.equal(audienceResponse.status(),200);const audienceId=(await audienceResponse.json()).data.audienceId as string;
  const tampered=await parentA.get(`/api/identity/audiences?caseId=${caseB}&audienceId=${audienceId}`);assert.equal(tampered.status(),404);
  const badCsrf=await parentA.put('/api/identity/preferences',{headers:{Origin:origin,'X-CSRF-Token':opaqueToken()},data:{preferences:[{eventType:'practice_due',channel:'email',enabled:true,locale:'he',timezone:'Asia/Jerusalem',quietStart:null,quietEnd:null}]}});assert.equal(badCsrf.status(),403);
  for(const path of ['/api/identity/child/login','/api/identity/register','/api/identity/bootstrap'])assert.equal((await anonymous.post(path,{data:{}})).status(),404);

  let resetCsrf=await csrf(anonymous);let reset=await anonymous.post('/api/identity/reset/request',{headers:{Origin:origin,'X-CSRF-Token':resetCsrf},data:{email:parentAEmail}});assert.equal(reset.status(),202);
  await processResetRequests(store,config,clock);await dispatchAll();const expiredToken=tokenFromMail(parentAEmail,'reset');
  await pool.query("UPDATE ls_identity.auth_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE token_digest=$1",[tokenDigest(expiredToken)]);
  const expiredContext=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
  resetCsrf=await csrf(expiredContext);reset=await expiredContext.post('/api/identity/reset/complete',{headers:{Origin:origin,'X-CSRF-Token':resetCsrf},data:{token:expiredToken,password:replacementPassword}});assert.equal(reset.status(),400);await expiredContext.dispose();

  const resetContext=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
  resetCsrf=await csrf(resetContext);reset=await resetContext.post('/api/identity/reset/request',{headers:{Origin:origin,'X-CSRF-Token':resetCsrf},data:{email:parentAEmail}});assert.equal(reset.status(),202);
  await processResetRequests(store,config,clock);await dispatchAll();const resetToken=tokenFromMail(parentAEmail,'reset');
  const completeContext=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
  let completeCsrf=await csrf(completeContext);let complete=await completeContext.post('/api/identity/reset/complete',{headers:{Origin:origin,'X-CSRF-Token':completeCsrf},data:{token:resetToken,password:replacementPassword}});assert.equal(complete.status(),200);
  const reuseContext=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});completeCsrf=await csrf(reuseContext);complete=await reuseContext.post('/api/identity/reset/complete',{headers:{Origin:origin,'X-CSRF-Token':completeCsrf},data:{token:resetToken,password:opaqueToken()}});assert.equal(complete.status(),400);
  await resetContext.dispose();await completeContext.dispose();await reuseContext.dispose();

  const parentReloginCsrf=await login(parentA,parentAEmail,replacementPassword);
  const logout=await authorizedPost(parentA,'/api/identity/logout',parentReloginCsrf,{});assert.equal(logout.status(),200);assert.equal((await parentA.get('/api/identity/session')).status(),401);
  await login(practitionerSecondTab,practitionerEmail,practitionerPassword);
  const logoutAll=await authorizedPost(practitioner,'/api/identity/logout-all',practitionerCsrf,{});assert.equal(logoutAll.status(),200);
  assert.equal((await practitionerSecondTab.get('/api/identity/session')).status(),401,'logout-all must revoke a second browser context immediately');
 }finally{
  await practitioner.dispose();await practitionerSecondTab.dispose();await parentA.dispose();await parentB.dispose();await anonymous.dispose();
 }
});
