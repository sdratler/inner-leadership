import {identityRuntime} from "@/features/identity/runtime.ts";
import {BnaInquiryStore} from "@/features/bna-inquiry/store.ts";
import {publicBnaInquiryHttp} from "@/features/bna-inquiry/http.ts";
import {configuredBnaAcknowledgmentQueue} from "@/features/bna-communications/acknowledgment-store.ts";
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return publicBnaInquiryHttp(request,async()=>{
 const r=await identityRuntime();return {enabled:process.env.LS_BNA_INQUIRY_ENABLED==="true"&&process.env.LS_BNA_SUPPORT_INQUIRY_ENABLED==="true",environment:process.env,
  challengeKey:r.config.rateLimitKey,now:()=>r.clock.now().getTime(),limits:r.services.limits,
  store:new BnaInquiryStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),process.env.LS_BNA_OWNER_ACCOUNT_ID??"",r.clock,
   configuredBnaAcknowledgmentQueue(process.env,r.config.keyring,r.config.lookupKey.toString("hex")))};
},"support");}
export const GET=handle;export const POST=handle;
