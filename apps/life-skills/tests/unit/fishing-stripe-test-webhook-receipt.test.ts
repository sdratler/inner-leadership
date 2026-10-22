import {createHash} from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import Stripe from "stripe";
import {afterAll,afterEach,beforeAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {StripeTestWebhookReceiptError,verifyStripeTestWebhookReceipt,type StripeTestWebhookInput} from "../../src/features/fishing-payments/stripe-test-webhook-receipt.ts";

const NOW=Date.parse("2026-10-16T12:00:00.000Z"),SECOND=NOW/1000;
const SECRET="whsec_SYNTHETIC_ONLY_no_endpoint_access_1046",OTHER_SECRET="whsec_SYNTHETIC_OTHER_no_endpoint_access_1046";
const CANARY="PRIVATE_SYNTHETIC_contact_card_header_secret_CANARY";
const noNetwork=vi.fn(()=>{throw Error("UNEXPECTED_NETWORK_ATTEMPT");});
beforeAll(()=>{
 vi.stubGlobal("fetch",noNetwork);vi.stubGlobal("WebSocket",noNetwork);
 vi.spyOn(http,"request").mockImplementation(noNetwork);vi.spyOn(http,"get").mockImplementation(noNetwork);
 vi.spyOn(https,"request").mockImplementation(noNetwork);vi.spyOn(https,"get").mockImplementation(noNetwork);
 vi.spyOn(net,"connect").mockImplementation(noNetwork);vi.spyOn(net,"createConnection").mockImplementation(noNetwork);
 vi.spyOn(net.Socket.prototype,"connect").mockImplementation(noNetwork);
 vi.spyOn(tls,"connect").mockImplementation(noNetwork);vi.spyOn(dgram,"createSocket").mockImplementation(noNetwork);
});
afterEach(()=>{expect(noNetwork).not.toHaveBeenCalled();});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

function event(){return {id:"evt_SYNTHETIC_1046",object:"event",type:"invoice.paid",livemode:false,api_version:"2026-09-30.endive",created:SECOND-60,
 data:{object:{id:"in_SYNTHETIC_1046",object:"invoice",metadata:{private:CANARY},customer_email:CANARY,amount_paid:175000}},private:CANARY};}
function signature(raw:Uint8Array,at=SECOND,secret=SECRET){
 return Stripe.webhooks.generateTestHeaderString({payload:Buffer.from(raw).toString("utf8"),timestamp:at,secret});
}
function input(raw:Uint8Array=Buffer.from(JSON.stringify(event()))):StripeTestWebhookInput{
 return {rawBody:raw,signatureHeader:signature(raw),endpointSecret:SECRET,binding:{endpoint:"direct",accountId:"acct_SYNTHETIC_1046",livemode:false,apiVersion:"2026-09-30.endive"},clock:{now:()=>new Date(NOW)}};
}
function reject(overrides:Record<string,unknown>={},base=input()){
 let caught:unknown;
 try{Reflect.apply(verifyStripeTestWebhookReceipt,undefined,[{...base,...overrides}]);}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(StripeTestWebhookReceiptError);
 if(!(caught instanceof StripeTestWebhookReceiptError))throw Error("EXPECTED_CONSTANT_SIGNATURE_FAILURE");
 expect(caught.code).toBe("STRIPE_TEST_SIGNATURE_UNAVAILABLE");expect(caught.message).toBe("Stripe test signature unavailable");
 expect(caught.name).toBe("StripeTestWebhookReceiptError");expect(caught.cause).toBeUndefined();
 const text=[String(caught),JSON.stringify(caught),caught.stack].join("\n");
 for(const hidden of [CANARY,SECRET,OTHER_SECRET,base.signatureHeader])expect(text).not.toContain(hidden);
 return caught;
}

test("actual SDK verification returns only a frozen signature-only minimal Receipt",()=>{
 const i=input(),spy=vi.spyOn(Stripe.webhooks,"constructEvent");
 try{
  const result=verifyStripeTestWebhookReceipt(i);
  expect(result).toEqual({kind:"stripe_test_signature_only",receipt:{eventId:"evt_SYNTHETIC_1046",eventType:"invoice.paid",objectId:"in_SYNTHETIC_1046",providerAccountId:"acct_SYNTHETIC_1046",livemode:false,apiVersion:"2026-09-30.endive",digest:createHash("sha256").update(i.rawBody).digest("hex"),createdAt:new Date(NOW-60000).toISOString()}});
  expect(spy).toHaveBeenCalledExactlyOnceWith(Buffer.from(i.rawBody),i.signatureHeader,SECRET,300,undefined,NOW);
  expect(Object.isFrozen(result)&&Object.isFrozen(result.receipt)).toBe(true);expect(JSON.stringify(result)).not.toContain(CANARY);
 }finally{spy.mockRestore();}
});

test("connected endpoint requires its exact signed account",()=>{
 const raw=Buffer.from(JSON.stringify({...event(),account:"acct_SYNTHETIC_1046"})),i=input(raw);
 const result=verifyStripeTestWebhookReceipt({...i,binding:{...i.binding,endpoint:"connected"}});
 expect(result.receipt.providerAccountId).toBe("acct_SYNTHETIC_1046");expect(result.kind).toBe("stripe_test_signature_only");
});

test.each([
 ["invoice.paid","invoice","in"],["invoice.payment_failed","invoice","in"],["invoice.payment_action_required","invoice","in"],
 ["payment_intent.succeeded","payment_intent","pi"],["payment_intent.payment_failed","payment_intent","pi"],["payment_intent.processing","payment_intent","pi"],
 ["checkout.session.completed","checkout.session","cs"],["checkout.session.async_payment_succeeded","checkout.session","cs"],["checkout.session.async_payment_failed","checkout.session","cs"],
 ["refund.created","refund","re"],["refund.updated","refund","re"],
])("supported native snapshot %s extracts only its correctly typed object",(type,object,prefix)=>{
 const raw=Buffer.from(JSON.stringify({...event(),type,data:{object:{id:`${prefix}_SYNTHETIC_1046`,object,private:CANARY}}}));
 expect(verifyStripeTestWebhookReceipt(input(raw)).receipt).toMatchObject({eventType:type,objectId:`${prefix}_SYNTHETIC_1046`});
});

test("SDK signs exact Unicode/whitespace bytes and a Uint8Array view, without mutating them",()=>{
 const raw=Buffer.from(` \n${JSON.stringify({...event(),private:"שלום 🎣 / "+CANARY},null,2)}\r\n`),storage=Buffer.concat([Buffer.from("prefix"),raw,Buffer.from("suffix")]);
 const view=new Uint8Array(storage.buffer,storage.byteOffset+6,raw.length),before=Buffer.from(storage);
 const result=verifyStripeTestWebhookReceipt(input(view));
 expect(result.receipt.digest).toBe(createHash("sha256").update(raw).digest("hex"));expect(storage).toEqual(before);
 const changed=Buffer.from(JSON.stringify(JSON.parse(raw.toString("utf8"))));reject({rawBody:changed},input(raw));
});

test("an unsigned UTF-8 BOM cannot be silently removed by the SDK decoder",()=>{
 const i=input(),raw=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(i.rawBody)]);
 expect(Stripe.webhooks.constructEvent(raw,i.signatureHeader,SECRET,300,undefined,NOW).id).toBe(event().id);
 reject({rawBody:raw},i);
});

test("server input is captured before an injected clock callback can replace it",()=>{
 const i=input(),original=Buffer.from(i.rawBody);
 Object.assign(i,{clock:{now:()=>{
  Object.assign(i.binding,{accountId:CANARY,endpoint:"connected",apiVersion:"changed"});
  Object.assign(i,{endpointSecret:OTHER_SECRET,rawBody:Buffer.from("changed")});return new Date(NOW);
 }}});
 const result=verifyStripeTestWebhookReceipt(i);
 expect(result.receipt.providerAccountId).toBe("acct_SYNTHETIC_1046");
 expect(result.receipt.digest).toBe(createHash("sha256").update(original).digest("hex"));
 expect(JSON.stringify(result)).not.toContain(CANARY);
});

test("exact 131072-byte raw JSON is accepted; the next byte is rejected",()=>{
 const base={...event(),padding:""},raw=Buffer.from(JSON.stringify({...base,padding:"x".repeat(131072-Buffer.byteLength(JSON.stringify(base)))}));
 expect(raw.byteLength).toBe(131072);expect(verifyStripeTestWebhookReceipt(input(raw)).receipt.eventId).toBe(event().id);
 reject({},input(Buffer.concat([raw,Buffer.from(" ")])));
});

test("body limit counts UTF-8 bytes rather than Unicode characters",()=>{
 const raw=Buffer.from(JSON.stringify({...event(),padding:"🎣".repeat(40000)}));
 expect(raw.toString("utf8").length).toBeLessThan(131072);expect(raw.length).toBeGreaterThan(131072);reject({},input(raw));
});

test.each([undefined,null,"{}",{},[],1,new Uint16Array(10),new DataView(new ArrayBuffer(8)),new Uint8Array(0)])("non-byte/empty raw input %s fails with a fixed error",rawBody=>{reject({rawBody});});

test("shared mutable bytes and invalid UTF-8 are rejected even with an SDK-produced signature",()=>{
 const shared=new Uint8Array(new SharedArrayBuffer(10));reject({rawBody:shared});
 const raw=Buffer.concat([Buffer.from('{"private":"'),Buffer.from([255]),Buffer.from('"}')]);reject({},input(raw));
});

test.each(["null","[]","1",'"text"',"{"," ","{\"object\":\"v2.core.event\"}"])("signed malformed/non-snapshot JSON %s fails safely",raw=>{reject({},input(Buffer.from(raw)));});

test("wrong secret, changed body and wrong signature use actual SDK rejection",()=>{
 const i=input();reject({endpointSecret:OTHER_SECRET},i);reject({rawBody:Buffer.from(JSON.stringify({...event(),private:"changed"}))},i);
 reject({signatureHeader:`t=${SECOND},v1=${"0".repeat(64)}`},i);
});

test.each([undefined,null,[],"",`v1=${"0".repeat(64)}`,`t=${SECOND}`,`t=${SECOND},t=${SECOND},v1=${"0".repeat(64)}`,
 `t=-${SECOND},v1=${"0".repeat(64)}`,`t=${SECOND}junk,v1=${"0".repeat(64)}`,`t=1e9,v1=${"0".repeat(64)}`,
 `t=0${SECOND},v1=${"0".repeat(64)}`,`t=${SECOND},v1=short`,`t=${SECOND},v1=${"0".repeat(64)},`,
 `t=${SECOND},v1=${"0".repeat(64)}\r\n`,"x".repeat(2049),`t=${SECOND},v0=${"0".repeat(64)}`,
])("malformed or oversized signature header %s is denied",signatureHeader=>{reject({signatureHeader});});

test("multiple v1 rotation signatures accept any actual matching SDK signature",()=>{
 const i=input(),good=i.signatureHeader.split(",")[1];
 expect(verifyStripeTestWebhookReceipt({...i,signatureHeader:`t=${SECOND},v1=${"0".repeat(64)},${good},v0=${"1".repeat(64)}`})).toMatchObject({kind:"stripe_test_signature_only"});
 const many=`t=${SECOND},${Array.from({length:9},()=>good).join(",")}`;reject({signatureHeader:many},i);
});

test.each([-300,-1,0,30])("fixed delivery time boundary %+i seconds is accepted",offset=>{
 const i=input();expect(verifyStripeTestWebhookReceipt({...i,signatureHeader:signature(i.rawBody,SECOND+offset)}).kind).toBe("stripe_test_signature_only");
});
test.each([-301,31,300])("delivery timestamp %+i seconds outside age/future bounds is denied",offset=>{
 const i=input();reject({signatureHeader:signature(i.rawBody,SECOND+offset)},i);
});

test("event creation is not confused with fresh delivery signing time",()=>{
 const created=SECOND-365*86400,i=input(Buffer.from(JSON.stringify({...event(),created})));
 expect(verifyStripeTestWebhookReceipt(i).receipt.createdAt).toBe(new Date(created*1000).toISOString());
 reject({signatureHeader:signature(i.rawBody,SECOND-301)},i);
});

test.each([0,-1,1.5,"1700000000",null,253402300800,SECOND+31])("invalid/future event.created %s is denied",created=>{reject({},input(Buffer.from(JSON.stringify({...event(),created}))));});

test.each([()=>new Date(NaN),()=>NOW,()=>{throw Error(CANARY);},()=>new Date(-1),()=>new Date(253402300800000)])("invalid or failing injected server clock is denied",now=>{reject({clock:{now}});});

test("SDK receives the injected clock rather than Date.now fallback",()=>{
 const i=input(),spy=vi.spyOn(Date,"now").mockImplementation(()=>{throw Error("NO_CLOCK_FALLBACK");});
 try{expect(verifyStripeTestWebhookReceipt(i).kind).toBe("stripe_test_signature_only");}finally{spy.mockRestore();}
});

test.each([undefined,null,"",`sk_test_${"x".repeat(32)}`,"whsec_short",`whsec_${"x".repeat(257)}`,SECRET+" "])("invalid endpoint secret is not normalized or exposed",endpointSecret=>{reject({endpointSecret});});

test.each([
 {endpoint:"other"},{accountId:"acctwrong"},{livemode:true},{livemode:"false"},{apiVersion:"2025-01-01"},{extra:"untrusted"},
])("invalid server endpoint binding %j is denied",change=>{const i=input();reject({binding:{...i.binding,...change}},i);});

test.each(["acct_SYNTHETIC_1046","acct_SYNTHETIC_OTHER",1,false,{}])("direct endpoint rejects a signed connected account %j",account=>{reject({},input(Buffer.from(JSON.stringify({...event(),account}))));});
test.each([undefined,null,"","acct_SYNTHETIC_OTHER"])("connected endpoint rejects missing/different signed account %s",account=>{
 const i=input(Buffer.from(JSON.stringify({...event(),account})));reject({binding:{...i.binding,endpoint:"connected"}},i);
});

test("direct endpoint pairing is supplied by the server, never certified as merchant ownership",()=>{
 const i=input(),result=verifyStripeTestWebhookReceipt({...i,binding:{...i.binding,accountId:"acct_SYNTHETIC_OTHER"}});
 expect(result.receipt.providerAccountId).toBe("acct_SYNTHETIC_OTHER");expect(Object.keys(result)).toEqual(["kind","receipt"]);
 expect(Object.keys(result.receipt).sort()).toEqual(["apiVersion","createdAt","digest","eventId","eventType","livemode","objectId","providerAccountId"]);
});

test.each([
 {id:"evtbad"},{object:"v2.core.event"},{livemode:true},{livemode:"false"},{api_version:"2025-01-01"},
 {type:"charge.refunded"},{type:"charge.dispute.created"},{type:"customer.created"},{type:"constructor"},{type:"toString"},
 {data:{}},{data:{object:null}},{data:{object:{id:"pi_WRONG_KIND",object:"invoice"}}},{data:{object:{id:"in_SYNTHETIC_1046",object:"refund"}}},
 {data:{object:{id:"in_SYNTHETIC_1046",object:"invoice",deleted:true}}},
])("signed snapshot mismatch %j cannot produce a receipt",change=>{reject({},input(Buffer.from(JSON.stringify({...event(),...change}))));});
