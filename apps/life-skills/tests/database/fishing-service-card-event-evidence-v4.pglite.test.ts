import {randomUUID,createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {FishingServiceGuestNativeV4} from '../../src/features/fishing-billing/guest-service-native-v4.ts';
import {FishingServiceCurrentCardV4} from '../../src/features/fishing-billing/guest-service-current-card-v4.ts';
import type {ServiceCardReconciliationAuthorityV4} from '../../src/features/fishing-billing/guest-service-current-card-contract-v4.ts';
import {FishingServiceCardEventsV4,type ServiceRefundAllocationAuthorityV4} from '../../src/features/fishing-billing/guest-service-card-events-v4.ts';
import {FishingServiceBillingCardsV4} from '../../src/features/fishing-billing/guest-service-cards-v4.ts';
import {FishingServiceBillingOwnerV4} from '../../src/features/fishing-billing/guest-service-owner-financial-v4.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {FishingServiceCardEventEvidenceV4} from '../../src/features/fishing-billing/guest-service-card-event-evidence-v4.ts';
import {FishingBillingStripeInbox,verifyBillingStripeTestEvent,type BillingStripeInboxAuthority,type BillingStripeSignedReceipt} from '../../src/features/fishing-billing/stripe-test.ts';
import type {BillingStripeTestProvider} from '../../src/features/fishing-billing/cards.ts';
import {providerPaymentSnapshotSchema,type ProviderPaymentSnapshot} from '../../src/features/fishing-billing/card-contracts.ts';
import {BILLING_DTO_VERSION,reminderIntentSchema} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4} from '../../src/features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import {canonical} from '../../src/features/contact-ops/core/validation.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import type {Actor,AccountId} from '../../src/features/identity/types.ts';
import type {BillingLedgerContext} from '../../src/features/fishing-billing/native.ts';
import {AppError} from '../../src/lib/errors.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing_service_money_v4.sql','UNNUMBERED_ls_fishing_service_state_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));
 await engine.exec('CREATE SCHEMA synthetic_evidence4; CREATE TABLE synthetic_evidence4.admission(workspace_id uuid PRIMARY KEY,active boolean NOT NULL DEFAULT true)');
},20000);
afterEach(()=>expect(network).not.toHaveBeenCalled());afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native owner/session/family/source/issuer/acceptance, owner preparation,
// durable UNKNOWN/request and real shared event/settlement persistence/crypto.
// Grant/legal/capacity/service/reservation/verifier/readback ports are explicitly
// SYNTHETIC/UNAPPROVED. No SDK creation, provider network, send, real payment,
// runtime policy, PostgreSQL competition or historical failure-clock proof.
async function ready(){
 const f=await serviceGuestFixtureV4(engine);await new FishingServiceGuestNativeV4(f.db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver()).acceptFinancialOffer(f.token,f.command);
 await engine.query('INSERT INTO synthetic_evidence4.admission(workspace_id) VALUES($1)',[f.workspace]);
 const ledgerKey=Buffer.from(programKey),binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-EVIDENCE4-NO-PROVIDER'};
 const controls={reading:false,authorized:false,privateBeforeTarget:0,reads:0,targets:0,authorizations:0,denyTarget:false,denyAtAuthorize:0,caughtWrite:false,mutateClock:false,revokeAtEvent:false,postCommit:false,
  corrupt:null as 'requestDigest'|'eventCipher'|'processingReceipt'|null,captured:null as Readonly<BillingLedgerContext>|null,sql:[] as string[],hold:null as Promise<void>|null,entered:()=>{},escape:false};
 const db:IdentityStore={transaction:async work=>{const result=await f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  if(controls.reading){controls.sql.push(sql);if(!controls.authorized&&sql.includes('FROM ls_fishing_billing'))controls.privateBeforeTarget++;
   if(sql==='SELECT 42 AS evidence_held'){controls.entered();await controls.hold;}
  }
  const rows=await tx.query<R>(sql,v);
  if(controls.reading&&controls.revokeAtEvent&&sql.includes('FROM ls_fishing_billing.stripe_events')){controls.revokeAtEvent=false;await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,f.clock.now()]);}
  if(controls.reading&&controls.corrupt){
   const eventRow=sql.includes('FROM ls_fishing_billing.stripe_events'),requestRow=sql.includes('FROM ls_fishing_billing.card_attempt_requests');
   if(eventRow||requestRow)return rows.map(value=>{
    const row={...value} as Record<string,unknown>;
    if(requestRow&&controls.corrupt==='requestDigest'){const aad='ls_fishing_billing/card/v1/checkout_request/'+f.workspace+'/'+command.operationId,data=JSON.parse(unseal(String(row.ciphertext),aad,programRing));data.digest='0'.repeat(64);row.ciphertext=seal(JSON.stringify(data),aad,programRing);}
    if(eventRow&&controls.corrupt==='eventCipher')row.ciphertext='CORRUPT';
    if(eventRow&&controls.corrupt==='processingReceipt'){const aad='ls_fishing_billing/card/v1/event_result/'+f.workspace+'/'+String(row.eventId),data=JSON.parse(unseal(String(row.processedCiphertext),aad,programRing));data.receiptIds=[randomUUID()];row.processedCiphertext=seal(JSON.stringify(data),aad,programRing);}
    return row as R;
   });
  }
  return rows;
 }}));if(controls.reading&&controls.postCommit){controls.postCommit=false;throw new AppError('FORBIDDEN');}return result;}};
 const service:ServiceCardReconciliationAuthorityV4={target:async(c,b)=>{
  controls.targets++;const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_evidence4.admission WHERE workspace_id=$1 FOR SHARE',[f.workspace]);
  if(controls.denyTarget||c.workspaceId!==f.workspace||canonical(b)!==canonical(binding)||rows.length!==1||!rows[0]!.active)throw new AppError('FORBIDDEN');controls.authorized=true;
 },authorize:async(c,_b,s)=>{
  controls.authorizations++;if(s.quoteId!==f.quote.id||s.familyId!==f.quote.familyId||s.offerSha256!==f.quote.offer.sha256||controls.denyAtAuthorize===controls.authorizations)throw new AppError('FORBIDDEN');
  if(controls.reading){controls.captured=c;if(controls.mutateClock)c.now.setTime(c.now.valueOf()+1);
   if(controls.caughtWrite){try{await c.tx.query('UPDATE synthetic_evidence4.admission SET active=false WHERE workspace_id=$1',[f.workspace]);}catch{/* Deliberately swallowed: must poison the read. */}}
   if(controls.escape){controls.escape=false;void c.tx.query('SELECT 42 AS evidence_held').catch(()=>{});}
  }
 }};
 const families=new FishingBillingInquiryFamilyProposals(db,f.workspace,programRing,programKey,f.clock),current=new FishingServiceCurrentCardV4(db,f.workspace,families,programRing,programKey,f.commandKey,ledgerKey,f.clock,service);
 const billingOwner=new FishingServiceBillingOwnerV4(f.workspace,new FishingProgramSourceNativeV3(db,f.workspace,programRing,programKey,f.owner.id,f.clock),families,programRing,programKey,f.commandKey,ledgerKey,f.clock,{target:async()=>{},authorize:async()=>{}});
 const inbox:BillingStripeInboxAuthority={authorize:async(_tx,ws,b)=>{if(ws!==f.workspace||canonical(b)!==canonical(binding))throw new AppError('FORBIDDEN');}};
 const snapshots=new Map<string,ProviderPaymentSnapshot>(),create=vi.fn(async()=>{throw Error('CREATE_FORBIDDEN');});
 const provider:BillingStripeTestProvider={createCheckout:create,readPayment:async r=>{controls.reads++;const s=snapshots.get(r.eventId);if(!s)throw new AppError('UNAVAILABLE');return structuredClone(s);}};
 const cards=new FishingServiceBillingCardsV4(db,f.workspace,current,billingOwner,programRing,ledgerKey,{binding,cardOnlyConfigurationId:'pmc_SYNTHETIC',approvedProductLabel:'SYNTHETIC ONLY'},inbox,provider,null,{target:service.target,authorize:async(_c,_b,r)=>{if(r.snapshot.quote.id!==f.quote.id||r.attempt.quoteId!==f.quote.id)throw new AppError('FORBIDDEN');}});
 const command={operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:3,selection:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))};
 await cards.prepare(f.owner,command);const reserved=await cards.reserveCheckout(f.owner,f.quote.id,command.operationId);expect(reserved.dispatch).toBe(true);expect(reserved.attempt.state).toBe('unknown');expect(create).not.toHaveBeenCalled();
 const processor=(refund:ServiceRefundAllocationAuthorityV4|null=null)=>new FishingServiceCardEventsV4(db,f.workspace,current,programRing,ledgerKey,binding,inbox,provider,refund);
 const reader=(authority=service,ownerId:AccountId=f.owner.id)=>new FishingServiceCardEventEvidenceV4(db,f.workspace,programRing,programKey,f.commandKey,ledgerKey,f.clock,ownerId,authority,binding);
 return {...f,db,current,billingOwner,cards,command,controls,binding,inbox,snapshots,processor,reader,create,ledgerKey,service};
}
type Fixture=Awaited<ReturnType<typeof ready>>;
function payment(f:Fixture,change:Partial<ProviderPaymentSnapshot>={}){return providerPaymentSnapshotSchema.parse({accountId:f.binding.accountId,livemode:false,apiVersion:f.binding.apiVersion,quoteId:f.quote.id,attemptId:f.command.operationId,sessionId:'cs_'+f.command.operationId.replaceAll('-',''),paymentIntentId:'pi_'+f.command.operationId.replaceAll('-',''),currency:'USD',amountMinor:130000,receivedMinor:130000,status:'paid',method:'card',paidAt:f.clock.now().toISOString(),observedAt:f.clock.now().toISOString(),refunds:[],dispute:'none',...change});}
async function event(f:Fixture,s=payment(f),type:BillingStripeSignedReceipt['eventType']='payment_intent.succeeded',objectId=s.paymentIntentId){
 const eventId='evt_'+randomUUID().replaceAll('-',''),bytes=Buffer.from('SYNTHETIC-EVIDENCE4-'+eventId),receipt:BillingStripeSignedReceipt={eventId,eventType:type,objectId,providerAccountId:f.binding.accountId,livemode:false,apiVersion:f.binding.apiVersion,digest:createHash('sha256').update(bytes).digest('hex'),createdAt:f.clock.now().toISOString()};
 await new FishingBillingStripeInbox(f.db,f.workspace,programRing,f.clock,f.inbox).ingest(verifyBillingStripeTestEvent({rawBody:bytes,signatureHeader:'MOCK-NOT-A-REAL-SIGNATURE',binding:f.binding,now:f.clock.now(),sdk:{verify:()=>({kind:'stripe_test_signature_only',receipt})}}));f.snapshots.set(eventId,s);return {eventId,receipt};
}
async function committed(f:Fixture){const e=await event(f);await f.processor().processEvent(e.eventId);return e;}
async function read(f:Fixture,eventId:string,actor:Actor=f.owner,query={quoteId:f.quote.id,attemptId:f.command.operationId,eventId}){
 f.controls.reading=true;f.controls.authorized=false;f.controls.targets=0;f.controls.authorizations=0;try{return await f.reader().readExact(actor,query);}finally{f.controls.reading=false;}
}
async function raw(f:Fixture){
 const result:Record<string,unknown>={};
 // Snapshot every native column without JS Date conversion or timestamp precision loss.
 for(const table of ['quotes','receipts','card_attempts','card_attempt_requests','stripe_events','card_settlements','reminders','guest_financial_acceptances','guest_operations','guest_grants','commands'])result[table]=(await engine.query<{snapshot:string}>('SELECT row_to_json(stored)::text AS snapshot FROM ls_fishing_billing.'+table+' AS stored WHERE workspace_id=$1 ORDER BY row_to_json(stored)::text COLLATE "C"',[f.workspace])).rows.map(row=>row.snapshot);
 return result;
}
async function reminder(f:Fixture,state:'queued'|'unknown'){
 const i=reminderIntentSchema.parse({version:BILLING_DTO_VERSION,id:randomUUID(),key:'SYNTHETIC-'+randomUUID(),quoteId:f.quote.id,familyId:f.quote.familyId,guardianId:randomUUID(),channel:'email',audience:'individual',locale:'he',policyId:'SYNTHETIC',policyRevision:1,sequence:0,dueAt:f.quote.lines[0]!.dueAt,scheduledAt:f.clock.now().toISOString(),state,dispatchId:state==='unknown'?randomUUID():null,providerId:null,reason:null});
 const hmac=(v:unknown)=>createHmac('sha256',f.ledgerKey).update(canonical(v)).digest('hex');await engine.query('INSERT INTO ls_fishing_billing.reminders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[f.workspace,i.id,f.quote.id,hmac({key:i.key}),state,seal(JSON.stringify(i),'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+i.id,programRing),'SYNTHETIC-NOT-POLICY',i.scheduledAt,hmac({quoteId:f.quote.id,guardianId:i.guardianId})]);return i;
}
it('event-evidence-v4 reads actual committed original lineage/current balances with zero DML, provider reads or historical byte changes',async()=>{
 const f=await ready(),e=await committed(f),before=await raw(f),providerReads=f.controls.reads;const first=await read(f,e.eventId);expect(first.state).toBe('committed');if(first.state!=='committed')throw Error('EXPECTED_COMMITTED');
 expect(first.evidence.original.receipt).toEqual(e.receipt);expect(first.evidence.scope.children.map(l=>l.selectedMinor)).toEqual([65000,65000]);expect(first.evidence.current.balance).toMatchObject({state:'paid',paidMinor:130000});
 expect(first.evidence.original.processing.receiptIds).toHaveLength(1);expect(first.evidence.original.requestCiphertextSha256).toMatch(/^[a-f0-9]{64}$/);expect(first.evidence.current.attemptCiphertextSha256).toMatch(/^[a-f0-9]{64}$/);
 expect(Object.isFrozen(first.evidence.scope.children)).toBe(true);expect(await read(f,e.eventId)).toEqual(first);expect(await raw(f)).toEqual(before);expect(f.controls.reads).toBe(providerReads);expect(f.controls.privateBeforeTarget).toBe(0);expect(f.controls.sql.every(s=>/^\s*SELECT\b/i.test(s))).toBe(true);expect(f.create).not.toHaveBeenCalled();
});
it('event-evidence-v4 retains an original failure-labelled committed event after a later genuine paid PI without inventing historical failure state or due clock',async()=>{
 const f=await ready(),pending=payment(f,{status:'pending',receivedMinor:0,paidAt:null}),old=await event(f,pending,'payment_intent.payment_failed');await f.processor().processEvent(old.eventId);const original=await read(f,old.eventId);
 f.flags.now=new Date(f.flags.now.valueOf()+1000);const newer=await event(f,payment(f,{paymentIntentId:'pi_NEW'+randomUUID().replaceAll('-','')}));await f.processor().processEvent(newer.eventId);const later=await read(f,old.eventId);
 expect(original.state).toBe('committed');expect(later.state).toBe('committed');if(original.state!=='committed'||later.state!=='committed')throw Error('EXPECTED_HISTORY');
 expect(later.evidence.original).toEqual(original.evidence.original);expect(later.evidence.current.attempt.paymentIntentId).not.toBe(old.receipt.objectId);expect(later.evidence.current.balance.state).toBe('paid');expect(later.evidence.current.objectSettlementReceiptId).toBeNull();expect(later.evidence).not.toHaveProperty('failedAt');expect(later.evidence).not.toHaveProperty('dueAt');
});
it('event-evidence-v4 missing/pending/wrong-query and foreign-workspace events stay unresolved without caller-created joins',async()=>{
 const f=await ready(),pending=await event(f),other=await ready(),foreign=await committed(other);
 for(const id of ['evt_MISSING',pending.eventId,foreign.eventId])expect(await read(f,id)).toMatchObject({state:'unresolved',reason:'missing_or_unlinked',evidence:null});
 await f.processor().processEvent(pending.eventId);expect(await read(f,pending.eventId,f.owner,{quoteId:f.quote.id,attemptId:randomUUID(),eventId:pending.eventId})).toMatchObject({state:'unresolved',evidence:null});
});
it('event-evidence-v4 actual review-required processing never becomes processed success or a failure clock',async()=>{
 const f=await ready(),s=payment(f,{refunds:[{id:'re_SYNTHETIC',amountMinor:20000,state:'succeeded',occurredAt:f.clock.now().toISOString()}]}),e=await event(f,s,'refund.updated','re_SYNTHETIC');expect((await f.processor().processEvent(e.eventId)).review).toBe(true);
 expect(await read(f,e.eventId)).toMatchObject({state:'unresolved',reason:'event_review_required',evidence:null});
});
it('event-evidence-v4 verifies every actual payment/refund settlement reference and selected child allocation',async()=>{
 const f=await ready(),s=payment(f,{refunds:[{id:'re_SYNTHETIC',amountMinor:20000,state:'succeeded',occurredAt:f.clock.now().toISOString()}]}),e=await event(f,s,'refund.updated','re_SYNTHETIC');
 await f.processor({allocations:async()=>[{lineId:f.quote.lines[0]!.id,amountMinor:20000}]}).processEvent(e.eventId);const result=await read(f,e.eventId);expect(result.state).toBe('committed');if(result.state!=='committed')throw Error('EXPECTED_REFUND');expect(result.evidence.original.processing.receiptIds).toHaveLength(2);expect(result.evidence.current.balance.lines.map(l=>l.remainingMinor)).toEqual([20000,0]);expect(result.evidence.current.objectSettlementReceiptId).toBeTruthy();
});
it.each(['paid','paused','cancelled'] as const)('event-evidence-v4 does not suppress queued reminders or change UNKNOWN delivery when current agreement is %s',async state=>{
 const f=await ready(),e=await committed(f);if(state!=='paid'){const snap=await f.billingOwner.readSnapshot(f.owner,f.quote.id);await f.billingOwner.setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:snap.quote.revision,...(state==='paused'?{paused:true}:{cancel:true})});}
 const queued=await reminder(f,'queued'),unknown=await reminder(f,'unknown'),before=await raw(f),result=await read(f,e.eventId);expect(result.state).toBe('committed');if(result.state!=='committed')throw Error('EXPECTED_COMMITTED');expect(result.evidence.current.balance.reminders).toEqual(expect.arrayContaining([{id:queued.id,state:'queued'},{id:unknown.id,state:'unknown'}]));expect(await raw(f)).toEqual(before);expect(f.controls.sql.every(s=>/^\s*SELECT\b/i.test(s))).toBe(true);
});
it('event-evidence-v4 authenticates actual configured owner/session and independent target before private billing reads',async()=>{
 const f=await ready(),e=await committed(f),before=await raw(f);await expect(read(f,e.eventId,f.parent)).rejects.toThrow('FORBIDDEN');f.controls.denyTarget=true;await expect(read(f,e.eventId)).rejects.toThrow('FORBIDDEN');expect(f.controls.privateBeforeTarget).toBe(0);f.controls.denyTarget=false;
 await expect(f.reader(f.service,f.parent.id).readExact(f.owner,{quoteId:f.quote.id,attemptId:f.command.operationId,eventId:e.eventId})).rejects.toThrow('FORBIDDEN');expect(await raw(f)).toEqual(before);
});
it('event-evidence-v4 rechecks real terminal session revocation and final independent read permission in the same physical TX',async()=>{
 const f=await ready(),e=await committed(f),before=await raw(f);f.controls.revokeAtEvent=true;await expect(read(f,e.eventId)).rejects.toThrow('UNAUTHENTICATED');expect(await raw(f)).toEqual(before);expect((await engine.query<{revoked_at:Date|null}>('SELECT revoked_at FROM ls_identity.sessions WHERE token_digest=$1',[f.owner.sessionDigest])).rows[0]!.revoked_at).toBeNull();
 f.controls.denyAtAuthorize=2;await expect(read(f,e.eventId)).rejects.toThrow('FORBIDDEN');expect(await raw(f)).toEqual(before);
});
it.each(['caughtWrite','mutateClock'] as const)('event-evidence-v4 poisons a %s attempt and preserves all stored bytes',async key=>{
 const f=await ready(),e=await committed(f),before=await raw(f);f.controls[key]=true;await expect(read(f,e.eventId)).rejects.toThrow('UNAVAILABLE');expect(await raw(f)).toEqual(before);expect(f.controls.sql.every(s=>/^\s*SELECT\b/i.test(s))).toBe(true);
});
it('event-evidence-v4 revokes escaped read authority and drains detached SQL before rollback',async()=>{
 const f=await ready(),e=await committed(f);await read(f,e.eventId);const expired=f.controls.captured!;const count=f.controls.sql.length;await expect(expired.tx.query('SELECT 1')).rejects.toThrow('UNAVAILABLE');expect(f.controls.sql).toHaveLength(count);
 let release=()=>{},entered=()=>{};f.controls.hold=new Promise<void>(r=>{release=r;});const gate=new Promise<void>(r=>{entered=r;});f.controls.entered=entered;f.controls.escape=true;let settled=false;const result=read(f,e.eventId).then(()=>{settled=true;},error=>{settled=true;throw error;});const assertion=expect(result).rejects.toThrow('UNAVAILABLE');try{await Promise.race([gate,result.then(()=>{throw Error('EXPECTED_ESCAPED_SQL');})]);await Promise.resolve();expect(settled).toBe(false);}finally{release();await assertion;}
});
it('event-evidence-v4 a driver error after successful read COMMIT remains UNAVAILABLE, not a fabricated owner denial',async()=>{
 const f=await ready(),e=await committed(f),before=await raw(f);f.controls.postCommit=true;await expect(read(f,e.eventId)).rejects.toThrow('UNAVAILABLE');expect(await raw(f)).toEqual(before);
});
it.each(['requestDigest','eventCipher','processingReceipt'] as const)('event-evidence-v4 rejects authenticated/index/HMAC corruption at %s without a read fallback',async kind=>{
 const f=await ready(),e=await committed(f),before=await raw(f);f.controls.corrupt=kind;
 // Corrupt only the physical read response. Immutable original stored facts
 // remain untouched; the reader must reject rather than repair or overwrite.
 await expect(read(f,e.eventId)).rejects.toThrow('UNAVAILABLE');expect(await raw(f)).toEqual(before);
});
