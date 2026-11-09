import {inquiryEmailControlRuntime,publicInquiryEmailState} from '../../../../features/group-application/academy-inquiry-email-control-runtime.ts';
import {dispatchAdmittedSignupCallback,loadSignupPopulation} from '@/features/group-application/academy-signup-population-runtime.ts';
import {identityRuntime} from "@/features/identity/runtime.ts";
import {publicGroupApplicationEnabled} from "@/features/group-application/candidate.ts";
import {publicGroupApplicationHttp} from "@/features/group-application/http.ts";
import {PublicGroupApplicationStore} from "@/features/group-application/store.ts";
import {trip390ReservationCollectionEnabled} from '@/features/group-application/academy-trip390-reservation-admission.ts';
import {inquiryEmailQueueEnabled,createInquiryEmailTransport,InquiryEmailOutbox,dispatchAdmittedTrip390Acknowledgment} from "@/features/group-application/inquiry-email.ts";
import {trip390AckQueueEnabled} from '@/features/group-application/academy-trip390-ack-admission.ts';
import {AcademyFounderStore} from '@/features/group-application/academy-founder-store.ts';
import {AcademyOwnerNotificationOutbox,createAcademyOwnerNotificationTransport} from '@/features/group-application/academy-owner-notification.ts';
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return publicGroupApplicationHttp(request,async(trip390)=>{
 const r=await identityRuntime();
 if(trip390)return {enabled:publicGroupApplicationEnabled(request),environment:process.env,
  trip390ReservationAdmitted:trip390ReservationCollectionEnabled(process.env),
  challengeKey:r.config.rateLimitKey,now:()=>r.clock.now().getTime(),limits:r.services.limits,
  store:new PublicGroupApplicationStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock,process.env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED==='true'?false:trip390AckQueueEnabled(process.env),undefined,'sunday_fishing_academy',process.env.LS_ACADEMY_OWNER_NOTIFICATION_ENABLED==='true'),
  ...(process.env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED==='true'?{afterNewTrip390Save:async(reference:string)=>{
   // The saved inquiry itself is the restart-safe recovery trigger. Queueing
   // the new encrypted verification action and its bearer is a separate SQL
   // transaction, never a transport call inside the saved-lead transaction.
   const owner=process.env.LS_ACADEMY_OWNER_NOTIFICATION_ENABLED==='true'?(async()=>{
    const mail=createAcademyOwnerNotificationTransport(process.env);
    await new AcademyOwnerNotificationOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchForApplication(reference,mail.transport,mail.from,mail.to,r.config.origin);
   })().catch(()=>undefined):Promise.resolve();
   try{
    const control=inquiryEmailControlRuntime(r,process.env);if(!control)return 'not_requested' as const;
    await control.outbox.prepareForApplication(reference);
    return publicInquiryEmailState(await control.outbox.dispatchForApplication(reference));
   }finally{await owner;}
  }}:{}),
  afterCommit:async(reference:string)=>{
   // Both intents are already durable. A transport exception cannot undo the
   // inquiry or prevent the other independent notification from being tried.
   const owner=process.env.LS_ACADEMY_OWNER_NOTIFICATION_ENABLED==='true'?(async()=>{
    const mail=createAcademyOwnerNotificationTransport(process.env);
    await new AcademyOwnerNotificationOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchForApplication(reference,mail.transport,mail.from,mail.to,r.config.origin);
   })().catch(()=>undefined):Promise.resolve();
   try{return await dispatchAdmittedTrip390Acknowledgment(reference,{
    store:r.store,workspaceId:r.config.workspaceId,keyring:r.config.keyring,clock:r.clock,
    origin:r.config.origin,digestKey:r.config.lookupKey.toString('hex')
   },process.env);}finally{await owner;}
  }};
 const founder=process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED==='true'?new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock,null,null,loadSignupPopulation(process.env,r.clock.now()),process.env.LS_ACADEMY_OWNER_NOTIFICATION_ENABLED==='true'):undefined;return {enabled:publicGroupApplicationEnabled(request),environment:process.env,
  challengeKey:r.config.rateLimitKey,now:()=>r.clock.now().getTime(),limits:r.services.limits,
  store:new PublicGroupApplicationStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock,inquiryEmailQueueEnabled(process.env),founder),
  ...(founder?{refreshFounder:(reference:string)=>r.store.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return founder.publicResult(tx,reference);})}:{}),
  afterCommit:async(reference:string)=>{
   await dispatchAdmittedSignupCallback(reference,founder,r.config.origin,process.env,r.clock.now());
   if(process.env.LS_ACADEMY_OWNER_NOTIFICATION_ENABLED==='true')try{const mail=createAcademyOwnerNotificationTransport(process.env);await new AcademyOwnerNotificationOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchForApplication(reference,mail.transport,mail.from,mail.to,r.config.origin);}catch{/* Durable row remains queued or terminal UNKNOWN; never fail or duplicate the saved registration. */}
   // Preserve the existing non-founder HTTP acknowledgment lane. Its outbox
   // lookup is restricted to INQUIRY_EMAIL_PURPOSE, never a founder purpose.
   if(!inquiryEmailQueueEnabled(process.env)||process.env.LS_INQUIRY_EMAIL_SEND_ENABLED!=="true")return undefined;
   const {transport,from}=createInquiryEmailTransport(process.env);
   return new InquiryEmailOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchForApplication(reference,transport,from);
  }};
});}
export const GET=handle;export const POST=handle;
