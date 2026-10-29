import {identityRuntime} from "@/features/identity/runtime.ts";
import {Owner305InquiryLinkStore} from "@/features/conversation-305/inquiry-link-store.ts";
import {owner305InquiryLinkHttp} from "@/features/conversation-305/inquiry-link-http.ts";
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return owner305InquiryLinkHttp(request,async()=>{
 const r=await identityRuntime();return {enabled:process.env.LS_305_CLASSIFICATION_ENABLED==="true"&&process.env.LS_305_INQUIRY_LINK_ENABLED==="true",origin:r.config.origin,
  actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  store:new Owner305InquiryLinkStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),process.env.LS_BNA_OWNER_ACCOUNT_ID??"",process.env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID??"",r.clock)};
});}
export const GET=handle;export const POST=handle;
