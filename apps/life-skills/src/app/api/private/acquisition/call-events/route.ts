import {identityRuntime} from "@/features/identity/runtime.ts";
import {receiveCallEvent} from "@/features/contact-ops/server/call-events-http.ts";
import {CallEventsStore} from "@/features/contact-ops/server/call-events-store.ts";
export const dynamic="force-dynamic";
export async function POST(request:Request){return receiveCallEvent(request,process.env,async()=>{
 const r=await identityRuntime();return {origin:r.config.origin,workspaceId:r.config.workspaceId,
  rateLimitKey:r.config.rateLimitKey,limits:r.services.limits,capture:(event,binding)=>
   new CallEventsStore(r.store,r.config.workspaceId,binding,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock).capture(event)};
});}
