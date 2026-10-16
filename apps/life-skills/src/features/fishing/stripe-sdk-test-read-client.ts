import "server-only";
import Stripe from "stripe";
import {z} from "zod";
import {stripeReadBounds,type StripeInvoicePaymentQuery,type StripeReadRequest,type StripeTestReadClient} from "./stripe-read-ports.ts";

export const stripeSdkTestVersion="23.0.0" as const;
export const stripeSdkTestApiVersion="2026-09-30.endive" as const;
const bindingSchema=z.strictObject({accountId:z.string().regex(/^acct_[A-Za-z0-9_]{1,150}$/),livemode:z.literal(false),
 apiVersion:z.literal(stripeSdkTestApiVersion),verifiedBindingId:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/)});
const secretSchema=z.string().regex(/^(?:sk|rk)_test_[A-Za-z0-9_]{16,256}$/);
const requestSchema=z.strictObject({object:z.enum(["event","invoice","checkout_session","payment_intent","charge","refund","balance_transaction"]),id:z.string().max(160)});
const invoiceId=z.string().regex(/^in_[A-Za-z0-9_]{1,150}$/),intentId=z.string().regex(/^pi_[A-Za-z0-9_]{1,150}$/);
const listSchema=z.union([z.strictObject({invoiceId,limit:z.literal(100)}),z.strictObject({paymentIntentId:intentId,limit:z.literal(100)})]);
const resources={event:["evt","events"],invoice:["in","invoices"],checkout_session:["cs","checkout/sessions"],
 payment_intent:["pi","payment_intents"],charge:["ch","charges"],refund:["re","refunds"],balance_transaction:["txn","balance_transactions"]} as const;

/** Fixed public failure: never retains an SDK error, key, response, URL or ID. */
export class StripeSdkTestReadError extends Error {
 readonly code="STRIPE_TEST_READ_UNAVAILABLE";
 constructor(){super("Stripe test read unavailable");this.name="StripeSdkTestReadError";}
}
const unavailable=()=>new StripeSdkTestReadError();
function assertRead(value:unknown):asserts value{if(!value)throw unavailable();}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{try{return schema.parse(value);}catch{throw unavailable();}}
function interruptible<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const aborted=()=>{signal.removeEventListener("abort",aborted);reject(unavailable());};
  if(signal.aborted){void promise.catch(()=>{});aborted();return;}
  signal.addEventListener("abort",aborted,{once:true});
  promise.then(value=>{signal.removeEventListener("abort",aborted);if(signal.aborted)reject(unavailable());else resolve(value);},()=>{signal.removeEventListener("abort",aborted);reject(unavailable());});
 });
}

/** UNMOUNTED server adapter, not merchant verification or a payment capability.
 * The owning server must independently verify the intended merchant, credential,
 * account context and API version BEFORE construction/mounting. A binding marker
 * or test-key prefix does not prove any of these. No env, DB, grant, SDK write,
 * signature ingress, account-discovery call, live-key fallback or config switch.
 *
 * The SDK serializes only the fixed read requests below. Its Fetch transport is
 * guarded before global fetch: HTTPS Stripe origin, exact expected GET/query,
 * one actual dispatch, no redirect, bounded bytes and combined cancellation.
 * Native receipt/ownership and returned financial DTO validation remain in the
 * existing resolver/normalizer, not provider metadata or this adapter.
 */
export class StripeSdkTestReadClient implements StripeTestReadClient {
 readonly #binding:StripeTestReadClient["binding"];
 readonly #secret:string;
 get binding():StripeTestReadClient["binding"]{return this.#binding;}
 constructor(secretKey:string,binding:StripeTestReadClient["binding"]){
  assertRead(Stripe.PACKAGE_VERSION===stripeSdkTestVersion&&Stripe.API_VERSION===stripeSdkTestApiVersion);
  this.#secret=parse(secretSchema,secretKey);this.#binding=Object.freeze(parse(bindingSchema,binding));
 }
 async retrieve(input:StripeReadRequest,signal:AbortSignal):Promise<unknown>{
  const request=parse(requestSchema,input),[prefix,resource]=resources[request.object];
  assertRead(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,150}$`).test(request.id));
  return this.#read(`/v1/${resource}/${request.id}`,[],signal,(sdk,options)=>{
   switch(request.object){
    case"event":return sdk.events.retrieve(request.id,{},options);
    case"invoice":return sdk.invoices.retrieve(request.id,{},options);
    case"checkout_session":return sdk.checkout.sessions.retrieve(request.id,{},options);
    case"payment_intent":return sdk.paymentIntents.retrieve(request.id,{},options);
    case"charge":return sdk.charges.retrieve(request.id,{},options);
    case"refund":return sdk.refunds.retrieve(request.id,{},options);
    case"balance_transaction":return sdk.balanceTransactions.retrieve(request.id,{},options);
   }
  });
 }
 async listInvoicePayments(input:StripeInvoicePaymentQuery,signal:AbortSignal):Promise<unknown>{
  const query=parse(listSchema,input);
  if("invoiceId"in query)return this.#read("/v1/invoice_payments",[["invoice",query.invoiceId],["limit","100"]],signal,
   (sdk,options)=>sdk.invoicePayments.list({invoice:query.invoiceId,limit:100},options));
  return this.#read("/v1/invoice_payments",[["payment[type]","payment_intent"],["payment[payment_intent]",query.paymentIntentId],["limit","100"]],signal,
   (sdk,options)=>sdk.invoicePayments.list({payment:{type:"payment_intent",payment_intent:query.paymentIntentId},limit:100},options));
 }
 async #read(expectedPath:string,expectedQuery:readonly(readonly[string,string])[],signal:AbortSignal,
  invoke:(sdk:Stripe,options:Stripe.RequestOptions)=>PromiseLike<unknown>):Promise<unknown>{
  assertRead(!signal.aborted);
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),stripeReadBounds.requestMilliseconds);
  const combined=AbortSignal.any([signal,deadline.signal]);let dispatched=false;
  const guardedFetch:typeof fetch=async(input,init)=>{
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined,complete=false;
   try{
    assertRead(!dispatched&&!combined.aborted);dispatched=true;
    assertRead(typeof input==="string"||input instanceof URL);
    const url=new URL(String(input));
    assertRead(url.origin==="https://api.stripe.com"&&!url.username&&!url.password&&!url.hash&&url.pathname===expectedPath);
    assertRead((init?.method??"GET").toUpperCase()==="GET"&&(!init?.body||init.body===""));
    const actual=[...url.searchParams];assertRead(actual.length===expectedQuery.length&&expectedQuery.every(([k,v])=>url.searchParams.getAll(k).length===1&&url.searchParams.get(k)===v));
    const transportSignal=AbortSignal.any([combined,...(init?.signal?[init.signal]:[])]);
    response=await interruptible(fetch(input,{...init,method:"GET",redirect:"error",credentials:"omit",cache:"no-store",signal:transportSignal}),transportSignal);
    assertRead(response.status===200&&/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")??""));
    const length=response.headers.get("content-length");assertRead(length===null||/^\d+$/.test(length)&&Number(length)<=stripeReadBounds.objectBytes);
    assertRead(response.body);reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
    for(;;){const part=await interruptible(reader.read(),transportSignal);if(part.done){complete=true;break;}
     size+=part.value.byteLength;assertRead(size<=stripeReadBounds.objectBytes);chunks.push(part.value);
    }
    assertRead(!transportSignal.aborted);
    // SDK must not receive upstream response headers/cookies/request metadata.
    return new Response(Buffer.concat(chunks,size),{status:200,headers:{"content-type":"application/json"}});
   }catch{deadline.abort();throw unavailable();}
   finally{if(reader){if(!complete)void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* Pending read is already aborted/cancelled. */}}
    else if(response?.body&&!complete)void response.body.cancel().catch(()=>{});}
  };
  try{
   const sdk=new Stripe(this.#secret,{apiVersion:stripeSdkTestApiVersion,maxNetworkRetries:0,timeout:stripeReadBounds.requestMilliseconds,
    telemetry:false,httpClient:Stripe.createFetchHttpClient(guardedFetch)});
   const raw=await interruptible(Promise.resolve(invoke(sdk,{stripeAccount:this.binding.accountId,apiVersion:stripeSdkTestApiVersion,maxNetworkRetries:0,timeout:stripeReadBounds.requestMilliseconds})),combined);
   assertRead(raw&&typeof raw==="object"&&!Array.isArray(raw)&&Object.getPrototypeOf(raw)===Object.prototype);
   const descriptors=Object.getOwnPropertyDescriptors(raw),result:Record<string,unknown>={};
   for(const[key,descriptor]of Object.entries(descriptors)){
    if(key==="lastResponse"&&!descriptor.enumerable)continue;
    assertRead("value"in descriptor&&descriptor.enumerable);Object.defineProperty(result,key,{value:descriptor.value,enumerable:true,writable:true,configurable:true});
   }
   assertRead(!combined.aborted);return result;
  }catch{throw unavailable();}finally{clearTimeout(timer);}
 }
}
