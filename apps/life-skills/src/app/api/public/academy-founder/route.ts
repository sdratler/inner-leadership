import {identityRuntime} from '@/features/identity/runtime.ts';
import {AcademyFounderStore} from '@/features/group-application/academy-founder-store.ts';
import {createInquiryEmailTransport,inquiryEmailQueueEnabled} from '@/features/group-application/inquiry-email.ts';
import {founderPublicHttp} from '@/features/group-application/academy-founder-http.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request){return founderPublicHttp(request,async()=>{
 const r=await identityRuntime(),founder=new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock);
 return {enabled:process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED==='true',store:founder,environment:process.env,limits:r.services.limits,rateKey:r.config.rateLimitKey,
  afterConfirm:async(reference:string)=>{
   if(!inquiryEmailQueueEnabled(process.env)||process.env.LS_INQUIRY_EMAIL_SEND_ENABLED!=='true'||process.env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED!=='true')return;
   const {transport,from}=createInquiryEmailTransport(process.env);
   await founder.dispatchForApplication(reference,transport,from,r.config.origin);
  }};
});}
export const GET=handle;export const POST=handle;
