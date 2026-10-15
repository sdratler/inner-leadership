import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { stripeReadBounds,stripeFishingMetadata,type StripeReadbackDependencies,type StripeReadRequest,type StripeInvoicePaymentQuery,type StripeTestReceiptReadPort } from '../fishing/stripe-read-ports.ts';
import type { Receipt,ReceiptReadback } from './ports.ts';
import type { SettlementFact } from './domain.ts';

/** Fixed public error vocabulary: never attach SDK errors, raw objects or IDs. */
export type StripeReadReason='INVALID_SHAPE'|'NATIVE_MAPPING_REQUIRED'|'NATIVE_BINDING_MISMATCH'|'CLIENT_BINDING_MISMATCH'|'EVENT_MISMATCH'|'OBJECT_MISMATCH'|'METADATA_MISMATCH'|'ALLOCATION_AMBIGUOUS'|'ALLOCATION_MISSING'|'LIST_INCOMPLETE'|'ITEM_LIMIT'|'OBJECT_LIMIT'|'CALL_LIMIT'|'CLOCK_INVALID'|'REQUEST_TIMEOUT'|'TOTAL_TIMEOUT'|'DEPENDENCY_FAILURE'|'UNSUPPORTED_EVENT'|'UNSUPPORTED_STATE'|'CAPTURE_NOT_VERIFIED'|'MONEY_MISMATCH'|'REFUND_PENDING'|'REFUND_FAILED'|'BALANCE_MISMATCH';
export class StripeReadbackError extends Error {
 readonly code='STRIPE_RECONCILIATION_REQUIRED';
 constructor(readonly reason:StripeReadReason){super('Stripe reconciliation required');this.name='StripeReadbackError';}
}
function requireProof(value:unknown,reason:StripeReadReason):asserts value {if(!value)throw new StripeReadbackError(reason);}
const opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),stripeId=z.string().regex(/^[a-z][a-z0-9]*_[A-Za-z0-9_]{1,150}$/);
const amount=z.number().int().min(0).max(100_000_000),signedAmount=z.number().int().min(-100_000_000).max(100_000_000),timestamp=z.number().int().positive().max(253402300799);
const ref=z.union([stripeId,z.object({id:stripeId,deleted:z.literal(false).optional()})]).transform(v=>typeof v==='string'?v:v.id);
const metadata=z.object({rm_operation_id:opaque.optional(),rm_purchase_id:opaque.optional(),rm_due_id:opaque.optional()});
const bindingSchema=z.object({accountId:stripeId.refine(v=>v.startsWith('acct_')),livemode:z.literal(false),apiVersion:z.string().min(1).max(80),verifiedBindingId:opaque});
const resultFields={providerObjectId:stripeId,providerAccountId:stripeId,livemode:z.literal(false),currency:z.literal('USD'),amountCents:amount.positive(),purchaseId:opaque,idempotencyKey:z.string().min(1).max(255)};
const operationSchema=z.object({id:opaque,kind:z.enum(['hosted_invoice','refund']),workspaceId:z.uuid(),purchaseId:opaque,dueId:opaque.nullable(),refundPaymentId:stripeId.nullable(),providerAccountId:stripeId,livemode:z.literal(false),amountCents:amount.positive(),currency:z.literal('USD'),idempotencyKey:z.string().min(1).max(255),state:z.enum(['reserved','unknown','confirmed']),requestDigest:z.string().regex(/^[a-f0-9]{64}$/),result:z.discriminatedUnion('kind',[z.object({...resultFields,kind:z.literal('hosted_invoice'),dueId:opaque}),z.object({...resultFields,kind:z.literal('refund'),status:z.enum(['pending','succeeded','failed'])})]).nullable()});
const nativeInvoice=z.object({nativeRevision:opaque,customerBindingId:opaque,payerAccountId:z.uuid(),customerId:stripeId,invoiceId:stripeId,purchaseLineId:opaque,paymentIntentId:stripeId.nullable(),checkoutSessionId:stripeId.nullable(),hostedOperation:operationSchema});
const nativeSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('payment'),invoice:nativeInvoice}),z.object({kind:z.literal('refund'),invoice:nativeInvoice,refundOperation:operationSchema,originalPaymentIntentId:stripeId})]);
const receiptSchema=z.object({eventId:stripeId,eventType:z.string().min(1).max(100),objectId:stripeId,providerAccountId:stripeId,livemode:z.literal(false),apiVersion:z.string().min(1).max(80),digest:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime({offset:true})});
const eventSchema=z.object({id:stripeId,object:z.literal('event'),type:z.string(),livemode:z.literal(false),api_version:z.string(),account:stripeId.optional(),created:timestamp,data:z.object({object:z.object({id:stripeId,object:z.string()})})});
const directMerchant={on_behalf_of:z.null().optional(),transfer_data:z.null().optional()};
const invoiceSchema=z.object({id:stripeId,object:z.literal('invoice'),livemode:z.literal(false),customer:ref,currency:z.literal('usd'),amount_due:amount.positive(),amount_paid:amount,amount_remaining:amount,total:amount.positive(),status:z.enum(['draft','open','paid','uncollectible','void']),metadata,...directMerchant});
const intentSchema=z.object({id:stripeId,object:z.literal('payment_intent'),livemode:z.literal(false),customer:ref,currency:z.literal('usd'),amount:amount.positive(),amount_received:amount,amount_capturable:amount,status:z.enum(['requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded']),latest_charge:ref.nullable(),last_payment_error:z.object({}).nullable(),metadata,...directMerchant});
const chargeSchema=z.object({id:stripeId,object:z.literal('charge'),livemode:z.literal(false),customer:ref,payment_intent:ref,currency:z.literal('usd'),amount:amount.positive(),amount_captured:amount,amount_refunded:amount,paid:z.boolean(),captured:z.boolean(),status:z.enum(['succeeded','pending','failed']),disputed:z.literal(false),balance_transaction:ref.nullable(),created:timestamp,metadata,...directMerchant});
const checkoutSchema=z.object({id:stripeId,object:z.literal('checkout.session'),livemode:z.literal(false),customer:ref,invoice:ref,payment_intent:ref.nullable(),currency:z.literal('usd'),mode:z.literal('payment'),status:z.enum(['open','complete','expired']),payment_status:z.enum(['paid','unpaid','no_payment_required']),metadata});
// Refund and BalanceTransaction have no required documented livemode field.
const refundSchema=z.object({id:stripeId,object:z.literal('refund'),charge:ref,payment_intent:ref,customer:ref.nullable().optional(),amount:amount.positive(),currency:z.literal('usd'),created:timestamp,status:z.enum(['pending','requires_action','succeeded','failed','canceled']),balance_transaction:ref.nullable(),metadata});
const balanceSchema=z.object({id:stripeId,object:z.literal('balance_transaction'),source:ref,currency:z.string().regex(/^[a-z]{3}$/),amount:signedAmount,fee:signedAmount,net:signedAmount});
const invoicePayment=z.object({id:stripeId,object:z.literal('invoice_payment'),invoice:ref,livemode:z.literal(false),currency:z.literal('usd'),amount_paid:amount.nullable(),amount_requested:amount.positive(),status:z.enum(['open','paid','canceled']),payment:z.object({type:z.literal('payment_intent'),payment_intent:ref}),status_transitions:z.object({paid_at:timestamp.nullable()})});
const pageSchema=z.object({object:z.literal('list'),url:z.literal('/v1/invoice_payments'),has_more:z.boolean(),data:z.array(invoicePayment).max(stripeReadBounds.listItems)});
type Native=z.infer<typeof nativeSchema>;

function boundedObject(raw:unknown):void {
 const stack:{value:unknown;depth:number;exit?:boolean}[]=[{value:raw,depth:0}],active=new WeakSet<object>();let bytes=0;
 while(stack.length){const {value,depth,exit}=stack.pop()!;if(exit){active.delete(value as object);continue;}requireProof(depth<=16,'OBJECT_LIMIT');
  if(value===null){bytes+=4;}else if(typeof value==='string'){bytes+=Buffer.byteLength(JSON.stringify(value));}else if(typeof value==='number'){requireProof(Number.isFinite(value),'INVALID_SHAPE');bytes+=String(value).length;}else if(typeof value==='boolean'){bytes+=5;}
  else if(typeof value==='object'){
   requireProof(!active.has(value),'INVALID_SHAPE');active.add(value);stack.push({value,depth,exit:true});
   if(Array.isArray(value)){requireProof(value.length<=stripeReadBounds.listItems,'ITEM_LIMIT');bytes+=2+value.length;for(const v of value)stack.push({value:v,depth:depth+1});}
   else {requireProof(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null,'INVALID_SHAPE');const descriptors=Object.getOwnPropertyDescriptors(value);bytes+=2;for(const [key,d] of Object.entries(descriptors)){requireProof('value' in d,'INVALID_SHAPE');bytes+=Buffer.byteLength(JSON.stringify(key))+2;stack.push({value:d.value,depth:depth+1});}}
  }else throw new StripeReadbackError('INVALID_SHAPE');
  requireProof(bytes<=stripeReadBounds.objectBytes,'OBJECT_LIMIT');
 }
}
function parse<T>(schema:z.ZodType<T>,raw:unknown):T {boundedObject(raw);try{return schema.parse(raw);}catch{throw new StripeReadbackError('INVALID_SHAPE');}}
function correlation(m:z.infer<typeof metadata>,op:z.infer<typeof operationSchema>,required:boolean){
 const fields=[stripeFishingMetadata.operation,stripeFishingMetadata.purchase,stripeFishingMetadata.due] as const;
 const present=fields.some(k=>m[k]!==undefined);if(!required&&!present)return;
 requireProof(m.rm_operation_id===op.id&&m.rm_purchase_id===op.purchaseId&&m.rm_due_id===op.dueId,'METADATA_MISMATCH');
}
function nativeProof(n:Native,b:z.infer<typeof bindingSchema>){const i=n.invoice,o=i.hostedOperation,r=o.result;
 requireProof(i.invoiceId.startsWith('in_')&&i.customerId.startsWith('cus_')&&(!i.paymentIntentId||i.paymentIntentId.startsWith('pi_'))&&(!i.checkoutSessionId||i.checkoutSessionId.startsWith('cs_')),'NATIVE_BINDING_MISMATCH');
 requireProof(o.kind==='hosted_invoice'&&o.state==='confirmed'&&o.dueId&&o.refundPaymentId===null&&r?.kind==='hosted_invoice','NATIVE_BINDING_MISMATCH');
 requireProof(o.providerAccountId===b.accountId&&r.providerAccountId===b.accountId&&r.providerObjectId===i.invoiceId&&r.purchaseId===o.purchaseId&&r.dueId===o.dueId&&r.amountCents===o.amountCents&&r.idempotencyKey===o.idempotencyKey,'NATIVE_BINDING_MISMATCH');
 if(n.kind==='refund'){const f=n.refundOperation,fr=f.result;
  requireProof(n.originalPaymentIntentId.startsWith('pi_')&&(!i.paymentIntentId||i.paymentIntentId===n.originalPaymentIntentId),'NATIVE_BINDING_MISMATCH');
  requireProof(f.kind==='refund'&&f.state==='confirmed'&&f.refundPaymentId===n.originalPaymentIntentId&&f.workspaceId===o.workspaceId&&f.purchaseId===o.purchaseId&&f.dueId===o.dueId&&f.providerAccountId===b.accountId&&fr?.kind==='refund','NATIVE_BINDING_MISMATCH');
  requireProof(fr.providerAccountId===b.accountId&&fr.providerObjectId.startsWith('re_')&&fr.purchaseId===o.purchaseId&&fr.amountCents===f.amountCents&&fr.idempotencyKey===f.idempotencyKey&&f.amountCents<=o.amountCents,'NATIVE_BINDING_MISMATCH');
 }
}

const invoiceEvents=new Set(['invoice.paid','invoice.payment_failed','invoice.payment_action_required']);
const intentEvents=new Set(['payment_intent.succeeded','payment_intent.payment_failed','payment_intent.processing']);
const checkoutEvents=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed']);
const refundEvents=new Set(['refund.created','refund.updated']);

/** Read-only wire normalizer. No client construction, env, HTTP or native effect.
 * Uses current InvoicePayment allocations, never legacy invoice.payment_intent.
 * Metadata correlates a native mapping; it never chooses ownership or a due.
 */
export class StripeReadbackNormalizer implements StripeTestReceiptReadPort {
 readonly execution='stripe_test_read_only' as const;
 readonly #deps:StripeReadbackDependencies;
 constructor(deps:StripeReadbackDependencies){this.#deps=deps;}
 async reconcileReceipt(input:Receipt):Promise<ReceiptReadback>{
  try{return await this.read(input);}catch(e){if(e instanceof StripeReadbackError)throw e;throw new StripeReadbackError('INVALID_SHAPE');}
 }
 private async read(input:Receipt):Promise<ReceiptReadback>{
  const receipt=Object.freeze(parse(receiptSchema,input)),binding=parse(bindingSchema,this.#deps.client.binding);
  requireProof(receipt.eventId.startsWith('evt_'),'EVENT_MISMATCH');requireProof(receipt.providerAccountId===binding.accountId&&receipt.apiVersion===binding.apiVersion,'CLIENT_BINDING_MISMATCH');
  const start=this.#deps.clock.now().getTime(),realStart=performance.now();let last=start,calls=0;
  requireProof(Number.isFinite(start),'CLOCK_INVALID');
  const clock=()=>{const now=this.#deps.clock.now().getTime();requireProof(Number.isFinite(now)&&now>=last,'CLOCK_INVALID');last=now;requireProof(now-start<=stripeReadBounds.totalMilliseconds&&performance.now()-realStart<=stripeReadBounds.totalMilliseconds,'TOTAL_TIMEOUT');
   const b=parse(bindingSchema,this.#deps.client.binding);requireProof(b.accountId===binding.accountId&&b.apiVersion===binding.apiVersion&&b.verifiedBindingId===binding.verifiedBindingId,'CLIENT_BINDING_MISMATCH');return now;
  };
  const call=async<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{
   clock();requireProof(++calls<=stripeReadBounds.calls,'CALL_LIMIT');const controller=new AbortController(),requestStart=last,realRequestStart=performance.now();
   const remaining=stripeReadBounds.totalMilliseconds-Math.max(last-start,performance.now()-realStart),milliseconds=Math.min(stripeReadBounds.requestMilliseconds,remaining);
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{const result=await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new StripeReadbackError(milliseconds<stripeReadBounds.requestMilliseconds?'TOTAL_TIMEOUT':'REQUEST_TIMEOUT'));},Math.max(0,milliseconds));})]);clock();requireProof(last-requestStart<=stripeReadBounds.requestMilliseconds&&performance.now()-realRequestStart<=stripeReadBounds.requestMilliseconds,'REQUEST_TIMEOUT');return result;}
   catch(e){controller.abort();if(e instanceof StripeReadbackError)throw e;throw new StripeReadbackError('DEPENDENCY_FAILURE');}finally{if(timer!==undefined)clearTimeout(timer);}
  };
  const rawNative=await call(signal=>this.#deps.resolveNativeBinding(receipt,signal));requireProof(rawNative,'NATIVE_MAPPING_REQUIRED');const native=parse(nativeSchema,rawNative);nativeProof(native,binding);
  const retrieve=async<T>(schema:z.ZodType<T>,object:StripeReadRequest['object'],objectId:string)=>{requireProof(stripeId.safeParse(objectId).success,'OBJECT_MISMATCH');const result=parse(schema,await call(signal=>this.#deps.client.retrieve({object,id:objectId},signal)));return result;};
  const page=async(query:StripeInvoicePaymentQuery)=>{const p=parse(pageSchema,await call(signal=>this.#deps.client.listInvoicePayments(query,signal)));requireProof(!p.has_more,'LIST_INCOMPLETE');requireProof(p.data.length<=1,'ALLOCATION_AMBIGUOUS');return p.data[0]??null;};
  const event=await retrieve(eventSchema,'event',receipt.eventId);
  requireProof(event.id===receipt.eventId&&event.type===receipt.eventType&&event.data.object.id===receipt.objectId&&event.api_version===binding.apiVersion&&(!event.account||event.account===binding.accountId)&&new Date(event.created*1000).getTime()===Date.parse(receipt.createdAt),'EVENT_MISMATCH');
  requireProof(event.created*1000<=clock(),'CLOCK_INVALID');
  const isCheckout=checkoutEvents.has(event.type),isIntent=intentEvents.has(event.type),isInvoice=invoiceEvents.has(event.type),isRefund=refundEvents.has(event.type),isChargeRefund=event.type==='charge.refunded';
  requireProof(native.kind==='payment'?(isCheckout||isIntent||isInvoice):(isRefund||isChargeRefund),'UNSUPPORTED_EVENT');
  requireProof(event.data.object.object===(isCheckout?'checkout.session':isIntent?'payment_intent':isInvoice?'invoice':isRefund?'refund':'charge'),'EVENT_MISMATCH');
  const i=native.invoice,o=i.hostedOperation;
  if(isInvoice)requireProof(receipt.objectId===i.invoiceId,'OBJECT_MISMATCH');
  let checkout:z.infer<typeof checkoutSchema>|null=null;
  if(isCheckout){requireProof(i.checkoutSessionId&&receipt.objectId===i.checkoutSessionId,'NATIVE_BINDING_MISMATCH');checkout=await retrieve(checkoutSchema,'checkout_session',i.checkoutSessionId);requireProof(checkout.id===i.checkoutSessionId&&checkout.invoice===i.invoiceId&&checkout.customer===i.customerId,'OBJECT_MISMATCH');correlation(checkout.metadata,o,false);}
  const invoice=await retrieve(invoiceSchema,'invoice',i.invoiceId);
  requireProof(invoice.id===i.invoiceId&&invoice.customer===i.customerId&&invoice.amount_due===o.amountCents&&invoice.total===o.amountCents&&invoice.amount_paid+invoice.amount_remaining===invoice.amount_due&&(invoice.status!=='paid'||invoice.amount_remaining===0),'MONEY_MISMATCH');correlation(invoice.metadata,o,true);
  const allocation=await page({invoiceId:i.invoiceId,limit:100});
  if(allocation)requireProof(allocation.invoice===i.invoiceId&&allocation.payment.payment_intent.startsWith('pi_'),'OBJECT_MISMATCH');
  const piId=allocation?.payment.payment_intent??i.paymentIntentId;
  const output=(facts:SettlementFact[],state?:'pending'|'action_required'|'failed'):ReceiptReadback=>({receiptId:receipt.eventId,resolvedObjectId:receipt.objectId,providerAccountId:binding.accountId,livemode:false,readAt:new Date(clock()).toISOString(),facts,dues:state?[{purchaseId:o.purchaseId,operationId:o.id,dueId:o.dueId!,state}]:[]});
  if(!piId){requireProof(native.kind==='payment'&&!isIntent&&!checkout?.payment_intent&&invoice.amount_paid===0&&['draft','open'].includes(invoice.status),'ALLOCATION_MISSING');return output([],'pending');}
  requireProof(piId.startsWith('pi_')&&(!i.paymentIntentId||piId===i.paymentIntentId)&&(!checkout?.payment_intent||checkout.payment_intent===piId)&&(!isIntent||receipt.objectId===piId),'OBJECT_MISMATCH');
  const piAllocation=await page({paymentIntentId:piId,limit:100});
  requireProof((allocation===null&&piAllocation===null)||(allocation&&piAllocation&&JSON.stringify(allocation)===JSON.stringify(piAllocation)),'ALLOCATION_AMBIGUOUS');
  const intent=await retrieve(intentSchema,'payment_intent',piId);requireProof(intent.id===piId&&intent.customer===i.customerId&&intent.amount_received<=intent.amount&&intent.amount_capturable<=intent.amount,'OBJECT_MISMATCH');correlation(intent.metadata,o,false);
  const unpaid=()=>{requireProof(native.kind==='payment'&&invoice.amount_paid===0&&(!allocation||allocation.amount_paid===null||allocation.amount_paid===0),'MONEY_MISMATCH');
   const state=intent.status==='requires_action'?'action_required':intent.status==='canceled'||intent.status==='requires_payment_method'&&intent.last_payment_error!==null?'failed':'pending';return output([],state);
  };
  if(intent.status!=='succeeded'){requireProof(native.kind==='payment','CAPTURE_NOT_VERIFIED');return unpaid();}
  requireProof(allocation?.status==='paid'&&allocation.amount_paid!==null&&allocation.amount_paid>0&&allocation.status_transitions.paid_at!==null,'ALLOCATION_MISSING');
  requireProof(intent.latest_charge&&intent.latest_charge.startsWith('ch_'),'CAPTURE_NOT_VERIFIED');
  const charge=await retrieve(chargeSchema,'charge',intent.latest_charge);
  requireProof(charge.id===intent.latest_charge&&charge.payment_intent===piId&&charge.customer===i.customerId,'OBJECT_MISMATCH');correlation(charge.metadata,o,false);
  requireProof(charge.paid&&charge.captured&&charge.status==='succeeded'&&charge.amount_captured>0&&intent.amount_capturable===0,'CAPTURE_NOT_VERIFIED');
  requireProof(charge.amount_captured<=charge.amount&&charge.amount_refunded<=charge.amount_captured&&intent.amount_received===charge.amount_captured&&allocation.amount_paid===charge.amount_captured&&invoice.amount_paid===allocation.amount_paid&&allocation.amount_paid<=allocation.amount_requested&&allocation.amount_requested<=o.amountCents,'MONEY_MISMATCH');
  requireProof(allocation.status_transitions.paid_at*1000<=clock()&&charge.created*1000<=clock(),'CLOCK_INVALID');
  const fee=async(transactionId:string|null,sourceId:string,expectedAmount:number):Promise<number|null>=>{
   if(!transactionId)return null;requireProof(transactionId.startsWith('txn_'),'BALANCE_MISMATCH');const b=await retrieve(balanceSchema,'balance_transaction',transactionId);
   requireProof(b.id===transactionId&&b.source===sourceId,'BALANCE_MISMATCH');if(b.currency!=='usd')return null;requireProof(b.amount===expectedAmount&&b.net===b.amount-b.fee,'BALANCE_MISMATCH');return b.fee;
  };
  const commonFact={providerReceiptId:receipt.eventId,purchaseId:o.purchaseId,purchaseLineId:i.purchaseLineId,dueId:o.dueId!,providerAccountId:binding.accountId,livemode:false,currency:'USD' as const};
  if(native.kind==='payment'){
   requireProof(!['void','uncollectible','draft'].includes(invoice.status),'UNSUPPORTED_STATE');
   if(checkout&&(checkout.status!=='complete'||checkout.payment_status!=='paid'))return output([],'pending');
   return output([{...commonFact,canonicalTransactionId:piId,relatedProviderObjectId:i.invoiceId,operationId:o.id,kind:'payment',cents:allocation.amount_paid,feeCents:await fee(charge.balance_transaction,charge.id,charge.amount_captured),originalPaymentId:null,occurredAt:new Date(allocation.status_transitions.paid_at*1000).toISOString()}]);
  }
  const ro=native.refundOperation;requireProof(ro.result?.kind==='refund'&&native.originalPaymentIntentId===piId,'NATIVE_BINDING_MISMATCH');
  if(isRefund)requireProof(receipt.objectId===ro.result.providerObjectId,'OBJECT_MISMATCH');if(isChargeRefund)requireProof(receipt.objectId===charge.id,'OBJECT_MISMATCH');
  const refund=await retrieve(refundSchema,'refund',ro.result.providerObjectId);
  requireProof(refund.id===ro.result.providerObjectId&&refund.charge===charge.id&&refund.payment_intent===piId&&(!refund.customer||refund.customer===i.customerId)&&refund.amount===ro.amountCents,'OBJECT_MISMATCH');correlation(refund.metadata,ro,true);
  if(refund.status==='pending'||refund.status==='requires_action')throw new StripeReadbackError('REFUND_PENDING');
  if(refund.status==='failed'||refund.status==='canceled')throw new StripeReadbackError('REFUND_FAILED');
  requireProof(refund.amount<=charge.amount_refunded&&refund.created>=charge.created&&refund.created*1000<=clock(),'MONEY_MISMATCH');
  return output([{...commonFact,canonicalTransactionId:refund.id,relatedProviderObjectId:refund.id,operationId:ro.id,kind:'refund',cents:refund.amount,feeCents:await fee(refund.balance_transaction,refund.id,-refund.amount),originalPaymentId:piId,occurredAt:new Date(refund.created*1000).toISOString()}]);
 }
}
