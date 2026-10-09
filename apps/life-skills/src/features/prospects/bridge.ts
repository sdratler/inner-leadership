import "server-only";
import { AppError } from "../../lib/errors.ts";
import { demoRecordBatch } from "../demo/provenance.ts";
import type { IdentityStore } from "../identity/store.ts";

export type Prospect = {
  leadId:string; receivedAt:string; name:string; phone:string; email:string; language:string;
  source:string; campaign:string; stage:string; lastContact:string; nextAction:string; dueDate:string;
  outcome:string; notes:string; caseId:string; formSent:string; formSubmitted:string;
  paymentLinkSent:string; paymentMethod:string; paymentStatus:string; paymentAllocation:string;
  bookingStatus:string; messageReceipt:string; updateProvenance:string; firstInboundAt:string; lastInboundAt:string; owner:string;
  journeyState:string; paymentVerified:boolean; bookingConfirmed:boolean;
  projectionPending?:boolean;
  projectionOperationId?:string;projectionState?:"prepared"|"sent_pending";
  projectionMessage?:string;projectionCreatedAt?:string;
  nativeEdit?:{personId:string;profileVersion:number;authorityEpoch:number};
};

function config(){
  const origin=(process.env.LIFE_SKILLS_CRM_BRIDGE_ORIGIN||"").replace(/\/+$/,"");
  const secret=(process.env.LIFE_SKILLS_APP_BRIDGE_SECRET||"").trim();
  if(!/^https:\/\//.test(origin)||secret.length<32)throw new Error("crm_bridge_not_configured");
  return {origin,secret};
}
export async function crmBridge<T>(path:string,init:RequestInit={}):Promise<T>{
  const {origin,secret}=config();
  const response=await fetch(origin+path,{...init,cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{"Content-Type":"application/json","X-Life-Skills-Bridge-Secret":secret,...init.headers}});
  let body:unknown;try{body=await response.json();}catch{throw new Error("crm_bridge_unavailable");}
  if(!response.ok||!body||typeof body!=="object"||!("success" in body)||(body as {success:boolean}).success!==true)throw new Error(response.status===401?"crm_bridge_unauthorized":"crm_bridge_unavailable");
  return body as T;
}
/** Fixed, read-only graphics endpoint; never a caller-controlled remote proxy. */
export async function crmBridgeImage(assetId:string,revision:number,digest:string,download=false,collection?:"templates"|"history"):Promise<Response>{
  if(!/^[A-Za-z0-9._-]{1,200}$/.test(assetId)||!Number.isSafeInteger(revision)||revision<1||revision>999999||! /^[a-f0-9]{64}$/.test(digest))throw new AppError("INVALID_REQUEST");
  if(collection!==undefined&&!["templates","history"].includes(collection))throw new AppError("INVALID_REQUEST");
  const {origin,secret}=config(),query=new URLSearchParams({revision:String(revision),digest,...(collection?{collection}:{}),...(download?{download:"1"}:{})});
  return fetch(`${origin}/api/bna/life-skills-app/marketing/assets/${encodeURIComponent(assetId)}?${query}`,{method:"GET",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(30000),headers:{"X-Life-Skills-Bridge-Secret":secret}});
}
export async function listProspects(){return (await crmBridge<{success:true;prospects:Prospect[]}>("/api/bna/life-skills-app/prospects")).prospects;}
export async function createProspect(input:{name:string;phone:string;language:""|"he"|"en";source:string;notes:string;nextAction:string;dueDate:string}){return crmBridge<{success:true;result:{action:"created"|"existing";leadId:string;row:number}}>("/api/bna/life-skills-app/prospects",{method:"POST",body:JSON.stringify(input)});}
export async function updateProspect(leadId:string,fields:Record<string,string>){return crmBridge(`/api/bna/life-skills-app/prospects/${encodeURIComponent(leadId)}`,{method:"PATCH",body:JSON.stringify({fields})});}
/** Recheck provenance at the final app-owned provider boundary, not only in a UI route. */
export async function sendProspectMessage(leadId:string,body:string,context:{store:IdentityStore;workspaceId:string}){
  const batch=await context.store.transaction(tx=>demoRecordBatch(tx,context.workspaceId,"prospect",leadId));
  if(batch)throw new AppError("FORBIDDEN");
  return crmBridge<{success:true;receipt:{provider:string;providerMessageId:string|null;sentAt:string|null;replaySuppressed?:boolean;sheetUpdated?:boolean}}>(`/api/bna/life-skills-app/prospects/${encodeURIComponent(leadId)}/send`,{method:"POST",body:JSON.stringify({body})});
}
/** Only the native store constructs this from its committed, authorized intent. */
export async function sendNativeProspectMessage(input:{operationId:string;authorityEpoch:number;bindingSha256:string;
 leadId:string;phone:string;body:string;recordMode:"live"}){
 return crmBridge<{success:true;receipt:{provider:string;providerMessageId:string|null;sentAt:string|null;replaySuppressed?:boolean;sheetUpdated?:boolean}}>(
  "/api/bna/life-skills-app/native-prospects/send",{method:"POST",body:JSON.stringify(input)});
}
