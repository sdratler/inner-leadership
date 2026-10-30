import {identityRuntime} from '@/features/identity/runtime.ts';
import {bnaCommunicationReviewStores} from '@/features/bna-communications/review-runtime.ts';
import {privateBnaOptionalCalendarHttp} from '@/features/bna-communications/optional-calendar-http.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request){return privateBnaOptionalCalendarHttp(request,async()=>{
 const r=await identityRuntime(),owner=process.env.LS_BNA_OWNER_ACCOUNT_ID??'',key=r.config.lookupKey.toString('hex');
 const stores=bnaCommunicationReviewStores({db:r.store,workspace:r.config.workspaceId,owner,ring:r.config.keyring,key,clock:r.clock,repliesEnabled:process.env.LS_BNA_MAILBOX_REPLIES_ENABLED==='true'&&process.env.LS_BNA_PREFERENCES_ENABLED==='true'});
 return {enabled:process.env.LS_BNA_OPTIONAL_CALENDAR_ENABLED==='true'&&process.env.LS_BNA_PREFERENCES_ENABLED==='true',origin:r.config.origin,
  actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  // No live optional sender/approval admission or provider adapter is mounted.
  store:stores.calendar};
});}
export const GET=handle;export const POST=handle;
