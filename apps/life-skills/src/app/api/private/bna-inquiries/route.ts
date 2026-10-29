import {identityRuntime} from "@/features/identity/runtime.ts";
import {BnaInquiryStore} from "@/features/bna-inquiry/store.ts";
import {privateBnaInquiryHttp} from "@/features/bna-inquiry/http.ts";
import {BnaAcknowledgmentStore} from "@/features/bna-communications/acknowledgment-store.ts";
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return privateBnaInquiryHttp(request,async()=>{
 const r=await identityRuntime();return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),
  csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  ...(process.env.LS_BNA_EMAIL_QUEUE_ENABLED==="true"?{communications:new BnaAcknowledgmentStore(r.store,r.config.workspaceId,process.env.LS_BNA_OWNER_ACCOUNT_ID??"",r.config.keyring,r.config.lookupKey.toString("hex"),r.clock)}:{}),
  store:new BnaInquiryStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),
   process.env.LS_BNA_OWNER_ACCOUNT_ID??"",r.clock)};
});}
export const GET=handle;export const POST=handle;
