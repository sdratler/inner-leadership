import {identityRuntime} from "@/features/identity/runtime.ts";
import {publicGroupApplicationEnabled} from "@/features/group-application/candidate.ts";
import {publicGroupApplicationHttp} from "@/features/group-application/http.ts";
import {PublicGroupApplicationStore} from "@/features/group-application/store.ts";
import {inquiryEmailQueueEnabled,createInquiryEmailTransport,InquiryEmailOutbox} from "@/features/group-application/inquiry-email.ts";
import {AcademyFounderStore} from '@/features/group-application/academy-founder-store.ts';
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return publicGroupApplicationHttp(request,async()=>{
 const r=await identityRuntime(),founder=process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED==='true'?new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock):undefined;return {enabled:publicGroupApplicationEnabled(request),environment:process.env,
  challengeKey:r.config.rateLimitKey,now:()=>r.clock.now().getTime(),limits:r.services.limits,
  store:new PublicGroupApplicationStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock,inquiryEmailQueueEnabled(process.env),founder),
  ...(founder?{refreshFounder:(reference:string)=>r.store.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return founder.publicResult(tx,reference);})}:{}),
  afterCommit:async(reference:string)=>{
   if(!inquiryEmailQueueEnabled(process.env)||process.env.LS_INQUIRY_EMAIL_SEND_ENABLED!=="true")return undefined;
   const {transport,from}=createInquiryEmailTransport(process.env);
   if(founder&&process.env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED==='true')await founder.dispatchForApplication(reference,transport,from,r.config.origin);
   return new InquiryEmailOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchForApplication(reference,transport,from);
  }};
});}
export const GET=handle;export const POST=handle;
