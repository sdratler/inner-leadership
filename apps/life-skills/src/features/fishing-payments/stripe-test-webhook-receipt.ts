import "server-only";
import {createHash} from "node:crypto";
import Stripe from "stripe";
import type {Receipt} from "./ports.ts";

const sdkVersion="23.0.0",apiVersion="2026-09-30.endive";
const bodyLimit=131072,headerLimit=2048,maximumAge=300,futureSkew=30;
const maximumTimestamp=253402300799;
const eventObjects:ReadonlyMap<string,readonly[string,string]>=new Map([
 ["invoice.paid",["invoice","in"]],
 ["invoice.payment_failed",["invoice","in"]],
 ["invoice.payment_action_required",["invoice","in"]],
 ["payment_intent.succeeded",["payment_intent","pi"]],
 ["payment_intent.payment_failed",["payment_intent","pi"]],
 ["payment_intent.processing",["payment_intent","pi"]],
 ["checkout.session.completed",["checkout.session","cs"]],
 ["checkout.session.async_payment_succeeded",["checkout.session","cs"]],
 ["checkout.session.async_payment_failed",["checkout.session","cs"]],
 ["refund.created",["refund","re"]],
 ["refund.updated",["refund","re"]],
] as const);

export type StripeTestWebhookEndpoint=Readonly<{
 endpoint:"direct"|"connected";
 accountId:string;
 livemode:false;
 apiVersion:"2026-09-30.endive";
}>;
export type StripeTestWebhookInput=Readonly<{
 rawBody:Uint8Array;
 signatureHeader:string;
 endpointSecret:string;
 binding:StripeTestWebhookEndpoint;
 clock:Readonly<{now():Date}>;
}>;
export type StripeTestSignatureReceipt=Readonly<{
 kind:"stripe_test_signature_only";
 receipt:Receipt&Readonly<{livemode:false}>;
}>;

/** No SDK cause, request, signature, secret or raw event is retained. */
export class StripeTestWebhookReceiptError extends Error {
 readonly code="STRIPE_TEST_SIGNATURE_UNAVAILABLE";
 constructor(){super("Stripe test signature unavailable");this.name="StripeTestWebhookReceiptError";}
}
function requireInput(value:unknown):asserts value{if(!value)throw new StripeTestWebhookReceiptError();}
function plainRecord(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
}
function record(value:unknown):Record<string,unknown>{
 requireInput(plainRecord(value));
 return value;
}
function id(value:unknown,prefix:string):value is string{
 return typeof value==="string"&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,150}$`).test(value);
}
function timestamp(value:unknown):value is number{
 return typeof value==="number"&&Number.isSafeInteger(value)&&value>0&&value<=maximumTimestamp;
}

/** UNMOUNTED, test-only snapshot signature verification with the actual SDK.
 * Limits: 128 KiB raw UTF-8, 2048 ASCII header bytes, one timestamp, at most
 * eight v1 signatures, age <=300 seconds and future skew <=30 seconds.
 * Signature delivery time and event creation time are deliberately separate.
 *
 * The server supplies the endpoint/account/secret pairing; this function cannot
 * certify that pairing or discover a merchant. A signature is not native payer,
 * purchase, service-principal, ownership or settlement authority. The minimal
 * receipt still requires durable intake, native resolution and current readback.
 * No environment, credential lookup, network, store, route or financial effect.
 */
export function verifyStripeTestWebhookReceipt(input:StripeTestWebhookInput):StripeTestSignatureReceipt{
 try{
  requireInput(Stripe.PACKAGE_VERSION===sdkVersion&&Stripe.API_VERSION===apiVersion);
  const supplied=record(input.binding);
  requireInput(Object.keys(supplied).length===4&&["endpoint","accountId","livemode","apiVersion"].every(key=>Object.hasOwn(supplied,key)));
  const binding=Object.freeze({endpoint:supplied.endpoint,accountId:supplied.accountId,livemode:supplied.livemode,apiVersion:supplied.apiVersion});
  requireInput((binding.endpoint==="direct"||binding.endpoint==="connected")&&id(binding.accountId,"acct")&&binding.livemode===false&&binding.apiVersion===apiVersion);
  const endpointSecret=input.endpointSecret,bytes=input.rawBody;
  requireInput(typeof endpointSecret==="string"&&/^whsec_[A-Za-z0-9_]{16,256}$/.test(endpointSecret));
  requireInput(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=bodyLimit);
  requireInput(!(bytes.buffer instanceof SharedArrayBuffer));
  const raw=Buffer.from(bytes);
  // The SDK decoder strips a leading BOM; refuse bytes it would normalize.
  requireInput(!(raw[0]===0xef&&raw[1]===0xbb&&raw[2]===0xbf));
  // Validate encoding without normalizing or reserializing the authenticated bytes.
  new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw);
  const header=input.signatureHeader;
  requireInput(typeof header==="string"&&header.length>0&&header.length<=headerLimit&&/^[\x21-\x7e]+$/.test(header));
  const parts=header.split(",");requireInput(parts.length<=16);
  let deliveredAt:number|undefined,signatures=0;
  for(const part of parts){
   const field=/^(t|v[0-9]{1,2})=([^=]+)$/.exec(part);requireInput(field);
   if(field[1]==="t"){
    requireInput(deliveredAt===undefined&&/^[1-9][0-9]{0,11}$/.test(field[2]!));
    deliveredAt=Number(field[2]);requireInput(timestamp(deliveredAt));
   }else{
    requireInput(/^[a-fA-F0-9]{64}$/.test(field[2]!));
    if(field[1]==="v1")requireInput(++signatures<=8);
   }
  }
  requireInput(deliveredAt!==undefined&&signatures>0);
  const now=input.clock.now();requireInput(now instanceof Date&&Number.isSafeInteger(now.getTime())&&now.getTime()>=0&&now.getTime()<=maximumTimestamp*1000);
  const nowMilliseconds=now.getTime(),nowSeconds=Math.floor(nowMilliseconds/1000);
  requireInput(nowSeconds-deliveredAt<=maximumAge&&deliveredAt-nowSeconds<=futureSkew);
  const event=record(Stripe.webhooks.constructEvent(raw,header,endpointSecret,maximumAge,undefined,nowMilliseconds));
  requireInput(event.object==="event"&&id(event.id,"evt")&&event.livemode===false&&event.api_version===binding.apiVersion);
  requireInput(typeof event.type==="string");
  const expected=eventObjects.get(event.type);requireInput(expected);
  requireInput(binding.endpoint==="connected"?event.account===binding.accountId:event.account===undefined||event.account===null||event.account==="");
  requireInput(timestamp(event.created)&&event.created<=nowSeconds+futureSkew);
  const object=record(record(event.data).object);
  requireInput(object.object===expected[0]&&id(object.id,expected[1])&&object.deleted!==true);
  const receipt:Receipt&Readonly<{livemode:false}>=Object.freeze({eventId:event.id,eventType:event.type,objectId:object.id,
   providerAccountId:binding.accountId,livemode:false,apiVersion:binding.apiVersion,digest:createHash("sha256").update(raw).digest("hex"),createdAt:new Date(event.created*1000).toISOString()});
  return Object.freeze({kind:"stripe_test_signature_only",receipt});
 }catch{throw new StripeTestWebhookReceiptError();}
}
