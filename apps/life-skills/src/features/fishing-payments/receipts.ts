import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { one } from '../identity/store.ts';
import type { Actor } from '../fishing/contract.ts';
import { cents,signedFeeCents,digest,id,instant,invariant,settled,type MerchantBinding,type SettlementFact } from './domain.ts';
import type { NativeContext,Receipt,ReceiptReadback } from './ports.ts';
import type {StripeTestWebhookEndpoint} from './stripe-test-webhook-receipt.ts';
import type {NativeStripeReceiptBindings} from '../fishing/native-stripe-bindings.ts';
import type {StripeTestReadClient} from '../fishing/stripe-read-ports.ts';
import { FishingPaymentStore } from './store.ts';

const events=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','payment_intent.succeeded','payment_intent.payment_failed','payment_intent.processing','invoice.paid','invoice.payment_failed','invoice.payment_action_required','refund.created','refund.updated','charge.refunded','charge.dispute.created','charge.dispute.closed'] as const;
const eventSchema=z.object({id,object:z.literal('event'),type:z.enum(events),account:id.optional(),livemode:z.boolean(),api_version:z.string().min(1).max(80),created:z.number().int().nonnegative(),data:z.object({object:z.object({id}).passthrough()}).passthrough()}).passthrough();
/** Test-only snapshot envelope. No key/env lookup, raw-body persistence or logging.
 * Real mounting must use the separately admitted pinned Stripe SDK verifier.
 */
export function verifySyntheticStripe(raw:Uint8Array,signature:string,secret:string,binding:MerchantBinding,now:Date):Receipt {
 invariant(binding.verifiedBindingId&&!binding.livemode&&secret.startsWith('whsec_'),'TEST_BINDING_REQUIRED');
 invariant(raw.byteLength>0&&raw.byteLength<=131072&&signature.length<=2048,'PAYLOAD_LIMIT');
 const parts=signature.split(',').map(p=>p.split('=')),times=parts.filter(p=>p[0]==='t').map(p=>p[1]);invariant(times.length===1&&/^\d{1,12}$/.test(times[0]??''),'INVALID_SIGNATURE');
 const time=Number(times[0]);invariant(Number.isSafeInteger(time)&&Math.abs(now.getTime()/1000-time)<=300,'SIGNATURE_TIME');
 const expected=createHmac('sha256',secret).update(`${time}.`).update(raw).digest();
 const signatures=parts.filter(p=>p[0]==='v1').map(p=>p[1]??'');invariant(signatures.some(s=>/^[0-9a-f]{64}$/i.test(s)&&timingSafeEqual(Buffer.from(s,'hex'),expected)),'INVALID_SIGNATURE');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),event=eventSchema.parse(JSON.parse(text));
 invariant(event.livemode===binding.livemode&&event.api_version===binding.apiVersion&&(!event.account||event.account===binding.accountId),'EVENT_BINDING');
 return {eventId:event.id,eventType:event.type,objectId:event.data.object.id,providerAccountId:binding.accountId,livemode:event.livemode,apiVersion:event.api_version,digest:createHash('sha256').update(raw).digest('hex'),createdAt:new Date(event.created*1000).toISOString()};
}
/** Unmounted, server-supplied test capabilities; no environment/credential lookup. */
export type StripeTestProcessingDependencies=Readonly<{endpoint:StripeTestWebhookEndpoint;endpointSecret:string;client:StripeTestReadClient;native:NativeStripeReceiptBindings}>;
export class FishingReceiptInbox {
 readonly #stripe:StripeTestProcessingDependencies|undefined;
 constructor(readonly store:FishingPaymentStore,stripe?:StripeTestProcessingDependencies){
  this.#stripe=stripe?Object.freeze({...stripe,endpoint:Object.freeze({...stripe.endpoint})}):undefined;
 }
 private stripeDependencies(){
  const d=this.#stripe,m=this.store.deps.merchant;
  invariant(d&&m&&!m.livemode&&digest(d.client.binding)===digest(m)&&d.endpoint.accountId===m.accountId&&d.endpoint.apiVersion===m.apiVersion&&d.endpoint.livemode===false,'STRIPE_TEST_PROCESSOR_UNAVAILABLE');
  return {deps:d,merchant:m};
 }
 /** Actual SDK authentication followed by minimal durable intake; no allocation. */
 async acceptStripeTest(rawBody:Uint8Array,signatureHeader:string){
  const {deps}=this.stripeDependencies();
  const {verifyStripeTestWebhookReceipt}=await import('./stripe-test-webhook-receipt.ts');
  const {receipt}=verifyStripeTestWebhookReceipt({rawBody,signatureHeader,endpointSecret:deps.endpointSecret,binding:deps.endpoint,clock:this.store.deps.clock});
  return this.persistMinimalReceipt(receipt);
 }
 /** Ordinary current operator only. Provider reads finish before commit locks. */
 async processStripeTest(actor:Actor,commandId:string,eventId:string){
  const {deps,merchant}=this.stripeDependencies(),clock=this.store.deps.clock;id.parse(eventId);
  const [{StripeReadbackNormalizer},{NativeStripeReceiptBindings}]=await Promise.all([import('./stripe-readback.ts'),import('../fishing/native-stripe-bindings.ts')]);
  invariant(deps.native instanceof NativeStripeReceiptBindings,'STRIPE_TEST_PROCESSOR_UNAVAILABLE');
  const receipt=await this.store.read(actor,async c=>{
   invariant(c.actor.role==='practitioner','NOT_FOUND');
   const row=await one<{receipt:Receipt}>(c.tx,'SELECT receipt_json AS receipt FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=$2 AND event_id=$3',[merchant.accountId,merchant.livemode,eventId]);invariant(row,'NOT_FOUND');return row.receipt;
  });
  let expectedNative:string|undefined;
  const reader=new StripeReadbackNormalizer({client:deps.client,clock,resolveNativeBinding:async(r,signal)=>{const binding=await deps.native.resolve(actor,r,signal);if(binding)expectedNative=digest(binding);return binding;}});
  const current=await reader.reconcileReceipt(receipt);this.validateReadback(receipt,current,clock.now());
  return this.store.command(actor,commandId,'stripe-test.receipt.reconcile',{eventId,receiptDigest:receipt.digest},async c=>{
   this.stripeDependencies();invariant(c.actor.role==='practitioner','NOT_FOUND');this.validateReadback(receipt,current,c.now);
   const actual=await deps.native.resolveInTransaction(c.tx,actor,receipt,new AbortController().signal,c.now);
   invariant(actual&&expectedNative&&digest(actual)===expectedNative,'STRIPE_NATIVE_CHANGED');
   for(const purchaseId of new Set([...current.facts.map(f=>f.purchaseId),...current.dues.map(d=>d.purchaseId)])){const p=await this.store.purchase(c,purchaseId);await this.store.access(c,p.offer,'read',true);}
  },c=>this.applyReadbackInTransaction(c,current,merchant,eventId));
 }
 /** Return only after commit; on DB failure caller returns retryable5xx. */
 async acceptSynthetic(raw:Uint8Array,signature:string,secret:string){const merchant=this.store.deps.merchant;invariant(merchant,'MERCHANT_BINDING_REQUIRED');const receipt=verifySyntheticStripe(raw,signature,secret,merchant,this.store.deps.clock.now());
  return this.persistMinimalReceipt(receipt);
 }
 async processSynthetic(actor:Actor,commandId:string,eventId:string){
  const {merchant,provider,clock}=this.store.deps;invariant(merchant&&!merchant.livemode&&provider?.execution==='synthetic'&&digest(provider.binding)===digest(merchant),'HOSTED_PROVIDER_UNAVAILABLE');id.parse(eventId);
  const receipt=await this.store.read(actor,async c=>{invariant(c.actor.role==='practitioner','NOT_FOUND');const row=await one<{receipt:Receipt}>(c.tx,'SELECT receipt_json AS receipt FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=$2 AND event_id=$3',[merchant.accountId,merchant.livemode,eventId]);invariant(row,'NOT_FOUND');return row.receipt;});
  // This readback is outside all native transactions/locks.
  const current=await provider.reconcileReceipt(receipt);this.validateReadback(receipt,current,clock.now());
  return this.store.command(actor,commandId,'receipt.reconcile',{eventId,receiptDigest:receipt.digest},async c=>{invariant(c.actor.role==='practitioner','NOT_FOUND');for(const purchaseId of new Set([...current.facts.map(f=>f.purchaseId),...current.dues.map(d=>d.purchaseId)])){const p=await this.store.purchase(c,purchaseId);await this.store.access(c,p.offer,'read',true);}},async c=>{
   return this.applyReadbackInTransaction(c,current,merchant,eventId);
  });
 }
 private async persistMinimalReceipt(receipt:Receipt){
  await this.store.deps.database.transaction(async tx=>{
   await tx.query('INSERT INTO ls_fishing_payments.inbox(provider_account_id,livemode,event_id,digest,receipt_json,received_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING',[receipt.providerAccountId,receipt.livemode,receipt.eventId,receipt.digest,JSON.stringify(receipt),this.store.deps.clock.now()]);
   const existing=await one<{digest:string}>(tx,'SELECT digest FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=$2 AND event_id=$3',[receipt.providerAccountId,receipt.livemode,receipt.eventId]);invariant(existing?.digest===receipt.digest,'EVENT_IDENTITY_CONFLICT');
  });return {status:200 as const,eventId:receipt.eventId,state:'durably_received' as const};
 }
 private async applyReadbackInTransaction(c:NativeContext,current:ReceiptReadback,merchant:MerchantBinding,eventId:string){
   const inbox=await one<{processed:Date|null}>(c.tx,'SELECT processed_at AS processed FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=$2 AND event_id=$3 FOR UPDATE',[merchant.accountId,merchant.livemode,eventId]);invariant(inbox,'NOT_FOUND');if(inbox.processed)return {state:'already_processed' as const};
   for(const f of [...current.facts].sort((a,b)=>(a.kind==='payment'?0:1)-(b.kind==='payment'?0:1))){
    const p=await this.store.purchase(c,f.purchaseId),op=await this.store.operation(c,f.operationId);
    invariant(f.purchaseLineId===p.line.id&&op.purchaseId===p.state.purchaseId&&op.dueId===f.dueId&&op.state==='confirmed'&&op.result&&f.relatedProviderObjectId===op.result.providerObjectId,'TRANSACTION_MAPPING_REQUIRED');
    invariant(f.kind==='refund'?op.kind==='refund'&&f.originalPaymentId===op.refundPaymentId:op.kind==='hosted_invoice','TRANSACTION_KIND');
    if(f.kind==='refund')invariant(f.canonicalTransactionId===op.result.providerObjectId,'REFUND_OBJECT_MAPPING');
    // Canonical money identity excludes delivery-event identity: three events
    // describing the same transaction allocate exactly once.
    const hash=digest({transaction:f.canonicalTransactionId,purchase:f.purchaseId,line:f.purchaseLineId,due:f.dueId,merchant:f.providerAccountId,mode:f.livemode,kind:f.kind,currency:f.currency,cents:f.cents,originalPayment:f.originalPaymentId});
    const prior=await one<{digest:string;fact:SettlementFact}>(c.tx,'SELECT digest,fact_json AS fact FROM ls_fishing_payments.settlements WHERE provider_account_id=$1 AND livemode=$2 AND kind=$3 AND transaction_id=$4',[merchant.accountId,merchant.livemode,f.kind,f.canonicalTransactionId]);
    if(prior){invariant(prior.digest===hash,'TRANSACTION_CONFLICT');if(prior.fact.feeCents===null&&f.feeCents!==null)await c.tx.query('UPDATE ls_fishing_payments.settlements SET fact_json=$5::jsonb WHERE provider_account_id=$1 AND livemode=$2 AND kind=$3 AND transaction_id=$4',[merchant.accountId,merchant.livemode,f.kind,f.canonicalTransactionId,JSON.stringify({...prior.fact,feeCents:f.feeCents})]);else invariant(f.feeCents===null||prior.fact.feeCents===f.feeCents,'FEE_CONFLICT');continue;}
    let next=settled(p.state,[f],c.now.toISOString());
    if(p.state.paidCents===0&&Date.parse(f.occurredAt)>Date.parse(p.offer.expiresAt))next={...next,state:'reconciliation_required'};
    await c.tx.query('INSERT INTO ls_fishing_payments.settlements(provider_account_id,livemode,kind,transaction_id,workspace_id,purchase_id,digest,fact_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[merchant.accountId,merchant.livemode,f.kind,f.canonicalTransactionId,c.actor.workspaceId,f.purchaseId,hash,JSON.stringify(f)]);
    await this.store.save(c,p.state,next);
    // Cash reconciliation does not select founder qualification or mutate
    // historical promotional inventory while those operational terms are open.
   }
   for(const signal of current.dues){const p=await this.store.purchase(c,signal.purchaseId),op=await this.store.operation(c,signal.operationId),due=p.state.dues.find(d=>d.id===signal.dueId);
    invariant(due&&op.purchaseId===p.state.purchaseId&&op.dueId===due.id&&op.kind==='hosted_invoice'&&op.state==='confirmed','DUE_MAPPING');
    // Current unpaid status cannot regress money already settled.
    if(due.paidCents===0)await this.store.save(c,p.state,{...p.state,revision:p.state.revision+1,state:p.state.paidCents===0?signal.state:p.state.state,dues:p.state.dues.map(d=>d.id===due.id?{...d,state:signal.state}:d)});
   }
   for(const purchaseId of new Set(current.facts.map(f=>f.purchaseId))){const p=await this.store.purchase(c,purchaseId),rows=await c.tx.query<{fact:SettlementFact}>('SELECT fact_json AS fact FROM ls_fishing_payments.settlements WHERE workspace_id=$1 AND purchase_id=$2',[c.actor.workspaceId,purchaseId]);const fees=rows.some(r=>r.fact.feeCents===null)?null:rows.reduce((sum,r)=>sum+r.fact.feeCents!,0);if(fees!==p.state.feesCents)await this.store.save(c,p.state,{...p.state,revision:p.state.revision+1,feesCents:fees});}
   await c.tx.query('UPDATE ls_fishing_payments.inbox SET processed_at=$4 WHERE provider_account_id=$1 AND livemode=$2 AND event_id=$3',[merchant.accountId,merchant.livemode,eventId,c.now]);return {state:'reconciled' as const};
 }
 private validateReadback(r:Receipt,v:ReceiptReadback,now:Date){
  invariant(v.receiptId===r.eventId&&v.resolvedObjectId===r.objectId&&v.providerAccountId===r.providerAccountId&&v.livemode===r.livemode&&v.facts.length<=100&&v.dues.length<=100&&v.facts.length+v.dues.length>0,'READBACK_BINDING');instant.parse(v.readAt);invariant(Math.abs(now.getTime()-Date.parse(v.readAt))<=300000,'READBACK_STALE');
  for(const f of v.facts){id.parse(f.operationId);id.parse(f.relatedProviderObjectId);id.parse(f.purchaseId);id.parse(f.purchaseLineId);id.parse(f.dueId);id.parse(f.canonicalTransactionId);instant.parse(f.occurredAt);cents.positive().parse(f.cents);invariant(['payment','refund','dispute'].includes(f.kind)&&f.currency==='USD'&&f.providerAccountId===r.providerAccountId&&f.livemode===r.livemode,'FACT_BINDING');if(f.feeCents!==null)signedFeeCents.parse(f.feeCents);}
  for(const d of v.dues)invariant(['pending','action_required','failed'].includes(d.state),'DUE_SIGNAL');
 }
}
