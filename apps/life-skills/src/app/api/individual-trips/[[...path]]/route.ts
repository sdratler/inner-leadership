import { after } from 'next/server';
import { individualTripsRuntime } from '@/features/individual-trips/runtime.ts';
import { scheduleRegistrationDelivery } from '@/features/individual-trips/registration-mail.ts';
import { canonicalForwardedRequest } from '@/features/integration/canonical-forwarded-request.ts';
import { failureResponse } from '@/lib/http/json.ts';
import { AppError } from '@/lib/errors.ts';
import { newRequestId } from '@/lib/ids.ts';
import { deliverTripOperationalMail } from '@/features/individual-trips/operational-mail.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request){
 try{
  const runtime=await individualTripsRuntime(),canonical=canonicalForwardedRequest(request);
  if(new URL(canonical.url).pathname==='/api/individual-trips/chat'){
   if(!runtime.chat)return failureResponse(new AppError('UNAVAILABLE'),newRequestId());
   const response=await runtime.chat.handle(canonical);
   scheduleOperational(runtime);return response;
  }
  const response=await runtime.http.handle(canonical);
  try{await scheduleRegistrationDelivery(canonical,response,runtime.identity,process.env,after,runtime.registrationAdmission);}catch{console.error('FISHING_REGISTRATION_SCHEDULING_FAILED');}
  scheduleOperational(runtime);
  return response;
 }catch{return failureResponse(new AppError('UNAVAILABLE'),newRequestId());}
}
function scheduleOperational(runtime:Awaited<ReturnType<typeof individualTripsRuntime>>){
 if(!runtime.operationalAdmission)return;
 const jobs=runtime.committed.slice();
 for(const job of jobs)after(async()=>{try{await deliverTripOperationalMail({store:runtime.identity.store,identity:runtime.identity.config,tripConfig:runtime.config,clock:runtime.identity.clock,trips:runtime.trips,actor:job.actor},job.operationId,process.env,runtime.operationalAdmission);}catch{console.error('FISHING_OPERATIONAL_DELIVERY_FAILED');}});
}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
export const DELETE=handle;
export const PATCH=handle;
export const HEAD=handle;
export const OPTIONS=handle;
