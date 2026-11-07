import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {FishingBillingStore,type BillingAuthority,type BillingOutboxReservation} from '../../src/features/fishing-billing/native.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import type {CreateFamilyOffer,FamilyOffer,ReminderPolicy} from '../../src/features/fishing-billing/contracts.ts';
import {REMINDER_SERVICE_VERSION,type BillingReminderServiceConfiguration,type BillingReminderServiceAuthority,type VerifiedReminderOutcome} from '../../src/features/fishing-billing/reminder-service.ts';
vi.mock('server-only',()=>({}));

// Explicit in-memory DB only. No URL, credentials, .env, port, migration runner,
// provider transport or existing native-data import. PGlite serializes its
// transactions; this proves fencing/constraints, not multi-connection Postgres.
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),otherWorkspace=asId(randomUUID(),'workspace');
const now=new Date('2035-01-06T15:00:00Z');let owner:Actor,parent:Actor,outsider:Actor;
const sendWindowOpen=true,consented=true,authorityRevoked=false,ownerEnabled=true;let outboxFails=false;
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}};
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({
 query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows,
} as SqlSession))};
const authority:BillingAuthority={
 authorize:async(c,action,s)=>{
  if(s.programKey!=='fishing_monthly_club'||authorityRevoked)throw new AppError('FORBIDDEN');
  if(s.familyId===null){if(c.actor.id!==owner.id||action!=='publish')throw new AppError('FORBIDDEN');return;}
  const rows=await c.tx.query<{guardianId:string}>('SELECT guardian_id AS "guardianId" FROM synthetic_billing.program_families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[c.workspaceId,s.familyId]);
  if(rows.length!==1||c.actor.id!==owner.id&&c.actor.id!==rows[0]!.guardianId)throw new AppError('FORBIDDEN');
  const members=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[c.workspaceId,s.familyId]);
  if(!s.childIds.every(id=>members.some(m=>m.id===id)))throw new AppError('FORBIDDEN');
 },
 reminderPermission:async(c,q,p,guardianId,channel)=>{
  const rows=await c.tx.query<{guardianId:string}>('SELECT guardian_id AS "guardianId" FROM synthetic_billing.program_families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[c.workspaceId,q.familyId]);
  if(rows.length!==1||rows[0]!.guardianId!==guardianId)throw new AppError('FORBIDDEN');
  return {audience:{guardianId,channel,audience:'individual',locale:'he',verified:true,consented,active:true},sendWindowOpen,ownerEnabled,policyCurrent:p.id==='SYNTHETIC-APPROVED-REMINDER'&&p.source.sha256==='a'.repeat(64)};
 },
};
const outbox:BillingOutboxReservation={reserve:async(c,{intent,amount})=>{
 if(outboxFails)throw new Error('SYNTHETIC_EXISTING_OUTBOX_FAILURE');
 await c.tx.query('INSERT INTO synthetic_billing.existing_outbox(dispatch_id,intent_id,remaining_minor,lines_json) VALUES($1,$2,$3,$4::jsonb)',[intent.dispatchId,intent.id,amount.remainingMinor,JSON.stringify(amount.lines)]);
}};
const store=(dbinder:IdentityStore=binder,at=now)=>new FishingBillingStore(dbinder,workspace,ring,Buffer.alloc(32,9),authority,{now:()=>at},outbox);
async function actor(role:'practitioner'|'parent',ws=workspace){
 const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)",[id,ws,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)",[id,ws,role,digest,now]);
 await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[ws,id]);
 await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,ws,id,now,new Date('2036-01-01T00:00:00Z')]);
 return {id:asId(id,'account'),workspaceId:ws,personId:asId(id,'person'),role,state:'active',locale:'en',sessionDigest:digest,expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
}
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const file of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
 await db.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));
 await db.exec('CREATE SCHEMA synthetic_billing;CREATE TABLE synthetic_billing.program_families(workspace_id uuid,family_id uuid,guardian_id uuid,revoked boolean DEFAULT false,PRIMARY KEY(workspace_id,family_id));CREATE TABLE synthetic_billing.existing_outbox(dispatch_id uuid PRIMARY KEY,intent_id uuid UNIQUE,remaining_minor integer,lines_json jsonb NOT NULL);');
 for(const w of [workspace,otherWorkspace])await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[w,now]);
 owner=await actor('practitioner');parent=await actor('parent');outsider=await actor('practitioner',otherWorkspace);
},20000);
afterAll(async()=>{await db.close();});
async function scenario(accept=true,distinctDue=false){
 const familyId=randomUUID(),children=[randomUUID(),randomUUID()],definition={...syntheticDefinition(),id:randomUUID()};
 await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[familyId,workspace,'SYNTHETIC',now]);
 await db.query('INSERT INTO synthetic_billing.program_families(workspace_id,family_id,guardian_id) VALUES($1,$2,$3)',[workspace,familyId,parent.id]);
 for(const id of children){
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','SYNTHETIC',$3)",[id,workspace,now]);
  await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspace,familyId,id]);
 }
 const offer={version:definition.version,id:definition.id,programKey:definition.programKey,environment:definition.environment,
  currency:definition.currency,unitAmountMinor:definition.unitAmountMinor,effectiveAt:definition.effectiveAt,source:definition.source,terms:definition.terms,policies:definition.policies};
 await store().publishOffer(owner,{operationId:randomUUID(),offer});
 const cmd:CreateFamilyOffer={operationId:randomUUID(),id:randomUUID(),familyId,definitionId:definition.id,override:null,children:children.map((childId,index)=>({
  lineId:randomUUID(),childId,groupId:null,period:{id:randomUUID(),startsAt:'2035-01-01T05:00:00Z',endsAt:'2035-02-01T05:00:00Z',timeZone:'America/New_York'},dueAt:distinctDue&&index===1?'2035-02-05T22:00:00Z':'2035-01-05T22:00:00Z',
 }))};
 const created=await store().createOffer(owner,cmd),issued=await store().issueOffer(owner,{operationId:randomUUID(),expectedVersion:1,quoteId:cmd.id});
 const accepted=accept?await store().acceptOffer(parent,{operationId:randomUUID(),expectedVersion:2,quoteId:cmd.id,terms:issued.result.quote.definition.terms,acknowledged:true}):null;
 return {familyId,children,cmd,created,issued,quote:accepted?.result.quote??issued.result.quote};
}
function cash(q:FamilyOffer,amount=20000,lineIndex=0){return {operationId:randomUUID(),expectedVersion:q.revision,quoteId:q.id,amountMinor:amount,currency:'USD' as const,receivedAt:now.toISOString(),allocations:[{lineId:q.lines[lineIndex]!.id,amountMinor:amount}]};}
const policy:ReminderPolicy={id:'SYNTHETIC-APPROVED-REMINDER',revision:1,source:{id:'SYNTHETIC',sha256:'a'.repeat(64)},timeZone:'America/New_York',offsetsMinutes:[0,1440]};
async function queue(q:FamilyOffer){return store().queueReminders(owner,{quoteId:q.id,policy,guardianId:parent.id,channel:'email'});}

const serviceBinding={version:REMINDER_SERVICE_VERSION,mode:'test' as const,serviceBindingId:'SYNTHETIC-BILLING-SERVICE',outboxBindingId:'SYNTHETIC-EXISTING-OUTBOX'};
let serviceCalls=0;
const serviceAuthority:BillingReminderServiceAuthority={
 authorize:async(c,b,operation,s,intent)=>{
  expect(c).not.toHaveProperty('actor');
  const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_billing.service_policy WHERE workspace_id=$1 AND service_id=$2 AND outbox_id=$3',[c.workspaceId,b.serviceBindingId,b.outboxBindingId]);
  if(rows.length!==1||rows[0]!.active!==true||b.mode!=='test')throw new AppError('UNAVAILABLE');
  if(s===null)return;
  if(s.programKey!=='fishing_monthly_club'||operation!=='plan'&&!intent||intent&&intent.quoteId!==s.quoteId)throw new AppError('FORBIDDEN');
  const family=await c.tx.query<{guardianId:string}>('SELECT guardian_id AS "guardianId" FROM synthetic_billing.program_families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[c.workspaceId,s.familyId]);
  if(family.length!==1||intent&&family[0]!.guardianId!==intent.guardianId)throw new AppError('FORBIDDEN');
  const children=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[c.workspaceId,s.familyId]);
  if(!s.childIds.every(id=>children.some(x=>x.id===id)))throw new AppError('FORBIDDEN');
  expect(['plan','reserve','outcome']).toContain(operation);
 },
 plan:async(c,_b,q)=>{
  const selected=(await c.tx.query<{policy:ReminderPolicy|null;channel:'email'|'whatsapp'|null}>('SELECT plan_policy AS policy,plan_channel AS channel FROM synthetic_billing.service_policy WHERE workspace_id=$1',[c.workspaceId]))[0];
  const family=(await c.tx.query<{guardianId:string}>('SELECT guardian_id AS "guardianId" FROM synthetic_billing.program_families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[c.workspaceId,q.familyId]))[0];
  if(!selected?.policy||!selected.channel||!family)return null;
  return {policy:selected.policy,guardianId:family.guardianId,channel:selected.channel};
 },
 permission:async(c,_b,_q,p,i)=>{
  expect(c).not.toHaveProperty('actor');
  const row=(await c.tx.query<{consented:boolean;windowOpen:boolean;sendEnabled:boolean;revision:number;locale:'en'|'he'}>('SELECT consented,window_open AS "windowOpen",send_enabled AS "sendEnabled",policy_revision AS revision,message_locale AS locale FROM synthetic_billing.service_policy WHERE workspace_id=$1',[c.workspaceId]))[0]!;
  return {audience:{guardianId:i.guardianId,channel:i.channel,audience:'individual',locale:row.locale,verified:true,active:true,consented:row.consented},
   sendWindowOpen:row.windowOpen,ownerEnabled:row.sendEnabled,policyCurrent:p.id===policy.id&&p.revision===row.revision&&p.source.sha256===policy.source.sha256};
 },
};
const serviceConfiguration:BillingReminderServiceConfiguration={binding:serviceBinding,authority:serviceAuthority};
outbox.reserveService=async(c,b,payload)=>{
 expect(c).not.toHaveProperty('actor');expect(b).toEqual(serviceBinding);
 expect((await c.tx.query<{state:string}>('SELECT state FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND id=$2',[c.workspaceId,payload.intent.id]))[0]!.state).toBe('unknown');
 if(outboxFails)throw new Error('SYNTHETIC_OUTBOX_FAILURE');
 serviceCalls++;
 await c.tx.query('INSERT INTO synthetic_billing.existing_outbox(dispatch_id,intent_id,remaining_minor,lines_json) VALUES($1,$2,$3,$4::jsonb)',[payload.intent.dispatchId,payload.intent.id,payload.amount.remainingMinor,JSON.stringify(payload.amount.lines)]);
};
outbox.readServiceOutcome=async(c,_b,lookup)=>{
 expect(c).not.toHaveProperty('actor');
 return (await c.tx.query<{payload:VerifiedReminderOutcome}>('SELECT payload FROM synthetic_billing.service_outcomes WHERE dispatch_id=$1 AND intent_id=$2',[lookup.dispatchId,lookup.intentId]))[0]?.payload??null;
};
const serviceStore=(configuration:BillingReminderServiceConfiguration|null=serviceConfiguration,port:BillingOutboxReservation|null=outbox,at=now)=>
 new FishingBillingStore(binder,workspace,ring,Buffer.alloc(32,9),authority,{now:()=>at},port,null,configuration);
beforeAll(async()=>{
 await db.exec('CREATE TABLE synthetic_billing.service_policy(workspace_id uuid PRIMARY KEY,service_id text,outbox_id text,active boolean,consented boolean,window_open boolean,send_enabled boolean,policy_revision integer,plan_policy jsonb,plan_channel text,message_locale text);CREATE TABLE synthetic_billing.service_outcomes(dispatch_id uuid PRIMARY KEY,intent_id uuid,payload jsonb NOT NULL)');
 await db.query("INSERT INTO synthetic_billing.service_policy VALUES($1,$2,$3,true,true,true,true,1,$4::jsonb,'email','he')",[workspace,serviceBinding.serviceBindingId,serviceBinding.outboxBindingId,JSON.stringify(policy)]);
});
beforeEach(async()=>{
 // This process owns this new no-URL memory DB. Clear only synthetic queue
 // fixtures between cases; each case keeps replay/UNKNOWN history throughout.
 await db.exec('TRUNCATE ls_fishing_billing.reminders,synthetic_billing.existing_outbox,synthetic_billing.service_outcomes');
 await db.query("UPDATE synthetic_billing.service_policy SET active=true,consented=true,window_open=true,send_enabled=true,policy_revision=1,plan_policy=$1::jsonb,plan_channel='email',message_locale='he'",[JSON.stringify(policy)]);
 serviceCalls=0;outboxFails=false;
});
async function planned(){const f=await scenario();return {...f,intents:await queue(f.quote)};}
async function outcome(intentId:string,dispatchId:string,state:'provider_accepted'|'delivered'|'failed',change:Partial<VerifiedReminderOutcome>={}){
 const value:VerifiedReminderOutcome={intentId,dispatchId,guardianId:parent.id,channel:'email',outboxBindingId:serviceBinding.outboxBindingId,
  sourceReceiptId:'SYNTHETIC-ONLY-RECEIPT',state,providerId:state==='failed'?null:'SYNTHETIC-ONLY-PROVIDER',...change};
 await db.query('INSERT INTO synthetic_billing.service_outcomes(dispatch_id,intent_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(dispatch_id) DO UPDATE SET payload=excluded.payload',[dispatchId,intentId,JSON.stringify(value)]);
}
it('plans only after native acceptance without owner sessions, using the current approved guardian/channel/locale and stable identities',async()=>{
 const f=await scenario();await db.query("UPDATE synthetic_billing.service_policy SET plan_channel='whatsapp',message_locale='en'");
 await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[owner.sessionDigest,now]);
 try{
  const first=await serviceStore().queueReminderServiceIntents({quoteId:f.quote.id});expect(first.state).toBe('queued');expect(first.intents).toHaveLength(2);
  expect(first.intents.every(i=>i.channel==='whatsapp'&&i.locale==='en'&&i.guardianId===parent.id)).toBe(true);
  const again=await serviceStore().queueReminderServiceIntents({quoteId:f.quote.id});expect(again.intents).toEqual(first.intents);
  expect((await serviceStore().reserveReminderServiceBatch({limit:2})).results[0]!.state).toBe('reserved');expect(serviceCalls).toBe(1);
 }finally{await db.query('UPDATE ls_identity.sessions SET revoked_at=NULL WHERE token_digest=$1',[owner.sessionDigest]);}
 expect((await store().readBalance(owner,f.quote.id)).quote.revision).toBe(3);
});
it('never turns an unanswered offer into a debt or supplies missing policy/channel defaults',async()=>{
 const unanswered=await scenario(false);await expect(serviceStore().queueReminderServiceIntents({quoteId:unanswered.quote.id})).rejects.toThrow('CONFLICT');
 expect((await store().readBalance(owner,unanswered.quote.id)).balance).toMatchObject({state:'no_debt',dueMinor:0});
 const f=await scenario();await db.query('UPDATE synthetic_billing.service_policy SET plan_policy=NULL');
 await expect(serviceStore().queueReminderServiceIntents({quoteId:f.quote.id})).rejects.toThrow('UNAVAILABLE');
 await db.query('UPDATE synthetic_billing.service_policy SET plan_policy=$1::jsonb,plan_channel=NULL',[JSON.stringify(policy)]);
 await expect(serviceStore().queueReminderServiceIntents({quoteId:f.quote.id})).rejects.toThrow('UNAVAILABLE');
 expect((await db.query('SELECT id FROM ls_fishing_billing.reminders')).rows).toHaveLength(0);
});
it('denies caller-supplied planning scope/policy and missing authority/outbox, while checking the resolved guardian against native family records',async()=>{
 const f=await scenario();await expect(serviceStore().queueReminderServiceIntents({quoteId:f.quote.id,policy})).rejects.toThrow();
 await expect(serviceStore(null).queueReminderServiceIntents({quoteId:f.quote.id})).rejects.toThrow('UNAVAILABLE');
 await expect(serviceStore(serviceConfiguration,null).queueReminderServiceIntents({quoteId:f.quote.id})).rejects.toThrow('UNAVAILABLE');
 const wrong:BillingReminderServiceConfiguration={binding:serviceBinding,authority:{...serviceAuthority,plan:async()=>({policy,guardianId:outsider.id,channel:'email'})}};
 await expect(serviceStore(wrong).queueReminderServiceIntents({quoteId:f.quote.id})).rejects.toThrow('FORBIDDEN');expect(serviceCalls).toBe(0);
});
it.each(['consent','window','paid','pause'] as const)('does not queue new service intents while %s suppresses the accepted quote',async condition=>{
 const f=await scenario();if(condition==='consent')await db.query('UPDATE synthetic_billing.service_policy SET consented=false');
 if(condition==='window')await db.query('UPDATE synthetic_billing.service_policy SET window_open=false');
 if(condition==='paid')await store().recordCash(owner,{...cash(f.quote,130000),allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))});
 if(condition==='pause')await store().setState(owner,{operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:3,paused:true});
 const r=await serviceStore().queueReminderServiceIntents({quoteId:f.quote.id});expect(r.state).toBe(condition==='window'?'deferred':'suppressed');expect(r.intents).toHaveLength(0);expect(serviceCalls).toBe(0);
});
it('blocks replanning around UNKNOWN after an approved policy/channel change',async()=>{
 const f=await scenario(),first=await serviceStore().queueReminderServiceIntents({quoteId:f.quote.id});
 await serviceStore().reserveReminderServiceBatch({limit:1});
 await db.query("UPDATE synthetic_billing.service_policy SET policy_revision=2,plan_policy=$1::jsonb,plan_channel='whatsapp'",[JSON.stringify({...policy,revision:2})]);
 const r=await serviceStore().queueReminderServiceIntents({quoteId:f.quote.id});expect(r.state).toBe('blocked_unknown');
 expect(r.intents.map(i=>i.id)).toEqual(first.intents.map(i=>i.id));expect(serviceCalls).toBe(1);
});

it('reserves one due two-child intent through the existing outbox with no owner identity or fabricated session',async()=>{
 const f=await planned();await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[owner.sessionDigest,now]);
 try{
  const r=await serviceStore().reserveReminderServiceBatch({limit:1});expect(r).toMatchObject({version:REMINDER_SERVICE_VERSION,scanned:1,moreDue:false});
  expect(r.results[0]).toMatchObject({state:'reserved',remainingMinor:130000});expect(serviceCalls).toBe(1);
  const row=(await db.query<{remaining_minor:number;lines_json:unknown[]}>('SELECT remaining_minor,lines_json FROM synthetic_billing.existing_outbox')).rows[0]!;
  expect(row.remaining_minor).toBe(130000);expect(row.lines_json).toHaveLength(2);
  expect((await serviceStore().reserveReminderServiceBatch({limit:1})).results).toHaveLength(0);expect(serviceCalls).toBe(1);
  expect(f.intents.map(i=>i.id)).toContain(r.results[0]!.intentId);
 }finally{await db.query('UPDATE ls_identity.sessions SET revoked_at=NULL WHERE token_digest=$1',[owner.sessionDigest]);}
});
it('denies missing service policy, revoked authority and an actor-only or missing outbox without reserving',async()=>{
 const f=await planned();
 await expect(serviceStore(null).reserveReminderServiceBatch({limit:1})).rejects.toThrow('UNAVAILABLE');
 await expect(serviceStore(serviceConfiguration,null).reserveReminderServiceBatch({limit:1})).rejects.toThrow('UNAVAILABLE');
 await expect(serviceStore(serviceConfiguration,{reserve:async()=>{throw new Error('Must not impersonate owner');}}).reserveReminderServiceBatch({limit:1})).rejects.toThrow('UNAVAILABLE');
 await db.query('UPDATE synthetic_billing.service_policy SET active=false');
 await expect(serviceStore().reserveReminderServiceBatch({limit:1})).rejects.toThrow('UNAVAILABLE');
 expect((await store().readBalance(owner,f.quote.id)).balance.reminders.every(i=>i.state==='queued')).toBe(true);expect(serviceCalls).toBe(0);
});
it('reserves the fresh partial amount only for this approved due group, not the future sibling balance',async()=>{
 const f=await scenario(true,true);await store().recordCash(owner,cash(f.quote,20000,0));await queue(f.quote);
 const r=await serviceStore().reserveReminderServiceBatch({limit:5});expect(r.results[0]).toMatchObject({state:'reserved',remainingMinor:45000});
 const row=(await db.query<{remaining_minor:number;lines_json:{childId:string;remainingMinor:number}[]}>('SELECT remaining_minor,lines_json FROM synthetic_billing.existing_outbox')).rows[0]!;
 expect(row.remaining_minor).toBe(45000);expect(row.lines_json).toHaveLength(1);expect(row.lines_json[0]).toMatchObject({childId:f.children[0],remainingMinor:45000});
});
it.each(['paid','cancel','pause'] as const)('stops %s before service reservation without a new outbox record',async state=>{
 const f=await planned();
 if(state==='paid')await store().recordCash(owner,{...cash(f.quote,130000),allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))});
 else await store().setState(owner,{operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:3,...(state==='cancel'?{cancel:true}:{paused:true})});
 expect((await serviceStore().reserveReminderServiceBatch({limit:5})).results).toHaveLength(0);expect(serviceCalls).toBe(0);
});
it.each(['consent','policy','window','disabled'] as const)('rechecks current service %s in its transaction',async field=>{
 await planned();await db.query('UPDATE synthetic_billing.service_policy SET consented=$1,policy_revision=$2,window_open=$3,send_enabled=$4',[field!=='consent',field==='policy'?2:1,field!=='window',field!=='disabled']);
 const r=await serviceStore().reserveReminderServiceBatch({limit:5});expect(r.results).toHaveLength(1);
 expect(r.results[0]!.state).toBe(field==='window'?'deferred':'suppressed');expect(serviceCalls).toBe(0);
 if(field==='window'){
  await db.query('UPDATE synthetic_billing.service_policy SET window_open=true');
  expect((await serviceStore().reserveReminderServiceBatch({limit:1})).results[0]!.state).toBe('reserved');expect(serviceCalls).toBe(1);
 }
});
it('does not retry UNKNOWN across channel or sequence and does not starve another family when resuming a bounded batch',async()=>{
 const f=await planned();await store().queueReminders(owner,{quoteId:f.quote.id,policy,guardianId:parent.id,channel:'whatsapp'});
 const first=await serviceStore().reserveReminderServiceBatch({limit:50});expect(first.results.filter(r=>r.state==='reserved')).toHaveLength(1);expect(serviceCalls).toBe(1);
 const later=serviceStore(serviceConfiguration,outbox,new Date('2035-01-07T15:00:00Z'));
 expect((await later.reserveReminderServiceBatch({limit:50})).results).toHaveLength(0);expect(serviceCalls).toBe(1);
 const other=await planned();const resumed=await later.reserveReminderServiceBatch({limit:1});
 expect(resumed.results[0]!.state).toBe('reserved');expect(other.intents.map(i=>i.id)).toContain(resumed.results[0]!.intentId);expect(serviceCalls).toBe(2);
});
it('rolls back UNKNOWN and existing-outbox writes together when reservation fails',async()=>{
 const f=await planned();outboxFails=true;
 await expect(serviceStore().reserveReminderServiceBatch({limit:1})).rejects.toThrow('SYNTHETIC_OUTBOX_FAILURE');
 expect((await store().readBalance(owner,f.quote.id)).balance.reminders.every(i=>i.state==='queued')).toBe(true);
 expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox')).rows).toHaveLength(0);
 outboxFails=false;expect((await serviceStore().reserveReminderServiceBatch({limit:1})).results[0]!.state).toBe('reserved');
});
it('fails before any later channel or sequence reservation when an original UNKNOWN audience index is tampered',async()=>{
 const f=await planned();await store().queueReminders(owner,{quoteId:f.quote.id,policy,guardianId:parent.id,channel:'whatsapp'});
 const first=await serviceStore().reserveReminderServiceBatch({limit:1}),reserved=first.results[0]!;if(reserved.state!=='reserved')throw new Error('Expected original UNKNOWN');
 const prior=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.reminders WHERE id=$1',[reserved.intentId])).rows[0]!.payload_ciphertext;
 await db.query('UPDATE ls_fishing_billing.reminders SET audience_key=$2 WHERE id=$1',[reserved.intentId,'f'.repeat(64)]);
 const later=serviceStore(serviceConfiguration,outbox,new Date('2035-01-07T15:00:00Z'));
 await expect(later.reserveReminderServiceBatch({limit:50})).rejects.toThrow('UNAVAILABLE');
 expect(serviceCalls).toBe(1);expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox')).rows).toHaveLength(1);
 const retained=(await db.query<{state:string;payload_ciphertext:string;audience_key:string}>('SELECT state,payload_ciphertext,audience_key FROM ls_fishing_billing.reminders WHERE id=$1',[reserved.intentId])).rows[0]!;
 expect(retained).toMatchObject({state:'unknown',payload_ciphertext:prior,audience_key:'f'.repeat(64)});
 expect((await db.query("SELECT id FROM ls_fishing_billing.reminders WHERE quote_id=$1 AND state='queued'",[f.quote.id])).rows).toHaveLength(3);
});
it('accepts a late original-dispatch receipt after paid/cancel/pause/consent/window changes without resending',async()=>{
 const f=await planned(),r=await serviceStore().reserveReminderServiceBatch({limit:1}),reserved=r.results[0]!;
 if(reserved.state!=='reserved')throw new Error('Expected reserved fixture');
 await store().recordCash(owner,{...cash(f.quote,130000),allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))});
 await store().setState(owner,{operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:4,paused:true,cancel:true});
 await db.query('UPDATE synthetic_billing.service_policy SET consented=false,window_open=false,send_enabled=false');
 const lookup={intentId:reserved.intentId,dispatchId:reserved.dispatchId};
 expect(await serviceStore().recordReminderServiceOutcome(lookup)).toMatchObject({state:'unresolved'});
 await outcome(lookup.intentId,lookup.dispatchId,'provider_accepted');expect(await serviceStore().recordReminderServiceOutcome(lookup)).toMatchObject({state:'recorded',intent:{state:'provider_accepted'}});
 await outcome(lookup.intentId,lookup.dispatchId,'delivered');const delivered=await serviceStore().recordReminderServiceOutcome(lookup);expect(delivered).toMatchObject({state:'recorded',intent:{state:'delivered'}});
 expect(await serviceStore().recordReminderServiceOutcome(lookup)).toEqual(delivered);expect(serviceCalls).toBe(1);
 expect((await serviceStore().reserveReminderServiceBatch({limit:50})).results).toHaveLength(0);
});
it('denies revoked native family/child authority and forged outcome facts while retaining UNKNOWN',async()=>{
 const f=await planned();
 await db.query("DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3 AND role='child'",[workspace,f.familyId,f.children[0]]);
 await expect(serviceStore().reserveReminderServiceBatch({limit:1})).rejects.toThrow('FORBIDDEN');expect(serviceCalls).toBe(0);
 await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspace,f.familyId,f.children[0]]);
 await db.query('UPDATE synthetic_billing.program_families SET revoked=true WHERE family_id=$1',[f.familyId]);
 await expect(serviceStore().reserveReminderServiceBatch({limit:1})).rejects.toThrow('FORBIDDEN');expect(serviceCalls).toBe(0);
 await db.query('UPDATE synthetic_billing.program_families SET revoked=false WHERE family_id=$1',[f.familyId]);
 const r=await serviceStore().reserveReminderServiceBatch({limit:1}),reserved=r.results[0]!;if(reserved.state!=='reserved')throw new Error('Expected reserved fixture');
 const lookup={intentId:reserved.intentId,dispatchId:reserved.dispatchId};
 await expect(serviceStore().recordReminderServiceOutcome({...lookup,state:'delivered'})).rejects.toThrow();
 await outcome(lookup.intentId,lookup.dispatchId,'delivered',{guardianId:outsider.id});
 await expect(serviceStore().recordReminderServiceOutcome(lookup)).rejects.toThrow('UNAVAILABLE');
 expect((await store().readBalance(owner,f.quote.id)).balance.reminders.find(i=>i.id===lookup.intentId)!.state).toBe('unknown');
});
it('competing and resumed service calls reserve a native intent at most once',async()=>{
 await planned();const results=await Promise.all([serviceStore().reserveReminderServiceBatch({limit:1}),serviceStore().reserveReminderServiceBatch({limit:1})]);
 expect(results.flatMap(r=>r.results).filter(r=>r.state==='reserved')).toHaveLength(1);expect(serviceCalls).toBe(1);
 expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox')).rows).toHaveLength(1);
});
it('denies malformed service permission rather than treating a string window flag as authorization',async()=>{
 await planned();const invalid:BillingReminderServiceConfiguration={binding:serviceBinding,authority:{...serviceAuthority,
  permission:async(...args)=>({...await serviceAuthority.permission(...args),sendWindowOpen:'false' as unknown as boolean})}};
 await expect(serviceStore(invalid).reserveReminderServiceBatch({limit:1})).rejects.toThrow();expect(serviceCalls).toBe(0);
 expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox')).rows).toHaveLength(0);
});
it('retains the original late outcome while service policy is revoked and applies it only after fresh authorization',async()=>{
 await planned();const batch=await serviceStore().reserveReminderServiceBatch({limit:1}),reserved=batch.results[0]!;if(reserved.state!=='reserved')throw new Error('Expected reserved fixture');
 const lookup={intentId:reserved.intentId,dispatchId:reserved.dispatchId};await outcome(lookup.intentId,lookup.dispatchId,'delivered');
 await db.query('UPDATE synthetic_billing.service_policy SET active=false');
 await expect(serviceStore().recordReminderServiceOutcome(lookup)).rejects.toThrow('UNAVAILABLE');
 expect((await db.query<{state:string}>('SELECT state FROM ls_fishing_billing.reminders WHERE id=$1',[lookup.intentId])).rows[0]!.state).toBe('unknown');
 await db.query('UPDATE synthetic_billing.service_policy SET active=true');
 expect(await serviceStore().recordReminderServiceOutcome(lookup)).toMatchObject({state:'recorded',intent:{state:'delivered'}});expect(serviceCalls).toBe(1);
});
it.each(['scheduled','key','quote','audience'] as const)('checks %s metadata against encrypted intent and bounds the scan command',async field=>{
 const f=await planned(),due=f.intents.find(i=>i.sequence===0)!;
 await expect(serviceStore().reserveReminderServiceBatch({limit:0})).rejects.toThrow();await expect(serviceStore().reserveReminderServiceBatch({limit:51})).rejects.toThrow();
 await expect(serviceStore().reserveReminderServiceBatch({limit:1,actorId:owner.id})).rejects.toThrow();
 if(field==='scheduled')await db.query('UPDATE ls_fishing_billing.reminders SET scheduled_at=$2 WHERE id=$1',[due.id,new Date('2035-01-01T00:00:00Z')]);
 if(field==='key')await db.query('UPDATE ls_fishing_billing.reminders SET intent_key=$2 WHERE id=$1',[due.id,'e'.repeat(64)]);
 if(field==='audience')await db.query('UPDATE ls_fishing_billing.reminders SET audience_key=$2 WHERE id=$1',[due.id,'f'.repeat(64)]);
 if(field==='quote'){const other=await scenario();await db.query('UPDATE ls_fishing_billing.reminders SET quote_id=$2 WHERE id=$1',[due.id,other.quote.id]);}
 await expect(serviceStore().reserveReminderServiceBatch({limit:1})).rejects.toThrow('UNAVAILABLE');expect(serviceCalls).toBe(0);
});
