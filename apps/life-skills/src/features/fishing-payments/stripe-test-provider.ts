import "server-only";
import Stripe from "stripe";

export const stripeTestApiVersion="2026-09-30.endive" as const;
export const stripeTestSdkVersion="23.0.0";
export type StripeTestAccountProof=Readonly<{accountId:string;livemode:false;apiVersion:typeof stripeTestApiVersion}>;
const fail=()=>new Error("STRIPE_TEST_ACCOUNT_UNAVAILABLE");
function interruptible<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const aborted=()=>{signal.removeEventListener('abort',aborted);reject(fail());};
  if(signal.aborted){void pending.catch(()=>{});aborted();return;}
  signal.addEventListener('abort',aborted,{once:true});
  pending.then(value=>{signal.removeEventListener('abort',aborted);if(signal.aborted)reject(fail());else resolve(value);},()=>{signal.removeEventListener('abort',aborted);reject(fail());});
 });
}
/** Two bounded GETs only. Account identity and balance livemode independently
 * establish the selected sandbox; a key prefix or owner marker is insufficient.
 * Responses, keys, balances, SDK causes and customer data are never returned.
 */
export async function verifyStripeTestAccount(key:string,expectedAccountId:string):Promise<StripeTestAccountProof>{
 if(!/^(?:sk|rk)_test_[A-Za-z0-9_]{16,256}$/.test(key)||!/^acct_[A-Za-z0-9_]{1,150}$/.test(expectedAccountId)||Stripe.PACKAGE_VERSION!==stripeTestSdkVersion||Stripe.API_VERSION!==stripeTestApiVersion)throw fail();
 let calls=0;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 const guardedFetch:typeof fetch=async(input,init)=>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   if(typeof input!=="string"&&!(input instanceof URL))throw fail();const url=new URL(String(input));
   const path=calls===0?"/v1/account":"/v1/balance";
   if(++calls>2||controller.signal.aborted||url.origin!=="https://api.stripe.com"||url.pathname!==path||url.search||url.hash||url.username||url.password||(init?.method??"GET").toUpperCase()!=="GET"||init?.body)throw fail();
   const signal=AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])]);
   const result=await interruptible(fetch(input,{...init,method:"GET",redirect:"error",credentials:"omit",cache:"no-store",signal}),signal);
   if(result.status!==200||!/^application\/json(?:\s*;|$)/i.test(result.headers.get("content-type")??"")||!result.body)throw fail();
   reader=result.body.getReader();let size=0,reads=0;const chunks:Uint8Array[]=[];
   for(;;){if(++reads>131073)throw fail();const part=await interruptible(reader.read(),signal);if(part.done)break;size+=part.value.byteLength;if(size>131072||signal.aborted)throw fail();chunks.push(part.value);}
   return new Response(Buffer.concat(chunks,size),{status:200,headers:{"content-type":"application/json"}});
  }catch{throw fail();}finally{try{void reader?.cancel().catch(()=>{});}catch{}try{reader?.releaseLock();}catch{}}
 };
 try{
  const sdk=new Stripe(key,{apiVersion:stripeTestApiVersion,timeout:5000,maxNetworkRetries:0,httpClient:Stripe.createFetchHttpClient(guardedFetch)});
  const account=await sdk.accounts.retrieve(null);if(account.object!=="account"||account.id!==expectedAccountId)throw fail();
  const balance=await sdk.balance.retrieve();if(balance.object!=="balance"||balance.livemode!==false||calls!==2||controller.signal.aborted)throw fail();
  return Object.freeze({accountId:account.id,livemode:false,apiVersion:stripeTestApiVersion});
 }catch{throw fail();}finally{clearTimeout(timer);}
}
