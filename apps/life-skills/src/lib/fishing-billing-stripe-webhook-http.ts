import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.ts';
import {failureResponse,successResponse} from './http/json.ts';
import {canonicalForwardedRequest} from '../features/integration/canonical-forwarded-request.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from './security/rate-limit.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from '../features/fishing-billing/card-binding.ts';
import {verifyBillingStripeTestEvent,billingStripeSignedReceiptSchema,type FishingBillingStripeInbox} from '../features/fishing-billing/stripe-test.ts';
import {verifyStripeTestWebhookReceipt} from './fishing-stripe-test-verifier.ts';

export const FISHING_BILLING_TEST_WEBHOOK_PATH='/api/webhooks/fishing-billing/stripe-test';
export type FishingBillingTestWebhookDeps={
 origin:string;binding:BillingStripeBinding;endpointSecret:string;now:()=>Date;
 /** Current server-owned endpoint/account/secret/target/schema/service admission.
  * No owner session, provider metadata or HTTP input can supply this grant. */
 admit:()=>Promise<void>;limits:RateLimitStore;rateLimitKey:string;
 inbox:Pick<FishingBillingStripeInbox,'ingest'>;
};
const maxBytes=131072,deadlineMs=10000;

/** Unmounted direct-account TEST intake only. The existing official SDK checks
 * exact raw bytes; the native inbox independently authorizes and commits a
 * deduplicated minimal receipt. A successful response means durable intake,
 * never payment, reconciliation, delivery or a newly enabled runtime. */
export async function fishingBillingTestWebhookHttp(request:Request,load:()=>Promise<FishingBillingTestWebhookDeps>):Promise<Response>{
 const requestId=randomUUID(),end=Date.now()+deadlineMs;
 let response:Response,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const bounded=async<T>(work:()=>Promise<T>):Promise<T>=>{
  const remaining=end-Date.now();if(remaining<=0||request.signal.aborted)throw new AppError('UNAVAILABLE');
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  try{
   const deadline=new Promise<never>((_,reject)=>{
   const fail=()=>reject(new AppError('UNAVAILABLE'));timer=setTimeout(fail,remaining);abort=fail;request.signal.addEventListener('abort',fail,{once:true});
   });
   const result=await Promise.race([work(),deadline]);
   if(Date.now()>=end||request.signal.aborted)throw new AppError('UNAVAILABLE');return result;
  }finally{if(timer)clearTimeout(timer);if(abort)request.signal.removeEventListener('abort',abort);}
 };
 try{
  if(request.method!=='POST')throw new AppError('INVALID_REQUEST');
  const rawUrl=new URL(request.url);
  if(rawUrl.pathname!==FISHING_BILLING_TEST_WEBHOOK_PATH||rawUrl.search||rawUrl.hash)throw new AppError('NOT_FOUND');
  if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new AppError('UNSUPPORTED_MEDIA_TYPE');
  if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')throw new AppError('INVALID_REQUEST');
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^(0|[1-9][0-9]{0,8})$/.test(declared)||Number(declared)>maxBytes))throw new AppError('PAYLOAD_TOO_LARGE');
  const signature=request.headers.get('stripe-signature');
  if(!signature||signature.length>2048||!request.body)throw new AppError('INVALID_REQUEST');
  const supplied=await bounded(load);
  const binding=billingStripeBindingSchema.parse(supplied.binding);
  const d={origin:supplied.origin,endpointSecret:supplied.endpointSecret,now:supplied.now,admit:supplied.admit,
   limits:supplied.limits,rateLimitKey:supplied.rateLimitKey,ingest:supplied.inbox.ingest.bind(supplied.inbox)};
  const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==FISHING_BILLING_TEST_WEBHOOK_PATH||url.search)throw new AppError('NOT_FOUND');
  if(!/^whsec_[A-Za-z0-9_]{16,250}$/.test(d.endpointSecret))throw new AppError('UNAVAILABLE');
  await bounded(()=>d.admit());
  // One bounded service counter. Caller-controlled forwarded addresses cannot
  // create unlimited buckets; a later mount must retain edge request limits.
  await bounded(()=>enforceRateLimit(d.limits,opaqueRateLimitKey('fishing-billing-test-webhook:'+binding.verifiedBindingId,d.rateLimitKey),120,60000));
  reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0,reads=0;
  while(true){
   const part=await bounded(()=>reader!.read());if(part.done)break;
   if(++reads>4096||size+part.value.byteLength>maxBytes)throw new AppError('PAYLOAD_TOO_LARGE');
   chunks.push(Uint8Array.from(part.value));size+=part.value.byteLength;
  }
  if(!size||declared!==null&&size!==Number(declared))throw new AppError('INVALID_REQUEST');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let capability,eventId='';
  try{
   capability=verifyBillingStripeTestEvent({rawBody:bytes,signatureHeader:signature,binding,now:d.now(),sdk:{
    verify:(rawBody,signatureHeader,now)=>{
     const verified=verifyStripeTestWebhookReceipt({rawBody,signatureHeader,endpointSecret:d.endpointSecret,
      binding:{endpoint:'direct',accountId:binding.accountId,livemode:false,apiVersion:binding.apiVersion},clock:{now:()=>now}});
     const receipt=billingStripeSignedReceiptSchema.parse(verified.receipt);eventId=receipt.eventId;return {kind:verified.kind,receipt};
    },
   }});
  }catch{throw new AppError('INVALID_REQUEST');}
  await bounded(()=>d.admit());
  // No automatic retry after timeout/unknown commit. A provider replay carries
  // the SAME signed event identity; the inbox owns atomic replay/conflict checks.
  const saved=await bounded(()=>d.ingest(capability));
  if(saved.received!==true||saved.processed!==false||typeof saved.replayed!=='boolean'||saved.eventId!==eventId)throw new AppError('UNAVAILABLE');
  response=successResponse({received:true,processed:false,replayed:saved.replayed},requestId,202);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 finally{if(reader){void reader.cancel().catch(()=>undefined);reader.releaseLock();}}
 response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
