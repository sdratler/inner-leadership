import {identityRuntime} from "@/features/identity/runtime.ts";
import {FishingInquiryFollowupStore} from "@/features/group-application/fishing-followup-store.ts";
import {fishingFollowupHttp} from "@/features/group-application/fishing-followup-http.ts";

export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return fishingFollowupHttp(request,async()=>{
 const r=await identityRuntime();return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),
  csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  store:new FishingInquiryFollowupStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),
   process.env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID??"",r.clock)};
});}
export const GET=handle;export const POST=handle;
