import {identityRuntime} from "@/features/identity/runtime.ts";
import {FishingLeadStore} from "@/features/contact-ops/server/fishing-lead-store.ts";
import {fishingLeadHttp} from "@/features/contact-ops/server/fishing-lead-http.ts";
export const dynamic="force-dynamic";
async function handle(request:Request,{params}:{params:Promise<{program:string}>}){
 const {program}=await params;
 return fishingLeadHttp(request,program,async trustedProgram=>{
  const r=await identityRuntime();return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),
   csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
   store:new FishingLeadStore(r.store,r.config.keyring,r.config.lookupKey.toString("hex"),trustedProgram,r.clock)};
 });
}
export const GET=handle;
export const POST=handle;
