import {createHash} from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import Stripe from "stripe";
import {afterAll,afterEach,beforeAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {stripeTestWebhookHttp,type StripeTestWebhookDurableAcceptor} from "../../../src/features/fishing-payments/stripe-test-webhook-http.ts";
import {verifyStripeTestWebhookReceipt} from "../../../src/features/fishing-payments/stripe-test-webhook-receipt.ts";

const NOW=Date.parse("2026-10-17T12:00:00Z");
const SECRET="whsec_SYNTHETIC_ONLY_HTTP1074_no_endpoint_access";
const CANARY="SYNTHETIC_PRIVATE_contact_é_😀_HTTP1074";
const EVENT={id:"evt_SYNTHETIC_HTTP1074",object:"event",type:"invoice.paid",livemode:false,api_version:"2026-09-30.endive",created:NOW/1000-60,data:{object:{id:"in_SYNTHETIC_HTTP1074",object:"invoice",private:CANARY}}};
const RAW=Buffer.from(" \n"+JSON.stringify(EVENT,null,2)+" \n");
const SIGNATURE=Stripe.webhooks.generateTestHeaderString({payload:RAW.toString("utf8"),secret:SECRET,timestamp:NOW/1000});
const noNetwork=vi.fn(()=>{throw Error("UNEXPECTED_NETWORK_ATTEMPT");});
beforeAll(()=>{
 vi.stubGlobal("fetch",noNetwork);vi.stubGlobal("WebSocket",noNetwork);
 vi.spyOn(http,"request").mockImplementation(noNetwork);vi.spyOn(http,"get").mockImplementation(noNetwork);
 vi.spyOn(https,"request").mockImplementation(noNetwork);vi.spyOn(https,"get").mockImplementation(noNetwork);
 vi.spyOn(net,"connect").mockImplementation(noNetwork);vi.spyOn(net,"createConnection").mockImplementation(noNetwork);
 vi.spyOn(net.Socket.prototype,"connect").mockImplementation(noNetwork);
 vi.spyOn(tls,"connect").mockImplementation(noNetwork);vi.spyOn(dgram,"createSocket").mockImplementation(noNetwork);
});
afterEach(()=>{vi.useRealTimers();expect(noNetwork).not.toHaveBeenCalled();});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

function request(body:BodyInit|null=RAW,fields:Record<string,string>={},options:RequestInit={}):Request{
 const init:RequestInit&{duplex:"half"}={...options,method:options.method??"POST",body,headers:{"content-type":"application/json","stripe-signature":SIGNATURE,...fields},duplex:"half"};
 return new Request("https://unmounted.invalid/arbitrary-path",init);
}
function durable(){return vi.fn<StripeTestWebhookDurableAcceptor>(async(raw,header)=>{
 const proof=verifyStripeTestWebhookReceipt({rawBody:raw,signatureHeader:header,endpointSecret:SECRET,
  binding:{endpoint:"direct",accountId:"acct_SYNTHETIC_HTTP1074",livemode:false,apiVersion:"2026-09-30.endive"},clock:{now:()=>new Date(NOW)}});
 expect(proof.receipt.digest).toBe(createHash("sha256").update(raw).digest("hex"));
 // Offline capability stand-in, not a database commit or native allocation.
});}
function chunks(parts:Uint8Array[],cancel=vi.fn()){
 let index=0;
 return new ReadableStream<Uint8Array>({pull(controller){if(index<parts.length)controller.enqueue(parts[index++]!);else controller.close();},cancel},{highWaterMark:0});
}
function gate(){let resolve!:()=>void,reject!:(error:unknown)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function called(fn:ReturnType<typeof vi.fn>){for(let i=0;i<40&&fn.mock.calls.length===0;i++)await Promise.resolve();expect(fn).toHaveBeenCalledTimes(1);}
async function rejected(r:Request,status:number){const accept=durable(),result=await stripeTestWebhookHttp(r,accept);expect(result.status).toBe(status);expect(accept).not.toHaveBeenCalled();expect(await result.text()).not.toContain(CANARY);return result;}

test("original bytes including whitespace and split UTF-8 reach the real SDK acceptor unchanged",async()=>{
 const cut=RAW.indexOf(Buffer.from("é"))+1,padding=Buffer.concat([Buffer.from("unused"),RAW,Buffer.from("unused")]),view=padding.subarray(6,6+RAW.length);
 const accept=durable(),sdk=vi.spyOn(Stripe.webhooks,"constructEvent");
 try{
  const result=await stripeTestWebhookHttp(request(chunks([view.subarray(0,cut),view.subarray(cut)]),{"content-length":String(RAW.length)}),accept);
  expect(result.status).toBe(200);expect(await result.json()).toEqual({received:true});
  expect(accept).toHaveBeenCalledTimes(1);expect(Buffer.from(accept.mock.calls[0]![0])).toEqual(RAW);expect(accept.mock.calls[0]![1]).toBe(SIGNATURE);
  expect(sdk).toHaveBeenCalledExactlyOnceWith(RAW,SIGNATURE,SECRET,300,undefined,NOW);
  expect(result.headers.get("cache-control")).toBe("no-store");expect(result.headers.get("x-content-type-options")).toBe("nosniff");
 }finally{sdk.mockRestore();}
});

test.each(["application/json","application/json; charset=utf-8","Application/JSON; Charset=\"UTF-8\""])("supported JSON content type %s",async contentType=>{
 expect((await stripeTestWebhookHttp(request(RAW,{"content-type":contentType}),durable())).status).toBe(200);
});
test("signature header uses case-insensitive HTTP lookup without rewriting its value",async()=>{
 const r=request();r.headers.delete("stripe-signature");r.headers.set("StRiPe-SiGnAtUrE",SIGNATURE);const accept=durable();expect((await stripeTestWebhookHttp(r,accept)).status).toBe(200);expect(accept.mock.calls[0]![1]).toBe(SIGNATURE);
});
test("identity content encoding is accepted without decoding or rewriting",async()=>{
 expect((await stripeTestWebhookHttp(request(RAW,{"content-encoding":"identity"}),durable())).status).toBe(200);
});
test.each(["GET","HEAD","PUT","PATCH","DELETE","OPTIONS"])("rejects %s without intake",async method=>{
 const result=await rejected(request(method==="GET"||method==="HEAD"?null:RAW,{}, {method}),405);expect(result.headers.get("allow")).toBe("POST");
});
test.each(["text/plain","application/x-www-form-urlencoded","application/json; charset=iso-8859-1","application/json; other=value","application/json, application/json"])("rejects unsupported media type %s",async type=>{await rejected(request(RAW,{"content-type":type}),415);});
test("rejects absent content type",async()=>{const r=request();r.headers.delete("content-type");await rejected(r,415);});
test.each(["gzip","br","deflate","identity,gzip"])("rejects content encoding %s without decompression",async encoding=>{await rejected(request(RAW,{"content-encoding":encoding}),415);});
test.each(["0","-1","01","1.5","1e3","+1","1,1"])("rejects invalid or empty declared content length %s",async length=>{await rejected(request(RAW,{"content-length":length}),400);});
test.each(["131073","9999999999999999999999999999"])("declared overflow %s cancels before reading or intake",async length=>{
 const cancel=vi.fn(),read=vi.fn();const body=new ReadableStream<Uint8Array>({pull:read,cancel},{highWaterMark:0});await rejected(request(body,{"content-length":length}),413);expect(read).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledTimes(1);
});
test.each([-1,1])("rejects declared/actual length mismatch %s",async delta=>{await rejected(request(RAW,{"content-length":String(RAW.length+delta)}),400);});
test.each([false,true])("exact 128KiB byte bound works, declared=%s",async declared=>{
 const raw=new Uint8Array(131072).fill(65),accept=vi.fn<StripeTestWebhookDurableAcceptor>(async()=>{});
 const result=await stripeTestWebhookHttp(request(chunks([raw.subarray(0,1),raw.subarray(1,65536),raw.subarray(65536)]),declared?{"content-length":"131072"}:{}),accept);
 expect(result.status).toBe(200);expect(accept).toHaveBeenCalledTimes(1);expect(accept.mock.calls[0]![0]).toEqual(raw);
});
test.each([false,true])("streamed overflow is rejected and cancelled, singleChunk=%s",async single=>{
 const cancel=vi.fn(),raw=new Uint8Array(131073);await rejected(request(chunks(single?[raw]:[raw.subarray(0,131072),raw.subarray(131072)],cancel)),413);expect(cancel).toHaveBeenCalledTimes(1);
});
test("does not await a stalled cancellation after overflow",async()=>{
 const cancel=vi.fn(()=>new Promise<void>(()=>{}));await rejected(request(chunks([new Uint8Array(131073)],cancel)),413);expect(cancel).toHaveBeenCalledTimes(1);
});
test.each([null,""])("missing or empty body %s cannot be acknowledged",async body=>{await rejected(request(body),400);});
test("a consumed request cannot be read or accepted again",async()=>{const r=request();await r.arrayBuffer();await rejected(r,400);});
test("an already-locked body is rejected",async()=>{const r=request(),reader=r.body!.getReader();try{await rejected(r,400);}finally{await reader.cancel();reader.releaseLock();}});
test.each(["","é","x".repeat(2049)])("invalid HTTP signature header length/encoding (%s)",async value=>{await rejected(request(RAW,{"stripe-signature":value}),400);});
test("missing signature is rejected before body reading",async()=>{const read=vi.fn(),cancel=vi.fn(),r=request(new ReadableStream({pull:read,cancel},{highWaterMark:0}));r.headers.delete("stripe-signature");await rejected(r,400);expect(read).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledTimes(1);});
test("maximum HTTP header length delegates verification to the server capability",async()=>{
 const accept=vi.fn<StripeTestWebhookDurableAcceptor>(async()=>{}),header="x".repeat(2048);expect((await stripeTestWebhookHttp(request(RAW,{"stripe-signature":header}),accept)).status).toBe(200);expect(accept.mock.calls[0]![1]).toBe(header);
});
test.each(["not-a-signature",`t=${NOW/1000},v1=${"0".repeat(64)}`])("actual SDK rejection creates no success acknowledgment (%s)",async header=>{
 const accept=durable(),result=await stripeTestWebhookHttp(request(RAW,{"stripe-signature":header}),accept);expect(result.status).toBe(400);expect(accept).toHaveBeenCalledTimes(1);expect(await result.json()).toEqual({received:false,error:"INVALID_REQUEST"});
});
test("tampered original bytes are rejected by the injected actual verifier",async()=>{
 const accept=durable(),raw=Buffer.from(RAW);raw[raw.indexOf(Buffer.from("invoice.paid"))]=0x78;expect((await stripeTestWebhookHttp(request(raw),accept)).status).toBe(400);
});
test("an already-aborted request never enters intake",async()=>{const controller=new AbortController();controller.abort(CANARY);await rejected(request(RAW,{}, {signal:controller.signal}),400);});
test("abort during a pending body read cancels and returns a fixed error",async()=>{
 const controller=new AbortController(),cancel=vi.fn(),accept=durable();const result=stripeTestWebhookHttp(request(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0}),{}, {signal:controller.signal}),accept);controller.abort(CANARY);expect((await result).status).toBe(400);expect(accept).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledTimes(1);
});
test("a stalled stream has a five-second deadline even when cancellation stalls",async()=>{
 vi.useFakeTimers();const cancel=vi.fn(()=>new Promise<void>(()=>{})),accept=durable(),result=stripeTestWebhookHttp(request(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0})),accept);await vi.advanceTimersByTimeAsync(5001);expect((await result).status).toBe(408);expect(accept).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
test("a body stream error is rejected without echoing its cause",async()=>{
 const r=request(new ReadableStream<Uint8Array>({start(c){c.error(new Error(CANARY));}}));await rejected(r,400);
});
test("malformed stream chunk types are rejected",async()=>{
 const body=new ReadableStream<Uint8Array>({start(c){Reflect.apply(c.enqueue,c,[CANARY]);c.close();}});await rejected(request(body),400);
});
test("shared-buffer chunks cannot bypass the existing verifier's byte policy",async()=>{await rejected(request(chunks([new Uint8Array(new SharedArrayBuffer(10))])),400);});
test("bounded empty chunks can precede a valid body",async()=>{
 expect((await stripeTestWebhookHttp(request(chunks([new Uint8Array(),RAW])),durable())).status).toBe(200);
});
test("endless zero-byte chunks are bounded even without timer progress",async()=>{
 let reads=0;const r=request(new ReadableStream<Uint8Array>({pull(c){reads++;c.enqueue(new Uint8Array());}},{highWaterMark:0}));await rejected(r,400);expect(reads).toBeLessThanOrEqual(131073);
});
test("no early 200 while durable acceptance is pending",async()=>{
 const commit=gate(),accept=vi.fn<StripeTestWebhookDurableAcceptor>(()=>commit.promise);let completed=false;
 const result=stripeTestWebhookHttp(request(),accept).then(r=>{completed=true;return r;});await called(accept);expect(completed).toBe(false);commit.resolve();expect((await result).status).toBe(200);
});
test.each(["database","configuration","commit","unknown outcome"])("unknown %s failure is a retryable fixed 503",async failure=>{
 const accept=vi.fn<StripeTestWebhookDurableAcceptor>(async()=>{throw new Error(CANARY+failure,{cause:SECRET+SIGNATURE});});const result=await stripeTestWebhookHttp(request(),accept);expect(result.status).toBe(503);expect(await result.text()).toBe('{"received":false,"error":"UNAVAILABLE"}');
});
test("acceptance deadline returns 503 while a late commit remains UNKNOWN",async()=>{
 vi.useFakeTimers();const commit=gate(),accept=vi.fn<StripeTestWebhookDurableAcceptor>(()=>commit.promise),result=stripeTestWebhookHttp(request(),accept);await called(accept);await vi.advanceTimersByTimeAsync(10001);expect((await result).status).toBe(503);commit.resolve();await Promise.resolve();expect(accept).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
test("a late rejection after the acceptance deadline remains handled",async()=>{
 vi.useFakeTimers();const commit=gate(),accept=vi.fn<StripeTestWebhookDurableAcceptor>(()=>commit.promise),result=stripeTestWebhookHttp(request(),accept);await called(accept);await vi.advanceTimersByTimeAsync(10001);expect((await result).status).toBe(503);commit.reject(new Error(CANARY));await Promise.resolve();
});
test("abort during acceptance returns 503 without retrying a possibly committed operation",async()=>{
 const controller=new AbortController(),commit=gate(),accept=vi.fn<StripeTestWebhookDurableAcceptor>(()=>commit.promise),result=stripeTestWebhookHttp(request(RAW,{}, {signal:controller.signal}),accept);await called(accept);controller.abort(CANARY);expect((await result).status).toBe(503);commit.resolve();expect(accept).toHaveBeenCalledTimes(1);
});
test("a non-Promise capability result fails closed",async()=>{
 const result=await Reflect.apply(stripeTestWebhookHttp,undefined,[request(),()=>undefined]);expect(result.status).toBe(503);
});
test("an absent server capability fails closed without consumption",async()=>{
 const r=request(),result=await Reflect.apply(stripeTestWebhookHttp,undefined,[r,undefined]);expect(result.status).toBe(503);expect(r.bodyUsed).toBe(true);
});
test("replay delegates both deliveries to the same acceptor without HTTP-layer deduplication",async()=>{
 const accept=durable();for(let i=0;i<2;i++)expect((await stripeTestWebhookHttp(request(),accept)).status).toBe(200);
 expect(accept).toHaveBeenCalledTimes(2);expect(accept.mock.calls[0]![0]).not.toBe(accept.mock.calls[1]![0]);expect(accept.mock.calls[0]![0]).toEqual(accept.mock.calls[1]![0]);expect(accept.mock.calls[0]![1]).toBe(SIGNATURE);expect(accept.mock.calls[1]![1]).toBe(SIGNATURE);
});
test("error responses and logs never expose request, signature or capability failure detail",async()=>{
 const error=vi.spyOn(console,"error"),warn=vi.spyOn(console,"warn"),log=vi.spyOn(console,"log");
 try{const result=await stripeTestWebhookHttp(request(),async()=>{throw new Error(CANARY+SECRET+SIGNATURE);});const text=await result.text();for(const value of [CANARY,SECRET,SIGNATURE,EVENT.id,EVENT.data.object.id])expect(text).not.toContain(value);expect(error).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();}
 finally{error.mockRestore();warn.mockRestore();log.mockRestore();}
});
