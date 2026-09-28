import {identityRuntime} from "@/features/identity/runtime.ts";
import {OperationalNativeCrmStore} from "@/features/contact-ops/server/operational-store.ts";
import {nativeProfileHttp} from "@/features/contact-ops/server/profile-http.ts";
export const dynamic="force-dynamic";
async function handle(request:Request){return nativeProfileHttp(request,async()=>{
 const r=await identityRuntime();
 return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),
  store:new OperationalNativeCrmStore(r.store,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock)};
});}
export const GET=handle;
export const POST=handle;
