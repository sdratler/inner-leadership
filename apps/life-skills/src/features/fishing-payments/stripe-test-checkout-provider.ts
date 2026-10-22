import 'server-only';
import Stripe from 'stripe';
import {z} from 'zod';
import {digest} from './domain.ts';
import {checkoutSdkVersion,checkoutApiVersion,checkoutBindingSchema,checkoutProviderId,checkoutParse,requireCheckout,StripeTestCheckoutError,validateCheckoutContext,assertCheckoutCreateWindow,checkoutDue,checkoutMetadata,validateCheckoutReturnUrls,validateCheckoutKnown,validateCheckoutClaim,validateCheckoutObservation,type StripeTestCheckoutBinding,type StripeTestCheckoutContext,type StripeTestCheckoutProvider,type CheckoutAction,type CheckoutReturnUrls,type CheckoutObservation} from './stripe-test-checkout-ports.ts';

export const checkoutTransportBounds=Object.freeze({requestMilliseconds:5000,objectBytes:131072,callsPerPhase:3});
const cents=z.number().int().nonnegative().max(100_000_000),metadata=z.record(z.string(),z.string());
const itemSchema=z.object({id:checkoutProviderId('li'),object:z.literal('item'),quantity:z.literal(1),currency:z.literal('usd'),amount_subtotal:cents,amount_total:cents,amount_tax:z.literal(0),amount_discount:z.literal(0),
 adjustable_quantity:z.object({enabled:z.literal(false)}).nullable(),price:z.object({id:checkoutProviderId('price'),currency:z.literal('usd'),unit_amount:cents,type:z.literal('one_time'),recurring:z.null()})});
const sessionSchema=z.object({id:checkoutProviderId('cs'),object:z.literal('checkout.session'),livemode:z.literal(false),customer:checkoutProviderId('cus'),mode:z.literal('payment'),ui_mode:z.literal('hosted_page'),currency:z.literal('usd'),status:z.enum(['open','complete','expired']),payment_status:z.enum(['paid','unpaid']),
 amount_subtotal:cents,amount_total:cents,allow_promotion_codes:z.literal(false),automatic_tax:z.object({enabled:z.literal(false)}),total_details:z.object({amount_discount:z.literal(0),amount_shipping:z.literal(0),amount_tax:z.literal(0)}),
 invoice_creation:z.object({enabled:z.literal(true)}),invoice:checkoutProviderId('in').nullable(),payment_intent:checkoutProviderId('pi').nullable(),subscription:z.null(),expires_at:z.number().int().nonnegative(),url:z.string().max(2048).nullable(),metadata,
 line_items:z.object({object:z.literal('list'),has_more:z.literal(false),data:z.array(itemSchema).length(1)})});
const actionSchema=z.discriminatedUnion('phase',[z.strictObject({phase:z.literal('create'),claim:z.unknown()}),z.strictObject({phase:z.literal('read'),known:z.unknown()}),z.strictObject({phase:z.literal('expire'),known:z.unknown(),claim:z.unknown()})]);
function interrupted<T>(promise:PromiseLike<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
 const aborted=()=>{signal.removeEventListener('abort',aborted);reject(new StripeTestCheckoutError());};
 if(signal.aborted){void Promise.resolve(promise).catch(()=>{});aborted();return;}
 signal.addEventListener('abort',aborted,{once:true});
 Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',aborted);if(signal.aborted){reject(new StripeTestCheckoutError());}else{resolve(value);}},()=>{signal.removeEventListener('abort',aborted);reject(new StripeTestCheckoutError());});
});}

/** SOURCE174 UNMOUNTED TEST capability. No env/DB/merchant discovery and no
 * legal approval inferred from DTO labels. Root owns current authority, durable
 * UNKNOWN/global consume, pending binding before URL and paid mapping/fulfillment.
 * Constructor never calls Stripe. Never feed browser JSON into this capability.
 * Installed primary SDK source inspected, not executed: Stripe23
 * esm/resources/Checkout/Sessions.{js,d.ts} and esm/resources/LineItems.d.ts;
 * API2026-09-30.endive.
 * Fixed POST create, GET known session, explicit POST expire only. No search,
 * customer creation, subscription, saved mandate/off-session setup, invoice
 * creation outside Checkout, direct pay/refund/send or automatic future debit. */
export class StripeTestCheckoutSessionProvider implements StripeTestCheckoutProvider {
 readonly execution='stripe_test_checkout' as const;
 readonly #binding:StripeTestCheckoutBinding;readonly #secret:string;readonly #urls:CheckoutReturnUrls;readonly #clock:()=>Date;
 get binding(){return this.#binding;}
 constructor(secret:string,binding:StripeTestCheckoutBinding,urls:CheckoutReturnUrls,clock:()=>Date=()=>new Date()){
  requireCheckout(Stripe.PACKAGE_VERSION===checkoutSdkVersion&&Stripe.API_VERSION===checkoutApiVersion);
  this.#binding=Object.freeze(checkoutParse(checkoutBindingSchema,binding));this.#secret=checkoutParse(z.string().regex(/^(?:rk|sk)_test_[A-Za-z0-9_]{16,256}$/),secret);
  this.#urls=validateCheckoutReturnUrls(urls);this.#clock=clock;
 }
 async perform(raw:StripeTestCheckoutContext,input:CheckoutAction,signal:AbortSignal):Promise<CheckoutObservation>{
  try{
   const c=validateCheckoutContext(raw,this.binding),action=checkoutParse(actionSchema,input),now=this.#clock();
   requireCheckout(Number.isFinite(now.valueOf())&&!signal.aborted&&Date.parse(c.customer.verifiedAt)<=now.valueOf()&&Date.parse(c.agreements.acceptedAt)<=now.valueOf());
   const due=checkoutDue(c),tags=checkoutMetadata(c),known=action.phase==='create'?undefined:validateCheckoutKnown(action.known,c);
   let calls=0;
   const request=(method:'GET'|'POST',path:string,key:string|null,invoke:(sdk:Stripe,options:Stripe.RequestOptions)=>PromiseLike<unknown>)=>{
    requireCheckout(++calls<=checkoutTransportBounds.callsPerPhase&&!signal.aborted);
    return this.#request(method,path,key,signal,invoke,action.phase==='create'?()=>assertCheckoutCreateWindow(c,this.#clock()):undefined);
   };
   const observation=(rawSession:unknown)=>{
    const s=checkoutParse(sessionSchema,rawSession),item=s.line_items.data[0]!;
    requireCheckout(s.customer===c.customer.customerId&&s.amount_subtotal===due.amountCents&&s.amount_total===due.amountCents&&item.amount_subtotal===due.amountCents&&item.amount_total===due.amountCents&&item.price.unit_amount===due.amountCents);
    const actual=Object.fromEntries(Object.keys(tags).map(key=>[key,s.metadata[key]]));requireCheckout(digest(actual)===digest(tags));
    if(known)requireCheckout(s.id===known.sessionId);
    const url=s.status==='open'&&s.payment_status==='unpaid'&&s.expires_at*1000>this.#clock().valueOf()?s.url:null;
    return validateCheckoutObservation({contextDigest:digest(c),sessionId:s.id,customerId:s.customer,status:s.status,paymentStatus:s.payment_status,amountCents:s.amount_total,expiresAt:s.expires_at,invoiceId:s.invoice,paymentIntentId:s.payment_intent,url},c,known);
   };
   if(action.phase==='create'){
    assertCheckoutCreateWindow(c,this.#clock());const claim=validateCheckoutClaim(action.claim,c,'create',this.#urls);
    const params:Stripe.Checkout.SessionCreateParams={mode:'payment',ui_mode:'hosted_page',customer:c.customer.customerId,currency:'usd',allowed_payment_method_types:['card'],
     line_items:[{quantity:1,adjustable_quantity:{enabled:false},price_data:{currency:'usd',unit_amount:due.amountCents,product_data:{name:'Academy stage payment',metadata:tags}}}],
     invoice_creation:{enabled:true,invoice_data:{metadata:tags}},payment_intent_data:{metadata:tags},metadata:tags,
     allow_promotion_codes:false,automatic_tax:{enabled:false},discounts:[],expires_at:Math.floor(Date.parse(c.expiresAt)/1000),success_url:this.#urls.successUrl,cancel_url:this.#urls.cancelUrl,expand:['line_items']};
    const created=observation(await request('POST','/v1/checkout/sessions',claim.idempotencyKey,(sdk,options)=>sdk.checkout.sessions.create(params,options)));
    requireCheckout(created.status==='open'&&created.paymentStatus==='unpaid'&&created.url);return created;
   }
   requireCheckout(known);const path=`/v1/checkout/sessions/${known.sessionId}`;
   const read=()=>request('GET',path,null,(sdk,options)=>sdk.checkout.sessions.retrieve(known.sessionId,{expand:['line_items']},options));
   // Validate separate expire decision BEFORE even a provider read. The marker
   // is not authorization: Root must consume its durable financial-owner claim.
   const closure=action.phase==='expire'?validateCheckoutClaim(action.claim,c,'expire',this.#urls,known.sessionId):null;
   const before=observation(await read());
   if(action.phase==='read'||before.status!=='open')return before;
   requireCheckout(closure&&before.paymentStatus==='unpaid');
   const expired=observation(await request('POST',path+'/expire',closure.idempotencyKey,(sdk,options)=>sdk.checkout.sessions.expire(known.sessionId,{expand:['line_items']},options)));
   requireCheckout(expired.status==='expired');
   const terminal=observation(await read());requireCheckout(terminal.status==='expired');return terminal;
  }catch{throw new StripeTestCheckoutError();}
 }
 async #request(method:'GET'|'POST',path:string,key:string|null,signal:AbortSignal,invoke:(sdk:Stripe,options:Stripe.RequestOptions)=>PromiseLike<unknown>,beforeDispatch?:()=>void):Promise<unknown>{
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),checkoutTransportBounds.requestMilliseconds),combined=AbortSignal.any([signal,deadline.signal]);let dispatched=false;
  const guarded:typeof fetch=async(input,init)=>{
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined,complete=false;
   try{
    requireCheckout(!combined.aborted&&!dispatched);dispatched=true;beforeDispatch?.();
    requireCheckout(typeof input==='string'||input instanceof URL);const url=new URL(String(input)),query=[...url.searchParams],headers=new Headers(init?.headers);
    requireCheckout(url.origin==='https://api.stripe.com'&&url.pathname===path&&!url.username&&!url.password&&!url.hash&&(init?.method??'GET').toUpperCase()===method);
    requireCheckout(method==='GET'?query.length===1&&url.searchParams.getAll('expand[0]').length===1&&url.searchParams.get('expand[0]')==='line_items'&&!init?.body:query.length===0&&key!==null&&headers.get('idempotency-key')===key);
    requireCheckout(headers.get('stripe-version')===checkoutApiVersion&&headers.get('stripe-account')===this.binding.accountId);
    const transportSignal=AbortSignal.any([combined,...(init?.signal?[init.signal]:[])]);
    response=await interrupted(fetch(input,{...init,method,redirect:'error',credentials:'omit',cache:'no-store',signal:transportSignal}),transportSignal);
    requireCheckout(response.status===200&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')&&response.body);
    const length=response.headers.get('content-length');requireCheckout(length===null||/^\d+$/.test(length)&&Number(length)<=checkoutTransportBounds.objectBytes);
    reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0,reads=0;
    for(;;){requireCheckout(++reads<=checkoutTransportBounds.objectBytes+1);const part=await interrupted(reader.read(),transportSignal);if(part.done){complete=true;break;}bytes+=part.value.byteLength;requireCheckout(bytes<=checkoutTransportBounds.objectBytes);chunks.push(part.value);}
    requireCheckout(!combined.aborted);return new Response(Buffer.concat(chunks,bytes),{status:200,headers:{'content-type':'application/json'}});
   }catch{deadline.abort();throw new StripeTestCheckoutError();}
   finally{if(reader){if(!complete)void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* Aborted read. */}}else if(response?.body&&!complete)void response.body.cancel().catch(()=>{});}
  };
  try{
   requireCheckout(!combined.aborted);const sdk=new Stripe(this.#secret,{apiVersion:checkoutApiVersion,maxNetworkRetries:0,telemetry:false,timeout:checkoutTransportBounds.requestMilliseconds,httpClient:Stripe.createFetchHttpClient(guarded)});
   return await interrupted(invoke(sdk,{apiVersion:checkoutApiVersion,stripeAccount:this.binding.accountId,maxNetworkRetries:0,timeout:checkoutTransportBounds.requestMilliseconds,...(key?{idempotencyKey:key}:{})}),combined);
  }catch{throw new StripeTestCheckoutError();}finally{clearTimeout(timer);}
 }
}
