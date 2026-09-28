import {identityRuntime} from "@/features/identity/runtime.ts";
import {ContactCutoverStore} from "@/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "@/features/contact-ops/server/operational-store.ts";
import {peopleHttp} from "@/features/contact-ops/server/people-http.ts";
export const dynamic="force-dynamic";
export async function GET(request:Request){return peopleHttp(request,async()=>{
 const r=await identityRuntime(),key=r.config.lookupKey.toString("hex");
 return {origin:r.config.origin,now:()=>r.clock.now(),actor:(token:string)=>r.services.sessions.actor(token),
  authority:new ContactCutoverStore(r.store,r.config.keyring,key,r.clock),
  directory:new OperationalNativeCrmStore(r.store,r.config.keyring,key,r.clock)};
});}
