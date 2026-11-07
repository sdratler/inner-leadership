import 'server-only';
import Stripe from 'stripe';
import {AppError} from './errors.ts';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from '../features/fishing-billing/card-binding.ts';
import {cardSessionResultSchema,prepareCardCommandSchema} from '../features/fishing-billing/card-contracts.ts';
import type {BillingStripeTestProvider} from '../features/fishing-billing/cards.ts';

type Request=Parameters<BillingStripeTestProvider['createCheckout']>[0];
export type BillingCheckoutEffect=Readonly<{
 effect:'create_checkout';binding:BillingStripeBinding;operationId:string;quoteId:string;
 amountMinor:number;configurationId:string;
}>;
export interface BillingCheckoutAdmission{
 /** Server-owned: recheck the current native family/amount, durable UNKNOWN
  * dispatch reservation, released terms and verified card-only configuration.
  * Called before account reads and again immediately before the POST. */
 authorize(effect:BillingCheckoutEffect):Promise<void>;
}
export type BillingCheckoutDependencies={
 binding:BillingStripeBinding;key:string;origin:string;successUrl:string;cancelUrl:string;
 admission:BillingCheckoutAdmission|null;transport:typeof fetch|null;
};
const apiVersion='2026-09-30.endive' as const;
const unavailable=()=>new AppError('UNAVAILABLE');
function requireValue(value:unknown):asserts value{if(!value)throw unavailable();}
function exactKeys(value:object,keys:readonly string[]){
 requireValue(Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)));
}
function returnUrl(raw:string,origin:string){
 const url=new URL(raw);
 requireValue(url.protocol==='https:'&&url.origin===origin&&!url.username&&!url.password&&!url.hash);
 return url.href;
}
function interruptible<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(unavailable());};
  if(signal.aborted){void pending.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  pending.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(unavailable());else resolve(value);},()=>{signal.removeEventListener('abort',abort);reject(unavailable());});
 });
}
function snapshot(request:Request,binding:BillingStripeBinding){
 requireValue(JSON.stringify(billingStripeBindingSchema.parse(request.binding))===JSON.stringify(binding));
 const command=prepareCardCommandSchema.parse({operationId:request.operationId,quoteId:request.quoteId,expectedVersion:request.expectedVersion,selection:request.allocations});
 const amount=command.selection.reduce((sum,line)=>sum+line.amountMinor,0),p=request.params;
 requireValue(Number.isSafeInteger(amount)&&amount>0&&amount===request.amountMinor&&request.idempotencyKey===command.operationId);
 exactKeys(p,['mode','client_reference_id','payment_method_configuration','integration_identifier','metadata','payment_intent_data','line_items']);
 requireValue(p.mode==='payment'&&p.client_reference_id===command.quoteId&&/^pmc_[A-Za-z0-9]+$/.test(p.payment_method_configuration)&&/^jlfa_monthly_[a-z]{8}$/.test(p.integration_identifier));
 for(const metadata of [p.metadata,p.payment_intent_data.metadata]){
  exactKeys(metadata,['billing_quote_id','billing_attempt_id']);
  requireValue(metadata.billing_quote_id===command.quoteId&&metadata.billing_attempt_id===command.operationId);
 }
 exactKeys(p.payment_intent_data,['metadata']);requireValue(p.line_items.length===1);
 const line=p.line_items[0]!;exactKeys(line,['quantity','price_data']);exactKeys(line.price_data,['currency','unit_amount','product_data']);exactKeys(line.price_data.product_data,['name']);
 requireValue(line.quantity===1&&line.price_data.currency==='usd'&&line.price_data.unit_amount===amount&&line.price_data.product_data.name.length>0&&line.price_data.product_data.name.length<=200);
 const metadata={billing_quote_id:command.quoteId,billing_attempt_id:command.operationId};
 return {effect:Object.freeze({effect:'create_checkout' as const,binding:Object.freeze({...binding}),operationId:command.operationId,quoteId:command.quoteId,amountMinor:amount,configurationId:p.payment_method_configuration}),
  params:{mode:'payment' as const,client_reference_id:command.quoteId,payment_method_configuration:p.payment_method_configuration,integration_identifier:p.integration_identifier,
   metadata:{...metadata},payment_intent_data:{metadata:{...metadata}},line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:amount,product_data:{name:line.price_data.product_data.name}}}]}};
}

/** Unmounted direct-account TEST Checkout creator using the official SDK.
 * No environment/key lookup, default network transport, retry, capture/refund,
 * subscription, native write or payment confirmation. A caller must durably
 * reserve UNKNOWN before calling; all errors remain uncertain to that caller.
 * Payment reconciliation is the separately required provider-read/webhook seam.
 */
export function createFishingBillingTestCheckout(dependencies:BillingCheckoutDependencies):Pick<BillingStripeTestProvider,'createCheckout'>{
 const supplied={...dependencies,binding:{...dependencies.binding}};
 return {async createCheckout(request){
  let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
   requireValue(supplied.admission&&supplied.transport&&Stripe.PACKAGE_VERSION==='23.0.0'&&Stripe.API_VERSION===apiVersion);
   const binding=billingStripeBindingSchema.parse(supplied.binding),frozen=snapshot(request,binding);
   requireValue(/^(?:sk|rk)_test_[A-Za-z0-9_]{16,256}$/.test(supplied.key));
   const origin=new URL(supplied.origin);requireValue(origin.protocol==='https:'&&origin.origin===supplied.origin&&!origin.username&&!origin.password);
   const successUrl=returnUrl(supplied.successUrl,origin.origin),cancelUrl=returnUrl(supplied.cancelUrl,origin.origin);
   controller=new AbortController();const signal=controller.signal;timer=setTimeout(()=>controller!.abort(),15000);
   const admission=supplied.admission,transport=supplied.transport;
   await interruptible(admission.authorize(frozen.effect),signal);
   let calls=0;
   const guardedFetch:typeof fetch=async(input,init)=>{
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try{
     requireValue(typeof input==='string'||input instanceof URL);const url=new URL(String(input));
     const expected=['/v1/account','/v1/balance','/v1/checkout/sessions'][calls],method=calls===2?'POST':'GET';
     requireValue(++calls<=3&&!signal.aborted&&url.origin==='https://api.stripe.com'&&url.pathname===expected&&!url.search&&!url.hash&&!url.username&&!url.password&&(init?.method??'GET').toUpperCase()===method);
     const headers=new Headers(init?.headers);requireValue(headers.get('stripe-version')===apiVersion&&!headers.has('stripe-account'));
     requireValue(method==='POST'?typeof init?.body==='string'&&init.body.length<=32768:!init?.body);
     const combined=AbortSignal.any([signal,...(init?.signal?[init.signal]:[])]);
     const response=await interruptible(transport(input,{...init,redirect:'error',credentials:'omit',cache:'no-store',signal:combined}),combined);
     requireValue((response.status===200||method==='POST'&&response.status===201)&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')&&response.body);
     reader=response.body.getReader();let size=0,reads=0;const chunks:Uint8Array[]=[];
     for(;;){requireValue(++reads<=131073);const part=await interruptible(reader.read(),combined);if(part.done)break;size+=part.value.byteLength;requireValue(size<=131072&&!combined.aborted);chunks.push(part.value);}
     return new Response(Buffer.concat(chunks,size),{status:response.status,headers:{'content-type':'application/json'}});
    }catch{throw unavailable();}finally{try{void reader?.cancel().catch(()=>{});}catch{}try{reader?.releaseLock();}catch{}}
   };
   const sdk=new Stripe(supplied.key,{apiVersion,timeout:5000,maxNetworkRetries:0,httpClient:Stripe.createFetchHttpClient(guardedFetch)});
   const account=await interruptible(sdk.accounts.retrieve(null),signal);requireValue(account.object==='account'&&account.id===binding.accountId);
   const balance=await interruptible(sdk.balance.retrieve(),signal);requireValue(balance.object==='balance'&&balance.livemode===false&&calls===2);
   await interruptible(admission.authorize(frozen.effect),signal);
   const session=await interruptible(sdk.checkout.sessions.create({...frozen.params,ui_mode:'hosted',success_url:successUrl,cancel_url:cancelUrl},{idempotencyKey:frozen.effect.operationId}),signal);
   requireValue(Number(calls)===3&&!signal.aborted&&session.object==='checkout.session'&&session.livemode===false&&session.mode==='payment'&&session.amount_total===frozen.effect.amountMinor&&session.currency==='usd'&&session.client_reference_id===frozen.effect.quoteId&&session.integration_identifier===frozen.params.integration_identifier&&session.metadata?.billing_quote_id===frozen.effect.quoteId&&session.metadata.billing_attempt_id===frozen.effect.operationId&&session.payment_method_configuration_details?.id===frozen.effect.configurationId&&session.url);
   const checkoutUrl=new URL(session.url);requireValue(checkoutUrl.origin==='https://checkout.stripe.com'&&!checkoutUrl.username&&!checkoutUrl.password);
   billingId.parse(frozen.effect.operationId);
   return cardSessionResultSchema.parse({accountId:binding.accountId,livemode:false,apiVersion,quoteId:frozen.effect.quoteId,attemptId:frozen.effect.operationId,id:session.id,amountMinor:session.amount_total,currency:'USD',url:session.url,paymentStatus:session.payment_status});
  }catch{throw unavailable();}finally{if(timer)clearTimeout(timer);controller?.abort();}
 }};
}
