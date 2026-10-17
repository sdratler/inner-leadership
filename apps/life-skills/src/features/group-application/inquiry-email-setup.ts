import "server-only";
import {INQUIRY_EMAIL_FROM,INQUIRY_EMAIL_PURPOSE} from "./inquiry-email-copy.ts";

type FieldStatus="DISABLED"|"SET_UNVERIFIED"|"HOLD_REQUIRED"|"MISSING"|"MISMATCH"|"INVALID";
export type InquiryEmailSetupReport=Readonly<{
 purpose:typeof INQUIRY_EMAIL_PURPOSE;
 status:"SEND_DISABLED"|"HOLD_REQUIRED";
 queueEnabled:boolean;
 providerSetup:"INCOMPLETE"|"CONFIGURED_UNVERIFIED";
 sendPermitted:false;
 senderVerified:false;
 deliveryVerified:false;
 fields:Readonly<{
  LS_INQUIRY_EMAIL_QUEUE_ENABLED:FieldStatus;LS_INQUIRY_EMAIL_SEND_ENABLED:FieldStatus;
  LS_AUTH_EMAIL_ENABLED:FieldStatus;LS_AUTH_EMAIL_PROVIDER:FieldStatus;LS_AUTH_EMAIL_FROM:FieldStatus;
  LS_AUTH_GOOGLE_CLIENT_ID:FieldStatus;LS_AUTH_GOOGLE_CLIENT_SECRET:FieldStatus;LS_AUTH_GOOGLE_REFRESH_TOKEN:FieldStatus;
 }>;
}>;
const invalidValue=Symbol("INVALID_SETUP_FIELD");
function flag(value:unknown):FieldStatus{
 return value===undefined||value===""||value==="false"?"DISABLED":value==="true"?"SET_UNVERIFIED":"INVALID";
}
function match(value:unknown,expected:string):FieldStatus{
 return value===undefined||value===""?"MISSING":typeof value!=="string"?"INVALID":value===expected?"SET_UNVERIFIED":"MISMATCH";
}
function credential(value:unknown,max:number):FieldStatus{
 if(value===undefined||value==="")return "MISSING";
 // Existing parseGmailAuthConfig bounds/CRLF policy; this is not token verification.
 return typeof value==="string"&&value.length<=max&&!/[\r\n]/.test(value)?"SET_UNVERIFIED":"INVALID";
}

/** Pure, nonsecret inspection of a supplied own-string map. No real env lookup,
 * config/transport construction, credential validation, provider call or send.
 * Queue/send semantics match inquiry-email.ts; structural credential rules
 * match providers/email/gmail.ts. Sending remains forbidden in every report.
 */
export function inspectInquiryEmailSetup(env:Record<string,string|undefined>):InquiryEmailSetupReport{
 const read=(key:string):unknown=>{
  try{const field=Object.getOwnPropertyDescriptor(env,key);return field===undefined?undefined:"value"in field?field.value:invalidValue;}
  catch{return invalidValue;}
 };
 const queue=read("LS_INQUIRY_EMAIL_QUEUE_ENABLED"),send=read("LS_INQUIRY_EMAIL_SEND_ENABLED");
 const fields=Object.freeze({
  LS_INQUIRY_EMAIL_QUEUE_ENABLED:flag(queue),LS_INQUIRY_EMAIL_SEND_ENABLED:send==="true"?"HOLD_REQUIRED" as const:flag(send),
  LS_AUTH_EMAIL_ENABLED:flag(read("LS_AUTH_EMAIL_ENABLED")),
  LS_AUTH_EMAIL_PROVIDER:match(read("LS_AUTH_EMAIL_PROVIDER"),"gmail"),LS_AUTH_EMAIL_FROM:match(read("LS_AUTH_EMAIL_FROM"),INQUIRY_EMAIL_FROM),
  LS_AUTH_GOOGLE_CLIENT_ID:credential(read("LS_AUTH_GOOGLE_CLIENT_ID"),512),LS_AUTH_GOOGLE_CLIENT_SECRET:credential(read("LS_AUTH_GOOGLE_CLIENT_SECRET"),512),
  LS_AUTH_GOOGLE_REFRESH_TOKEN:credential(read("LS_AUTH_GOOGLE_REFRESH_TOKEN"),4096),
 });
 const configured=[fields.LS_AUTH_EMAIL_ENABLED,fields.LS_AUTH_EMAIL_PROVIDER,fields.LS_AUTH_EMAIL_FROM,
  fields.LS_AUTH_GOOGLE_CLIENT_ID,fields.LS_AUTH_GOOGLE_CLIENT_SECRET,fields.LS_AUTH_GOOGLE_REFRESH_TOKEN].every(value=>value==="SET_UNVERIFIED");
 return Object.freeze({purpose:INQUIRY_EMAIL_PURPOSE,status:send==="true"?"HOLD_REQUIRED":"SEND_DISABLED",queueEnabled:queue==="true",
  providerSetup:configured?"CONFIGURED_UNVERIFIED":"INCOMPLETE",sendPermitted:false,senderVerified:false,deliveryVerified:false,fields});
}
