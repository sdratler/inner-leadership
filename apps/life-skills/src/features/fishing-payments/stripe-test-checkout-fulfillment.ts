import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {lockWorkspace} from '../identity/data.ts';
import {one} from '../identity/store.ts';
import type {Actor} from '../fishing/contract.ts';
import type {NativeFishingProgram} from '../fishing/native-program.ts';
import {enrollmentCommandSchema} from '../fishing/native-program-contract.ts';
import {approvedOffer,digest,invariant,signedFeeCents} from './domain.ts';
import {FishingPaymentStore} from './store.ts';
import type {FishingReceiptInbox} from './receipts.ts';
import type {NativeContext,ProviderOperation,PurchaseRecord,Receipt} from './ports.ts';
import {checkoutNativeJournalActions,type NativeStripeCheckoutCoordinator} from './stripe-test-checkout-native.ts';
import {checkoutBindingSchema,checkoutProviderId,validateCheckoutContext,validateCheckoutKnown,validateCheckoutObservation,type StripeTestCheckoutBinding,type StripeTestCheckoutContext,type StripeTestCheckoutProvider,type CheckoutKnownBinding,type CheckoutObservation} from './stripe-test-checkout-ports.ts';

const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),pid=checkoutProviderId,money=z.number().int().nonnegative().max(100000000);
const receiptSchema=z.strictObject({eventId:pid('evt'),eventType:z.enum(['checkout.session.completed','checkout.session.async_payment_succeeded']),objectId:pid('cs'),providerAccountId:pid('acct'),livemode:z.literal(false),apiVersion:z.literal('2026-09-30.endive'),digest:sha,createdAt:z.iso.datetime({offset:true})});
const factSchema=z.strictObject({canonicalTransactionId:pid('pi'),providerReceiptId:pid('evt'),relatedProviderObjectId:pid('in'),operationId:uuid,purchaseId:uuid,purchaseLineId:opaque,dueId:opaque,providerAccountId:pid('acct'),livemode:z.literal(false),currency:z.literal('USD'),kind:z.literal('payment'),cents:money.positive(),feeCents:signedFeeCents.nullable(),originalPaymentId:z.null(),occurredAt:z.iso.datetime({offset:true})});
const targetSchema=z.strictObject({fitDecisionId:uuid,termsAcceptanceId:uuid,policyApprovalId:uuid,revision:sha});
const planSchema=z.strictObject({purchaseId:uuid,purchaseLineId:opaque,stageId:uuid,learnerId:uuid,offerDigest:sha,enrollmentId:uuid});
const attemptSchema=z.strictObject({targetRevision:sha,input:enrollmentCommandSchema});
export const checkoutFulfillmentActions=Object.freeze({plan:'stripe-test.checkout.fulfillment.plan',attempt:'stripe-test.checkout.fulfillment.attempt'});
export const checkoutFulfillmentBounds=Object.freeze({checkoutReadMilliseconds:15000,eventsPerCall:1});
export type CheckoutEnrollmentTarget=Readonly<z.infer<typeof targetSchema>>;
/** Root loads actual current fit/terms/hold/native policy approvals in this
 * transaction; IDs and a revision string are references, never permission.
 * No SDK/network here. NativeFishingProgram remains the final enforcing writer.
 * null means no admitted target; cash may be recorded without enrollment. */
export interface CheckoutFulfillmentPolicy{
 enrollmentTarget(c:NativeContext,purchase:PurchaseRecord,context:StripeTestCheckoutContext):Promise<CheckoutEnrollmentTarget|null>;
}
type Coordinator=Pick<NativeStripeCheckoutCoordinator,'inspect'|'reconcile'|'promote'>;
type Inbox=Pick<FishingReceiptInbox,'store'|'processStripeTest'>;
type Program=Pick<NativeFishingProgram,'confirmEnrollment'|'readEnrollmentForInquiryLinkInTransaction'>;
type Loaded={context:StripeTestCheckoutContext;known:CheckoutKnownBinding;purchase:PurchaseRecord;operation:ProviderOperation;receipt:Receipt;processedAt:Date|null};
type Snapshot=Loaded&{cash:boolean};
type Reason='provider_read_required'|'session_unpaid'|'session_expired'|'reference_promotion_required'|'receipt_processing_required'|'native_cash_readback_required'|'native_cash_missing'|'native_target_required'|'policy_required'|'native_approval_required'|'capacity_required'|'native_retry_required'|'enrollment_inactive'|'enrollment_readback_required'|'confirmed';
export type CheckoutFulfillmentResult=Readonly<{
 state:'provider_pending'|'cash_pending'|'cash_recorded_enrollment_pending'|'enrolled';reason:Reason;
 eventId:string;operationId:string;purchaseId:string;money:'not_recorded'|'unknown'|'recorded';
 enrollment:'not_confirmed'|'unknown'|'confirmed';enrollmentId:string|null;paymentRevision:number|null;paidCents:number|null;
}>;
type EnrollmentStep={state:'confirmed';id:string}|{state:'pending';id:string|null;reason:Reason}|{state:'attempt';input:z.infer<typeof enrollmentCommandSchema>};
const stepKey=(step:string,value:unknown)=>'checkout.'+step+':'+digest(value);
function pendingReason(error:unknown):Reason{const code=error instanceof Error?('code'in error?String(error.code):error.message):'';return code==='POLICY_REQUIRED'?'policy_required':code==='CAPACITY'?'capacity_required':['APPROVAL_REQUIRED','FORBIDDEN','NOT_FOUND'].includes(code)?'native_approval_required':'native_retry_required';}

/** Source193 server-only explicit ONE-event operator processor. No webhook
 * actor minting, browser return, creation, automatic founder activation, second
 * ledger, schema, scheduler, credentials or provider discovery. Each native
 * operation commits separately. ALL provider calls occur outside transactions.
 * Native journals, canonical settlement identity and native enrollment receipts
 * are recovery truth, rather than a cached orchestration success flag.
 */
export class StripeTestCheckoutFulfillment{
 readonly #binding:StripeTestCheckoutBinding;
 constructor(private readonly store:FishingPaymentStore,private readonly coordinator:Coordinator,private readonly provider:StripeTestCheckoutProvider,private readonly inbox:Inbox,private readonly program:Program,private readonly policy:CheckoutFulfillmentPolicy|null){this.#binding=Object.freeze(checkoutBindingSchema.parse(store.deps.merchant));this.composition();}
 private composition(){invariant(this.inbox.store===this.store&&this.provider.execution==='stripe_test_checkout'&&digest(this.provider.binding)===digest(this.#binding)&&digest(this.store.deps.merchant)===digest(this.#binding),'STRIPE_TEST_FULFILLMENT_UNAVAILABLE');}
 private async journal(c:NativeContext,action:string,key:string){
  const rows=await c.tx.query<{value:unknown;hash:string}>('SELECT result_json AS value,digest AS hash FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND action=$2 AND command_id=$3 AND octet_length(result_json::text)<=131072 ORDER BY actor_id LIMIT 2 FOR SHARE',[c.actor.workspaceId,action,key]);invariant(rows.length<=1,'CONFLICT');const row=rows[0];if(row)invariant(row.hash===digest(row.value),'UNAVAILABLE');return row??null;
 }
 private async save(c:NativeContext,action:string,key:string,value:unknown){
  opaque.parse(key);invariant(Buffer.byteLength(JSON.stringify(value))<=131072,'UNAVAILABLE');const old=await this.journal(c,action,key);if(old){invariant(old.hash===digest(value),'CONFLICT');return;}
  await c.tx.query('INSERT INTO ls_fishing_payments.commands(workspace_id,actor_id,action,command_id,digest,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[c.actor.workspaceId,c.actor.id,action,key,digest(value),JSON.stringify(value),c.now]);
 }
 private async load(c:NativeContext,eventId:string,operationId:string):Promise<Loaded>{
  this.composition();invariant(c.actor.role==='practitioner','NOT_FOUND');
  const verified=await one(c.tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[c.actor.workspaceId,c.actor.id]);invariant(verified,'NOT_FOUND');
  const intent=await this.journal(c,checkoutNativeJournalActions.intent,operationId);invariant(intent,'NOT_FOUND');const context=validateCheckoutContext(intent.value,this.#binding),pending=await this.journal(c,checkoutNativeJournalActions.pending,operationId);invariant(pending,'UNKNOWN_CREATE');const known=validateCheckoutKnown(pending.value,context),op=await this.store.operation(c,operationId),p=await this.store.purchase(c,context.purchaseId);
  invariant(context.operationId===operationId&&context.offer.workspaceId===c.actor.workspaceId&&p.offer.program==='sunday_fishing_academy'&&p.offer.operatorAccountId===c.actor.id&&digest(p.offer)===context.offerDigest&&p.line.id===context.purchaseLineId&&p.state.providerAccountId===this.#binding.accountId&&!p.state.livemode&&op.kind==='hosted_invoice'&&op.workspaceId===c.actor.workspaceId&&op.purchaseId===context.purchaseId&&op.dueId===context.dueId&&op.providerAccountId===this.#binding.accountId&&!op.livemode&&op.currency==='USD'&&op.amountCents===p.line.dues.find(d=>d.id===context.dueId)?.amountCents,'NOT_FOUND');
  await this.store.access(c,p.offer,'read',true);await this.store.assertHostedActivationAllowed(c,p.offer);
  const current=await this.store.deps.authority.loadApprovedOffer(c.tx,c.actor,p.offer.id);invariant(current&&digest(approvedOffer(current))===context.offerDigest,'APPROVAL_CHANGED');
  const row=await one<{receipt:unknown;hash:string;processedAt:Date|null}>(c.tx,'SELECT receipt_json AS receipt,digest AS hash,processed_at AS "processedAt" FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2 AND octet_length(receipt_json::text)<=131072 FOR SHARE',[this.#binding.accountId,eventId]);invariant(row,'NATIVE_RECEIPT_REQUIRED');const receipt=receiptSchema.parse(row.receipt);
  invariant(receipt.eventId===eventId&&receipt.objectId===known.sessionId&&receipt.providerAccountId===this.#binding.accountId&&receipt.digest===row.hash&&Date.parse(receipt.createdAt)<=c.now.valueOf()&&(row.processedAt===null||row.processedAt instanceof Date),'NATIVE_RECEIPT_REQUIRED');return {context,known,purchase:p,operation:op,receipt,processedAt:row.processedAt};
 }
 private async cash(c:NativeContext,s:Loaded){
  const rows=await c.tx.query<{fact:unknown;hash:string}>('SELECT fact_json AS fact,digest AS hash FROM ls_fishing_payments.settlements WHERE provider_account_id=$1 AND livemode=false AND kind=\'payment\' AND workspace_id=$2 AND purchase_id=$3 AND fact_json->>\'operationId\'=$4 AND octet_length(fact_json::text)<=131072 ORDER BY transaction_id LIMIT 2 FOR SHARE',[this.#binding.accountId,c.actor.workspaceId,s.context.purchaseId,s.context.operationId]);invariant(rows.length<=1,'NATIVE_CASH_CONFLICT');if(!rows[0])return false;
  const f=factSchema.parse(rows[0].fact),op=s.operation,p=s.purchase,due=p.state.dues.find(d=>d.id===f.dueId);
  invariant(op.state==='confirmed'&&op.result?.kind==='hosted_invoice'&&op.result.providerObjectId===f.relatedProviderObjectId&&f.operationId===op.id&&f.purchaseId===p.state.purchaseId&&f.purchaseLineId===p.line.id&&f.dueId===s.context.dueId&&f.providerAccountId===this.#binding.accountId&&f.cents<=op.amountCents&&due&&due.paidCents>=f.cents&&p.state.settlements.some(value=>value.kind==='payment'&&value.canonicalTransactionId===f.canonicalTransactionId&&value.purchaseLineId===f.purchaseLineId&&value.cents===f.cents),'NATIVE_CASH_CONFLICT');
  invariant(rows[0].hash===digest({transaction:f.canonicalTransactionId,purchase:f.purchaseId,line:f.purchaseLineId,due:f.dueId,merchant:f.providerAccountId,mode:false,kind:'payment',currency:'USD',cents:f.cents,originalPayment:null}),'NATIVE_CASH_CONFLICT');
  const receipt=await one(c.tx,'SELECT event_id FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2 AND processed_at IS NOT NULL AND receipt_json->>\'apiVersion\'=$3 FOR SHARE',[this.#binding.accountId,f.providerReceiptId,this.#binding.apiVersion]);invariant(receipt,'NATIVE_CASH_RECEIPT_REQUIRED');return true;
 }
 private snapshot(actor:Actor,eventId:string,operationId:string){return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const loaded=await this.load(c,eventId,operationId);return {...loaded,cash:await this.cash(c,loaded)};});}
 private result(s:Loaded,state:CheckoutFulfillmentResult['state'],reason:Reason,money:CheckoutFulfillmentResult['money'],enrollment:CheckoutFulfillmentResult['enrollment']='not_confirmed',enrollmentId:string|null=null):CheckoutFulfillmentResult{return {state,reason,eventId:s.receipt.eventId,operationId:s.context.operationId,purchaseId:s.context.purchaseId,money,enrollment,enrollmentId,paymentRevision:money==='unknown'?null:s.purchase.state.revision,paidCents:money==='unknown'?null:s.purchase.state.paidCents};}
 private async readProvider(context:StripeTestCheckoutContext,known:CheckoutKnownBinding){
  this.composition();const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return validateCheckoutObservation(await Promise.race([this.provider.perform(context,{phase:'read',known},controller.signal),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('UNAVAILABLE'));},checkoutFulfillmentBounds.checkoutReadMilliseconds);})]),context,known);}
  finally{if(timer)clearTimeout(timer);controller.abort();}
 }
 private async existing(c:NativeContext,actor:Actor,s:Loaded):Promise<EnrollmentStep|null>{
  const rows=await c.tx.query<{id:string;state:string;lineId:string;stageId:string;learnerId:string}>('SELECT id,state,purchase_line_id AS "lineId",stage_id AS "stageId",learner_id AS "learnerId" FROM ls_fishing_stage.enrollments WHERE workspace_id=$1 AND purchase_id=$2 ORDER BY id LIMIT 2 FOR SHARE',[c.actor.workspaceId,s.context.purchaseId]);invariant(rows.length<=1,'CONFLICT');const row=rows[0];if(!row)return null;
  invariant(row.lineId===s.purchase.line.id&&row.stageId===s.purchase.line.stageId&&row.learnerId===s.purchase.line.learnerId,'CONFLICT');if(row.state!=='confirmed')return {state:'pending',id:row.id,reason:'enrollment_inactive'};
  const current=await this.program.readEnrollmentForInquiryLinkInTransaction(c.tx,actor,row.id);invariant(current.enrollment.id===row.id&&current.enrollment.purchaseId===s.context.purchaseId&&current.enrollment.state==='confirmed'&&current.offerId===s.purchase.offer.id&&current.operatorAccountId===c.actor.id,'CONFLICT');return {state:'confirmed',id:row.id};
 }
 private async enrollmentStep(actor:Actor,eventId:string,operationId:string):Promise<EnrollmentStep>{
  return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const s=await this.load(c,eventId,operationId);invariant(await this.cash(c,s),'NATIVE_CASH_REQUIRED');const existing=await this.existing(c,actor,s);if(existing)return existing;
   if(!this.policy)return {state:'pending',id:null,reason:'native_target_required'};const raw=await this.policy.enrollmentTarget(c,s.purchase,s.context);if(!raw)return {state:'pending',id:null,reason:'native_target_required'};const target=targetSchema.parse(raw),oldPlan=await this.journal(c,checkoutFulfillmentActions.plan,s.context.purchaseId);
   const plan=oldPlan?planSchema.parse(oldPlan.value):{purchaseId:s.context.purchaseId,purchaseLineId:s.purchase.line.id,stageId:s.purchase.line.stageId,learnerId:s.purchase.line.learnerId,offerDigest:s.context.offerDigest,enrollmentId:randomUUID()};invariant(plan.purchaseId===s.context.purchaseId&&plan.purchaseLineId===s.purchase.line.id&&plan.stageId===s.purchase.line.stageId&&plan.learnerId===s.purchase.line.learnerId&&plan.offerDigest===s.context.offerDigest,'CONFLICT');await this.save(c,checkoutFulfillmentActions.plan,s.context.purchaseId,plan);
   // A failed native command has no receipt. A changed payment revision/actual
   // target may form a new immutable attempt, preserving the SAME enrollment ID.
   // A committed/lost reply is discovered via existing() before another attempt.
   const key=s.context.purchaseId+':'+s.purchase.state.revision+':'+digest(target),old=await this.journal(c,checkoutFulfillmentActions.attempt,key),attempt=old?attemptSchema.parse(old.value):{targetRevision:target.revision,input:enrollmentCommandSchema.parse({commandId:randomUUID(),id:plan.enrollmentId,stageId:plan.stageId,purchaseId:plan.purchaseId,fitDecisionId:target.fitDecisionId,termsAcceptanceId:target.termsAcceptanceId,policyApprovalId:target.policyApprovalId,expectedPaymentRevision:s.purchase.state.revision})};
   invariant(attempt.targetRevision===target.revision&&attempt.input.id===plan.enrollmentId&&attempt.input.purchaseId===plan.purchaseId&&attempt.input.stageId===plan.stageId&&attempt.input.fitDecisionId===target.fitDecisionId&&attempt.input.termsAcceptanceId===target.termsAcceptanceId&&attempt.input.policyApprovalId===target.policyApprovalId&&attempt.input.expectedPaymentRevision===s.purchase.state.revision,'CONFLICT');await this.save(c,checkoutFulfillmentActions.attempt,key,attempt);return {state:'attempt',input:attempt.input};
  });
 }
 private async enrollmentReadback(actor:Actor,eventId:string,operationId:string){return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const s=await this.load(c,eventId,operationId);invariant(await this.cash(c,s),'NATIVE_CASH_REQUIRED');return {snapshot:s,existing:await this.existing(c,actor,s)};});}
 private async finishEnrollment(actor:Actor,s:Snapshot){
  let step:EnrollmentStep;try{step=await this.enrollmentStep(actor,s.receipt.eventId,s.context.operationId);}catch(error){return this.result(s,'cash_recorded_enrollment_pending',pendingReason(error),'recorded','unknown');}
  if(step.state==='confirmed')return this.result(s,'enrolled','confirmed','recorded','confirmed',step.id);if(step.state==='pending')return this.result(s,'cash_recorded_enrollment_pending',step.reason,'recorded','not_confirmed',step.id);
  let failure:unknown;try{await this.program.confirmEnrollment(actor,step.input);}catch(error){failure=error;}
  try{const current=await this.enrollmentReadback(actor,s.receipt.eventId,s.context.operationId);if(current.existing?.state==='confirmed')return this.result(current.snapshot,'enrolled','confirmed','recorded','confirmed',current.existing.id);if(current.existing?.state==='pending')return this.result(current.snapshot,'cash_recorded_enrollment_pending',current.existing.reason,'recorded','not_confirmed',current.existing.id);return this.result(current.snapshot,'cash_recorded_enrollment_pending',failure?pendingReason(failure):'enrollment_readback_required','recorded','not_confirmed',step.input.id);}
  catch{return this.result(s,'cash_recorded_enrollment_pending','enrollment_readback_required','recorded','unknown',step.input.id);}
 }
 private async recover(actor:Actor,s:Snapshot,state:'provider_pending'|'cash_pending',reason:Reason){
  try{const current=await this.snapshot(actor,s.receipt.eventId,s.context.operationId);if(current.cash&&current.processedAt!==null)return this.finishEnrollment(actor,current);return this.result(current,current.cash?'cash_pending':state,reason,current.cash?'recorded':'not_recorded');}
  catch{return this.result(s,'cash_pending','native_cash_readback_required','unknown','unknown');}
 }
 /** Caller supplies only explicit native identifiers and an ordinary CURRENT
  * operator Actor from the server. Constructor/process grant no provider access.
  * No catch turns authorization failure at intake into a successful payment. */
 async process(actor:Actor,eventId:string,operationId:string):Promise<CheckoutFulfillmentResult>{
  pid('evt').parse(eventId);uuid.parse(operationId);let s=await this.snapshot(actor,eventId,operationId);
  if(!s.cash){
   let observation:CheckoutObservation;
   try{const current=await this.coordinator.inspect(actor,operationId);invariant(current.known&&digest(current.known)===digest(s.known)&&digest(current.context)===digest(s.context),'CONFLICT');observation=await this.readProvider(current.context,current.known);}
   catch{return this.recover(actor,s,'provider_pending','provider_read_required');}
   try{await this.coordinator.reconcile(actor,stepKey('observe',[operationId,eventId,digest(observation)]),operationId,observation);}catch{return this.recover(actor,s,'provider_pending','reference_promotion_required');}
   if(observation.status!=='complete'||observation.paymentStatus!=='paid')return this.recover(actor,s,'provider_pending',observation.status==='expired'?'session_expired':'session_unpaid');
   try{await this.coordinator.promote(actor,stepKey('promote',[operationId,eventId,digest(observation)]),operationId,observation,eventId);}catch{return this.recover(actor,s,'provider_pending','reference_promotion_required');}
  }
  // A prior durable cash commit plus processed receipt resumes natively even
  // when the provider is unavailable. Otherwise use the EXISTING strict reader
  // and ledger writer; promotion/session.complete never substitutes for it.
  if(!s.cash||s.processedAt===null){
   let failure=false;try{await this.inbox.processStripeTest(actor,stepKey('receipt',[operationId,eventId,s.receipt.digest]),eventId);}catch{failure=true;}
   try{s=await this.snapshot(actor,eventId,operationId);}catch{return this.result(s,'cash_pending','native_cash_readback_required','unknown','unknown');}
   if(!s.cash||s.processedAt===null)return this.result(s,'cash_pending',failure?'receipt_processing_required':'native_cash_missing',s.cash?'recorded':'not_recorded');
  }
  return this.finishEnrollment(actor,s);
 }
}
