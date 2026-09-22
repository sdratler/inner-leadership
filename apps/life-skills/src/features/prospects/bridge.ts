import "server-only";

export type Prospect = {
  leadId:string; receivedAt:string; name:string; phone:string; email:string; language:string;
  source:string; campaign:string; stage:string; lastContact:string; nextAction:string; dueDate:string;
  outcome:string; notes:string; caseId:string; formSent:string; formSubmitted:string;
  paymentLinkSent:string; paymentMethod:string; paymentStatus:string; paymentAllocation:string;
  bookingStatus:string; messageReceipt:string; updateProvenance:string; firstInboundAt:string; lastInboundAt:string; owner:string;
  journeyState:string; paymentVerified:boolean;
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
export async function listProspects(){return (await crmBridge<{success:true;prospects:Prospect[]}>("/api/bna/life-skills-app/prospects")).prospects;}
export async function createProspect(input:{name:string;phone:string;language:""|"he"|"en";source:string;notes:string;nextAction:string;dueDate:string}){return crmBridge<{success:true;result:{action:"created"|"existing";leadId:string;row:number}}>("/api/bna/life-skills-app/prospects",{method:"POST",body:JSON.stringify(input)});}
export async function updateProspect(leadId:string,fields:Record<string,string>){return crmBridge(`/api/bna/life-skills-app/prospects/${encodeURIComponent(leadId)}`,{method:"PATCH",body:JSON.stringify({fields})});}
export async function sendProspectMessage(leadId:string,body:string){return crmBridge<{success:true;receipt:{provider:string;providerMessageId:string|null;sentAt:string|null;replaySuppressed?:boolean;sheetUpdated?:boolean}}>(`/api/bna/life-skills-app/prospects/${encodeURIComponent(leadId)}/send`,{method:"POST",body:JSON.stringify({body})});}
