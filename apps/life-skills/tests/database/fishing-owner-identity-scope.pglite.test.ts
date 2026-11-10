import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {IdentityAuthService} from '../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../src/features/identity/session-adapter.ts';
import {IdentityPreferenceService} from '../../src/features/identity/preferences.ts';
import {accountById} from '../../src/features/identity/data.ts';
import {issueAuthToken,queueAuthMail} from '../../src/features/identity/auth-mail.ts';
import type {AuthMailKind} from '../../src/features/identity/auth-mail.ts';
import {opaqueToken,tokenDigest,hashPassword,blindEmail,seal} from '../../src/features/identity/crypto.ts';
import type {IdentityConfig} from '../../src/features/identity/config.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {dispatchOneAuthMail,processResetRequest,processResetRequests} from '../../src/providers/email/dispatch.ts';

let engine:PGlite,password:string,passwordHash:string;
const now=new Date('2035-01-02T15:00:00Z'),clock={now:()=>new Date(now)};
const keyring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}};
const noNetwork=vi.fn(async()=>{throw Error('OWNER_IDENTITY_EXTERNAL_NETWORK_DENIED');});
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',noNetwork);engine=new PGlite();await engine.exec('CREATE SCHEMA ls_control');
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0030_ls_calendar_attendance_20260907.sql','0097_ls_demo_provenance.sql'])await engine.exec(await readFile('migrations/'+name,'utf8'));
 password=opaqueToken();passwordHash=await hashPassword(password);
},20000);
afterEach(()=>expect(noNetwork).not.toHaveBeenCalled());
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});

async function setup(){
 const workspace=asId(randomUUID(),'workspace'),owner=asId(randomUUID(),'account'),parent=asId(randomUUID(),'account');
 const store:IdentityStore={transaction:work=>engine.transaction(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>
  (await tx.query<T>(sql,[...v])).rows} as SqlSession))};
 const config:IdentityConfig={enabled:true,origin:'https://synthetic-owner.invalid',workspaceId:workspace,ownerAccountId:owner,
  csrfKey:Buffer.alloc(32,8),lookupKey:Buffer.alloc(32,9),rateLimitKey:'SYNTHETIC-OWNER-IDENTITY',keyring,sessionSeconds:3600};
 await engine.query('INSERT INTO ls_identity.workspaces VALUES($1,$2)',[workspace,now]);
 for(const [id,role,email] of [[owner,'practitioner','owner@example.invalid'],[parent,'parent','parent@example.invalid']] as const){
  const person=asId(randomUUID(),'person');
  await engine.query("INSERT INTO ls_identity.people VALUES($1,$2,'adult',$3,$4)",[person,workspace,seal(JSON.stringify({displayName:'SYNTHETIC '+role}),`person:${workspace}:${person}`,keyring),now]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,$7,$6,$6)",
   [id,workspace,role,blindEmail(email,config.lookupKey),seal(email,`email:${workspace}:${id}`,keyring),now,passwordHash]);
  await engine.query('INSERT INTO ls_identity.account_subjects VALUES($1,$2,$3)',[workspace,id,person]);
 }
 const auth=new IdentityAuthService(store,config,clock),sessions=new IdentitySessions(store,config,clock);
 const account=async(id:typeof owner)=>{const row=await store.transaction(tx=>accountById(tx,workspace,id));if(!row)throw Error('SYNTHETIC_ACCOUNT_MISSING');return row;};
 async function queue(id:typeof owner,kind:AuthMailKind){
  const mailId=randomUUID();
  await engine.query("INSERT INTO ls_identity.auth_mail_outbox(id,workspace_id,account_id,kind,payload_ciphertext,created_at,expires_at,next_attempt_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$6,'queued')",
   [mailId,workspace,id,kind,seal(JSON.stringify({recipient:id===owner?'owner@example.invalid':'parent@example.invalid',locale:'en',token:null}),`auth-mail:${workspace}:${mailId}`,keyring),now,new Date(now.getTime()+3600000)]);
  return mailId;
 }
 async function markDemo(){
  await engine.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,'ls-owner-20260925',$2)",[workspace,owner]);
  await engine.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,'ls-owner-20260925','SYNTHETIC-owner')",[workspace,owner]);
 }
 return {workspace,owner,parent,store,config,auth,sessions,account,queue,markDemo};
}

it('logs in only the selected current owner and rejects a real parent credential and pre-existing session',async()=>{
 const f=await setup(),preauth=await f.auth.preauth();
 const login=await f.auth.login('owner@example.invalid',password,preauth.token,randomUUID());
 expect((await f.sessions.actor(login.token)).id).toBe(f.owner);
 const other=await f.auth.preauth();
 await expect(f.auth.login('parent@example.invalid',password,other.token,randomUUID())).rejects.toThrow('UNAUTHENTICATED');
 const parentToken=opaqueToken();
 await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenDigest(parentToken),f.workspace,f.parent,now,new Date(now.getTime()+3600000)]);
 expect(await f.sessions.resolve(parentToken)).toBeNull();
 expect((await engine.query<{count:number}>('SELECT count(*)::int AS count FROM ls_identity.sessions WHERE workspace_id=$1',[f.workspace])).rows[0]!.count).toBe(2);
 await engine.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspace,f.owner]);
 await expect(f.sessions.actor(login.token)).rejects.toThrow('UNAUTHENTICATED');
});

it('rejects a marked demo owner even when the historical setup recipient is allowlisted',async()=>{
 const f=await setup();await f.markDemo();
 const config={...f.config,demoSetupRecipients:['owner@example.invalid']},auth=new IdentityAuthService(f.store,config,clock),preauth=await auth.preauth();
 await expect(auth.login('owner@example.invalid',password,preauth.token,randomUUID())).rejects.toThrow('UNAUTHENTICATED');
 const owner=await f.account(f.owner);
 await expect(f.store.transaction(tx=>issueAuthToken(tx,config,owner,{now,requestId:randomUUID()},'reset'))).rejects.toThrow('FORBIDDEN');
 expect((await engine.query('SELECT id FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});

it('denies inherited parent reset tokens and owner invites/notices before durable credential or mail changes',async()=>{
 const f=await setup(),token=opaqueToken(),digest=tokenDigest(token);
 await engine.query("INSERT INTO ls_identity.auth_tokens(token_digest,workspace_id,account_id,purpose,created_at,expires_at) VALUES($1,$2,$3,'reset',$4,$5)",[digest,f.workspace,f.parent,now,new Date(now.getTime()+3600000)]);
 await expect(f.auth.consumePasswordToken('reset',token,opaqueToken(),randomUUID())).rejects.toThrow('INVALID_REQUEST');
 expect((await f.account(f.parent)).passwordHash).toBe(passwordHash);
 expect((await engine.query<{used_at:Date|null}>('SELECT used_at FROM ls_identity.auth_tokens WHERE token_digest=$1',[digest])).rows[0]!.used_at).toBeNull();
 const owner=await f.account(f.owner),parent=await f.account(f.parent),context={now,requestId:randomUUID()};
 await expect(f.store.transaction(tx=>issueAuthToken(tx,f.config,parent,context,'reset'))).rejects.toThrow('FORBIDDEN');
 await expect(f.store.transaction(tx=>issueAuthToken(tx,f.config,owner,context,'invite'))).rejects.toThrow('FORBIDDEN');
 await expect(f.store.transaction(tx=>queueAuthMail(tx,f.config,owner,context,'case_notice',null))).rejects.toThrow('FORBIDDEN');
 expect((await engine.query('SELECT id FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});

it.each([false,true])('the reset worker keeps address privacy and resolves only the owner (batch=%s)',async batch=>{
 const f=await setup(),ownerRequest=randomUUID(),parentRequest=randomUUID();
 await f.auth.requestReset('parent@example.invalid',parentRequest);await f.auth.requestReset('owner@example.invalid',ownerRequest);
 if(batch)expect(await processResetRequests(f.store,f.config,clock)).toBe(2);
 else{expect(await processResetRequest(f.store,f.config,clock,parentRequest)).toBeNull();expect(await processResetRequest(f.store,f.config,clock,ownerRequest)).toBeTruthy();}
 const rows=(await engine.query<{account_id:string;kind:string}>('SELECT account_id,kind FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1',[f.workspace])).rows;
 expect(rows).toEqual([{account_id:f.owner,kind:'reset'}]);
 expect((await engine.query('SELECT id FROM ls_identity.reset_requests WHERE workspace_id=$1 AND processed_at IS NULL',[f.workspace])).rows).toHaveLength(0);
});

it.each([false,true])('dispatch selects only permitted owner purposes and leaves historical queues intact (nonIdempotent=%s)',async nonIdempotent=>{
 const f=await setup(),parentMail=await f.queue(f.parent,'reset'),caseMail=await f.queue(f.owner,'case_notice'),ownerMail=await f.queue(f.owner,'security_notice');
 const send=vi.fn(async()=>({providerId:'SYNTHETIC-NOT-A-REAL-DELIVERY'})),transport={nonIdempotent,send};
 expect(await dispatchOneAuthMail(f.store,f.config,clock,transport,'synthetic@example.invalid',parentMail)).toBe('idle');
 expect(await dispatchOneAuthMail(f.store,f.config,clock,transport,'synthetic@example.invalid',caseMail)).toBe('idle');
 expect(await dispatchOneAuthMail(f.store,f.config,clock,transport,'synthetic@example.invalid')).toBe('sent');
 expect(send).toHaveBeenCalledTimes(1);
 expect(send.mock.calls[0]).toMatchObject([{to:'owner@example.invalid',idempotencyKey:`ls-auth-${ownerMail}`}]);
 const rows=(await engine.query<{id:string;state:string;payload_ciphertext:string|null}>('SELECT id,state,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1',[f.workspace])).rows;
 for(const id of [parentMail,caseMail])expect(rows.find(row=>row.id===id)).toMatchObject({state:'queued',payload_ciphertext:expect.any(String)});
 expect(await dispatchOneAuthMail(f.store,f.config,clock,transport,'synthetic@example.invalid')).toBe('idle');expect(send).toHaveBeenCalledTimes(1);
});

it('rechecks the real owner role after a non-idempotent reservation commits, before network',async()=>{
 const f=await setup();await f.queue(f.owner,'security_notice');let transactions=0;
 const store:IdentityStore={transaction:async work=>{if(++transactions===2)await engine.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspace,f.owner]);return f.store.transaction(work);}};
 const send=vi.fn(async()=>({providerId:'SYNTHETIC-NOT-SENT'}));
 expect(await dispatchOneAuthMail(store,f.config,clock,{nonIdempotent:true,send},'synthetic@example.invalid')).toBe('canceled');
 expect(send).not.toHaveBeenCalled();
});
it('owner contact readback requires the actual selected non-demo account inside its data transaction',async()=>{
 const f=await setup(),preauth=await f.auth.preauth(),login=await f.auth.login('owner@example.invalid',password,preauth.token,randomUUID()),actor=await f.sessions.actor(login.token);
 const preferences=new IdentityPreferenceService(f.store,f.config,clock);
 expect(await preferences.contacts(actor)).toEqual({email:'owner@example.invalid',emailVerified:true,phone:null,phoneVerified:false});
 await f.markDemo();
 await expect(preferences.contacts(actor)).rejects.toThrow('FORBIDDEN');
});
it('owner contact mutation cannot use an earlier owner actor after its real role is changed',async()=>{
 const f=await setup(),preauth=await f.auth.preauth(),login=await f.auth.login('owner@example.invalid',password,preauth.token,randomUUID()),actor=await f.sessions.actor(login.token);
 await engine.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspace,f.owner]);
 const preferences=new IdentityPreferenceService(f.store,f.config,clock);
 await expect(preferences.setUnverifiedPhone(actor,'+12025550123',passwordHash,randomUUID())).rejects.toThrow('FORBIDDEN');
 expect((await f.account(f.owner)).phoneCiphertext).toBeNull();
});
