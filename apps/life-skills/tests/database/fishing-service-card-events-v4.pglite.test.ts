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
import type {BillingStripeTestProvider} from '../../src/features/fishing-billing/cards.ts';
import {FishingBillingStripeInbox,verifyBillingStripeTestEvent,type BillingStripeInboxAuthority,type BillingStripeSignedReceipt} from '../../src/features/fishing-billing/stripe-test.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {FishingServiceBillingOwnerV4} from '../../src/features/fishing-billing/guest-service-owner-financial-v4.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4} from '../../src/features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import {CARD_VERSION,cardAttemptSchema,providerPaymentSnapshotSchema,type ProviderPaymentSnapshot} from '../../src/features/fishing-billing/card-contracts.ts';
import {canonical} from '../../src/features/contact-ops/core/validation.ts';
import {seal} from '../../src/features/identity/crypto.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing_service_money_v4.sql','UNNUMBERED_ls_fishing_service_state_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));
 await engine.exec('CREATE SCHEMA synthetic_event4; CREATE TABLE synthetic_event4.admission(workspace_id uuid PRIMARY KEY,active boolean NOT NULL DEFAULT true)');
},20000);
afterEach(()=>expect(network).not.toHaveBeenCalled());afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// ACTUAL V4 issuer/acceptance/history/family/kernel, existing signed-capability
// inbox and shared event/settlement processor, encrypted SQL and calculator.
// RAW SEEDED grant/attempt/dispatch facts and MOCK SDK verifier/readback/service
// authority are expressly SYNTHETIC/UNAPPROVED. Not an actual Stripe signature,
// provider, owner prepare/dispatch, PostgreSQL race, runtime or payment proof.
async function ready(dispatched=true){
 const f=await serviceGuestFixtureV4(engine);await new FishingServiceGuestNativeV4(f.db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver()).acceptFinancialOffer(f.token,f.command);
 const ledgerKey=Buffer.from(programKey),binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-EVENT4-NO-PROVIDER'};
 await engine.query('INSERT INTO synthetic_event4.admission(workspace_id) VALUES($1)',[f.workspace]);
 const controls={depth:0,reads:0,postCommit:false,settlementFails:false,denyInbox:false};
 const db:IdentityStore={transaction:async work=>{controls.depth++;let writes=false;try{const result=await f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  if(sql.startsWith('UPDATE ls_fishing_billing.quotes'))writes=true;if(controls.settlementFails&&sql.startsWith('INSERT INTO ls_fishing_billing.card_settlements'))throw new AppError('UNAVAILABLE');return tx.query<R>(sql,v);
 }}));if(writes&&controls.postCommit){controls.postCommit=false;throw new AppError('CONFLICT');}return result;}finally{controls.depth--;}}};
 const authority:ServiceCardReconciliationAuthorityV4={target:async(c,b)=>{expect(c).not.toHaveProperty('actor');const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_event4.admission WHERE workspace_id=$1 FOR SHARE',[f.workspace]);if(c.workspaceId!==f.workspace||canonical(b)!==canonical(binding)||rows.length!==1||!rows[0]!.active)throw new AppError('FORBIDDEN');},authorize:async(_c,_b,s)=>{if(s.quoteId!==f.quote.id||s.familyId!==f.quote.familyId||s.offerSha256!==f.quote.offer.sha256)throw new AppError('FORBIDDEN');}};
 const inbox:BillingStripeInboxAuthority={authorize:async(_tx,ws,b)=>{if(controls.denyInbox||ws!==f.workspace||canonical(b)!==canonical(binding))throw new AppError('FORBIDDEN');}};
 const families=new FishingBillingInquiryFamilyProposals(f.db,f.workspace,programRing,programKey,f.clock);
 const native=new FishingServiceCurrentCardV4(db,f.workspace,families,programRing,programKey,f.commandKey,ledgerKey,f.clock,authority);
 const id=randomUUID(),selection=f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000})),command={operationId:id,quoteId:f.quote.id,expectedVersion:3,selection};
 const attempt=cardAttemptSchema.parse({version:CARD_VERSION,id,workspaceId:f.workspace,quoteId:f.quote.id,familyId:f.quote.familyId,actorId:f.owner.id,revision:1,balanceVersion:4,binding,command,requestDigest:createHmac('sha256',ledgerKey).update(canonical(command)).digest('hex'),
  preparation:{version:CARD_VERSION,operationId:id,quoteId:f.quote.id,entityVersion:4,replayed:false,result:{attemptId:id,amountMinor:130000,allocations:selection}},createdAt:f.clock.now().toISOString(),state:dispatched?'unknown':'prepared',dispatchId:dispatched?randomUUID():null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
 await native.withCurrentCardServiceV4(binding,f.quote.id,async l=>{await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempts VALUES($1,$2,$3,$4,$5,$6)',[f.workspace,id,f.quote.id,1,attempt.state,seal(JSON.stringify(attempt),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);await l.advance();});
 const snapshots=new Map<string,ProviderPaymentSnapshot>(),provider:BillingStripeTestProvider={createCheckout:async()=>{throw Error('CREATE_FORBIDDEN');},readPayment:async(r,b)=>{expect(controls.depth).toBe(0);expect(b).toEqual(binding);controls.reads++;const s=snapshots.get(r.eventId);if(!s)throw new AppError('UNAVAILABLE');return structuredClone(s);}};
 const processor=(allocation:ServiceRefundAllocationAuthorityV4|null=null,transport:BillingStripeTestProvider|null=provider)=>new FishingServiceCardEventsV4(db,f.workspace,native,programRing,ledgerKey,binding,inbox,transport,allocation);
 const owner=()=>new FishingServiceBillingOwnerV4(f.workspace,new FishingProgramSourceNativeV3(f.db,f.workspace,programRing,programKey,f.owner.id,f.clock),families,programRing,programKey,f.commandKey,ledgerKey,f.clock,{target:async()=>{},authorize:async()=>{}});
 return {...f,native,processor,controls,snapshots,binding,inbox,attempt,db,billingOwner:owner,provider};
}
type Fixture=Awaited<ReturnType<typeof ready>>;
function payment(f:Fixture,change:Partial<ProviderPaymentSnapshot>={}){return providerPaymentSnapshotSchema.parse({accountId:f.binding.accountId,livemode:false,apiVersion:f.binding.apiVersion,quoteId:f.quote.id,attemptId:f.attempt.id,sessionId:'cs_'+f.attempt.id.replaceAll('-',''),paymentIntentId:'pi_'+f.attempt.id.replaceAll('-',''),currency:'USD',amountMinor:130000,receivedMinor:130000,status:'paid',method:'card',paidAt:f.clock.now().toISOString(),observedAt:f.clock.now().toISOString(),refunds:[],dispute:'none',...change});}
async function event(f:Fixture,s:ProviderPaymentSnapshot,type:BillingStripeSignedReceipt['eventType']='payment_intent.succeeded',object?:string){
 const eventId='evt_'+randomUUID().replaceAll('-',''),bytes=Buffer.from('SYNTHETIC-EVENT4-'+eventId),receipt:BillingStripeSignedReceipt={eventId,eventType:type,objectId:object??(type.startsWith('refund')?s.refunds[0]!.id:s.paymentIntentId),providerAccountId:f.binding.accountId,livemode:false,apiVersion:f.binding.apiVersion,digest:createHash('sha256').update(bytes).digest('hex'),createdAt:f.clock.now().toISOString()};
 const cap=verifyBillingStripeTestEvent({rawBody:bytes,signatureHeader:'MOCK-NOT-A-STRIPE-SIGNATURE',binding:f.binding,now:f.clock.now(),sdk:{verify:()=>({kind:'stripe_test_signature_only',receipt})}});
 await new FishingBillingStripeInbox(f.db,f.workspace,programRing,f.clock,f.inbox).ingest(cap);f.snapshots.set(eventId,s);return eventId;
}
const balance=(f:Fixture)=>f.native.withCurrentCardServiceV4(f.binding,f.quote.id,async l=>l.frame);
async function moneyRows(f:Fixture){const result:Record<string,unknown>={};for(const table of ['quotes','receipts','card_attempts','card_settlements','stripe_events','card_exceptions','guest_financial_acceptances'])result[table]=(await engine.query('SELECT * FROM ls_fishing_billing.'+table+' WHERE workspace_id=$1 ORDER BY 2',[f.workspace])).rows;return result;}
it('service-card-events-v4 settles actual V4 two-child balances and recovers the exact committed event result without another provider read',async()=>{
 const f=await ready(),id=await event(f,payment(f)),before=await moneyRows(f),first=await f.processor().processEvent(id);expect(first.review).toBe(false);expect(first.receiptIds).toHaveLength(1);
 const s=await balance(f);expect(s.version).toBe(BILLING_SERVICE_V4);expect(s.quote.revision).toBe(5);expect(s.balance).toMatchObject({state:'paid',paidMinor:130000,remainingMinor:0,pendingAttemptIds:[]});expect(s.balance.lines.map(l=>l.paidMinor)).toEqual([65000,65000]);
 const committed=await moneyRows(f);expect(committed.guest_financial_acceptances).toEqual(before.guest_financial_acceptances);expect(await f.processor().processEvent(id)).toEqual(first);expect(f.controls.reads).toBe(1);expect(await moneyRows(f)).toEqual(committed);
});
it('service-card-events-v4 credits one original transaction across distinct signed events',async()=>{
 const f=await ready(),snapshot=payment(f),a=await event(f,snapshot),b=await event(f,snapshot,'checkout.session.completed',snapshot.sessionId);await f.processor().processEvent(a);await f.processor().processEvent(b);expect((await balance(f)).balance.receipts).toHaveLength(1);expect((await moneyRows(f)).card_settlements).toHaveLength(1);
});
it('service-card-events-v4 uses current payment facts rather than a failure-event label and retains pending uncertainty',async()=>{
 const f=await ready(),pending=payment(f,{status:'pending',receivedMinor:0,paidAt:null}),id=await event(f,pending,'payment_intent.payment_failed');await f.processor().processEvent(id);
 const s=await balance(f);expect(s.balance).toMatchObject({state:'unpaid',paidMinor:0,pendingAttemptIds:[f.attempt.id]});expect(s.balance.receipts).toHaveLength(0);
 const paid=await event(f,payment(f));await f.processor().processEvent(paid);expect((await balance(f)).balance.state).toBe('paid');
});
it('service-card-events-v4 appends refund-first payment plus explicitly authorized child allocation with immutable original facts',async()=>{
 const f=await ready(),snapshot=payment(f,{refunds:[{id:'re_SYNTHETIC'+randomUUID().replaceAll('-',''),amountMinor:20000,state:'succeeded',occurredAt:f.clock.now().toISOString()}]}),id=await event(f,snapshot,'refund.updated');
 const allocation:ServiceRefundAllocationAuthorityV4={allocations:async(_c,frame,r)=>{expect(frame.version).toBe(BILLING_SERVICE_V4);return [{lineId:f.quote.lines[0]!.id,amountMinor:r.amountMinor}];}};
 const p=await f.processor(allocation).processEvent(id);expect(p.receiptIds).toHaveLength(2);const s=await balance(f);expect(s.balance.lines.map(l=>l.remainingMinor)).toEqual([20000,0]);expect(s.balance.receipts.find(r=>r.kind==='refund')!.originalReceiptId).toBe(s.balance.receipts.find(r=>r.kind==='card')!.id);
});
it('service-card-events-v4 holds an unallocated refund or never-dispatched funds for review without inventing receipts',async()=>{
 const f=await ready(),s=payment(f,{refunds:[{id:'re_SYNTHETIC',amountMinor:20000,state:'succeeded',occurredAt:f.clock.now().toISOString()}]}),id=await event(f,s,'refund.updated');expect(await f.processor().processEvent(id)).toMatchObject({review:true,reason:'refund_allocation_required'});expect((await balance(f)).balance).toMatchObject({state:'review_required',paidMinor:0});
 const untouched=await ready(false),e=await event(untouched,payment(untouched));expect(await untouched.processor().processEvent(e)).toMatchObject({review:true,reason:'never_dispatched_funds'});expect((await balance(untouched)).balance.receipts).toHaveLength(0);
});
it.each(['account','quote','object','invoice'] as const)('service-card-events-v4 rejects mismatched %s joins without crediting a family',async kind=>{
 const f=await ready(),s=payment(f);if(kind==='account')s.accountId='acct_WRONG';if(kind==='quote')s.quoteId=randomUUID();const id=await event(f,s,kind==='invoice'?'invoice.paid':'payment_intent.succeeded',kind==='object'?'pi_WRONG':kind==='invoice'?'in_UNIMPLEMENTED':undefined),before=await moneyRows(f);
 await expect(f.processor().processEvent(id)).rejects.toThrow();expect(await moneyRows(f)).toEqual(before);expect((await balance(f)).balance.paidMinor).toBe(0);
});
it('service-card-events-v4 atomically rolls back receipt/attempt/settlement/event on storage failure and later recovers the same event',async()=>{
 const f=await ready(),id=await event(f,payment(f)),before=await moneyRows(f);f.controls.settlementFails=true;await expect(f.processor().processEvent(id)).rejects.toThrow('UNAVAILABLE');expect(await moneyRows(f)).toEqual(before);
 f.controls.settlementFails=false;expect((await f.processor().processEvent(id)).receiptIds).toHaveLength(1);expect((await balance(f)).balance.state).toBe('paid');
});
it('service-card-events-v4 preserves post-COMMIT uncertainty and recovers the exact original processing receipt without recredit or provider read',async()=>{
 const f=await ready(),id=await event(f,payment(f));f.controls.postCommit=true;await expect(f.processor().processEvent(id)).rejects.toThrow('UNAVAILABLE');const stored=await moneyRows(f),reads=f.controls.reads;
 expect((await balance(f)).balance.state).toBe('paid');const recovered=await f.processor().processEvent(id);expect(recovered.receiptIds).toHaveLength(1);expect(f.controls.reads).toBe(reads);expect(await moneyRows(f)).toEqual(stored);
});
it('service-card-events-v4 denies revoked service or missing provider rather than using an owner or legacy ledger fallback',async()=>{
 const f=await ready(),id=await event(f,payment(f)),before=await moneyRows(f);await engine.query('UPDATE synthetic_event4.admission SET active=false WHERE workspace_id=$1',[f.workspace]);await expect(f.processor().processEvent(id)).rejects.toThrow('FORBIDDEN');expect(await moneyRows(f)).toEqual(before);
 await expect(f.processor(null,null).processEvent(id)).rejects.toThrow('UNAVAILABLE');
});
it('service-card-events-v4 records late funds after actual owner cancellation without resuming the agreement',async()=>{
 const f=await ready();await f.billingOwner().setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:4,cancel:true});const id=await event(f,payment(f));await f.processor().processEvent(id);const s=await balance(f);expect(s.quote.state).toBe('cancelled');expect(s.balance).toMatchObject({cancelled:true,paidMinor:130000,remainingMinor:0});
});
