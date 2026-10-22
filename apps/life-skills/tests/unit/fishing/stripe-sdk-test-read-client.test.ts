import Stripe from "stripe";
import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {StripeSdkTestReadClient,StripeSdkTestReadError,stripeSdkTestApiVersion,stripeSdkTestVersion} from "../../../src/features/fishing/stripe-sdk-test-read-client.ts";
import {stripeReadBounds,type StripeInvoicePaymentQuery,type StripeReadRequest} from "../../../src/features/fishing/stripe-read-ports.ts";
import {StripeReadbackNormalizer} from "../../../src/features/fishing-payments/stripe-readback.ts";

const SECRET="sk_test_SYNTHETIC_SDK_SECRET_CANARY_NO_NETWORK",CANARY="SYNTHETIC_PRIVATE_PROVIDER_ERROR_CANARY";
const binding={accountId:"acct_SYNTHETIC_BOUND",livemode:false as const,apiVersion:stripeSdkTestApiVersion,verifiedBindingId:"SYNTHETIC_NOT_MERCHANT_PROOF"};
const client=()=>new StripeSdkTestReadClient(SECRET,binding),signal=()=>new AbortController().signal;
function json(value:unknown,init:ResponseInit={}){return new Response(JSON.stringify(value),{status:200,...init,headers:{"content-type":"application/json",...init.headers}});}
function transport(value:unknown={id:"evt_SYNTHETIC",object:"event",livemode:false}){const mock=vi.fn<typeof fetch>(async()=>json(value));vi.stubGlobal("fetch",mock);return mock;}
async function unavailable(pending:Promise<unknown>){
 const error=await pending.then(()=>null,error=>error);expect(error).toBeInstanceOf(StripeSdkTestReadError);
 expect(error).toMatchObject({code:"STRIPE_TEST_READ_UNAVAILABLE",message:"Stripe test read unavailable"});
 expect(JSON.stringify(error)).not.toContain(SECRET);expect(String(error)).not.toContain(CANARY);expect(error).not.toHaveProperty("cause");return error;
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe("actual pinned SDK serialization through an unmounted read-only adapter; global fetch is mocked",()=>{
 it("constructs without network/env discovery, fixes SDK/API versions and hides the key and mutable binding",()=>{
  const fetch=transport(),input={...binding},c=new StripeSdkTestReadClient(SECRET,input);input.accountId="acct_CHANGED";
  expect(Stripe.PACKAGE_VERSION).toBe(stripeSdkTestVersion);expect(Stripe.API_VERSION).toBe(stripeSdkTestApiVersion);
  expect(c.binding).toEqual(binding);expect(Object.isFrozen(c.binding)).toBe(true);expect(Reflect.set(c,"binding",input)).toBe(false);
  expect(JSON.stringify(c)).not.toContain(SECRET);expect(fetch).not.toHaveBeenCalled();
  for(const name of["create","send","finalize","pay","refund","rawRequest","readOperation"])expect(name in c).toBe(false);
 });
 it.each([
  ["event","evt_SYNTHETIC","events"],["invoice","in_SYNTHETIC","invoices"],["checkout_session","cs_test_SYNTHETIC","checkout/sessions"],
  ["payment_intent","pi_SYNTHETIC","payment_intents"],["charge","ch_SYNTHETIC","charges"],["refund","re_SYNTHETIC","refunds"],
  ["balance_transaction","txn_SYNTHETIC","balance_transactions"],
 ] as const)("uses one exact GET for %s and strips SDK response metadata",async(object,id,path)=>{
  const fetch=transport({id,object,livemode:false}),result=await client().retrieve({object,id},signal());
  expect(fetch).toHaveBeenCalledTimes(1);const[url,init]=fetch.mock.calls[0]!;
  expect(String(url)).toBe(`https://api.stripe.com/v1/${path}/${id}`);expect(init).toMatchObject({method:"GET",redirect:"error",credentials:"omit",cache:"no-store"});
  const headers=new Headers(init?.headers);expect(headers.get("stripe-account")).toBe(binding.accountId);expect(headers.get("stripe-version")).toBe(stripeSdkTestApiVersion);
  expect(init?.body).toBeUndefined();expect(result).toEqual({id,object,livemode:false});expect(Object.getOwnPropertyNames(result)).not.toContain("lastResponse");
 });
 it.each([
  [{invoiceId:"in_SYNTHETIC",limit:100},{invoice:"in_SYNTHETIC",limit:"100"}],
  [{paymentIntentId:"pi_SYNTHETIC",limit:100},{"payment[type]":"payment_intent","payment[payment_intent]":"pi_SYNTHETIC",limit:"100"}],
 ] as const)("lists exactly one bounded InvoicePayment page: %j",async(query,expected)=>{
  const page={object:"list",url:"/v1/invoice_payments",has_more:true,data:[{id:"inpay_SYNTHETIC"}]},fetch=transport(page);
  expect(await client().listInvoicePayments(query,signal())).toEqual(page);expect(fetch).toHaveBeenCalledTimes(1);
  const url=new URL(String(fetch.mock.calls[0]![0]));expect(url.origin).toBe("https://api.stripe.com");expect(url.pathname).toBe("/v1/invoice_payments");
  expect(Object.fromEntries(url.searchParams)).toEqual(expected);expect([...url.searchParams]).toHaveLength(Object.keys(expected).length);
 });
 it.each(["sk_live_SYNTHETIC_NOT_A_REAL_KEY_123456","rk_live_SYNTHETIC_NOT_A_REAL_KEY_123456","pk_test_SYNTHETIC_NOT_A_SECRET_123456","sk_test_short",""])("rejects non-test-secret configuration without a request",key=>{
  const fetch=transport();expect(()=>new StripeSdkTestReadClient(key,binding)).toThrow(StripeSdkTestReadError);expect(fetch).not.toHaveBeenCalled();
 });
 it.each([{livemode:true},{apiVersion:"2020-08-27"},{accountId:"acct_BAD/path"},{verifiedBindingId:""},{extra:"not accepted"}])("rejects a mismatched/extra binding field %j",change=>{
  const fetch=transport();expect(()=>new StripeSdkTestReadClient(SECRET,{...binding,...change} as typeof binding)).toThrow(StripeSdkTestReadError);expect(fetch).not.toHaveBeenCalled();
 });
 it.each([
  {object:"invoice",id:"pi_SYNTHETIC"},{object:"event",id:"evt_A/../customers"},{object:"event",id:"https://example.invalid/evt_X"},
  {object:"event",id:"evt_A?expand[]=customer"},{object:"event",id:"evt_A#fragment"},{object:"customer",id:"cus_A"},{object:"event",id:"evt_A",url:"https://example.invalid"},
 ])("rejects untyped retrieval escape %j before SDK/network",async input=>{
  const fetch=transport();await unavailable(client().retrieve(input as StripeReadRequest,signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it.each([
  {invoiceId:"in_A",paymentIntentId:"pi_A",limit:100},{invoiceId:"in_A",limit:101},{invoiceId:"in_A",limit:1},
  {invoiceId:"in_A",limit:100,starting_after:"inpay_A"},{invoiceId:"in_A",limit:100,expand:["data.invoice"]},{paymentIntentId:"in_A",limit:100},
 ])("rejects ambiguous/unbounded list input %j before SDK/network",async input=>{
  const fetch=transport();await unavailable(client().listInvoicePayments(input as StripeInvoicePaymentQuery,signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it.each([
  ["https://example.invalid/v1/events/evt_SYNTHETIC",undefined],["http://api.stripe.com/v1/events/evt_SYNTHETIC",undefined],
  ["https://api.stripe.com:444/v1/events/evt_SYNTHETIC",undefined],["https://api.stripe.com/v1/customers/cus_A",undefined],
  ["https://api.stripe.com/v1/events/evt_SYNTHETIC?expand[]=customer",undefined],["https://api.stripe.com/v1/events/evt_SYNTHETIC","POST"],
 ] as const)("blocks unexpected SDK transport URL/method before global fetch: %s",async(url,method)=>{
  const fetch=transport(),create=Stripe.createFetchHttpClient.bind(Stripe);
  vi.spyOn(Stripe,"createFetchHttpClient").mockImplementation(guard=>create((_url,init)=>guard!(url,{...init,...(method?{method}:{} )})));
  await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it("does not read the provider before the normalizer has a durable native ownership mapping",async()=>{
  const fetch=transport(),native=vi.fn(async()=>null),c=client(),reader=new StripeReadbackNormalizer({client:c,clock:{now:()=>new Date()},resolveNativeBinding:native});
  await expect(reader.reconcileReceipt({eventId:"evt_SYNTHETIC",eventType:"invoice.paid",objectId:"in_SYNTHETIC",providerAccountId:binding.accountId,livemode:false,apiVersion:stripeSdkTestApiVersion,digest:"a".repeat(64),createdAt:new Date().toISOString()}))
   .rejects.toMatchObject({code:"STRIPE_RECONCILIATION_REQUIRED",reason:"NATIVE_MAPPING_REQUIRED"});
  expect(native).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();
 });
 it("makes no network call for an already-aborted read",async()=>{
  const fetch=transport(),abort=new AbortController();abort.abort();await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},abort.signal));expect(fetch).not.toHaveBeenCalled();
 });
 it("bounds actual streamed bytes even when Content-Length understates them",async()=>{
  const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(stripeReadBounds.objectBytes));c.enqueue(new Uint8Array(1));},cancel});
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(body,{status:200,headers:{"content-type":"application/json","content-length":"1"}}));vi.stubGlobal("fetch",fetch);
  await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));expect(fetch).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalledTimes(1);
 });
 it.each(["131073","99999999999999999999999","NaN","-1"])("rejects unsafe advertised response size %s and cancels the body",async length=>{
  const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({cancel});transport();vi.stubGlobal("fetch",vi.fn(async()=>new Response(body,{status:200,headers:{"content-type":"application/json","content-length":length}})));
  await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));expect(cancel).toHaveBeenCalledTimes(1);
 });
 it("accepts the exact byte bound and rejects the next byte",async()=>{
  const text=JSON.stringify({value:"x".repeat(stripeReadBounds.objectBytes-12)});expect(Buffer.byteLength(text)).toBe(stripeReadBounds.objectBytes);
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(text,{headers:{"content-type":"application/json"}})));
  expect(await client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal())).toHaveProperty("value");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(text+" ",{headers:{"content-type":"application/json"}})));
  await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));
 });
 it.each([302,401,429,500])("sanitizes HTTP %i without returning or parsing private errors",async status=>{
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>json({error:{message:CANARY,key:SECRET}},{status,headers:{location:"https://example.invalid"}}));vi.stubGlobal("fetch",fetch);
  const error=await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));expect(fetch).toHaveBeenCalledTimes(1);expect(String(error.stack)).not.toContain(CANARY);
 });
 it.each(["<html>private</html>","{"])("sanitizes non-JSON/malformed response %s",async text=>{
  transport();vi.stubGlobal("fetch",vi.fn(async()=>new Response(text,{headers:{"content-type":text.startsWith("<")?"text/html":"application/json"}})));
  await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));
 });
 it("sanitizes a network failure and never dispatches a second request",async()=>{
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>{throw Object.assign(new Error(CANARY+SECRET),{code:"ECONNRESET"});});vi.stubGlobal("fetch",fetch);
  await unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("propagates caller cancellation after headers and cancels a stalled body",async()=>{
  const cancel=vi.fn(),abort=new AbortController();let bodyStarted=false,observed:AbortSignal|null|undefined;
  const body=new ReadableStream<Uint8Array>({pull(){bodyStarted=true;},cancel});
  vi.stubGlobal("fetch",vi.fn<typeof fetch>(async(_url,init)=>{observed=init?.signal;return new Response(body,{headers:{"content-type":"application/json"}});}));
  const pending=unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},abort.signal));await vi.waitFor(()=>expect(bodyStarted&&!!observed).toBe(true));abort.abort();
  await pending;expect(observed?.aborted).toBe(true);await vi.waitFor(()=>expect(cancel).toHaveBeenCalledTimes(1));
 });
 it("enforces the request deadline while fetch is stalled",async()=>{
  vi.useFakeTimers();let observed:AbortSignal|null|undefined;
  const fetch=vi.fn<typeof globalThis.fetch>((_url,init)=>{observed=init?.signal;return new Promise((_resolve,reject)=>observed?.addEventListener("abort",()=>reject(new Error(CANARY)),{once:true}));});vi.stubGlobal("fetch",fetch);
  const pending=unavailable(client().retrieve({object:"event",id:"evt_SYNTHETIC"},signal()));await vi.advanceTimersByTimeAsync(stripeReadBounds.requestMilliseconds+1);
  await pending;expect(observed?.aborted).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
 });
});
