import {identityRuntime} from '@/features/identity/runtime.ts';
import {PublicGroupApplicationStore} from '@/features/group-application/store.ts';
import {FishingLeadStore} from '@/features/contact-ops/server/fishing-lead-store.ts';
import {AcademyFamilyStore} from '@/features/fishing/academy-family-store.ts';
import {AcademyBillingStore} from '@/features/fishing/academy-billing-store.ts';
import {academyBillingHttp} from '@/features/fishing/academy-billing-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const {config,store,clock,services}=await identityRuntime(),integrity=config.lookupKey.toString('hex'),family=new AcademyFamilyStore(store,config,new PublicGroupApplicationStore(store,config.workspaceId,config.keyring,integrity,clock),new FishingLeadStore(store,config.keyring,integrity,'sunday_fishing_academy',clock),clock);
 // Existing native reads only until Root installs the independently admitted
 // TEST merchant/runtime. No env flag or synthetic provider establishes it.
 return {runtime:{config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},store:new AcademyBillingStore(store,config,family,null,clock)};}
export const GET=(request:Request)=>academyBillingHttp(request,dependencies);
export const POST=(request:Request)=>academyBillingHttp(request,dependencies);
