import 'server-only';
import Stripe from 'stripe';
import {AppError} from './errors.ts';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from '../features/fishing-billing/card-binding.ts';
import {billingStripeSignedReceiptSchema,type BillingStripeSignedReceipt} from '../features/fishing-billing/stripe-test.ts';
import {providerPaymentSnapshotSchema} from '../features/fishing-billing/card-contracts.ts';
import type {BillingStripeTestProvider} from '../features/fishing-billing/cards.ts';

export type BillingPaymentReadEffect=Readonly<{effect:'read_payment';binding:BillingStripeBinding;eventId:string;eventType:string;objectId:string}>;
export type BillingPaymentReadDependencies={
 binding:BillingStripeBinding;key:string;transport:typeof fetch|null;
 /** Server closure checks the durably verified event, current native service
  * target and account admission before every GET. Receipt JSON is not authority. */
 admission:{authorize(effect:BillingPaymentReadEffect):Promise<void>}|null;clock:{now():Date};
};
const apiVersion='2026-09-30.endive' as const;
const unavailable=()=>new AppError('UNAVAILABLE');
function requireValue(value:unknown):asserts value{if(!value)throw unavailable();}
function record(value:unknown):Record<string,unknown>{requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function providerId(value:unknown,prefix:string){
 const id=typeof value==='string'?value:record(value).id;requireValue(typeof id==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9_]{1,150}$').test(id));return id;
}
function amount(value:unknown){requireValue(Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=100_000_000);return Number(value);}
function instant(value:unknown,observedAt:Date){
 requireValue(Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=253402300799&&Number(value)*1000<=observedAt.valueOf()+30000);
 return new Date(Number(value)*1000).toISOString();
}
function interruptible<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
 const abort=()=>{signal.removeEventListener('abort',abort);reject(unavailable());};
 if(signal.aborted){void pending.catch(()=>{});abort();return;}signal.addEventListener('abort',abort,{once:true});
 pending.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(unavailable());else resolve(value);},()=>{signal.removeEventListener('abort',abort);reject(unavailable());});
});}
function metadata(value:unknown){const m=record(value);return {quoteId:billingId.parse(m.billing_quote_id),attemptId:billingId.parse(m.billing_attempt_id)};}

/** Translate current account-scoped SDK facts only. Gross principal is distinct
 * from Stripe's fee/net fields. Missing capture/refund facts, disputed charges,
 * incomplete pagination or an ambiguous Session stay unresolved for review.
 * This function does not establish native family or refund-allocation authority.
 */
function normalize(session:Stripe.Checkout.Session,refunds:Stripe.ApiList<Stripe.Refund>,receipt:BillingStripeSignedReceipt,binding:BillingStripeBinding,observedAt:Date){
 requireValue(session.object==='checkout.session'&&session.livemode===false&&session.mode==='payment'&&session.currency==='usd'&&session.payment_method_types.length===1&&session.payment_method_types[0]==='card');
 const sessionId=providerId(session.id,'cs'),m=metadata(session.metadata);
 requireValue(session.client_reference_id===m.quoteId);const pi=record(session.payment_intent),paymentIntentId=providerId(pi.id,'pi');
 const pm=metadata(pi.metadata);requireValue(pi.object==='payment_intent'&&pi.livemode===false&&pi.currency==='usd'&&pm.quoteId===m.quoteId&&pm.attemptId===m.attemptId);
 const total=amount(pi.amount),received=amount(pi.amount_received);requireValue(total>0&&total===session.amount_total&&received<=total);
 requireValue(Array.isArray(pi.payment_method_types)&&pi.payment_method_types.length===1&&pi.payment_method_types[0]==='card');
 requireValue(refunds.object==='list'&&refunds.has_more===false&&refunds.data.length<=100&&new Set(refunds.data.map(r=>r.id)).size===refunds.data.length);
 let status:'pending'|'failed'|'paid',paidAt:string|null=null;
 const charge=pi.latest_charge===null?null:record(pi.latest_charge);
 if(charge){requireValue(charge.object==='charge'&&charge.livemode===false&&charge.currency==='usd'&&providerId(charge.payment_intent,'pi')===paymentIntentId&&charge.disputed===false);}
 if(pi.status==='succeeded'){
  requireValue(session.payment_status==='paid'&&received===total&&charge&&charge.paid===true&&charge.captured===true&&charge.status==='succeeded'&&amount(charge.amount_captured)===received&&record(charge.payment_method_details).type==='card');
  const transaction=record(charge.balance_transaction);
  requireValue(transaction.object==='balance_transaction'&&['charge','payment'].includes(String(transaction.type))&&transaction.currency==='usd'&&amount(transaction.amount)===received&&providerId(transaction.source,'ch')===providerId(charge.id,'ch'));
  paidAt=instant(transaction.created,observedAt);status='paid';
 }else{
  requireValue(received===0&&refunds.data.length===0&&session.payment_status==='unpaid');
  if(pi.status==='canceled'||pi.status==='requires_payment_method')status='failed';
  else{requireValue(['processing','requires_action','requires_confirmation','requires_capture'].includes(String(pi.status)));status='pending';}
 }
 const mapped=refunds.data.map(raw=>{
  const r=record(raw),id=providerId(r.id,'re');requireValue(r.object==='refund'&&r.livemode!==true&&r.currency==='usd'&&providerId(r.payment_intent,'pi')===paymentIntentId&&charge&&providerId(r.charge,'ch')===providerId(charge.id,'ch'));
  const principal=amount(r.amount);requireValue(principal>0);
  let state:'pending'|'succeeded'|'failed',occurredAt:string;
  if(r.status==='succeeded'){
   const tx=record(r.balance_transaction);requireValue(tx.object==='balance_transaction'&&['refund','payment_refund'].includes(String(tx.type))&&tx.currency==='usd'&&tx.amount===-principal&&providerId(tx.source,'re')===id);
   state='succeeded';occurredAt=instant(tx.created,observedAt);
  }else{requireValue(['pending','requires_action','failed','canceled'].includes(String(r.status)));state=r.status==='failed'||r.status==='canceled'?'failed':'pending';occurredAt=instant(r.created,observedAt);}
  return {id,amountMinor:principal,state,occurredAt};
 });
 requireValue(mapped.filter(r=>r.state!=='failed').reduce((sum,r)=>sum+r.amountMinor,0)<=received);
 if(receipt.objectId.startsWith('cs_'))requireValue(receipt.objectId===sessionId);
 else if(receipt.objectId.startsWith('pi_'))requireValue(receipt.objectId===paymentIntentId);
 else requireValue(mapped.some(r=>r.id===receipt.objectId));
 return providerPaymentSnapshotSchema.parse({accountId:binding.accountId,livemode:false,apiVersion,quoteId:m.quoteId,attemptId:m.attemptId,sessionId,paymentIntentId,currency:'USD',amountMinor:total,receivedMinor:received,status,method:'card',paidAt,observedAt:observedAt.toISOString(),refunds:mapped,dispute:'none'});
}

/** Unmounted direct-account test-only current readback, GET-only through the
 * official SDK. No default transport, environment/credential lookup, payment,
 * refund, native mutation or automatic retry. Invoice/dispute and ambiguous
 * facts require their separately admitted successor; they never invent debt.
 */
export function createFishingBillingTestReadback(dependencies:BillingPaymentReadDependencies):Pick<BillingStripeTestProvider,'readPayment'>{
 const supplied={...dependencies,binding:{...dependencies.binding}};
 return {async readPayment(rawReceipt,rawBinding){
  let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
   requireValue(supplied.admission&&supplied.transport&&Stripe.PACKAGE_VERSION==='23.0.0'&&Stripe.API_VERSION===apiVersion);
   const binding=billingStripeBindingSchema.parse(supplied.binding),requested=billingStripeBindingSchema.parse(rawBinding),receipt=billingStripeSignedReceiptSchema.parse(rawReceipt);
   requireValue(JSON.stringify(binding)===JSON.stringify(requested)&&receipt.providerAccountId===binding.accountId&&receipt.livemode===false&&receipt.apiVersion===apiVersion&&/^(?:sk|rk)_test_[A-Za-z0-9_]{16,256}$/.test(supplied.key));
   requireValue(receipt.eventType.startsWith('checkout.session.')?receipt.objectId.startsWith('cs_'):receipt.eventType.startsWith('payment_intent.')?receipt.objectId.startsWith('pi_'):receipt.eventType.startsWith('refund.')&&receipt.objectId.startsWith('re_'));
   const observedAt=new Date(supplied.clock.now());requireValue(Number.isFinite(observedAt.valueOf()));
   const effect=Object.freeze({effect:'read_payment' as const,binding:Object.freeze({...binding}),eventId:receipt.eventId,eventType:receipt.eventType,objectId:receipt.objectId});
   controller=new AbortController();const signal=controller.signal;timer=setTimeout(()=>controller!.abort(),25000);
   const admission=supplied.admission,transport=supplied.transport;let calls=0;
   const guardedFetch:typeof fetch=async(input,init)=>{
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try{
     requireValue(typeof input==='string'||input instanceof URL);const url=new URL(String(input));
     const resource=/^\/v1\/(?:account|balance|checkout\/sessions(?:\/cs_[A-Za-z0-9_]{1,150})?|refunds(?:\/re_[A-Za-z0-9_]{1,150})?)$/.test(url.pathname);
     requireValue(++calls<=8&&!signal.aborted&&url.origin==='https://api.stripe.com'&&resource&&!url.hash&&!url.username&&!url.password&&(init?.method??'GET').toUpperCase()==='GET'&&!init?.body);
     const headers=new Headers(init?.headers);requireValue(headers.get('stripe-version')===apiVersion&&!headers.has('stripe-account'));
     await interruptible(admission.authorize(effect),signal);
     const combined=AbortSignal.any([signal,...(init?.signal?[init.signal]:[])]);
     const response=await interruptible(transport(input,{...init,redirect:'error',credentials:'omit',cache:'no-store',signal:combined}),combined);
     requireValue(response.status===200&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')&&response.body);
     reader=response.body.getReader();let size=0,reads=0;const chunks:Uint8Array[]=[];
     for(;;){requireValue(++reads<=262145);const part=await interruptible(reader.read(),combined);if(part.done)break;size+=part.value.byteLength;requireValue(size<=262144&&!combined.aborted);chunks.push(part.value);}
     return new Response(Buffer.concat(chunks,size),{status:200,headers:{'content-type':'application/json'}});
    }catch{throw unavailable();}finally{try{void reader?.cancel().catch(()=>{});}catch{}try{reader?.releaseLock();}catch{}}
   };
   const sdk=new Stripe(supplied.key,{apiVersion,timeout:5000,maxNetworkRetries:0,httpClient:Stripe.createFetchHttpClient(guardedFetch)});
   const account=await interruptible(sdk.accounts.retrieve(null),signal);requireValue(account.object==='account'&&account.id===binding.accountId);
   const balance=await interruptible(sdk.balance.retrieve(),signal);requireValue(balance.object==='balance'&&balance.livemode===false);
   let sessionId:string,expectedPaymentIntentId:string|null=null;
   if(receipt.objectId.startsWith('cs_'))sessionId=providerId(receipt.objectId,'cs');
   else{
    let paymentIntentId:string;
    if(receipt.objectId.startsWith('re_')){const refund=await interruptible(sdk.refunds.retrieve(providerId(receipt.objectId,'re')),signal);requireValue(refund.object==='refund');paymentIntentId=providerId(refund.payment_intent,'pi');}
    else paymentIntentId=providerId(receipt.objectId,'pi');
    expectedPaymentIntentId=paymentIntentId;
    const sessions=await interruptible(sdk.checkout.sessions.list({payment_intent:paymentIntentId,limit:2}),signal);
    requireValue(sessions.object==='list'&&sessions.has_more===false&&sessions.data.length===1);sessionId=providerId(sessions.data[0]!.id,'cs');
   }
   const session=await interruptible(sdk.checkout.sessions.retrieve(sessionId,{expand:['payment_intent.latest_charge.balance_transaction']}),signal);requireValue(session.id===sessionId);
   const pi=record(session.payment_intent),paymentIntentId=providerId(pi.id,'pi');
   requireValue(expectedPaymentIntentId===null||expectedPaymentIntentId===paymentIntentId);
   const refunds=await interruptible(sdk.refunds.list({payment_intent:paymentIntentId,limit:100,expand:['data.balance_transaction']}),signal);
   requireValue(!signal.aborted);return normalize(session,refunds,receipt,binding,observedAt);
  }catch{throw unavailable();}finally{if(timer)clearTimeout(timer);controller?.abort();}
 }};
}
