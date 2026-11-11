import 'server-only';
import {randomUUID,randomInt} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {one,type IdentityStore} from '../identity/store.ts';
import {seal,type Keyring} from '../identity/crypto.ts';
import type {Actor,WorkspaceId} from '../identity/types.ts';
import {billingId} from './contracts.ts';
import {requireBilling} from './domain.ts';
import type {BillingStripeBinding} from './card-binding.ts';
import {prepareBillingServiceTestCheckoutV4,type BillingStripeInboxAuthority} from './stripe-test.ts';
import {CARD_VERSION,prepareCardCommandSchema,cardAttemptSchema,cardPreparationReceiptSchema,cardSessionResultSchema,type PrepareCardCommand} from './card-contracts.ts';
import {frozenRequestSchema,requestRecordSchema,type CheckoutRequest} from './card-checkout-request.ts';
import {cardRecordAad as aad} from './card-event-processor.ts';
import type {BillingStripeTestProvider} from './cards.ts';
import {FishingServiceCardEventsV4,type ServiceRefundAllocationAuthorityV4} from './guest-service-card-events-v4.ts';
import {FishingServiceCurrentCardV4} from './guest-service-current-card-v4.ts';
import {FishingServiceBillingOwnerV4} from './guest-service-owner-financial-v4.ts';
import type {ServiceCurrentCardLedgerV4} from './guest-service-current-card-contract-v4.ts';
import type {AccountFacts} from '../identity/types.ts';
import type {BillingLedgerContext} from './native.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import {BILLING_SERVICE_V4} from './guest-service-contract-v4.ts';
import type {ServiceCardReservationAuthorityV4,ServiceCardReservationV4} from './guest-service-card-reservation-v4.ts';
import {cardRecordCanonical as canonical} from './card-event-processor.ts';
import {guardedCardServicePermissionV4} from './card-service-permission-v4.ts';
import {serviceCheckoutEffectV4Schema,type ServiceCheckoutEffectAuthorityV4} from './guest-service-checkout-effect-v4.ts';
import type {BillingCheckoutAdmission,BillingCheckoutEffect} from '../../lib/fishing-billing-stripe-checkout.ts';

function freezeReservation<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freezeReservation(x);Object.freeze(v);}return v;}

/** Existing card storage/protocol with actual V4 owner preparation and durable
 * reservation, plus the shared event reconciler. Explicit unmounted creation
 * calls only Root's independently admitted provider port, once for a FRESH
 * committed UNKNOWN. No SDK/transport/runtime is installed here. Root must pair
 * checkoutAdmission() with its official SDK before-account/pre-POST guards.
 * Session response never credits money; existing UNKNOWN is read/recovery only. */
export class FishingServiceBillingCardsV4 extends FishingServiceCardEventsV4{
 private readonly reservationAuthority:ServiceCardReservationAuthorityV4|null;
 private readonly checkoutAuthority:ServiceCheckoutEffectAuthorityV4|null;
 // Active original-request provenance only, NEVER a cached permission. Restart
 // or completion loses this capability; persisted UNKNOWN cannot mint another.
 private readonly activeCheckoutRequests=new Map<string,Readonly<{dispatchId:string;request:CheckoutRequest}>>();
 constructor(db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly current:FishingServiceCurrentCardV4,private readonly owner:FishingServiceBillingOwnerV4,
  ring:Keyring,digestKey:Buffer,private readonly configuration:{binding:BillingStripeBinding;cardOnlyConfigurationId:string;approvedProductLabel:string},inbox:BillingStripeInboxAuthority,
  provider:BillingStripeTestProvider|null=null,refund:ServiceRefundAllocationAuthorityV4|null=null,reservationAuthority:ServiceCardReservationAuthorityV4|null=null,checkoutAuthority:ServiceCheckoutEffectAuthorityV4|null=null){
  super(db,workspaceId,current,ring,digestKey,configuration.binding,inbox,provider,refund);
  requireBilling(!reservationAuthority||typeof reservationAuthority.target==='function'&&typeof reservationAuthority.authorize==='function','UNAVAILABLE');
  this.reservationAuthority=reservationAuthority?Object.freeze({target:reservationAuthority.target.bind(reservationAuthority),authorize:reservationAuthority.authorize.bind(reservationAuthority)}):null;
  requireBilling(!checkoutAuthority||typeof checkoutAuthority.target==='function'&&typeof checkoutAuthority.authorize==='function','UNAVAILABLE');
  this.checkoutAuthority=checkoutAuthority?Object.freeze({target:checkoutAuthority.target.bind(checkoutAuthority),authorize:checkoutAuthority.authorize.bind(checkoutAuthority)}):null;
 }
 private withOwner<T>(actor:Actor,id:string,work:(ledger:ServiceCurrentCardLedgerV4&{actor:Readonly<AccountFacts>})=>Promise<T>,terminal?:(context:Readonly<BillingLedgerContext>,snapshot:ServiceOwnerSnapshotV4)=>Promise<void>){
  return this.owner.withCurrentCardActorV4(actor,id,l=>{requireBilling(l.context.workspaceId===this.workspaceId,'FORBIDDEN');return work(l);},terminal);
 }
 private reservationPermission(c:Readonly<BillingLedgerContext>,reservation:ServiceCardReservationV4|null){return guardedCardServicePermissionV4(c,this.workspaceId,this.binding,this.reservationAuthority,reservation);}
 /** Pair THIS adapter with Root's official SDK admission before account reads
  * and immediately before POST. It never calls the SDK or authorizes resend. */
 checkoutAdmission():BillingCheckoutAdmission{return Object.freeze({authorize:this.authorizeCheckoutEffect.bind(this)});}
 async authorizeCheckoutEffect(raw:BillingCheckoutEffect):Promise<void>{
  const authority=this.checkoutAuthority;if(!authority)throw new AppError('UNAVAILABLE');
  const effect=serviceCheckoutEffectV4Schema.parse(raw),active=this.activeCheckoutRequests.get(effect.operationId);requireBilling(active,'UNAVAILABLE');this.sameBinding(effect.binding);
  await this.current.withCurrentCardServiceV4(this.binding,effect.quoteId,async l=>{
   requireBilling(l.context.workspaceId===this.workspaceId,'FORBIDDEN');await guardedCardServicePermissionV4(l.context,this.workspaceId,this.binding,authority,null);
  },async(context,frame)=>{
   // Re-read after ALL mutable reconciliation/native postludes in the same TX.
   requireBilling(context.workspaceId===this.workspaceId,'FORBIDDEN');await guardedCardServicePermissionV4(context,this.workspaceId,this.binding,authority,null);
   const a=await this.attempt(context,effect.operationId,effect.quoteId),request=await this.frozenRequest(context,a),q=frame.quote;
   requireBilling(active&&this.activeCheckoutRequests.get(a.id)===active&&a.state==='unknown'&&a.dispatchId===active.dispatchId&&a.balanceVersion===q.revision&&a.sessionId===null&&a.paymentIntentId===null&&a.checkoutUrl===null&&canonical(request)===canonical(active.request),'UNAVAILABLE');
   requireBilling(q.state==='accepted'&&!q.paused&&q.acceptance&&frame.balance.pendingAttemptIds.length===1&&frame.balance.pendingAttemptIds[0]===a.id&&!['review_required','overpaid'].includes(frame.balance.state),'UNAVAILABLE');
   requireBilling(effect.amountMinor===request.amountMinor&&effect.configurationId===request.params.payment_method_configuration&&request.allocations.every(x=>x.amountMinor<=(frame.balance.lines.find(line=>line.lineId===x.lineId)?.remainingMinor??0)),'UNAVAILABLE');
   await guardedCardServicePermissionV4(context,this.workspaceId,this.binding,authority,{version:BILLING_SERVICE_V4,purpose:'create_checkout',effect,snapshot:frame,attempt:a,request});
   requireBilling(this.activeCheckoutRequests.get(a.id)===active,'UNAVAILABLE');
  });
 }
 async createCheckout(actor:Actor,quoteId:string,attemptId:string){
  requireBilling(this.provider&&typeof this.provider.createCheckout==='function'&&this.checkoutAuthority,'UNAVAILABLE');
  const reserved=await this.reserveCheckout(actor,quoteId,attemptId);if(!reserved.dispatch)return reserved.attempt;
  const request=freezeReservation(structuredClone(reserved.request)),dispatchId=reserved.attempt.dispatchId;requireBilling(dispatchId&&!this.activeCheckoutRequests.has(attemptId),'UNAVAILABLE');
  this.activeCheckoutRequests.set(attemptId,freezeReservation({dispatchId:dispatchId!,request}));
  let session:ReturnType<typeof cardSessionResultSchema.parse>;
  try{
   await this.authorizeCheckoutEffect({effect:'create_checkout',binding:this.binding,operationId:request.operationId,quoteId:request.quoteId,amountMinor:request.amountMinor,configurationId:request.params.payment_method_configuration});
   // Outside every native TX. The paired official SDK separately re-admits at
   // its own account-read and immediately-before-POST effect points.
   session=cardSessionResultSchema.parse(await this.provider!.createCheckout(request));
   requireBilling(session.accountId===this.binding.accountId&&session.livemode===false&&session.apiVersion===this.binding.apiVersion&&session.quoteId===quoteId&&session.attemptId===attemptId&&session.amountMinor===request.amountMinor&&session.currency==='USD'&&session.paymentStatus!=='no_payment_required','UNAVAILABLE');
   const url=new URL(session.url);requireBilling(url.origin==='https://checkout.stripe.com'&&!url.username&&!url.password,'UNAVAILABLE');
  }catch{return reserved.attempt;}finally{this.activeCheckoutRequests.delete(attemptId);}
  // A real remote session may still accept funds after local cash/cancellation.
  // Keep V4 under review rather than clearing an unresolved remote obligation
  // and permitting another card attempt. Historical V3 retains its old recipe.
  try{return await this.current.withCurrentCardServiceV4(this.binding,quoteId,l=>this.recordCheckoutSession(l,quoteId,attemptId,reserved.attempt,session,'review_required'));}
  catch{throw new AppError('UNAVAILABLE');} // Remote effect and/or COMMIT may exist.
 }
 private async original(l:ServiceCurrentCardLedgerV4&{actor:Readonly<AccountFacts>},cmd:PrepareCardCommand){
  const exists=await one(l.context.tx,'SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND id=$2',[l.context.workspaceId,cmd.operationId]);if(!exists)return null;
  const a=await this.attempt(l.context,cmd.operationId,cmd.quoteId);requireBilling(a.actorId===l.actor.id&&a.requestDigest===this.digest(cmd),'CONFLICT');return a;
 }
 async prepare(actor:Actor,raw:unknown){
  const cmd=prepareCardCommandSchema.parse(raw);
  return this.withOwner(actor,cmd.quoteId,async l=>{
   const previous=await this.original(l,cmd);if(previous)return {...previous.preparation,replayed:true};
   const q=l.frame.quote;requireBilling(q.revision===cmd.expectedVersion,'CONFLICT');
   requireBilling(!['review_required','overpaid'].includes(l.frame.balance.state),'UNAVAILABLE');
   const active=await l.context.tx.query("SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 AND state IN('prepared','unknown','open','pending')",[l.context.workspaceId,q.id]);requireBilling(active.length===0,'CONFLICT');
   const draft=prepareBillingServiceTestCheckoutV4({frame:l.frame,operationId:cmd.operationId,selection:cmd.selection,...this.configuration});
   const identifier='jlfa_monthly_'+Array.from({length:8},()=>String.fromCharCode(97+randomInt(26))).join('');
   const request=frozenRequestSchema.parse({...draft,params:{...draft.params,integration_identifier:identifier}});
   const preparation=cardPreparationReceiptSchema.parse({version:CARD_VERSION,operationId:cmd.operationId,quoteId:q.id,entityVersion:q.revision+1,replayed:false,result:{attemptId:cmd.operationId,amountMinor:request.amountMinor,allocations:request.allocations}});
   const a=cardAttemptSchema.parse({version:CARD_VERSION,id:cmd.operationId,workspaceId:l.context.workspaceId,quoteId:q.id,familyId:q.familyId,actorId:l.actor.id,revision:1,balanceVersion:preparation.entityVersion,binding:this.binding,command:cmd,requestDigest:this.digest(cmd),preparation,createdAt:l.context.now.toISOString(),state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
   await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempts(workspace_id,id,quote_id,revision,state,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[l.context.workspaceId,a.id,q.id,1,a.state,seal(JSON.stringify(a),aad('attempt',l.context.workspaceId,a.id),this.ring)]);
   const record=requestRecordSchema.parse({version:'JLFA-FISHING-CHECKOUT-REQUEST-v1',workspaceId:l.context.workspaceId,attemptId:a.id,quoteId:q.id,actorId:a.actorId,digest:this.digest(request),request});
   await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempt_requests(workspace_id,attempt_id,quote_id,payload_ciphertext) VALUES($1,$2,$3,$4)',[l.context.workspaceId,a.id,q.id,seal(JSON.stringify(record),aad('checkout_request',l.context.workspaceId,a.id),this.ring)]);
   await l.advance();return preparation;
  });
 }
 /** Exact original command only; this lookup never creates an absent attempt.
  * Original preparation is not evidence that today's balance is still payable. */
 async readPreparationReceipt(actor:Actor,raw:unknown){
  const cmd=prepareCardCommandSchema.parse(raw);return this.withOwner(actor,cmd.quoteId,async l=>{const a=await this.original(l,cmd);return a?{...a.preparation,replayed:true}:null;});
 }
 async readAttempt(actor:Actor,quoteId:string,attemptId:string){
  billingId.parse(quoteId);billingId.parse(attemptId);return this.withOwner(actor,quoteId,async l=>{const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');return a;});
 }
 async reserveCheckout(actor:Actor,quoteId:string,attemptId:string){
  billingId.parse(quoteId);billingId.parse(attemptId);
  requireBilling(this.provider&&this.reservationAuthority,'UNAVAILABLE');
  let reserved:ServiceCardReservationV4|null=null;
  return this.withOwner(actor,quoteId,async l=>{
   reserved=null;
   await this.reservationPermission(l.context,null);
   const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');
   if(a.state!=='prepared')return {dispatch:false as const,attempt:a};
   const q=l.frame.quote;
   if(q.revision!==a.balanceVersion||q.state!=='accepted'||q.paused||['review_required','overpaid'].includes(l.frame.balance.state)){
    const stale={...a,state:'stale' as const,revision:a.revision+1,balanceVersion:q.revision+1};await this.save(l.context,a,stale);await l.advance();return {dispatch:false as const,attempt:stale};
   }
   const request=await this.frozenRequest(l.context,a);
   requireBilling(request.allocations.every(x=>x.amountMinor<=(l.frame.balance.lines.find(line=>line.lineId===x.lineId)?.remainingMinor??0)),'CONFLICT');
   await this.reservationPermission(l.context,{version:BILLING_SERVICE_V4,purpose:'reserve_checkout',phase:'before_reservation',snapshot:l.frame,attempt:a,request});
   const unknown={...a,state:'unknown' as const,dispatchId:randomUUID(),revision:a.revision+1,balanceVersion:q.revision+1};
   await this.save(l.context,a,unknown);const snapshot=await l.advance();reserved=freezeReservation(structuredClone({version:BILLING_SERVICE_V4,purpose:'reserve_checkout',phase:'terminal',snapshot,attempt:unknown,request}));return {dispatch:true as const,attempt:unknown,request};
  },async(c,snapshot)=>{
   if(!reserved)return;
   const a=await this.attempt(c,attemptId,quoteId),request=await this.frozenRequest(c,a),q=snapshot.quote;
   requireBilling(canonical(a)===canonical(reserved.attempt)&&canonical(request)===canonical(reserved.request)&&a.state==='unknown'&&a.dispatchId&&a.balanceVersion===q.revision&&q.id===a.quoteId&&q.familyId===a.familyId&&q.state==='accepted'&&!q.paused&&snapshot.balance.pendingAttemptIds.every(id=>id===a.id)&&!['review_required','overpaid'].includes(snapshot.balance.state),'CONFLICT');
   requireBilling(request.allocations.every(x=>x.amountMinor<=(snapshot.balance.lines.find(line=>line.lineId===x.lineId)?.remainingMinor??0)),'CONFLICT');
   await this.reservationPermission(c,{...reserved,snapshot,attempt:a,request});
   // No further awaited native financial IO after actual terminal admission.
  });
 }
}
