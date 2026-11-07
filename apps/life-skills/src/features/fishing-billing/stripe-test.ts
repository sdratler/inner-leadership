import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {lockWorkspace} from '../identity/data.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {WorkspaceId,IdentityClock} from '../identity/types.ts';
import {billingId,billingAmount,billingInstant,type FamilyOffer,type BillingBalance} from './contracts.ts';
import {requireBilling} from './domain.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from './card-binding.ts';
export type {BillingStripeBinding} from './card-binding.ts';

/** Reuse PR189's reviewed SDK verifier through a server-created closure. This
 * interface performs no signature algorithm, credential lookup or fallback.
 * Missing SDK/binding/admission stays unavailable. A browser DTO is not a port. */
const signedReceiptSchema=z.object({
 eventId:z.string().regex(/^evt_[A-Za-z0-9_]{1,150}$/),eventType:z.enum([
  'payment_intent.succeeded','payment_intent.processing','payment_intent.payment_failed',
  'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed',
  'refund.created','refund.updated','invoice.paid','invoice.payment_failed','invoice.payment_action_required',
 ]),objectId:z.string().regex(/^(pi|cs|re|in)_[A-Za-z0-9_]{1,150}$/),
 providerAccountId:z.string().regex(/^acct_[A-Za-z0-9_]{1,150}$/),livemode:z.literal(false),
 apiVersion:z.literal('2026-09-30.endive'),digest:z.string().regex(/^[a-f0-9]{64}$/),createdAt:billingInstant,
}).strict();
export type BillingStripeSignedReceipt=z.infer<typeof signedReceiptSchema>;
export const billingStripeSignedReceiptSchema=signedReceiptSchema;
export interface BillingStripeSdkVerifier{
 verify(rawBody:Uint8Array,signatureHeader:string,now:Date):{
  kind:'stripe_test_signature_only';receipt:BillingStripeSignedReceipt;
 };
}
const bindingSchema=billingStripeBindingSchema;
declare const verifiedEventBrand:unique symbol;
export type VerifiedBillingStripeEvent={readonly [verifiedEventBrand]:true};
const verifiedEvents=new WeakMap<object,{binding:BillingStripeBinding;receipt:BillingStripeSignedReceipt}>();
/** Signature capability only. No HTTP200/durable/settlement claim is made. */
export function verifyBillingStripeTestEvent(input:{
 rawBody:Uint8Array;signatureHeader:string;binding:BillingStripeBinding;sdk:BillingStripeSdkVerifier;now:Date;
}):VerifiedBillingStripeEvent{
 const binding=bindingSchema.parse(input.binding);
 requireBilling(input.now instanceof Date&&Number.isFinite(input.now.valueOf()));
 requireBilling(input.rawBody instanceof Uint8Array&&input.rawBody.byteLength>0&&input.rawBody.byteLength<=131072&&!(input.rawBody.buffer instanceof SharedArrayBuffer));
 requireBilling(typeof input.signatureHeader==='string'&&input.signatureHeader.length>0&&input.signatureHeader.length<=2048);
 const rawBody=Uint8Array.from(input.rawBody);
 // The exact paired SDK verifier, not caller-provided JSON, validates signatures,
 // account/mode/API version, age/skew, encoding and supported object identity.
 let verified:ReturnType<BillingStripeSdkVerifier['verify']>;
 try{verified=input.sdk.verify(rawBody,input.signatureHeader,new Date(input.now));}catch{requireBilling(false);}
 requireBilling(verified!.kind==='stripe_test_signature_only');
 const receipt=signedReceiptSchema.parse(verified!.receipt);
 requireBilling(receipt.providerAccountId===binding.accountId&&receipt.livemode===binding.livemode&&
  receipt.apiVersion===binding.apiVersion&&receipt.digest===createHash('sha256').update(rawBody).digest('hex'));
 const capability=Object.freeze({}) as VerifiedBillingStripeEvent;
 verifiedEvents.set(capability,{binding:{...binding},receipt:{...receipt}});return capability;
}
export interface BillingStripeInboxAuthority{
 /** Current server-owned service policy/target binding in this transaction.
  * No provider event alone establishes Academy family or settlement authority. */
 authorize(tx:SqlSession,workspaceId:WorkspaceId,binding:BillingStripeBinding):Promise<void>;
}
export class FishingBillingStripeInbox{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,
  private readonly ring:Keyring,private readonly clock:IdentityClock,private readonly authority:BillingStripeInboxAuthority){}
 async ingest(capability:VerifiedBillingStripeEvent){
  const verified=verifiedEvents.get(capability);requireBilling(verified,'FORBIDDEN');
  const {binding,receipt}=verified!;
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await this.authority.authorize(tx,this.workspaceId,binding);
   const params=[binding.accountId,false,receipt.eventId];
   const old=await one<{workspaceId:string;digest:string;ciphertext:string}>(tx,'SELECT workspace_id AS "workspaceId",body_digest AS digest,receipt_ciphertext AS ciphertext FROM ls_fishing_billing.stripe_events WHERE account_id=$1 AND livemode=$2 AND event_id=$3 FOR UPDATE',params);
   const aad='ls_fishing_billing/stripe_event/v1/'+this.workspaceId+'/'+binding.accountId+'/'+receipt.eventId;
   if(old){
    requireBilling(old.workspaceId===this.workspaceId&&old.digest===receipt.digest,'CONFLICT');
    const stored=signedReceiptSchema.parse(JSON.parse(unseal(old.ciphertext,aad,this.ring)));
    requireBilling(stored.providerAccountId===binding.accountId&&stored.livemode===binding.livemode&&
     stored.eventId===receipt.eventId&&stored.digest===old.digest&&JSON.stringify(stored)===JSON.stringify(receipt),'CONFLICT');
    return {received:true as const,replayed:true,processed:false as const,eventId:receipt.eventId};
   }
   await tx.query('INSERT INTO ls_fishing_billing.stripe_events(account_id,livemode,event_id,workspace_id,body_digest,receipt_ciphertext,received_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...params,this.workspaceId,receipt.digest,seal(JSON.stringify(receipt),aad,this.ring),this.clock.now(),'pending']);
   return {received:true as const,replayed:false,processed:false as const,eventId:receipt.eventId};
  });
 }
}
const selectionSchema=z.array(z.object({lineId:billingId,amountMinor:billingAmount.refine(n=>n>0)}).strict()).min(1).max(10);
/** Server-only, inert Checkout request preparation. An admitted coordinator must
 * reserve UNKNOWN durably before SDK creation and persist/read back its result.
 * Actual amounts derive from an accepted order/current balance, never redirects.
 * Do not call this a working Checkout or enable a provider from this helper. */
export function prepareBillingTestCheckout(input:{
 quote:FamilyOffer;balance:BillingBalance;operationId:string;
 selection:{lineId:string;amountMinor:number}[];
 binding:BillingStripeBinding;cardOnlyConfigurationId:string;approvedProductLabel:string;
}){
 const {quote:q,balance:b}=input,selection=selectionSchema.parse(input.selection),binding=bindingSchema.parse(input.binding);
 billingId.parse(input.operationId);
 requireBilling(q.state==='accepted'&&q.acceptance&&!q.paused&&b.cancelled===false&&b.missingPolicy.length===0,'UNAVAILABLE');
 requireBilling(b.quoteId===q.id&&b.familyId===q.familyId&&b.revision===q.revision&&q.definition.environment==='test');
 requireBilling(new Set(selection.map(l=>l.lineId)).size===selection.length&&
  selection.every(l=>l.amountMinor<=(b.lines.find(x=>x.lineId===l.lineId)?.remainingMinor??0)));
 requireBilling(/^pmc_[A-Za-z0-9]+$/.test(input.cardOnlyConfigurationId)&&input.approvedProductLabel.length>0&&input.approvedProductLabel.length<=200,'UNAVAILABLE');
 const amountMinor=selection.reduce((s,l)=>s+l.amountMinor,0);
 return {
  binding,operationId:input.operationId,quoteId:q.id,expectedVersion:b.revision,allocations:selection,amountMinor,
  idempotencyKey:input.operationId,
  params:{
   mode:'payment' as const,client_reference_id:q.id,payment_method_configuration:input.cardOnlyConfigurationId,
   metadata:{billing_quote_id:q.id,billing_attempt_id:input.operationId},
   payment_intent_data:{metadata:{billing_quote_id:q.id,billing_attempt_id:input.operationId}},
   line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:amountMinor,product_data:{name:input.approvedProductLabel}}}],
  },
 };
}
