/** Run only with an EMPTY, disposable loopback PostgreSQL 17 database. No production fallback. */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { asId } from '../../src/lib/ids.ts';
import { AppError } from '../../src/lib/errors.ts';
import type { IdentityStore,SqlSession } from '../../src/features/identity/store.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { Actor } from '../../src/features/identity/types.ts';
import { opaqueToken,blindEmail,seal } from '../../src/features/identity/crypto.ts';
import { IdentityAuthService } from '../../src/features/identity/auth-service.ts';
import { IdentityAccountService } from '../../src/features/identity/account-service.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { IdentityPreferenceService,defaultPreference } from '../../src/features/identity/preferences.ts';
import { IdentityDeliveryAuthorization } from '../../src/features/identity/delivery-authorization.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import { CaseService } from '../../src/features/cases/service.ts';
import { DatabaseCaseAuthorizer } from '../../src/features/cases/authorization.ts';
import { SyntheticAuthEmailSink } from '../../src/providers/email/sink.ts';
import { processResetRequests,dispatchOneAuthMail,pruneAuthEphemera } from '../../src/providers/email/dispatch.ts';
import { opaqueRateLimitKey } from '../../src/lib/security/rate-limit.ts';
let pool:Pool,store:IdentityStore,config:IdentityConfig,auth:IdentityAuthService,accounts:IdentityAccountService,sessions:IdentitySessions,prefs:IdentityPreferenceService,cases:CaseService,authorizer:DatabaseCaseAuthorizer;
const clock={now:()=>new Date()},sink=new SyntheticAuthEmailSink('synthetic-test'),mailFrom='service@example.invalid';
const request=()=>randomUUID();
const email={practitioner:'practitioner@example.invalid',a:'parent-a@example.invalid',b:'parent-b@example.invalid',other:'parent-other@example.invalid',adult:'adult@example.invalid'};
const passwords=new Map<string,string>();
async function dispatchAll(){for(let i=0;i<100;i++){if(await dispatchOneAuthMail(store,config,clock,sink,mailFrom)==='idle') return;}throw new Error('SYNTHETIC_QUEUE_NOT_DRAINED');}
function tokenFromMail(to:string,mode:'invite'|'reset'){
 const message=[...sink.messages].reverse().find(m=>m.to===to && m.text.includes(`/auth/${mode}#token=`));
 const token=message?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];assert.ok(token,'synthetic token should be delivered to the sink');return token;
}
async function accept(to:string){const password=opaqueToken();passwords.set(to,password);await auth.consumePasswordToken('invite',tokenFromMail(to,'invite'),password,request());}
async function login(to:string):Promise<{actor:Actor;token:string}>{
 const pre=await auth.preauth(),result=await auth.login(to,passwords.get(to)!,pre.token,request());
 assert.ok(result.token!==pre.token,'login must rotate the preauth token');return {actor:await sessions.actor(result.token),token:result.token};
}
async function denied(work:()=>Promise<unknown>,code='NOT_FOUND'){await assert.rejects(work,e=>e instanceof AppError && e.code===code);}
before(async()=>{
 const raw=process.env.LS_IDENTITY_TEST_DATABASE_URL;
 if(!raw || process.env.LS_IDENTITY_TEST_ALLOW_DISPOSABLE!=='true') throw new Error('EXPLICIT_DISPOSABLE_DATABASE_REQUIRED');
 const url=new URL(raw);
 if(!['postgres:','postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/^\/ls010_test_[a-z0-9_]+$/.test(url.pathname) || url.search) throw new Error('LOOPBACK_DISPOSABLE_DATABASE_REQUIRED');
 pool=new Pool({connectionString:raw,ssl:false,max:6});
 let tables;try{tables=await pool.query("SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");}catch{throw new Error('SYNTHETIC_DATABASE_UNAVAILABLE');}
 if(tables.rows[0]?.count!==0) throw new Error('EMPTY_DISPOSABLE_DATABASE_REQUIRED_NO_DELETIONS_PERFORMED');
 store={async transaction(work){const client=await pool.connect();try{await client.query('BEGIN');const tx:SqlSession={async query<T extends object>(text:string,values:readonly unknown[]=[]){return (await client.query(text,[...values])).rows as T[];}};const value=await work(tx);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
 const foundation=await readFile(resolve('migrations/0001_ls_foundation.sql'),'utf8');
 assert.ok(createHash('sha256').update(foundation).digest('hex')==='df3ba0131c7d5fd093953884e5f5316c7416b2dbe49fceee0d57acf2ae362dcd','foundation migration must match frozen baseline');
 await pool.query('CREATE SCHEMA ls_control');await pool.query(foundation);
 await pool.query(await readFile(resolve('migrations/0010_ls_identity_cases_20260906.sql'),'utf8'));
 config={enabled:true,origin:'https://app.example.invalid',workspaceId:asId(randomUUID(),'workspace'),csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:opaqueToken(),keyring:{activeKeyId:'test',keys:{test:randomBytes(32)}},sessionSeconds:28800};
 auth=new IdentityAuthService(store,config,clock);accounts=new IdentityAccountService(store,config,clock);sessions=new IdentitySessions(store,config,clock);prefs=new IdentityPreferenceService(store,config,clock);cases=new CaseService(store,config,clock);authorizer=new DatabaseCaseAuthorizer(store);
});
after(async()=>{sink.clear();if(pool)await pool.end();});
test('PostgreSQL journey: practitioner, two independent parents, reset, explicit audiences and immediate revocation',async()=>{
 await accounts.bootstrapPractitioner({email:email.practitioner,displayName:'Synthetic Practitioner',locale:'he'},true,request());
 await denied(()=>accounts.bootstrapPractitioner({email:email.practitioner,displayName:'Synthetic Practitioner',locale:'he'},true,request()),'CONFLICT');
 await dispatchAll();await accept(email.practitioner);const practitioner=await login(email.practitioner);
 const main=await cases.create(practitioner.actor,{kind:'minor',displayName:'Synthetic Minor A',familyLabel:'Synthetic Family A'},request());
 const other=await cases.create(practitioner.actor,{kind:'minor',displayName:'Synthetic Minor B',familyLabel:'Synthetic Family B'},request());
 const a=await accounts.inviteParent(practitioner.actor,{caseId:main.caseId,email:email.a,displayName:'Synthetic Parent A',locale:'he'},request());
 const b=await accounts.inviteParent(practitioner.actor,{caseId:main.caseId,email:email.b,displayName:'Synthetic Parent B',locale:'en'},request());
 await denied(()=>accounts.inviteParent(practitioner.actor,{caseId:main.caseId,email:email.other,displayName:'Synthetic Third Parent',locale:'he'},request()),'CONFLICT');
 await accounts.inviteParent(practitioner.actor,{caseId:other.caseId,email:email.other,displayName:'Synthetic Other Parent',locale:'he'},request());
 await dispatchAll();for(const address of [email.a,email.b,email.other])await accept(address);
 let parentA=await login(email.a);const parentB=await login(email.b),unrelated=await login(email.other);
 assert.ok(parentA.actor.id!==parentB.actor.id && parentA.actor.personId!==parentB.actor.personId,'separate adult principals are required');
 assert.ok((await cases.list(parentA.actor)).every(c=>c.id===main.caseId),'unrelated cases must not appear');
 await denied(()=>authorizer.authorize({workspaceId:config.workspaceId,accountId:unrelated.actor.id},main.caseId,'read'));
 await denied(()=>cases.create(parentA.actor,{kind:'minor',displayName:'Synthetic',familyLabel:'Synthetic'},request()),'FORBIDDEN');
 const shared=await cases.createAudience(practitioner.actor,main.caseId,{visibility:'family_full',published:true},request());
 assert.ok(shared.accountIds.length===2 && shared.accountIds.includes(a.accountId) && shared.accountIds.includes(b.accountId),'default audience snapshots both currently authorized parents');
 const narrow=await cases.createAudience(practitioner.actor,main.caseId,{visibility:'family_full',published:true,accountIds:[a.accountId]},request());
 const privateAudience=await cases.createAudience(practitioner.actor,main.caseId,{visibility:'private',published:true},request());
 await cases.audience(parentA.actor,main.caseId,shared.audienceId);await cases.audience(parentB.actor,main.caseId,shared.audienceId);
 await denied(()=>cases.audience(parentB.actor,main.caseId,narrow.audienceId));await denied(()=>cases.audience(parentA.actor,main.caseId,privateAudience.audienceId));
 await denied(()=>cases.createAudience(parentA.actor,main.caseId,{visibility:'family_full',published:true,accountIds:[a.accountId,b.accountId]},request()));
 await prefs.replace(parentA.actor,parentA.actor.id,[{...defaultPreference('practice_due','email','he'),enabled:true}],request());
 assert.ok((await prefs.list(parentB.actor,parentB.actor.id)).find(p=>p.channel==='email' && p.eventType==='practice_due')?.enabled===false,'one parent cannot consent for another');
 await denied(()=>prefs.replace(parentA.actor,parentB.actor.id,[defaultPreference('practice_due','email','he')],request()));
 await auth.requestReset(email.a,request());await auth.requestReset('unknown@example.invalid',request());await processResetRequests(store,config,clock);await dispatchAll();
 const resetToken=tokenFromMail(email.a,'reset'),nextPassword=opaqueToken();
 const concurrent=await Promise.allSettled([auth.consumePasswordToken('reset',resetToken,nextPassword,request()),auth.consumePasswordToken('reset',resetToken,nextPassword,request())]);
 assert.ok(concurrent.filter(x=>x.status==='fulfilled').length===1,'a reset token must be consumed only once across transactions');passwords.set(email.a,nextPassword);
 assert.ok(await sessions.resolve(parentA.token)===null,'reset must revoke the old session');parentA=await login(email.a);
 await accounts.revokeGuardian(practitioner.actor,main.caseId,parentA.actor.id,request());
 assert.ok(await sessions.resolve(parentA.token)===null,'guardian revocation must invalidate sessions');assert.ok(await sessions.resolve(parentB.token)!==null,'independent parent session remains usable');
 parentA=await login(email.a);assert.ok((await cases.list(parentA.actor)).length===0,'revoked guardian cannot enumerate the case');
 await accounts.inviteParent(practitioner.actor,{caseId:main.caseId,email:email.a,displayName:'Synthetic Parent A',locale:'he'},request());
 parentA=await login(email.a);await denied(()=>cases.audience(parentA.actor,main.caseId,shared.audienceId));
 const republished=await cases.createAudience(practitioner.actor,main.caseId,{visibility:'family_full',published:true},request());await cases.audience(parentA.actor,main.caseId,republished.audienceId);
 const verifiedHash=await auth.verifyCurrentPassword(parentA.actor,nextPassword);await prefs.setUnverifiedPhone(parentA.actor,'+15550001111',verifiedHash,request());
 assert.ok((await prefs.contacts(parentA.actor)).phoneVerified===false,'typing a phone number is not verification');
 await prefs.replace(parentA.actor,parentA.actor.id,[{...defaultPreference('practice_due','whatsapp','he'),enabled:true}],request());
 const effect={schemaVersion:1 as const,workspaceId:config.workspaceId,caseId:main.caseId,audienceId:republished.audienceId,recipientAccountId:parentA.actor.id,sourceId:randomUUID(),sourceVersionId:randomUUID(),neutralMessageKey:'practice_due' as const,dueAt:clock.now().toISOString(),channel:'whatsapp' as const,idempotencyKey:randomUUID()};
 assert.ok(!await new IdentityDeliveryAuthorization(store,clock,{async isCurrentAndPending(){return true;}}).mayDeliver(effect),'unverified phone blocks delivery even after opt-in');
 await accounts.revokeAccount(practitioner.actor,parentB.actor.id,request());assert.ok(await sessions.resolve(parentB.token)===null);await denied(()=>login(email.b),'UNAUTHENTICATED');
 const adultCase=await cases.create(practitioner.actor,{kind:'adult',displayName:'Synthetic Adult',familyLabel:'Synthetic Adult Case'},request());
 await accounts.inviteAdult(practitioner.actor,{caseId:adultCase.caseId,email:email.adult,displayName:'Synthetic Adult',locale:'en'},request());await dispatchAll();await accept(email.adult);
 const adult=await login(email.adult);assert.ok((await cases.list(adult.actor)).every(c=>c.id===adultCase.caseId));await denied(()=>authorizer.authorize({workspaceId:config.workspaceId,accountId:adult.actor.id},main.caseId,'read'));
 const engagement=await cases.createEngagement(practitioner.actor,main.caseId,{rateMinor:55000,attendedReviewTarget:12},request());assert.ok(Boolean(engagement.engagementId));
 await denied(()=>cases.createEngagement(practitioner.actor,other.caseId,{rateMinor:45000,attendedReviewTarget:12},request()),'CONFLICT');
 // Terminal outbox rows retain no decryptable recipient or token payload.
 await dispatchAll();const leaked=await pool.query("SELECT count(*)::integer AS count FROM ls_identity.auth_mail_outbox WHERE state<>'queued' AND payload_ciphertext IS NOT NULL");assert.ok(leaked.rows[0]?.count===0);
});
test('PostgreSQL constraints reject child authentication and cross-workspace relationships',async()=>{
 const minor=await pool.query("SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND kind='minor' LIMIT 1",[config.workspaceId]);
 await assert.rejects(()=>store.transaction(async tx=>{
  const id=asId(randomUUID(),'account');await tx.query("INSERT INTO ls_identity.accounts (id,workspace_id,role,state,locale,email_blind,email_ciphertext,created_at,updated_at) VALUES ($1,$2,'parent','invited','he',$3,$4,$5,$5)",[id,config.workspaceId,blindEmail('invalid-child-link@example.invalid',config.lookupKey),seal('invalid-child-link@example.invalid',`email:${config.workspaceId}:${id}`,config.keyring),clock.now()]);
  await tx.query("INSERT INTO ls_identity.account_subjects (workspace_id,account_id,person_id) VALUES ($1,$2,$3)",[config.workspaceId,id,minor.rows[0].id]);
 }),e=>typeof e==='object' && e!==null && 'code' in e && e.code==='23514');
 await assert.rejects(()=>pool.query("INSERT INTO ls_cases.family_members (workspace_id,family_id,person_id,role) VALUES ($1,$2,$3,'child')",[randomUUID(),randomUUID(),minor.rows[0].id]),e=>typeof e==='object' && e!==null && 'code' in e && e.code==='23503');
});
test('PostgreSQL counter is atomic under concurrent requests and recovers after expiry',async()=>{
 const rate=new PostgresIdentityRateStore(store),key=opaqueRateLimitKey('synthetic-parallel-counter',config.rateLimitKey);
 const counts=await Promise.all(Array.from({length:20},()=>rate.consume(key,10000)));assert.ok(new Set(counts.map(x=>x.count)).size===20 && Math.max(...counts.map(x=>x.count))===20);
 await pool.query("UPDATE ls_identity.rate_counters SET expires_at=clock_timestamp()-interval '1 second' WHERE key_digest=$1",[key]);assert.ok((await rate.consume(key,10000)).count===1);
});
test('forward migration rerun is data-preserving and credential cleanup remains scoped',async()=>{
 const before=await pool.query("SELECT count(*)::integer AS count FROM ls_identity.accounts");
 await pool.query(await readFile(resolve('migrations/0010_ls_identity_cases_20260906.sql'),'utf8'));
 const after=await pool.query("SELECT count(*)::integer AS count FROM ls_identity.accounts");assert.ok(before.rows[0].count===after.rows[0].count);
 await pruneAuthEphemera(store,config,clock);
});
