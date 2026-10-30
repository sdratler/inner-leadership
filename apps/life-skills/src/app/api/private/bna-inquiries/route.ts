import {identityRuntime} from "@/features/identity/runtime.ts";
import {bnaCommunicationReviewStores} from '@/features/bna-communications/review-runtime.ts';
import {privateBnaInquiryHttp} from "@/features/bna-inquiry/http.ts";
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return privateBnaInquiryHttp(request,async()=>{
 const r=await identityRuntime();const stores=bnaCommunicationReviewStores({db:r.store,workspace:r.config.workspaceId,owner:process.env.LS_BNA_OWNER_ACCOUNT_ID??'',ring:r.config.keyring,key:r.config.lookupKey.toString('hex'),clock:r.clock,repliesEnabled:process.env.LS_BNA_MAILBOX_REPLIES_ENABLED==='true'&&process.env.LS_BNA_PREFERENCES_ENABLED==='true'});
 return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),
  csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  ...(process.env.LS_BNA_EMAIL_QUEUE_ENABLED==="true"?{communications:stores.acknowledgments}:{}),
  ...(stores.replies?{replyReviews:stores.replies}:{}),store:stores.inquiries};
});}
export const GET=handle;export const POST=handle;
