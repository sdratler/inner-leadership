import {identityRuntime} from "@/features/identity/runtime.ts";
import {BnaInquiryStore} from "@/features/bna-inquiry/store.ts";
import {BnaPreferenceStore} from "@/features/bna-communications/preferences-store.ts";
import {publicBnaPreferenceHttp} from "@/features/bna-communications/preferences-http.ts";
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return publicBnaPreferenceHttp(request,async()=>{
 const r=await identityRuntime(),owner=process.env.LS_BNA_OWNER_ACCOUNT_ID??"",key=r.config.lookupKey.toString("hex");
 const inquiries=new BnaInquiryStore(r.store,r.config.workspaceId,r.config.keyring,key,owner,r.clock);
 return {enabled:process.env.LS_BNA_PREFERENCES_ENABLED==="true",origin:r.config.origin,limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  store:new BnaPreferenceStore(r.store,r.config.workspaceId,owner,r.config.keyring,key,r.clock,inquiries)};
});}
export const GET=handle;export const POST=handle;
