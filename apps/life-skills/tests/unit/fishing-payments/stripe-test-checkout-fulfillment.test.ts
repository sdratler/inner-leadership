/** Source193 AUTHORING ONLY, UNRUN. Transaction/provider/native-policy doubles;
 * not actual signature, native atomicity, merchant, legal or sandbox proof. */
import {randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import type {Actor,SqlSession} from '../../../src/features/fishing/contract.ts';
import type {NativeContext,ProviderOperation,PurchaseRecord} from '../../../src/features/fishing-payments/ports.ts';
import {digest,initialPayment,settled,type SettlementFact} from '../../../src/features/fishing-payments/domain.ts';
import type {FishingPaymentStore} from '../../../src/features/fishing-payments/store.ts';
import {checkoutNativeJournalActions as N} from '../../../src/features/fishing-payments/stripe-test-checkout-native.ts';
import {StripeTestCheckoutFulfillment,checkoutFulfillmentBounds,type CheckoutEnrollmentTarget} from '../../../src/features/fishing-payments/stripe-test-checkout-fulfillment.ts';
import {enrollmentCommandSchema} from '../../../src/features/fishing/native-program-contract.ts';
import type {StripeTestCheckoutContext,StripeTestCheckoutProvider,CheckoutKnownBinding,CheckoutObservation} from '../../../src/features/fishing-payments/stripe-test-checkout-ports.ts';
import {offerFixture} from './fixture.ts';
const NOW=Date.parse('2027-01-05T15:00:00Z'),merchant={accountId:'acct_SYNTHETIC_FULFILLMENT',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC_NOT_ACTUAL_PROVIDER_PROOF'};
type EnrollmentRow={id:string;state:string;lineId:string;stageId:string;learnerId:string};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function fixture(){
 const offer=offerFixture('installments',NOW),line=offer.lines[0]!,purchaseId=randomUUID(),operationId=randomUUID(),eventId='evt_SYNTHETIC_FULFILLMENT',customerId='cus_SYNTHETIC_FULFILLMENT',sessionId='cs_test_SYNTHETIC_FULFILLMENT',invoiceId='in_SYNTHETIC_FULFILLMENT',pi='pi_SYNTHETIC_FULFILLMENT';
 const actor={id:offer.operatorAccountId,workspaceId:offer.workspaceId,role:'practitioner'} as Actor,p:PurchaseRecord={offer,line,state:initialPayment(offer,line,purchaseId,merchant)};
 const schedule={id:randomUUID(),revision:1,sourceVersion:'SYNTHETIC_EXPLICIT_SCHEDULE',offerId:offer.id,offerRevision:offer.revision,purchaseLineId:line.id,learnerId:line.learnerId,currency:'USD' as const,mode:line.mode,totalCents:line.totalCents,dues:line.dues.map(d=>({id:d.id,index:d.index,amountCents:d.amountCents,dueAt:d.dueAt}))};
 const context:StripeTestCheckoutContext={offer,offerDigest:digest(offer),purchaseId,purchaseLineId:line.id,dueId:line.dues[0]!.id,operationId,generation:1,entryPoint:'registration',schedule,scheduleDigest:digest(schedule),authorizationVersion:'a'.repeat(64),customer:{bindingId:randomUUID(),revision:1,payerAccountId:offer.payerAccountId,customerId,merchantBindingId:merchant.verifiedBindingId,verifiedAt:new Date(NOW-60000).toISOString()},agreements:{approvalId:'SYNTHETIC_NOT_LEGAL_APPROVAL',documentSetId:'SYNTHETIC_TWELVE_SESSION_TERMS',documentSetRevision:1,acceptanceId:randomUUID(),termsVersion:offer.terms.version,program:'sunday_fishing_academy',sessions:12,acceptedBy:offer.payerAccountId,acceptedAt:offer.terms.acceptedAt,language:'en'},window:{policyId:'SYNTHETIC_WINDOW',revision:1,sourceVersion:'SYNTHETIC_ONLY',opensAt:new Date(NOW-60000).toISOString(),closesAt:offer.expiresAt},expiresAt:new Date(NOW+3600000).toISOString()};
 const known:CheckoutKnownBinding={id:randomUUID(),revision:1,sessionId,contextDigest:digest(context),operationId,purchaseId,purchaseLineId:line.id,dueId:context.dueId,customerBindingId:context.customer.bindingId,offerDigest:context.offerDigest,scheduleDigest:context.scheduleDigest};
 let op:ProviderOperation={id:operationId,kind:'hosted_invoice',workspaceId:offer.workspaceId,purchaseId,dueId:context.dueId,refundPaymentId:null,providerAccountId:merchant.accountId,livemode:false,amountCents:65000,currency:'USD',idempotencyKey:`rm:${offer.workspaceId}:${operationId}`,state:'unknown',requestDigest:digest([offer.id,offer.revision,line.id,line.dues[0]]),result:null};
 const receipt:Record<string,unknown>={eventId,eventType:'checkout.session.completed',objectId:sessionId,providerAccountId:merchant.accountId,livemode:false,apiVersion:merchant.apiVersion,digest:'d'.repeat(64),createdAt:new Date(NOW-1000).toISOString()};
 const journals=new Map<string,{value:unknown;hash:string}>(),facts:{fact:SettlementFact;hash:string}[]=[],rows:EnrollmentRow[]=[],calls:string[]=[];journals.set(N.intent+':'+operationId,{value:context,hash:digest(context)});journals.set(N.pending+':'+operationId,{value:known,hash:digest(known)});
 let processedAt:Date|null=null,receiptPresent=true,reads=true,founder=false,confirmFailure:string|null=null,loseEnrollmentReply=false,target:CheckoutEnrollmentTarget|null={fitDecisionId:randomUUID(),termsAcceptanceId:randomUUID(),policyApprovalId:randomUUID(),revision:'b'.repeat(64)},guardian=true;
 const tx:SqlSession={query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{let result:object[]=[];
  if(sql.includes('FROM ls_identity.workspaces')){if(v[0]===offer.workspaceId)result=[{id:offer.workspaceId}];}
  else if(sql.includes('FROM ls_identity.accounts')){if(v[0]===offer.workspaceId&&v[1]===actor.id)result=[{id:actor.id}];}
  else if(sql.includes('FROM ls_fishing_payments.commands')){const row=journals.get(String(v[1])+':'+String(v[2]));if(v[0]===offer.workspaceId&&row)result=[row];}
  else if(sql.startsWith('INSERT INTO ls_fishing_payments.commands'))journals.set(String(v[2])+':'+String(v[3]),{value:JSON.parse(String(v[5])),hash:String(v[4])});
  else if(sql.includes('SELECT receipt_json AS receipt')){if(receiptPresent&&v[0]===merchant.accountId&&v[1]===eventId)result=[{receipt,hash:'d'.repeat(64),processedAt}];}
  else if(sql.includes('SELECT event_id FROM ls_fishing_payments.inbox')){if(processedAt&&v[1]===eventId)result=[{event_id:eventId}];}
  else if(sql.includes('FROM ls_fishing_payments.settlements'))result=facts;
  else if(sql.includes('FROM ls_fishing_stage.enrollments'))result=rows;
  else throw Error('UNHANDLED_UNIT_SQL');return result as T[];
 }};
 const store={deps:{merchant,clock:{now:()=>new Date(NOW)},authority:{loadApprovedOffer:async()=>offer}},read:async<T>(who:Actor,work:(c:NativeContext)=>Promise<T>)=>{if(!reads)throw Error('UNAVAILABLE');if(who.id!==actor.id||who.workspaceId!==actor.workspaceId||who.role!=='practitioner')throw Error('NOT_FOUND');return work({tx,actor:who,now:new Date(NOW)});},purchase:async()=>p,operation:async()=>op,access:async()=>{},assertHostedActivationAllowed:vi.fn(async()=>{if(founder)throw Error('FOUNDER_ACTIVATION_BLOCKED');})} as unknown as FishingPaymentStore;
 const observation:CheckoutObservation={contextDigest:digest(context),sessionId,customerId,status:'complete',paymentStatus:'paid',amountCents:65000,expiresAt:Math.floor(Date.parse(context.expiresAt)/1000),invoiceId,paymentIntentId:pi,url:null};
 const provider:StripeTestCheckoutProvider={execution:'stripe_test_checkout',binding:merchant,perform:vi.fn<StripeTestCheckoutProvider['perform']>(async()=>{calls.push('provider');return observation;})};
 const coordinator={inspect:vi.fn(async()=>({context,known})),reconcile:vi.fn(async()=>{calls.push('reconcile');return {state:'observed' as const};}),promote:vi.fn(async()=>{calls.push('promote');op={...op,state:'confirmed',result:{kind:'hosted_invoice',providerObjectId:invoiceId,url:`https://checkout.stripe.com/c/pay/${sessionId}#opaque`,providerAccountId:merchant.accountId,livemode:false,currency:'USD',amountCents:65000,purchaseId,dueId:context.dueId,idempotencyKey:op.idempotencyKey}};return {state:'references_promoted' as const,operationId,sessionId,invoiceId,paymentIntentId:pi,settlementRecorded:false as const};})};
 const recordCash=()=>{if(!facts.length){const fact:SettlementFact={canonicalTransactionId:pi,providerReceiptId:eventId,relatedProviderObjectId:invoiceId,operationId,purchaseId,purchaseLineId:line.id,dueId:context.dueId,providerAccountId:merchant.accountId,livemode:false,currency:'USD',kind:'payment',cents:65000,feeCents:100,originalPaymentId:null,occurredAt:new Date(NOW-1000).toISOString()};facts.push({fact,hash:digest({transaction:pi,purchase:purchaseId,line:line.id,due:context.dueId,merchant:merchant.accountId,mode:false,kind:'payment',currency:'USD',cents:65000,originalPayment:null})});p.state=settled(p.state,[fact],new Date(NOW).toISOString());}processedAt=new Date(NOW);};
 const inbox={store,processStripeTest:vi.fn(async()=>{calls.push('cash');recordCash();return {state:'reconciled' as const};})};
 const program={confirmEnrollment:vi.fn(async(_who:Actor,raw:unknown)=>{calls.push('enroll');const input=enrollmentCommandSchema.parse(raw);if(confirmFailure)throw Error(confirmFailure);expect(input.expectedPaymentRevision).toBe(p.state.revision);rows.push({id:input.id,state:'confirmed',lineId:line.id,stageId:line.stageId,learnerId:line.learnerId});if(loseEnrollmentReply)throw Error('SYNTHETIC_LOST_ENROLLMENT_REPLY');return {id:input.id,revision:1,state:'confirmed' as const,replayed:false};}),readEnrollmentForInquiryLinkInTransaction:vi.fn(async()=>{if(!guardian)throw Error('FORBIDDEN');const row=rows[0];if(!row)throw Error('NOT_FOUND');return {enrollment:{id:row.id,state:row.state,purchaseId},offerId:offer.id,operatorAccountId:actor.id};})};
 const policy={enrollmentTarget:vi.fn(async()=>target)},make=()=>new StripeTestCheckoutFulfillment(store,coordinator,provider,inbox,program as unknown as ConstructorParameters<typeof StripeTestCheckoutFulfillment>[4],policy),processor=make(),run=()=>processor.process(actor,eventId,operationId);
 return {offer,p,actor,context,known,receipt,journals,facts,rows,calls,provider,coordinator,inbox,program,policy,store,processor,make,run,recordCash,eventId,operationId,observation,noReceipt:()=>{receiptPresent=false;},holdFounder:()=>{founder=true;},targetMissing:()=>{target=null;},failConfirm:(value:string|null)=>{confirmFailure=value;},loseEnrollmentReply:()=>{loseEnrollmentReply=true;},readable:(value:boolean)=>{reads=value;},revokeGuardian:()=>{guardian=false;},advanceRevision:()=>{p.state={...p.state,revision:p.state.revision+1};}};
}

it('requires a durable exact TEST session receipt and ordinary current operator before provider I/O',async()=>{
 for(const patch of[{livemode:true},{providerAccountId:'acct_FOREIGN'},{apiVersion:'wrong'},{objectId:'cs_test_FOREIGN'},{eventType:'invoice.paid'},{digest:'e'.repeat(64)}]){const f=fixture();Object.assign(f.receipt,patch);await expect(f.run()).rejects.toThrow();expect(f.provider.perform).not.toHaveBeenCalled();}
 const f=fixture();f.noReceipt();await expect(f.run()).rejects.toThrow();await expect(f.processor.process({...f.actor,role:'parent'},f.eventId,f.operationId)).rejects.toThrow();expect(f.inbox.processStripeTest).not.toHaveBeenCalled();
});
it('orders known GET, reconciliation, promotion, existing cash writer, actual-revision enrollment and native readback',async()=>{
 const f=fixture(),r=await f.run();expect(f.calls).toEqual(['provider','reconcile','promote','cash','enroll']);expect(r).toMatchObject({state:'enrolled',money:'recorded',enrollment:'confirmed',paidCents:65000,paymentRevision:2});expect(f.facts).toHaveLength(1);expect(f.p.state.dues.map(d=>d.paidCents)).toEqual([65000,0,0]);
});
it('a new processor recovers replay without repeating provider/cash/enrollment effects',async()=>{
 const f=fixture(),r=await f.run(),again=await f.make().process(f.actor,f.eventId,f.operationId);expect(again).toEqual(r);expect(f.provider.perform).toHaveBeenCalledTimes(1);expect(f.inbox.processStripeTest).toHaveBeenCalledTimes(1);expect(f.program.confirmEnrollment).toHaveBeenCalledTimes(1);
});
it('unpaid or wrong-amount observations cannot become promotion, cash or enrollment',async()=>{
 const f=fixture();vi.mocked(f.provider.perform).mockResolvedValue({...f.observation,paymentStatus:'unpaid',invoiceId:null,paymentIntentId:null});expect(await f.run()).toMatchObject({state:'provider_pending',reason:'session_unpaid',money:'not_recorded'});expect(f.coordinator.promote).not.toHaveBeenCalled();
 const g=fixture();vi.mocked(g.provider.perform).mockResolvedValue({...g.observation,amountCents:100});expect(await g.run()).toMatchObject({state:'provider_pending',money:'not_recorded'});expect(g.inbox.processStripeTest).not.toHaveBeenCalled();
});
it('reference promotion never substitutes for cash readback',async()=>{
 const f=fixture();f.inbox.processStripeTest.mockResolvedValue({state:'reconciled'});expect(await f.run()).toMatchObject({state:'cash_pending',reason:'native_cash_missing',money:'not_recorded'});expect(f.program.confirmEnrollment).not.toHaveBeenCalled();expect(f.facts).toHaveLength(0);
});
it('lost receipt-processor commit reply is recovered from durable cash before enrollment',async()=>{
 const f=fixture();f.inbox.processStripeTest.mockImplementation(async()=>{f.recordCash();throw Error('SYNTHETIC_LOST_CASH_COMMIT_REPLY');});expect(await f.run()).toMatchObject({state:'enrolled',money:'recorded'});expect(f.facts).toHaveLength(1);
});
it('unknown cash readback stays unknown and does not enroll',async()=>{
 const f=fixture();f.inbox.processStripeTest.mockImplementation(async()=>{f.recordCash();f.readable(false);throw Error('SYNTHETIC_UNKNOWN_REPLY');});expect(await f.run()).toMatchObject({state:'cash_pending',money:'unknown',enrollment:'unknown',paymentRevision:null});expect(f.program.confirmEnrollment).not.toHaveBeenCalled();f.readable(true);expect(await f.run()).toMatchObject({state:'enrolled',money:'recorded'});
});
it('cash remains recorded when the real enrollment target/policy/fit/capacity is unavailable',async()=>{
 const f=fixture();f.targetMissing();expect(await f.run()).toMatchObject({state:'cash_recorded_enrollment_pending',reason:'native_target_required',money:'recorded',enrollment:'not_confirmed'});
 for(const [code,reason] of[['POLICY_REQUIRED','policy_required'],['APPROVAL_REQUIRED','native_approval_required'],['CAPACITY','capacity_required']]){const g=fixture();g.failConfirm(code!);expect(await g.run()).toMatchObject({state:'cash_recorded_enrollment_pending',reason,money:'recorded'});expect(g.facts).toHaveLength(1);}
});
it('failed enrollment retries reuse an immutable command; changed actual revision preserves enrollment ID',async()=>{
 const f=fixture();f.failConfirm('CAPACITY');await f.run();await f.run();const first=f.program.confirmEnrollment.mock.calls[0]![1],second=f.program.confirmEnrollment.mock.calls[1]![1];expect(second).toEqual(first);f.advanceRevision();f.failConfirm(null);await f.run();const changed=enrollmentCommandSchema.parse(f.program.confirmEnrollment.mock.calls[2]![1]),old=enrollmentCommandSchema.parse(first);expect(changed.id).toBe(old.id);expect(changed.commandId).not.toBe(old.commandId);expect(changed.expectedPaymentRevision).toBe(f.p.state.revision);
});
it('lost enrollment reply is read back from native confirmation and cannot duplicate enrollment',async()=>{
 const f=fixture();f.loseEnrollmentReply();expect(await f.run()).toMatchObject({state:'enrolled',enrollment:'confirmed'});expect(await f.run()).toMatchObject({state:'enrolled'});expect(f.rows).toHaveLength(1);expect(f.program.confirmEnrollment).toHaveBeenCalledTimes(1);
});
it('cached enrollment success does not bypass current native guardian readback',async()=>{
 const f=fixture();await f.run();f.revokeGuardian();expect(await f.run()).toMatchObject({state:'cash_recorded_enrollment_pending',money:'recorded',reason:'native_approval_required'});expect(f.program.confirmEnrollment).toHaveBeenCalledTimes(1);
});
it('founder activation remains blocked before any provider, cash or enrollment effect',async()=>{
 const f=fixture();f.holdFounder();await expect(f.run()).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');expect(f.provider.perform).not.toHaveBeenCalled();expect(f.inbox.processStripeTest).not.toHaveBeenCalled();expect(f.program.confirmEnrollment).not.toHaveBeenCalled();
});
it('known-provider read has a finite deadline without another attempt',async()=>{
 const f=fixture();vi.useFakeTimers();vi.mocked(f.provider.perform).mockImplementation(async()=>new Promise<CheckoutObservation>(()=>{}));const pending=f.run();await vi.advanceTimersByTimeAsync(checkoutFulfillmentBounds.checkoutReadMilliseconds+1);expect(await pending).toMatchObject({state:'provider_pending',money:'not_recorded'});expect(f.provider.perform).toHaveBeenCalledTimes(1);
});
