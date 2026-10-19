import {identityRuntime} from '@/features/identity/runtime.ts';
import {PublicGroupApplicationStore} from '@/features/group-application/store.ts';
import {FishingLeadStore} from '@/features/contact-ops/server/fishing-lead-store.ts';
import {AcademyFamilyStore} from '@/features/fishing/academy-family-store.ts';
import {academyFamilyHttp} from '@/features/fishing/academy-family-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const {config,store,clock,services}=await identityRuntime(),integrity=config.lookupKey.toString('hex');return {runtime:{config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},store:new AcademyFamilyStore(store,config,new PublicGroupApplicationStore(store,config.workspaceId,config.keyring,integrity,clock),new FishingLeadStore(store,config.keyring,integrity,'sunday_fishing_academy',clock),clock)};}
export const GET=(request:Request)=>academyFamilyHttp(request,dependencies);
export const POST=(request:Request)=>academyFamilyHttp(request,dependencies);
