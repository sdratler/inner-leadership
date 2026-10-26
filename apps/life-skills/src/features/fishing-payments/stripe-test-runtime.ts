import "server-only";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import type {StripeTestWebhookEndpoint} from "./stripe-test-webhook-receipt.ts";
import type {StripeTestInbox} from "./stripe-test-inbox.ts";
import {stripeTestWebhookEnabled} from "./stripe-test-gate.ts";
import {stripeTestWebhookHttp} from "./stripe-test-webhook-http.ts";

export type StripeTestWebhookRuntime=Readonly<{
 inbox:Pick<StripeTestInbox,"acceptStripeTest">;
 endpoint:StripeTestWebhookEndpoint;
 merchant:Readonly<{accountId:string;livemode:boolean;apiVersion:string;verifiedBindingId:string}>;
 admission:Readonly<{id:string;origin:string;accountId:string;endpoint:"direct"|"connected";livemode:false;apiVersion:"2026-09-30.endive"}>;
}>;
const apiVersion="2026-09-30.endive",opaque=/^[A-Za-z0-9_.:-]{1,160}$/,account=/^acct_[A-Za-z0-9_]{1,150}$/;
function denied(status:503|405=503){return new Response(JSON.stringify({received:false,error:status===405?"METHOD_NOT_ALLOWED":"UNAVAILABLE"}),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",...(status===405?{Allow:"POST"}:{})}});}
/** Configuration alone cannot admit a runtime. The server loader independently
 * verifies the sandbox account/mode and restricted native inbox before use. */
async function loadDefault():Promise<StripeTestWebhookRuntime>{
 const {loadStripeTestRuntime}=await import("./stripe-test-server.ts");
 return loadStripeTestRuntime();
}
function matched(runtime:StripeTestWebhookRuntime,origin:string):boolean{
 const {inbox,endpoint,merchant,admission}=runtime;
 return !!inbox&&typeof inbox.acceptStripeTest==="function"&&!!endpoint&&!!merchant&&!!admission&&
  typeof admission.id==="string"&&opaque.test(admission.id)&&admission.origin===origin&&
  typeof endpoint.accountId==="string"&&account.test(endpoint.accountId)&&
  (endpoint.endpoint==="direct"||endpoint.endpoint==="connected")&&
  endpoint.livemode===false&&merchant.livemode===false&&admission.livemode===false&&
  endpoint.apiVersion===apiVersion&&merchant.apiVersion===apiVersion&&admission.apiVersion===apiVersion&&
  endpoint.accountId===merchant.accountId&&endpoint.accountId===admission.accountId&&endpoint.endpoint===admission.endpoint&&
  typeof merchant.verifiedBindingId==="string"&&opaque.test(merchant.verifiedBindingId);
}
/** Server composition only. A successful response means minimal inbox commit,
 * never processing/allocation/payment/enrollment. Request fields cannot select
 * runtime, merchant, endpoint, workspace, principal or an admission record. */
export async function handleStripeTestWebhook(request:Request,load:()=>Promise<StripeTestWebhookRuntime>=loadDefault,environment:Readonly<Record<string,string|undefined>>=process.env):Promise<Response>{
 try{
  const url=new URL(request.url);
  if(!stripeTestWebhookEnabled(url.pathname,environment))return denied();
  if(request.method!=="POST")return denied(405);
  if(url.search||url.hash||url.username||url.password)return denied();
  const origin=environment.LS_STRIPE_TEST_WEBHOOK_ORIGIN!,host=request.headers.get("host");
  if(host!==null&&(!host.trim()||host.includes(",")))return denied();
  if(request.headers.has("x-forwarded-proto")||request.headers.has("x-forwarded-host")){
   // Validate forwarding using a bodyless probe. Cloning/teeing a hostile POST
   // stream here could pull bytes before configuration is authorized.
   canonicalForwardedRequest(new Request(url,{headers:request.headers}),origin);
  }else if(url.origin!==origin||(host??url.host).trim().toLowerCase()!==new URL(origin).host.toLowerCase())return denied();
  const runtime=await load();if(!matched(runtime,origin))return denied();
  return await stripeTestWebhookHttp(request,async(raw,signature)=>{await runtime.inbox.acceptStripeTest(raw,signature);});
 }catch{return denied();}
}
