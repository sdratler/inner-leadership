import "server-only";
import {AppError} from "../../lib/errors.ts";
import {GmailAuthTransport,parseGmailAuthConfig} from "../../providers/email/gmail.ts";
import type {BnaAcknowledgmentTransport} from "./acknowledgment-store.ts";
import {BNA_EMAIL_SENDER} from "./delivery-policy.ts";
import {bnaAdmissionAllows,readBnaDispatchAdmission,type BnaDispatchAdmission} from "./dispatch-admission.ts";

/** The configured Office identity is reused; no alternate mailbox, BCC,
 * recipient override or generic/Fishing email enable flag authorizes BNA mail. */
export function createBnaAcknowledgmentTransport(env:Record<string,string|undefined>,clock:{now:()=>Date},
 verifyAdmission:(policy:BnaDispatchAdmission)=>Promise<void>,sendFetch:typeof fetch=fetch):BnaAcknowledgmentTransport{
 const initial=readBnaDispatchAdmission(env,clock.now()),config=parseGmailAuthConfig(env);
 const current=()=>{const policy=readBnaDispatchAdmission(env,clock.now());if(JSON.stringify(policy)!==JSON.stringify(initial))throw new AppError("UNAVAILABLE");return policy;};
 return {mode:initial.mode,authorize:message=>bnaAdmissionAllows(current(),message,clock.now()),send:async message=>{
  let attempted=false;
  try{
   const policy=current();if(!bnaAdmissionAllows(policy,message,clock.now()))return {state:"not_attempted"};
   await verifyAdmission(policy);
   const adapter=new GmailAuthTransport(config,sendFetch,"BNA Office",async mail=>{
    const latest=current();if(!bnaAdmissionAllows(latest,message,clock.now())||mail.from!==BNA_EMAIL_SENDER||mail.to!==message.payload.recipient||mail.subject!==message.payload.subject||mail.text!==message.payload.text||mail.idempotencyKey!==`ls-auth-${message.id}`)throw new AppError("UNAVAILABLE");
    await verifyAdmission(latest);
    attempted=true;
   });
   const result=await adapter.send({from:BNA_EMAIL_SENDER,to:message.payload.recipient,subject:message.payload.subject,text:message.payload.text,idempotencyKey:`ls-auth-${message.id}`});
   return {state:"accepted",providerId:result.providerId};
  }catch{return {state:attempted?"unknown":"not_attempted"};}
 }};
}
