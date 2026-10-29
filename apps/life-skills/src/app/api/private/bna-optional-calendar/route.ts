import {identityRuntime} from '@/features/identity/runtime.ts';
import {BnaInquiryStore} from '@/features/bna-inquiry/store.ts';
import {BnaPreferenceStore} from '@/features/bna-communications/preferences-store.ts';
import {BnaOptionalCalendarStore} from '@/features/bna-communications/optional-calendar-store.ts';
import {privateBnaOptionalCalendarHttp} from '@/features/bna-communications/optional-calendar-http.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request){return privateBnaOptionalCalendarHttp(request,async()=>{
 const r=await identityRuntime(),owner=process.env.LS_BNA_OWNER_ACCOUNT_ID??'',key=r.config.lookupKey.toString('hex');
 const inquiries=new BnaInquiryStore(r.store,r.config.workspaceId,r.config.keyring,key,owner,r.clock);
 const preferences=new BnaPreferenceStore(r.store,r.config.workspaceId,owner,r.config.keyring,key,r.clock,inquiries);
 return {enabled:process.env.LS_BNA_OPTIONAL_CALENDAR_ENABLED==='true'&&process.env.LS_BNA_PREFERENCES_ENABLED==='true',origin:r.config.origin,
  actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  // No live optional sender/approval admission or provider adapter is mounted.
  store:new BnaOptionalCalendarStore(r.store,r.config.workspaceId,owner,r.config.keyring,key,r.clock,inquiries,preferences)};
});}
export const GET=handle;export const POST=handle;
