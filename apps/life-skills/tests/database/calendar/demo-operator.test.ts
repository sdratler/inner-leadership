/** Actual production adapters on the guarded disposable native PostgreSQL.
 * Invitation/password/login tokens stay in memory; no transport is constructed.
 */
import {expect,test,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {fixture} from './fixture.ts';
import {CaseService} from '../../../src/features/cases/service.ts';
import {IdentityAccountService} from '../../../src/features/identity/account-service.ts';
import {IdentityAuthService} from '../../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../../src/features/identity/session-adapter.ts';
import {blindEmail,seal,unseal} from '../../../src/features/identity/crypto.ts';
import {prepareDemoHistory} from '../../../src/features/demo/history-operator.ts';
import {prepareDemoPractice} from '../../../src/features/demo/practice-operator.ts';
import {HomePracticeService} from '../../../src/features/home-practice/service.ts';
import {CheckInService} from '../../../src/features/checkins/service.ts';
import type {ResponsibilityInput} from '../../../src/features/home-practice/responsibility-input.ts';
import {civilDate,possibleInstants,shiftDay} from '../../../src/features/calendar/time.ts';
import {systemClock,type AccountId,type Actor} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
import {realCaseEffectAllowed} from '../../../src/features/demo/provenance.ts';
import {drainCalendarEvents} from '../../../src/features/calendar/relay.ts';
import {applyCalendarCreditEffect} from '../../../src/features/payments/calendar-consumer.ts';
const key=()=>randomUUID(),batch='ls-owner-20260927';
// Only the build-time server import marker is stubbed. Every store, clock,
// authorization, transaction and current domain service remains real native PG.
vi.mock('server-only',()=>({}));
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
 return {...f,cases,accounts,auth,config,addresses,actors,minor,adult,prepare,command,booking,realBooking:f.booking,book,counts};
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

test('live selection precedes LIMIT100 when recent DEMO roots outnumber the entire page',()=>using(async f=>{
 for(let i=0;i<101;i++)await f.cases.createDemoAsOperator(f.practitioner.actor.id,
  {kind:'adult',displayName:`DEMO — Synthetic volume ${i}`,familyLabel:`DEMO — Synthetic volume ${i}`},batch,`volume-${i}`,key(),true);
 expect((await f.cases.list(f.practitioner.actor)).some(c=>c.id===f.first.id)).toBe(false);
 const live=await f.cases.list(f.practitioner.actor,'live');
 expect(live.map(c=>c.id).sort()).toEqual([f.first.id,f.second.id].sort());
 expect(live.every(c=>c.mode==='live')).toBe(true);
 const demo=await f.cases.list(f.practitioner.actor,'demo');
 expect(demo).toHaveLength(100);expect(demo.every(c=>c.mode==='demo')).toBe(true);
 for(const role of ['parent','child','adult']){
  await expect(f.cases.list(f.actors[role]!,'live')).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.cases.list(f.actors[role]!,'demo')).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await f.cases.list(f.actors[role]!)).map(c=>c.id)).toEqual([role==='adult'?f.adult.caseId:f.minor.caseId]);
 }
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

test('historical DEMO uses actual past time, completed attendance, encrypted history and exact replay',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId,f.at(-48)),command=key(),before=await f.counts();
 const create=()=>f.service.createDemoHistoryAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true);
 const a=await create();expect(a.status).toBe('completed');expect(a.attendance).toMatchObject({state:'present',attended:true,version:1,arrivedAt:input.startsAt});
 expect(await create()).toEqual(a);expect(await f.counts()).toEqual(before);
 await expect(f.service.createDemoHistoryAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,{...input,startsAt:f.at(-47)},true)).rejects.toMatchObject({code:'CONFLICT'});
 expect((await f.service.get(f.actors.parent!,a.id)).status).toBe('completed');
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='appointment' AND entity_key=$2 AND batch_id=$3 AND case_id=$4",[f.workspaceId,a.id,batch,f.minor.caseId])).rows[0].n).toBe(1);
 expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_attendance.history WHERE workspace_id=$1 AND appointment_id=$2',[f.workspaceId,a.id])).rows[0].n).toBe(1);
 await expect(f.service.create(f.practitioner.actor,key(),input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(f.book(input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
}));
test('historical setup cannot backdate a real case, cross a batch or replace real owner authorization',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId,f.at(-48));
 const create=(owner=f.practitioner.actor.id,b=batch,i=input,permission=true)=>f.service.createDemoHistoryAsOperator(f.workspaceId,owner,b,key(),i,permission);
 await expect(create(f.practitioner.actor.id,batch,input,false)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(create(f.actors.parent!.id)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(create(f.practitioner.actor.id,'ls-owner-20260926')).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(create(f.practitioner.actor.id,batch,{...input,caseId:f.first.id,audienceId:f.first.audienceId})).rejects.toMatchObject({code:'NOT_FOUND'});
 for(const bad of [{...input,startsAt:f.at(1)},{...input,startsAt:f.at(-32*24)},{...input,kind:'parent_guidance' as const,parentForId:asAppointment(input.caseId),parentIds:ready.parentIds},{...input,location:'DEMO https://meet.google.com/invented'},{...input,bufferBefore:1}])await expect(create(f.practitioner.actor.id,batch,bad)).rejects.toMatchObject({code:'INVALID_REQUEST'});
}));
function asAppointment(id:string){return id as import('../../../src/features/calendar/types.ts').AppointmentId;}
test('historical replay rechecks revoked owner and audience without restoring access',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId,f.at(-48)),command=key();
 const create=()=>f.service.createDemoHistoryAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true);await create();
 await f.pool.query('UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND audience_id=$2 AND account_id=$3',[f.workspaceId,ready.audienceId,f.actors.child!.id]);
 await expect(create()).rejects.toMatchObject({code:'CONFLICT'});
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 await expect(create()).rejects.toMatchObject({code:'FORBIDDEN'});
}));
test('historical DEMO placement respects real appointment buffers',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId,f.at(-48));await f.seed(input.startsAt);
 await expect(f.service.createDemoHistoryAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),input,true)).rejects.toMatchObject({code:'CONFLICT'});
}));
test('historical transaction rejects completed real appointment buffers without a partial DEMO write',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId,f.at(-48)),real=await f.seed(input.startsAt);
 await f.pool.query("UPDATE ls_calendar.appointments SET status='completed' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,real]);
 const snapshot=async()=>(await f.pool.query(`SELECT
  (SELECT count(*)::int FROM ls_calendar.appointments WHERE workspace_id=$1 AND case_id=$2) AS appointments,
  (SELECT count(*)::int FROM ls_attendance.records WHERE workspace_id=$1 AND case_id=$2) AS attendance,
  (SELECT count(*)::int FROM ls_calendar.history WHERE workspace_id=$1 AND case_id=$2) AS history,
  (SELECT count(*)::int FROM ls_calendar.commands WHERE workspace_id=$1) AS commands,
  (SELECT count(*)::int FROM ls_calendar.events WHERE workspace_id=$1 AND case_id=$2) AS events`,[f.workspaceId,f.minor.caseId])).rows[0];
 const before=await snapshot();
 await expect(f.service.createDemoHistoryAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),input,true)).rejects.toMatchObject({code:'CONFLICT'});
 expect(await snapshot()).toEqual(before);
}));
test('historical attendance reaches the existing credit consumer but suppresses actual money effects',()=>using(async f=>{
 const ready=await f.prepare(),before=await f.counts(),a=await f.service.createDemoHistoryAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),f.booking(ready.audienceId,f.at(-48)),true);
 expect(await f.db.read(f.practitioner.actor,c=>drainCalendarEvents(c,'credit_effect',applyCalendarCreditEffect))).toBe(1);
 expect(await f.db.read(f.practitioner.actor,c=>drainCalendarEvents(c,'credit_effect',applyCalendarCreditEffect))).toBe(0);
 expect(await f.counts()).toEqual(before);expect(await f.db.store.transaction(tx=>realCaseEffectAllowed(tx,f.workspaceId,a.caseId))).toBe(false);
 expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_demo.suppressed_effects WHERE workspace_id=$1 AND case_id=$2',[f.workspaceId,a.caseId])).rows[0].n).toBe(1);
}));
function historyRecipe(){const anchorDate=civilDate(new Date().toISOString()),dates:string[]=[];
 for(let i=1;dates.length<5;i++){const date=shiftDay(anchorDate,-i),day=new Date(date+'T12:00Z').getUTCDay();if(day!==5&&day!==6)dates.unshift(date);}
 const common={isDemo:true,demoBatchId:batch,source:'owner-acceptance-demo',externalEffects:'deny',realAnalytics:'exclude'},ids=['engagement','regulation','frustration_tolerance','initiative','reflective_capacity','impulse_control','responsiveness','participation','social_engagement'];
 return {schemaVersion:1,recipeOnly:true,notExecuted:true,batchId:batch,anchorDate,timezone:'Asia/Jerusalem',
 appointments:dates.map((localDate,i)=>({...common,stableKey:`session-${i+1}`,caseKey:'case-a',state:'completed',attendance:'present',durationMinutes:60,blocksRealAvailability:false,timezone:'Asia/Jerusalem',localTime:'11:00',localDate})),
 observations:dates.map((observedDate,i)=>({...common,stableKey:`observation-${i+1}`,caseKey:'case-a',sessionKey:`session-${i+1}`,observedDate,visibility:'practitioner_private',values:Object.fromEntries(ids.map((id,j)=>[id,{score:i===2&&j===8?null:3+(i+j)%5,note:'Synthetic observation for interface verification only.'}]))}))};
}
test('full historical preflight refuses a completed real slot before any of the five writes',()=>using(async f=>{
 await f.prepare();const ownerEmail='fixtureowner@example.invalid',recipe=historyRecipe();
 await f.pool.query('UPDATE ls_identity.accounts SET email_blind=$3,email_ciphertext=$4 WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.practitioner.actor.id,blindEmail(ownerEmail,f.config.lookupKey),seal(ownerEmail,`email:${f.workspaceId}:${f.practitioner.actor.id}`,f.keyring)]);
 const startsAt=possibleInstants(recipe.appointments[0]!.localDate+'T11:00')[0]!;
 await f.pool.query("INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,'open')",[key(),f.workspaceId,f.practitioner.actor.id,startsAt,new Date(Date.parse(startsAt)+3600000).toISOString()]);
 const real=await f.seed(startsAt);
 await f.pool.query("UPDATE ls_calendar.appointments SET status='completed' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,real]);
 const before=await f.counts();
 await expect(prepareDemoHistory({config:f.config,store:f.db.store,clock:systemClock},{batch,ownerEmail,addresses:f.addresses},recipe,true)).rejects.toMatchObject({code:'CONFLICT'});
 expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_calendar.appointments WHERE workspace_id=$1 AND case_id=$2',[f.workspaceId,f.minor.caseId])).rows[0].n).toBe(0);
 expect(await f.counts()).toEqual(before);
}));
test('full existing-history operator reads real owner and identities, persists five once and never seeds observations',()=>using(async f=>{
 await f.prepare();const ownerEmail='fixtureowner@example.invalid';
 await f.pool.query('UPDATE ls_identity.accounts SET email_blind=$3,email_ciphertext=$4 WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.practitioner.actor.id,blindEmail(ownerEmail,f.config.lookupKey),seal(ownerEmail,`email:${f.workspaceId}:${f.practitioner.actor.id}`,f.keyring)]);
 const runtime={config:f.config,store:f.db.store,clock:systemClock},selection={batch,ownerEmail,addresses:f.addresses},recipe=historyRecipe(),before=await f.counts();
 await expect(prepareDemoHistory(runtime,selection,recipe,false)).rejects.toMatchObject({code:'FORBIDDEN'});
 const first=await prepareDemoHistory(runtime,selection,recipe,true);expect(first).toEqual({batch,createdOrReused:5,accountChanges:0,providerEffects:0,paymentEffects:0,observationsWritten:0});
 const snapshot=async()=>{const r=await f.pool.query(`SELECT
  (SELECT count(*)::int FROM ls_calendar.appointments WHERE workspace_id=$1 AND case_id=$2 AND status='completed') AS appointments,
  (SELECT count(*)::int FROM ls_attendance.records WHERE workspace_id=$1 AND case_id=$2 AND state='present') AS attendance,
  (SELECT count(*)::int FROM ls_calendar.history WHERE workspace_id=$1 AND case_id=$2) AS history,
  (SELECT count(*)::int FROM ls_calendar.commands WHERE workspace_id=$1) AS commands,
  (SELECT count(*)::int FROM ls_sessions.practitioner_observations WHERE workspace_id=$1) AS observations`,[f.workspaceId,f.minor.caseId]);return r.rows[0];};
 const once=await snapshot();expect(once).toMatchObject({appointments:5,attendance:5,observations:0});
 expect(await prepareDemoHistory(runtime,selection,recipe,true)).toEqual(first);expect(await snapshot()).toEqual(once);expect(await f.counts()).toEqual(before);
 await f.pool.query('UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[f.workspaceId,f.minor.caseId,f.actors.child!.id]);
 await expect(prepareDemoHistory(runtime,selection,recipe,true)).rejects.toMatchObject({code:'CONFLICT'});expect(await snapshot()).toEqual(once);
}));
test('failed historical attendance rolls back its entire appointment, marker, history and receipt transaction',()=>using(async f=>{
 const ready=await f.prepare(),input=f.booking(ready.audienceId,f.at(-48));
 const snapshot=async()=>{const r=await f.pool.query(`SELECT (SELECT count(*)::int FROM ls_calendar.appointments WHERE workspace_id=$1) AS appointments,
  (SELECT count(*)::int FROM ls_attendance.records WHERE workspace_id=$1) AS attendance,
  (SELECT count(*)::int FROM ls_calendar.history WHERE workspace_id=$1) AS history,
  (SELECT count(*)::int FROM ls_calendar.commands WHERE workspace_id=$1) AS commands,
  (SELECT count(*)::int FROM ls_demo.records WHERE workspace_id=$1) AS markers,
  (SELECT count(*)::int FROM ls_calendar.events WHERE workspace_id=$1) AS events`,[f.workspaceId]);return r.rows[0];};
 const before=await snapshot(),functionName='synthetic_attendance_failure_'+randomUUID().replaceAll('-','');
 try{await f.pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.workspace_id='${f.workspaceId}'::uuid THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END$$`);
  await f.pool.query(`CREATE TRIGGER ${functionName} BEFORE INSERT ON ls_attendance.history FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
  await expect(f.service.createDemoHistoryAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),input,true)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
 }finally{await f.pool.query(`DROP TRIGGER IF EXISTS ${functionName} ON ls_attendance.history`);await f.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);}
}));

test('practitioner Calendar defaults to live, separates immutable demo origins and rejects mismatched selected context',()=>using(async f=>{
 const ready=await f.prepare(),demo=await f.book(f.booking(ready.audienceId,f.at(48))),real=await f.seed(f.at(96));
 const query={from:f.at(0),to:f.at(240),caseId:null,cursor:null};
 expect((await f.service.list(f.practitioner.actor,query)).items.map(a=>a.id)).toEqual([real]);
 expect((await f.service.list(f.practitioner.actor,{...query,mode:'demo'})).items.map(a=>a.id)).toEqual([demo.id]);
 await expect(f.service.list(f.practitioner.actor,{...query,caseId:f.minor.caseId,mode:'live'})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(f.service.list(f.practitioner.actor,{...query,caseId:f.first.id,mode:'demo'})).rejects.toMatchObject({code:'NOT_FOUND'});
 for(const role of ['parent','child','adult'] as const)await expect(f.service.list(f.actors[role]!,{...query,caseId:role==='adult'?f.adult.caseId:f.minor.caseId,mode:'demo'})).rejects.toMatchObject({code:'FORBIDDEN'});
 expect((await f.service.list(f.actors.parent!,{...query,caseId:f.minor.caseId})).items.map(a=>a.id)).toEqual([demo.id]);
}));
test('Calendar applies live/demo selection before pagination and preserves the matching demo page',()=>using(async f=>{
 const ready=await f.prepare(),first=await f.book(f.booking(ready.audienceId,f.at(48))),real=await f.seed(f.at(96));
 for(let i=0;i<101;i++){const id=randomUUID();
  await f.pool.query(`INSERT INTO ls_calendar.appointments(id,workspace_id,case_id,audience_id,engagement_id,practitioner_id,terms_version,kind,starts_at,ends_at,parent_ids,buffer_before,buffer_after,location_ciphertext,created_by,created_at)
   SELECT $3,workspace_id,case_id,audience_id,engagement_id,practitioner_id,terms_version,kind,starts_at,ends_at,parent_ids,buffer_before,buffer_after,$4,created_by,created_at FROM ls_calendar.appointments WHERE workspace_id=$1 AND id=$2`,[f.workspaceId,first.id,id,seal('DEMO — Synthetic pagination sample',`calendar:location:${f.workspaceId}:${id}`,f.keyring)]);
  await f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id) VALUES($1,$2,'appointment',$3,$3,$4)",[f.workspaceId,batch,id,f.minor.caseId]);
 }
 const query={from:f.at(0),to:f.at(240),caseId:null,cursor:null};
 expect(await f.service.list(f.practitioner.actor,query)).toMatchObject({items:[{id:real}],nextCursor:null});
 const page=await f.service.list(f.practitioner.actor,{...query,mode:'demo'});expect(page.items).toHaveLength(100);expect(page.nextCursor).not.toBeNull();
 const next=await f.service.list(f.practitioner.actor,{...query,mode:'demo',cursor:page.nextCursor});expect(next.items).toHaveLength(2);expect(next.nextCursor).toBeNull();
 expect(new Set([...page.items,...next.items].map(a=>a.id)).size).toBe(102);expect([...page.items,...next.items].every(a=>a.caseId===f.minor.caseId)).toBe(true);
}));
test('a calendar appointment marker inconsistent with real immutable case origin is an error, not a live or empty result',()=>using(async f=>{
 const real=await f.seed(f.at(48));await f.pool.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id) VALUES($1,$2,'appointment',$3,$3,$4)",[f.workspaceId,batch,real,f.minor.caseId]);
 const query={from:f.at(0),to:f.at(240),caseId:null,cursor:null};
 await expect(f.service.list(f.practitioner.actor,query)).rejects.toMatchObject({code:'UNAVAILABLE'});
 await expect(f.service.list(f.practitioner.actor,{...query,mode:'demo'})).rejects.toMatchObject({code:'UNAVAILABLE'});
}));

test('contained demo practice uses retained writers, ordinary role reads/reports and exact effect-free replay',()=>using(async f=>{
 const practice=new HomePracticeService(f.db.store,f.config,systemClock),checkins=new CheckInService(f.db.store,systemClock,f.keyring);
 const minor=await f.prepare(),adult=await f.cases.prepareDemoCalendarAsOperator(f.practitioner.actor.id,f.adult.caseId,batch,key(),key(),true);
 const before=await f.counts(),date=f.at(48).slice(0,10);
 const make=(role:'child'|'parent'|'adult')=>{
  const responsibility:ResponsibilityInput={participant:role==='parent'?'parent':'client',period:'evening',
   assigneeAccountIds:[f.actors[role]!.id],assistedByParentAccountIds:role==='child'?[f.actors.parent!.id]:[],reminderRecipients:[],
   completionMode:'any_assignee',weekdays:[0,1,2,3,4,5,6],localTime:'18:30',timezone:'UTC',timeOrigin:'practitioner',foldChoice:null};
  return {caseId:role==='adult'?f.adult.caseId:f.minor.caseId,audienceId:role==='adult'?adult.audienceId:minor.audienceId,demoAudienceAccountIds:role==='adult'?[f.actors.adult!.id]:[f.actors.parent!.id,f.actors.child!.id],
   templateKey:'DEMO',templateVersion:'owner-practice-v1',instructions:`DEMO — ${role} small practice`,startsOn:date,endsOn:date,responsibility,
   occurrences:[{occursOn:date,period:'evening' as const}]};
 };
 for(const role of ['child','parent','adult'] as const){
  const input=make(role),command=key(),saved=await practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true);
  expect(saved.occurrences).toHaveLength(1);
  const count=async()=> (await f.pool.query(`SELECT (SELECT count(*)::int FROM ls_practice.practice_assignments WHERE workspace_id=$1) AS assignments,
   (SELECT count(*)::int FROM ls_practice.practice_occurrences WHERE workspace_id=$1) AS occurrences,
   (SELECT count(*)::int FROM ls_practice.action_history WHERE workspace_id=$1) AS history`,[f.workspaceId])).rows[0];
  const once=await count();expect(await practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true)).toEqual(saved);expect(await count()).toEqual(once);
  // A later audience expansion must deny both new setup and cached replay.
  await f.pool.query('INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())',[f.workspaceId,input.caseId,input.audienceId,f.outsider.actor.id]);
  await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),input,true)).rejects.toMatchObject({code:'CONFLICT'});
  await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true)).rejects.toMatchObject({code:'CONFLICT'});
  expect(await count()).toEqual(once);
  await f.pool.query('DELETE FROM ls_cases.audience_accounts WHERE workspace_id=$1 AND audience_id=$2 AND account_id=$3',[f.workspaceId,input.audienceId,f.outsider.actor.id]);
  await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,{...input,instructions:'DEMO — different'},true)).rejects.toMatchObject({code:'CONFLICT'});
  expect((await practice.list(f.actors[role]!,input.caseId,input.audienceId)).some(row=>row.versionId===saved.versionId&&row.instructions===input.instructions)).toBe(true);
  await expect(practice.list(f.outsider.actor,input.caseId,input.audienceId)).rejects.toMatchObject({code:'NOT_FOUND'});
  const occurrence=saved.occurrences[0]!;
  await checkins.submit(f.actors[role]!,{occurrenceId:occurrence.id,status:'done',idempotencyKey:key()},key());
  expect((await checkins.list(f.actors[role]!,occurrence.id,true))[0]).toMatchObject({status:'done',authorAccountId:f.actors[role]!.id});
  // Setup replay never overwrites an ordinary completed occurrence.
  await practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true);
  expect((await f.pool.query('SELECT state FROM ls_practice.practice_occurrences WHERE id=$1',[occurrence.id])).rows[0].state).toBe('closed');
 }
 expect(await f.counts()).toEqual(before);
 expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_notifications.notification_outbox WHERE workspace_id=$1',[f.workspaceId])).rows[0].count).toBe(0);
 expect((await f.pool.query("SELECT count(*)::int AS count FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='assignment'",[f.workspaceId])).rows[0].count).toBe(3);
}));

test('demo practice denies unmarked families, missing capability, real accounts and notices; failed schedules roll back all setup',()=>using(async f=>{
 const practice=new HomePracticeService(f.db.store,f.config,systemClock),prepared=await f.prepare(),date=f.at(48).slice(0,10);
 const responsibility:ResponsibilityInput={participant:'parent',period:'evening',assigneeAccountIds:[f.actors.parent!.id],assistedByParentAccountIds:[],reminderRecipients:[],completionMode:'any_assignee',weekdays:[0,1,2,3,4,5,6],localTime:'18:30',timezone:'UTC',timeOrigin:'practitioner',foldChoice:null};
 const input={caseId:f.minor.caseId,audienceId:prepared.audienceId,demoAudienceAccountIds:[f.actors.parent!.id,f.actors.child!.id],templateKey:'DEMO',templateVersion:'owner-practice-v1',instructions:'DEMO — Parent practice',startsOn:date,endsOn:date,responsibility,occurrences:[{occursOn:date,period:'evening' as const}]};
 const count=async()=> (await f.pool.query(`SELECT (SELECT count(*)::int FROM ls_practice.practice_assignments WHERE workspace_id=$1) AS assignments,
  (SELECT count(*)::int FROM ls_practice.action_history WHERE workspace_id=$1) AS actions,
  (SELECT count(*)::int FROM ls_calendar.commands WHERE workspace_id=$1 AND operation='demo:practice') AS receipts,
  (SELECT count(*)::int FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='assignment') AS markers`,[f.workspaceId])).rows[0];
 const before=await count();
 await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),input,false)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),{...input,caseId:f.first.id,audienceId:f.first.audienceId},true)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(practice.prepareDemoAsOperator(f.workspaceId,f.actors.parent!.id,batch,key(),input,true)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),{...input,responsibility:{...responsibility,reminderRecipients:[{accountId:f.actors.parent!.id,purpose:'self'}]}},true)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,key(),{...input,occurrences:[{occursOn:date,period:'morning'}]},true)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(await count()).toEqual(before);
 const command=key();await practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true);
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 await expect(practice.prepareDemoAsOperator(f.workspaceId,f.practitioner.actor.id,batch,command,input,true)).rejects.toMatchObject({code:'FORBIDDEN'});
}));

test('private practice recipe resolves only retained demo identities; rerun preserves ordinary edits and receipts',()=>using(async f=>{
 const minor=await f.prepare(),adult=await f.cases.prepareDemoCalendarAsOperator(f.practitioner.actor.id,f.adult.caseId,batch,key(),key(),true);
 const ownerEmail='fixtureowner@example.invalid',date=f.at(48).slice(0,10);
 await f.pool.query('UPDATE ls_identity.accounts SET email_blind=$3,email_ciphertext=$4 WHERE workspace_id=$1 AND id=$2',
  [f.workspaceId,f.practitioner.actor.id,blindEmail(ownerEmail,f.config.lookupKey),seal(ownerEmail,`email:${f.workspaceId}:${f.practitioner.actor.id}`,f.keyring)]);
 const marker={isDemo:true,demoBatchId:batch,source:'owner-acceptance-demo',externalEffects:'deny',realAnalytics:'exclude',timezone:'Asia/Jerusalem',revision:1,startDate:date,endDate:date};
 const recipe={schemaVersion:1,recipeOnly:true,notExecuted:true,batchId:batch,timezone:'Asia/Jerusalem',assignments:[
  {...marker,stableKey:'practice-a',caseKey:'case-a',responsibilities:[{key:'child-action',participantKey:'child-a',text:'Choose one small task.',localTime:'18:30'},{key:'parent-support',participantKey:'parent-a',text:'Ask an open question.',localTime:'18:25'}]},
  {...marker,stableKey:'practice-adult',caseKey:'case-adult',responsibilities:[{key:'adult-action',participantKey:'adult-a',text:'Write one reflection.',localTime:'20:00'}]},
 ]};
 const runtime={config:f.config,store:f.db.store,clock:systemClock},selection={batch,ownerEmail,addresses:f.addresses},before=await f.counts();
 await expect(prepareDemoPractice(runtime,selection,recipe,date,false)).rejects.toMatchObject({code:'FORBIDDEN'});
 for(const [caseId,audienceId] of [[f.minor.caseId,minor.audienceId],[f.adult.caseId,adult.audienceId]]){
  await f.pool.query('INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())',[f.workspaceId,caseId,audienceId,f.outsider.actor.id]);
  await expect(prepareDemoPractice(runtime,selection,recipe,date,true)).rejects.toMatchObject({code:'CONFLICT'});
  expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_practice.practice_assignments WHERE workspace_id=$1',[f.workspaceId])).rows[0].count).toBe(0);
  await f.pool.query('DELETE FROM ls_cases.audience_accounts WHERE workspace_id=$1 AND audience_id=$2 AND account_id=$3',[f.workspaceId,audienceId,f.outsider.actor.id]);
 }
 expect(await prepareDemoPractice(runtime,selection,recipe,date,true)).toEqual({batch,createdOrReused:3,accountChanges:0,providerEffects:0,paymentEffects:0,completionReportsWritten:0});
 const snapshot=async()=> (await f.pool.query(`SELECT (SELECT json_agg(a ORDER BY id) FROM ls_practice.practice_assignments a WHERE workspace_id=$1) AS assignments,
  (SELECT json_agg(o ORDER BY id) FROM ls_practice.practice_occurrences o WHERE workspace_id=$1) AS occurrences,
  (SELECT count(*)::int FROM ls_practice.action_history WHERE workspace_id=$1) AS actions,
  (SELECT count(*)::int FROM ls_calendar.commands WHERE workspace_id=$1 AND operation='demo:practice') AS receipts`,[f.workspaceId])).rows[0];
 const once=await snapshot();expect(once.assignments).toHaveLength(3);expect(once.occurrences).toHaveLength(3);expect(once.receipts).toBe(3);
 await prepareDemoPractice(runtime,selection,recipe,date,true);expect(await snapshot()).toEqual(once);expect(await f.counts()).toEqual(before);
 expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_notifications.notification_outbox WHERE workspace_id=$1',[f.workspaceId])).rows[0].count).toBe(0);
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.actors.child!.id]);
 await expect(prepareDemoPractice(runtime,selection,recipe,date,true)).rejects.toMatchObject({code:'CONFLICT'});expect(await snapshot()).toEqual(once);
}));
