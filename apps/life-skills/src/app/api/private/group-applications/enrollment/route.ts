import {identityRuntime} from '@/features/identity/runtime.ts';
import {PublicGroupApplicationStore} from '@/features/group-application/store.ts';
import {FishingLeadStore} from '@/features/contact-ops/server/fishing-lead-store.ts';
import {AcademyFamilyStore} from '@/features/fishing/academy-family-store.ts';
import {AcademyEnrollmentStore} from '@/features/fishing/academy-enrollment-store.ts';
import {academyEnrollmentHttp} from '@/features/fishing/academy-enrollment-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const {config,store,clock,services}=await identityRuntime(),integrity=config.lookupKey.toString('hex'),family=new AcademyFamilyStore(store,config,new PublicGroupApplicationStore(store,config.workspaceId,config.keyring,integrity,clock),new FishingLeadStore(store,config.keyring,integrity,'sunday_fishing_academy',clock),clock);return {runtime:{config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},store:new AcademyEnrollmentStore(store,config,family,clock)};}
export const GET=(request:Request)=>academyEnrollmentHttp(request,dependencies);
export const POST=(request:Request)=>academyEnrollmentHttp(request,dependencies);
