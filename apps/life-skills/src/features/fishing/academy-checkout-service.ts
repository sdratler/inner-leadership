import 'server-only';
import {randomUUID} from 'node:crypto';
import {digest,invariant} from '../fishing-payments/domain.ts';
import type {Actor} from './contract.ts';
import type {IdentityClock} from '../identity/types.ts';
import type {NativeStripeCheckoutCoordinator} from '../fishing-payments/stripe-test-checkout-native.ts';
import {validateCheckoutObservation,type StripeTestCheckoutProvider,type StripeTestCheckoutContext,type CheckoutAction} from '../fishing-payments/stripe-test-checkout-ports.ts';
type Coordinator=Pick<NativeStripeCheckoutCoordinator,'prepare'|'inspect'|'inspectForExpiry'|'claim'|'consume'|'observe'|'reconcile'|'redirect'|'inspectExpiry'>;
/** Existing native purchase only. No public form authority, environment lookup,
 * money allocation, subscription, scheduler or provider call in the constructor.
 * Each coordinator call commits independently; no transaction spans SDK I/O. */
export class AcademyCheckoutService{
 constructor(private readonly coordinator:Coordinator,private readonly provider:StripeTestCheckoutProvider,private readonly clock:IdentityClock){}
 private async call(context:StripeTestCheckoutContext,action:CheckoutAction){
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return validateCheckoutObservation(await Promise.race([this.provider.perform(context,action,controller.signal),new Promise<never>((_ok,no)=>{timer=setTimeout(()=>{controller.abort();no(Error('UNAVAILABLE'));},15000);})]),context,action.phase==='create'?undefined:action.known);}
  finally{if(timer)clearTimeout(timer);controller.abort();}
 }
 async request(actor:Actor,commandId:string,purchaseId:string,dueId:string){
  const context=await this.coordinator.prepare(actor,commandId+':prepare',purchaseId,dueId);invariant(context.purchaseId===purchaseId&&context.dueId===dueId,'CONFLICT');
  let current=await this.coordinator.inspect(actor,context.operationId);invariant(digest(current.context)===digest(context),'CONFLICT');
  if(!current.known){
   // A consumed create without a committed provider ID remains UNKNOWN. A
   // cached claim never permits a second mutation or a guessed session URL.
   const claim=await this.coordinator.claim(actor,commandId+':create',context.operationId,'create');if(!await this.coordinator.consume(actor,claim))return null;
   const observation=await this.call(context,{phase:'create',claim:claim.dispatch});await this.coordinator.observe(claim,observation);
   current=await this.coordinator.inspect(actor,context.operationId);invariant(digest(current.context)===digest(context),'CONFLICT');
  }
  if(!current.known)return null;
  const observation=await this.call(context,{phase:'read',known:current.known});await this.coordinator.reconcile(actor,randomUUID(),context.operationId,observation);
  if(observation.status!=='open'||observation.paymentStatus!=='unpaid'||!observation.url)return null;
  return this.coordinator.redirect(actor,commandId+':publish',context,current.known,observation);
 }
 async close(actor:Actor,commandId:string,operationId:string,expiredOnly:boolean){
  if(expiredOnly){const current=await this.coordinator.inspectForExpiry(actor,operationId);invariant(Date.parse(current.context.expiresAt)<=this.clock.now().valueOf(),'CONFLICT');}
  let claim=await this.coordinator.claim(actor,commandId+':expire',operationId,'expire');
  invariant(claim.known&&(!expiredOnly||Date.parse(claim.context.expiresAt)<=this.clock.now().valueOf()),'CONFLICT');
  const consumed=await this.coordinator.consume(actor,claim);
  if(!consumed)claim=await this.coordinator.inspectExpiry(actor,operationId);
  invariant(claim.known,'UNKNOWN_CREATE');
  const observation=await this.call(claim.context,consumed?{phase:'expire',known:claim.known,claim:claim.dispatch}:{phase:'read',known:claim.known});
  if(observation.status==='open')return {state:'review_required' as const};
  await this.coordinator.observe(claim,observation);
  return {state:observation.status==='expired'?'closed' as const:observation.paymentStatus==='paid'?'already_paid' as const:'review_required' as const};
 }
}
