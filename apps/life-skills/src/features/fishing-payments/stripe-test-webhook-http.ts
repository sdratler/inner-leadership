import "server-only";
import {StripeTestWebhookReceiptError} from "./stripe-test-webhook-receipt.ts";

/** Server-owned SDK verification + minimal durable commit, never allocation.
 * Resolve only after commit; reject on verification/configuration/commit failure.
 * Root wraps its existing acceptStripeTest; this is not a credential or identity.
 */
export type StripeTestWebhookDurableAcceptor=(rawBody:Uint8Array,signatureHeader:string)=>Promise<void>;

const bodyLimit=131072,signatureLimit=2048,bodyMilliseconds=5000,acceptMilliseconds=10000;
class HttpFailure extends Error {
 constructor(readonly status:408|413|415|503){super("Stripe test HTTP unavailable");}
}
function invalid():never{throw new StripeTestWebhookReceiptError();}
function response(status:number):Response{
 const code=status===400?"INVALID_REQUEST":status===405?"METHOD_NOT_ALLOWED":status===408?"REQUEST_TIMEOUT":status===413?"PAYLOAD_TOO_LARGE":status===415?"UNSUPPORTED_MEDIA_TYPE":"UNAVAILABLE";
 return new Response(status===200?'{"received":true}':`{"received":false,"error":"${code}"}`,{status,headers:{
  "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
  ...(status===405?{Allow:"POST"}:{}),
 }});
}
/** No await: a hostile/stalled underlying cancellation must not hold the reply. */
function discard(stream:ReadableStream<Uint8Array>|null){
 try{if(stream&&!stream.locked)void stream.cancel().catch(()=>{});}catch{/* Fixed response only. */}
}
async function bounded<T>(pending:Promise<T>,signal:AbortSignal,milliseconds:number,status:408|503):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 let abort=()=>{};
 const interruption=new Promise<never>((_resolve,reject)=>{
  abort=()=>reject(status===408?new StripeTestWebhookReceiptError():new HttpFailure(503));
  timer=setTimeout(()=>reject(new HttpFailure(status)),milliseconds);
  signal.addEventListener("abort",abort,{once:true});
  if(signal.aborted)abort();
 });
 try{return await Promise.race([pending,interruption]);}
 finally{clearTimeout(timer);signal.removeEventListener("abort",abort);}
}
async function originalBytes(request:Request,declared:number|null):Promise<Uint8Array>{
 if(!request.body||request.bodyUsed||request.signal.aborted)invalid();
 let reader:ReadableStreamDefaultReader<Uint8Array>;
 try{reader=request.body.getReader();}catch{invalid();}
 let stopped=false,complete=false;
 const read=async()=>{
  // Fixed allocation; oversized chunks are rejected before copying.
  const output=new Uint8Array(bodyLimit);let size=0,reads=0;
  for(;;){
   if(++reads>bodyLimit+1)invalid(); // Also bounds endless zero-byte chunks.
   const part=await reader.read();
   if(stopped||request.signal.aborted)invalid();
   if(part.done){complete=true;break;}
   if(!(part.value instanceof Uint8Array)||part.value.buffer instanceof SharedArrayBuffer)invalid();
   if(part.value.byteLength>bodyLimit-size)throw new HttpFailure(413);
   if(declared!==null&&part.value.byteLength>declared-size)invalid();
   output.set(part.value,size);size+=part.value.byteLength;
  }
  if(size===0||declared!==null&&size!==declared)invalid();
  return output.slice(0,size);
 };
 try{return await bounded(read(),request.signal,bodyMilliseconds,408);}
 catch(error){if(error instanceof HttpFailure||error instanceof StripeTestWebhookReceiptError)throw error;return invalid();}
 finally{
  stopped=true;
  if(!complete){try{void reader.cancel().catch(()=>{});}catch{/* Do not retain source errors. */}}
  try{reader.releaseLock();}catch{/* An interrupted read may still be settling. */}
 }
}

/** UNMOUNTED test-only HTTP boundary. No route/path, environment, secret, Actor,
 * provider read/write, native mapping, ledger allocation or merchant discovery.
 * Body deadline: 5s; acceptance deadline: 10s. An acceptance timeout/abort is
 * UNKNOWN: the server capability may still commit; replay must use its existing
 * durable idempotency. This adapter never retries, deduplicates or invents cash.
 */
export async function stripeTestWebhookHttp(request:Request,accept:StripeTestWebhookDurableAcceptor):Promise<Response>{
 try{
  if(request.method!=="POST")return response(405);
  if(typeof accept!=="function")throw new HttpFailure(503);
  if(request.signal.aborted)invalid();
  const contentType=request.headers.get("content-type"),encoding=request.headers.get("content-encoding");
  if(!contentType||contentType.length>128||!/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?[ \t]*$/i.test(contentType)||encoding!==null&&encoding.toLowerCase()!=="identity")throw new HttpFailure(415);
  const header=request.headers.get("stripe-signature");
  if(!header||header.length>signatureLimit||!/^[\x21-\x7e]+$/.test(header))invalid();
  // Signature grammar and cryptography remain with the actual SDK acceptor.
  const length=request.headers.get("content-length");let declared:number|null=null;
  if(length!==null){
   if(!/^(?:0|[1-9][0-9]*)$/.test(length))invalid();
   if(length.length>6||Number(length)>bodyLimit)throw new HttpFailure(413);
   declared=Number(length);if(declared===0)invalid();
  }
  const raw=await originalBytes(request,declared);
  if(request.signal.aborted)invalid();
  const committed=accept(raw,header);
  if(!committed||typeof committed.then!=="function")throw new HttpFailure(503);
  await bounded(committed,request.signal,acceptMilliseconds,503);
  if(request.signal.aborted)throw new HttpFailure(503);
  return response(200);
 }catch(error){
  return response(error instanceof StripeTestWebhookReceiptError?400:error instanceof HttpFailure?error.status:503);
 }finally{discard(request.body);}
}
