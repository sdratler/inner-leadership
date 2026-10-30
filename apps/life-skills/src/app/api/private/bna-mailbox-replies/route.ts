import {identityRuntime} from '@/features/identity/runtime.ts';
import {bnaCommunicationReviewStores} from '@/features/bna-communications/review-runtime.ts';
import {privateBnaReplyHttp} from '@/features/bna-communications/reply-http.ts';
import {readBnaReplyMonitorPolicy,bnaReplyMonitorBinding} from '@/features/bna-communications/reply-monitor-admission.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request){return privateBnaReplyHttp(request,async()=>{
 const r=await identityRuntime(),enabled=process.env.LS_BNA_MAILBOX_REPLIES_ENABLED==='true'&&process.env.LS_BNA_PREFERENCES_ENABLED==='true';
 const stores=bnaCommunicationReviewStores({db:r.store,workspace:r.config.workspaceId,owner:process.env.LS_BNA_OWNER_ACCOUNT_ID??'',ring:r.config.keyring,key:r.config.lookupKey.toString('hex'),clock:r.clock,repliesEnabled:enabled,monitorAdmission:()=>{const p=readBnaReplyMonitorPolicy(process.env,r.clock.now());return p?bnaReplyMonitorBinding(p):null;}});
 return {enabled,origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),
  limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,store:stores.replies,monitor:stores.monitor};
});}
export const GET=handle;export const POST=handle;
