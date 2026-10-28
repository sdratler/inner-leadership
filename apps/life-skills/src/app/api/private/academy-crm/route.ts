import {identityRuntime} from "@/features/identity/runtime.ts";
import {AcademyCrmStore} from "@/features/contact-ops/server/academy-crm-store.ts";
import {academyCrmHttp} from "@/features/contact-ops/server/academy-crm-http.ts";
export const dynamic="force-dynamic";
async function handle(request:Request){return academyCrmHttp(request,async()=>{
 const r=await identityRuntime();
 return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),
  limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  store:new AcademyCrmStore(r.store,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock)};
});}
export const GET=handle;
export const POST=handle;
