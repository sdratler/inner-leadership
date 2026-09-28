/** Actual production adapters on the guarded disposable native PostgreSQL.
 * Invitation/password/login tokens stay in memory; no transport is constructed.
 */
import {expect,test} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {fixture} from './fixture.ts';
import {CaseService} from '../../../src/features/cases/service.ts';
import {IdentityAccountService} from '../../../src/features/identity/account-service.ts';
import {IdentityAuthService} from '../../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../../src/features/identity/session-adapter.ts';
import {seal,unseal} from '../../../src/features/identity/crypto.ts';
import {systemClock,type AccountId,type Actor} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
import {realCaseEffectAllowed} from '../../../src/features/demo/provenance.ts';
import {drainCalendarEvents} from '../../../src/features/calendar/relay.ts';
import {applyCalendarCreditEffect} from '../../../src/features/payments/calendar-consumer.ts';
const key=()=>randomUUID(),batch='ls-owner-20260927';
async function setup(){
 const f=await fixture();
 try{
 const addresses={parent:'syntheticowner+demo-parent@example.invalid',child:'syntheticowner+demo-child@example.invalid',adult:'syntheticowner+demo-adult@example.invalid'};
 const config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,
  keyring:f.keyring,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString('hex'),
  sessionSeconds:8*3600,childAccountsEnabled:true,demoSetupRecipients:Object.values(addresses)};
 const cases=new CaseService(f.db.store,config,systemClock),accounts=new IdentityAccountService(f.db.store,config,systemClock),
  auth=new IdentityAuthService(f.db.store,config,systemClock),sessions=new IdentitySessions(f.db.store,config,systemClock);
 const minor=await cases.createDemoAsOperator(f.practitioner.actor.id,{kind:'minor',displayName:'DEMO — Child A',familyLabel:'DEMO — Family A'},batch,'owner-minor-a',key(),true);
 const adult=await cases.createDemoAsOperator(f.practitioner.actor.id,{kind:'adult',displayName:'DEMO — Adult',familyLabel:'DEMO — Adult'},batch,'owner-adult-a',key(),true);
 const actors:Record<string,Actor>={};
 for(const [role,address] of Object.entries(addresses)){
  const {accountId}=await accounts.inviteDemoAsOperator(f.practitioner.actor.id,role==='adult'?'adult_client':role as 'parent'|'child',
   {caseId:role==='adult'?adult.caseId:minor.caseId,email:address,displayName:`DEMO — ${role}`,locale:'en'},key(),true);
  const mail=(await f.pool.query('SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind=\'invite\' AND state=\'queued\'',[f.workspaceId,accountId])).rows[0];
  const payload=JSON.parse(unseal(mail.payload_ciphertext,`auth-mail:${f.workspaceId}:${mail.id}`,f.keyring));
  await auth.consumePasswordToken('invite',payload.token,'Ab9x!q',key());
  const preauth=await auth.preauth(),login=await auth.login(address,'Ab9x!q',preauth.token,key());
  actors[role]=await sessions.actor(login.token);
 }
 const command=key(),prepare=()=>cases.prepareDemoCalendarAsOperator(f.practitioner.actor.id,minor.caseId,batch,command,key(),true);
 const booking=(audienceId:Awaited<ReturnType<typeof prepare>>['audienceId'],startsAt=f.at(48))=>({...f.booking(startsAt),caseId:minor.caseId,audienceId,location:'DEMO — Synthetic local calendar'});
 const book=(input:ReturnType<typeof booking>,commandKey=key())=>f.service.createDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,commandKey,input,true);
 const counts=async()=>{const r=await f.pool.query(`SELECT
  (SELECT count(*)::int FROM ls_identity.accounts WHERE workspace_id=$1) AS accounts,
  (SELECT count(*)::int FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1) AS mail,
  (SELECT count(*)::int FROM ls_onboarding.provider_receipts WHERE workspace_id=$1) AS payments,
  (SELECT count(*)::int FROM ls_payments.credit_events WHERE workspace_id=$1) AS credits,
  (SELECT count(*)::int FROM ls_payments.credit_blocks WHERE workspace_id=$1) AS blocks`,[f.workspaceId]);return r.rows[0];};
 return {...f,cases,accounts,auth,config,actors,minor,adult,prepare,command,booking,realBooking:f.booking,book,counts};
 }catch(error){await f.pool.end();throw error;}
}
async function using(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){const f=await setup();try{await work(f);}finally{await f.pool.end();}}
test('native service fixture enforces the exact production UUID-array binding contract',()=>using(async f=>{
 const ids=[f.practitioner.actor.id];
 await expect(f.db.store.transaction(tx=>tx.query('SELECT $1 AS ids',[ids]))).rejects.toMatchObject({code:'INTERNAL'});
 expect(await f.db.store.transaction(tx=>tx.query('SELECT $1::uuid[] AS ids',[ids]))).toEqual([{ids}]);
}));

test('authorized case lists retain immutable DEMO provenance without inferring it from names or changing role access',()=>using(async f=>{
 const rename=async(caseId:string,displayName:string)=>{
  const person=(await f.pool.query(`SELECT cl.person_id FROM ls_cases.clients cl JOIN ls_cases.cases c
   ON c.workspace_id=cl.workspace_id AND c.client_id=cl.id WHERE c.workspace_id=$1 AND c.id=$2`,[f.workspaceId,caseId])).rows[0].person_id;
  await f.pool.query('UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',
   [f.workspaceId,person,seal(JSON.stringify({displayName}),`person:${f.workspaceId}:${person}`,f.keyring)]);
 };
 const before=await f.counts();
 await rename(f.first.id,'DEMO is part of this real name');
 await rename(f.minor.caseId,'Synthetic exercise record');
 const rows=await f.cases.list(f.practitioner.actor);
 expect(rows.find(c=>c.id===f.first.id)).toMatchObject({displayName:'DEMO is part of this real name',mode:'live'});
 expect(rows.find(c=>c.id===f.minor.caseId)).toMatchObject({displayName:'Synthetic exercise record',mode:'demo'});
 expect(rows.find(c=>c.id===f.adult.caseId)).toMatchObject({mode:'demo'});
 for(const role of ['parent','child','adult']){
  const allowed=await f.cases.list(f.actors[role]!);
  expect(allowed.map(c=>({id:c.id,mode:c.mode}))).toEqual([{id:role==='adult'?f.adult.caseId:f.minor.caseId,mode:'demo'}]);
  expect(Object.keys(allowed[0]!).sort()).toEqual(['displayName','id','kind','mode','state']);
 }
 await f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',
  [f.workspaceId,f.minor.caseId,f.actors.parent!.id]);
 expect(await f.cases.list(f.actors.parent!)).toEqual([]);
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.actors.child!.id]);
 await expect(f.cases.list(f.actors.child!)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 expect(await f.counts()).toEqual(before);
}));
test('prepares only the existing cases; repeats reuse engagement, audience and history with no identity/payment effects',()=>using(async f=>{
 const before=await f.counts(),a=await f.prepare();expect(await f.prepare()).toEqual(a);expect(await f.counts()).toEqual(before);
 expect(a.accountIds.sort()).toEqual([f.actors.parent!.id,f.actors.child!.id].sort());
 const row=(await f.pool.query(`SELECT c.state,(SELECT count(*)::int FROM ls_cases.engagements e WHERE e.workspace_id=c.workspace_id AND e.case_id=c.id) AS engagements,
  (SELECT count(*)::int FROM ls_cases.audiences a WHERE a.workspace_id=c.workspace_id AND a.case_id=c.id) AS audiences FROM ls_cases.cases c WHERE c.workspace_id=$1 AND c.id=$2`,[f.workspaceId,f.minor.caseId])).rows[0];
 expect(row).toEqual({state:'active',engagements:1,audiences:1});
 expect((await f.pool.query("SELECT action FROM ls_identity.action_history WHERE workspace_id=$1 AND action IN ('engagement_created','audience_created','case_status_changed') ORDER BY occurred_at,id",[f.workspaceId])).rows.map(r=>r.action).sort()).toEqual(['audience_created','case_status_changed','engagement_created']);
}));
test('ordinary real login roles read persisted items; cross-family access and parent writes remain denied',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId),a=await f.book(input);
 for(const role of ['parent','child']){expect(f.actors[role]?.role).toBe(role);
  expect((await f.cases.list(f.actors[role]!)).map(c=>c.id)).toEqual([f.minor.caseId]);
  const page=await f.service.list(f.actors[role]!,{from:f.at(0),to:f.at(240),caseId:f.minor.caseId,cursor:null});expect(page.items.map(i=>i.id)).toEqual([a.id]);}
 await expect(f.service.get(f.actors.adult!,a.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 // Existing case policy deliberately conceals a client write as NOT_FOUND.
 await expect(f.service.create(f.actors.parent!,key(),input)).rejects.toMatchObject({code:'NOT_FOUND'});
 const adult=await f.cases.prepareDemoCalendarAsOperator(f.practitioner.actor.id,f.adult.caseId,batch,key(),key(),true);
 const b=await f.book({...input,caseId:f.adult.caseId,audienceId:adult.audienceId,startsAt:f.at(60)});
 expect((await f.service.get(f.actors.adult!,b.id)).id).toBe(b.id);
 await expect(f.service.get(f.actors.child!,b.id)).rejects.toMatchObject({code:'NOT_FOUND'});
}));
test('booking retries reuse one actual appointment and immutable marker; changed input conflicts',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId),command=key(),a=await f.book(input,command);
 expect(await f.book(input,command)).toEqual(a);
 await expect(f.book({...input,startsAt:f.at(49)},command)).rejects.toMatchObject({code:'CONFLICT'});
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='appointment' AND entity_key=$2 AND batch_id=$3 AND case_id=$4",[f.workspaceId,a.id,batch,f.minor.caseId])).rows[0].n).toBe(1);
 await expect(f.pool.query("UPDATE ls_demo.records SET source_key='changed' WHERE workspace_id=$1 AND entity_key=$2",[f.workspaceId,a.id])).rejects.toMatchObject({code:'23514'});
}));
test('explicit capability, real owner, case ancestry and batch checks precede all writes',()=>using(async f=>{
 const denied=(id:AccountId,caseId=f.minor.caseId,b=batch,permission=true)=>f.cases.prepareDemoCalendarAsOperator(id,caseId,b,key(),key(),permission);
 await expect(denied(f.practitioner.actor.id,f.minor.caseId,batch,false)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(denied(f.actors.parent!.id)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(denied(f.practitioner.actor.id,f.first.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(denied(f.practitioner.actor.id,f.minor.caseId,'ls-owner-20260926')).rejects.toMatchObject({code:'NOT_FOUND'});
 await f.pool.query("UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=(SELECT cl.person_id FROM ls_cases.clients cl JOIN ls_cases.cases c ON c.workspace_id=cl.workspace_id AND c.client_id=cl.id WHERE c.workspace_id=$1 AND c.id=$2)",[f.workspaceId,f.first.id,'DEMO display text is not ancestry']);
 await expect(denied(f.practitioner.actor.id,f.first.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await f.pool.query('SELECT state FROM ls_cases.cases WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.minor.caseId])).rows[0].state).toBe('invited');
}));
test('foreign-workspace practitioners and revoked owners cannot take or replay the batch',()=>using(async f=>{
 const ready=await f.prepare(),g=await fixture();try{
  // Existing schema allows exactly one practitioner per workspace; preserve it.
  await expect(f.cases.prepareDemoCalendarAsOperator(g.practitioner.actor.id,f.minor.caseId,batch,key(),key(),true)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(g.db.demoOperatorCommand(g.workspaceId,g.practitioner.actor.id,f.minor.caseId,batch,'demo:case:prepare',f.command,{},true,async()=>{},async()=>({accepted:true}))).rejects.toMatchObject({code:'NOT_FOUND'});
 }finally{await g.pool.end();}
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 await expect(f.prepare()).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(f.book(f.booking(ready.audienceId))).rejects.toMatchObject({code:'FORBIDDEN'});
}));
test('revoked audience membership blocks setup and booking replay rather than reinstating it',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId),command=key(),a=await f.book(input,command);
 await f.pool.query('UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND audience_id=$2 AND account_id=$3',[f.workspaceId,ready.audienceId,f.actors.child!.id]);
 await expect(f.prepare()).rejects.toMatchObject({code:'CONFLICT'});
 await expect(f.book(input,command)).rejects.toMatchObject({code:'CONFLICT'});
 await expect(f.service.get(f.actors.child!,a.id)).rejects.toMatchObject({code:'NOT_FOUND'});
}));
test('unpublished audience and canceled engagement are not resurrected by cached preparation',()=>using(async f=>{
 const ready=await f.prepare();await f.pool.query('UPDATE ls_cases.audiences SET published=false WHERE workspace_id=$1 AND id=$2',[f.workspaceId,ready.audienceId]);
 await expect(f.prepare()).rejects.toMatchObject({code:'CONFLICT'});
 await f.pool.query('UPDATE ls_cases.audiences SET published=true WHERE workspace_id=$1 AND id=$2',[f.workspaceId,ready.audienceId]);
 await f.pool.query("UPDATE ls_cases.engagements SET state='canceled' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,ready.engagementId]);
 await expect(f.prepare()).rejects.toMatchObject({code:'CONFLICT'});
}));
test('real appointments and buffers are respected; a DEMO does not reserve real capacity',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId);
 await f.seed(f.at(49));await expect(f.book({...input,bufferAfter:1})).rejects.toMatchObject({code:'CONFLICT'});
 // The real ordinary route invokes create(), not the private operator path.
 await expect(f.service.create(f.practitioner.actor,key(),{...input,bufferAfter:1})).rejects.toMatchObject({code:'CONFLICT'});
 await expect(f.service.create(f.practitioner.actor,key(),{...input,startsAt:f.at(49)})).rejects.toMatchObject({code:'CONFLICT'});
 const a=await f.book({...input,startsAt:f.at(52)});
 const real=await f.service.create(f.practitioner.actor,key(),f.realBooking(f.at(52),f.second));expect(real.id).not.toBe(a.id);
}));
test('linked parent guidance is fifteen minutes; wrong family, invented provider link and invalid policy input fail',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId),child=await f.book(input);
 const guidance={...input,kind:'parent_guidance' as const,startsAt:f.at(50),parentForId:child.id,parentIds:ready.parentIds};
 const a=await f.book(guidance);expect(Date.parse(a.endsAt)-Date.parse(a.startsAt)).toBe(15*60_000);
 expect(a.parentForId).toBe(child.id);expect((await f.service.get(f.actors.parent!,a.id)).kind).toBe('parent_guidance');
 await expect(f.book({...guidance,parentIds:[f.outsider.actor.id]})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(f.book({...input,location:'DEMO https://meet.google.com/invented'})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(f.book({...input,bufferBefore:-1})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(f.book({...input,startsAt:f.at(-1)})).rejects.toMatchObject({code:'INVALID_REQUEST'});
}));
test('ordinary parent notice on the new DEMO reaches the real credit consumer with durable suppression and no real debit',()=>using(async f=>{
 const ready=await f.prepare(),a=await f.book(f.booking(ready.audienceId,f.at(12))),before=await f.counts();
 await f.service.receiveNotice(f.actors.parent!,a.id,key(),{kind:'cancel',proposedWindows:[]},new Date());
 expect(await f.db.read(f.practitioner.actor,c=>drainCalendarEvents(c,'credit_effect',applyCalendarCreditEffect))).toBe(1);
 expect(await f.db.read(f.practitioner.actor,c=>drainCalendarEvents(c,'credit_effect',applyCalendarCreditEffect))).toBe(0);
 expect(await f.counts()).toEqual(before);
 expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_demo.suppressed_effects WHERE workspace_id=$1 AND case_id=$2',[f.workspaceId,f.minor.caseId])).rows[0].n).toBe(1);
 expect(await f.db.store.transaction(tx=>realCaseEffectAllowed(tx,f.workspaceId,f.minor.caseId))).toBe(false);
}));
test('a case marker alone without immutable person/client/family ancestry is insufficient',async()=>{
 const f=await fixture({demoFirst:true});try{
  await expect(f.db.demoOperatorCommand(f.workspaceId,f.practitioner.actor.id,f.first.id,'ls-owner-20260925','demo:case:prepare',key(),{},true,async()=>{},async()=>({accepted:true}))).rejects.toMatchObject({code:'NOT_FOUND'});
 }finally{await f.pool.end();}
});
