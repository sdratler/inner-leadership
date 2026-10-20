import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import type {IdentityStore} from '../identity/store.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {digest,invariant} from '../fishing-payments/domain.ts';
import type {NativeContext,StripeTestHostedBinding,StripeTestHostedProvider} from '../fishing-payments/ports.ts';
import {FishingPaymentStore} from '../fishing-payments/store.ts';
import {FishingPaymentService} from '../fishing-payments/service.ts';
import {AcademyFamilyStore} from './academy-family-store.ts';
import {NativeFishingProgram} from './native-program.ts';
import {NativeStripeHostedCoordinator,type NativeStripeHostedPolicy} from './native-stripe-hosted-bindings.ts';
import {NativeStripeCheckoutCoordinator,type NativeStripeCheckoutPolicy} from '../fishing-payments/stripe-test-checkout-native.ts';
import type {StripeTestCheckoutBinding,StripeTestCheckoutProvider,CheckoutReturnUrls} from '../fishing-payments/stripe-test-checkout-ports.ts';
import {AcademyCheckoutService} from './academy-checkout-service.ts';
import {academyHostedCommandSchema,academyHostedCleanupCommandSchema,type AcademyHostedCommand,type AcademyHostedResult,type AcademyHostedCleanupResult} from './academy-hosted-contract.ts';

/** Trusted Root SERVER capability, never request JSON or an environment flag.
 * Supplier must independently verify the merchant/customer/effect/expiry policy.
 * Null remains the default; no SDK, credential lookup or provider discovery. */
export type AcademyHostedAdmission=Readonly<{merchant:StripeTestHostedBinding;provider:StripeTestHostedProvider;policy:NativeStripeHostedPolicy}>|Readonly<{merchant:StripeTestCheckoutBinding;checkout:Readonly<{provider:StripeTestCheckoutProvider;policy:NativeStripeCheckoutPolicy;returnUrls:CheckoutReturnUrls}>}>;
export class AcademyHostedStore{
 private readonly runtime:{store:FishingPaymentStore;service:FishingPaymentService;coordinator:NativeStripeHostedCoordinator;program:NativeFishingProgram}|null;
 private readonly checkout:{store:FishingPaymentStore;service:AcademyCheckoutService;program:NativeFishingProgram}|null;
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,admission:AcademyHostedAdmission|null=null,private readonly clock:IdentityClock=systemClock){
  this.runtime=null;this.checkout=null;if(!admission)return;
  const program=new NativeFishingProgram(db,config.keyring,{childAccountsEnabled:false,merchant:admission.merchant},clock),store=new FishingPaymentStore({database:db,clock,merchant:admission.merchant,authority:{...program.paymentApprovalAuthority(),withdrawalFacts:async()=>{throw new AppError('UNAVAILABLE');},reminderPolicy:async()=>{throw new AppError('UNAVAILABLE');}}});
  if('checkout' in admission){invariant(admission.checkout.provider.execution==='stripe_test_checkout'&&digest(admission.checkout.provider.binding)===digest(admission.merchant),'MERCHANT_BINDING');const coordinator=new NativeStripeCheckoutCoordinator(store,admission.checkout.policy,admission.checkout.returnUrls);this.checkout={store,program,service:new AcademyCheckoutService(coordinator,admission.checkout.provider,clock)};return;}
  invariant(admission.provider.execution==='stripe_test_hosted_invoice'&&digest(admission.provider.binding)===digest(admission.merchant),'MERCHANT_BINDING');const coordinator=new NativeStripeHostedCoordinator(store,program,admission.policy);
  this.runtime={program,store,coordinator,service:new FishingPaymentService(store,{provider:admission.provider,coordinator})};
 }
 available(){return this.runtime!==null||this.checkout!==null;}
 /** Explicit operator action only. No timer, new invoice, refund or cached
  * family URL. An unknown void reply can recover only by the durable ID. */
 async cleanup(actor:Actor,raw:unknown):Promise<AcademyHostedCleanupResult>{
  const parsed=academyHostedCleanupCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data;
  await this.db.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,this.clock.now());if(current.workspaceId!==this.config.workspaceId||current.role!=='practitioner')throw new AppError('FORBIDDEN');});
  const active=this.runtime??this.checkout;if(!active)throw new AppError('UNAVAILABLE');
  await active.store.command(actor,command.operationId,'academy.hosted.cleanup',command,async c=>{const op=await active.store.operation(c,command.hostedOperationId);invariant(op.kind==='hosted_invoice','NOT_FOUND');const p=await active.store.purchase(c,op.purchaseId);await active.program.stripeHostedClosureOfferInTransaction(c,p.offer.id);},async()=>({hostedOperationId:command.hostedOperationId,action:command.action}));
  if(this.checkout)return this.checkout.service.close(actor,'academy:'+command.operationId,command.hostedOperationId,command.action==='close_expired');
  const r=this.runtime;if(!r)throw new AppError('UNAVAILABLE');
  const read=()=>r.coordinator.closureReadback(actor,command.hostedOperationId,command.action==='close_expired'),before=await read();
  if(before.state==='not_requested'||before.state==='pending'&&!before.dispatched)await r.service.executeStripeTestHosted(actor,'academy:'+command.operationId+':close',command.hostedOperationId,'close');
  else if(before.state==='pending')await r.service.reconcileStripeTestHostedClosure(actor,command.hostedOperationId,before.decisionId);
  const after=await read();return {state:after.state==='void'?'closed':after.state==='paid'?'already_paid':'review_required'};
 }
 private async target(c:NativeContext,command:AcademyHostedCommand,actor:Actor){
  if(c.actor.workspaceId!==this.config.workspaceId||c.actor.role!=='parent')throw new AppError('FORBIDDEN');
  const family=await this.family.readParentForEnrollmentInTransaction(c.tx,actor,command.learnerId),r=this.runtime??this.checkout;invariant(r,'UNAVAILABLE');
  const p=await r.store.purchase(c,command.purchaseId),group=await r.program.academyBillingStageInTransaction(c.tx,actor,family,command.purchaseId);
  if(!group||group.stageId!==command.stageId||p.line.learnerId!==command.learnerId||p.line.stageId!==command.stageId||p.offer.householdId!==family.householdId||p.offer.payerAccountId!==c.actor.id)throw new AppError('NOT_FOUND');
  await r.store.access(c,p.offer,'hosted');await r.store.assertHostedActivationAllowed(c,p.offer);const due=p.state.dues.find(d=>d.index===command.dueIndex);invariant(due&&due.paidCents===0,'DUE_NOT_PAYABLE');return {purchaseId:p.state.purchaseId,dueId:due.id};
 }
 async request(actor:Actor,raw:unknown):Promise<AcademyHostedResult>{
  const parsed=academyHostedCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data;
  // Even the unavailable default authenticates the ordinary parent and selected
  // saved child. No provider or payment-table access is needed in that default.
  await this.db.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,this.clock.now());if(current.workspaceId!==this.config.workspaceId||current.role!=='parent')throw new AppError('FORBIDDEN');await this.family.readParentForEnrollmentInTransaction(tx,actor,command.learnerId);});
  const r=this.runtime??this.checkout;if(!r)throw new AppError('UNAVAILABLE');
  const target=await r.store.command(actor,command.operationId,'academy.hosted.request',command,async c=>{await this.target(c,command,actor);},c=>this.target(c,command,actor));
  const authorize=()=>r.store.read(actor,c=>this.target(c,command,actor));
  if(this.checkout){let result:AcademyHostedResult={state:'review_required'};const dueIndex=command.dueIndex;invariant(dueIndex===1||dueIndex===2||dueIndex===3,'INVALID_REQUEST');try{await authorize();const action=await this.checkout.service.request(actor,'academy:'+command.operationId,target.purchaseId,target.dueId);if(action)result={state:'ready',action:{purchaseId:action.purchaseId,dueIndex,state:'ready',url:action.url}};}catch{/* Durable native UNKNOWN/pending journal survives; never synthesize success. */}await authorize();return result;}
  invariant(this.runtime,'UNAVAILABLE');const legacy=this.runtime;
  // Every call below opens and commits its own bounded native transaction.
  // No outer transaction spans SDK I/O. At most one known-ID reconciliation,
  // three mutation phases and one final read occur in a deliberate request.
  let result:AcademyHostedResult={state:'review_required'};
  try{
   await authorize();const {operationId}=await legacy.service.prepareStripeTestHosted(actor,'academy:'+command.operationId+':prepare',target.purchaseId,target.dueId),known=await legacy.coordinator.inspect(actor,operationId);
   if(known.context.operation.state==='unknown'&&known.invoiceId){await authorize();const reconciled=await legacy.service.reconcileStripeTestHosted(actor,randomUUID(),operationId);if(reconciled.state!=='observed')throw new AppError('UNAVAILABLE');}
   if(known.context.operation.state!=='confirmed')for(const phase of ['create','add_line','finalize'] as const){
    await authorize();const observed=await legacy.service.executeStripeTestHosted(actor,'academy:'+command.operationId+':'+phase,operationId,phase);if(observed.state==='unknown')throw new AppError('UNAVAILABLE');
   }
   await authorize();const action=await legacy.service.familyStripeTestHostedAction(actor,'academy:'+command.operationId+':publish',operationId);if(action)result={state:'ready',action};
  }catch{/* Native history/UNKNOWN survives. No guessed URL or replacement create. */}
  // A revoked/logout/changed-family result is denied even after provider I/O.
  await authorize();return result;
 }
}
