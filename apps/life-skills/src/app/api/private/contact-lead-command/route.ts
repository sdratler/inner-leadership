import {identityRuntime} from "@/features/identity/runtime.ts";
import {LeadCommandStore} from "@/features/contact-ops/server/lead-command-store.ts";
import {leadCommandHttp} from "@/features/contact-ops/server/lead-command-http.ts";
export const dynamic="force-dynamic";
export async function POST(request:Request){return leadCommandHttp(request,async()=>{
 const r=await identityRuntime();return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),
  csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  store:new LeadCommandStore(r.store,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock)};
});}
