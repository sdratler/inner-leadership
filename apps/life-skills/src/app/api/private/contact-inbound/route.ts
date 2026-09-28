import {identityRuntime} from "@/features/identity/runtime.ts";
import {ContactInboundStore} from "@/features/contact-ops/server/inbound-store.ts";
import {receiveContactInquiry} from "@/features/contact-ops/server/inbound-http.ts";
import {readInboundInbox} from "@/features/contact-ops/server/inbound-reader.ts";
export const dynamic="force-dynamic";
export async function POST(request:Request){return receiveContactInquiry(request,process.env,async binding=>{
 const r=await identityRuntime();
 return new ContactInboundStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),binding,r.clock);
});}
export async function GET(request:Request){return readInboundInbox(request,async()=>{
 const r=await identityRuntime();
 return {origin:r.config.origin,captureEnabled:process.env.LS_CONTACT_INBOUND_ENABLED==="true",
  bindingConfigured:/^[a-f0-9]{64}$/.test(process.env.LS_CONTACT_INBOUND_BINDING_SHA256??""),
  actor:(token:string)=>r.services.sessions.actor(token),
  store:new ContactInboundStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),null,r.clock)};
});}
