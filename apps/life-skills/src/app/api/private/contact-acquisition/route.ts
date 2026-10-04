import {identityRuntime} from "@/features/identity/runtime.ts";
import {ContactCutoverStore} from "@/features/contact-ops/server/cutover-store.ts";
import {AcquisitionDecisionStore} from "@/features/contact-ops/server/acquisition-decisions.ts";
import {acquisitionHttp} from "@/features/contact-ops/server/acquisition-http.ts";
export const dynamic="force-dynamic";
async function handle(request:Request){return acquisitionHttp(request,async()=>{
 const r=await identityRuntime(),key=r.config.lookupKey.toString("hex");
 return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),
  authority:new ContactCutoverStore(r.store,r.config.keyring,key,r.clock),
  store:new AcquisitionDecisionStore(r.store,r.config.keyring,key,r.clock)};
});}
export const GET=handle;
export const POST=handle;
