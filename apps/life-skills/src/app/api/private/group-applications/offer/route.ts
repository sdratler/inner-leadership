import {identityRuntime} from '@/features/identity/runtime.ts';
import {PublicGroupApplicationStore} from '@/features/group-application/store.ts';
import {FishingLeadStore} from '@/features/contact-ops/server/fishing-lead-store.ts';
import {AcademyFamilyStore} from '@/features/fishing/academy-family-store.ts';
import {AcademyOfferStore} from '@/features/fishing/academy-offer-store.ts';
import {academyOfferHttp} from '@/features/fishing/academy-offer-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const {config,store,clock,services}=await identityRuntime(),integrity=config.lookupKey.toString('hex'),family=new AcademyFamilyStore(store,config,new PublicGroupApplicationStore(store,config.workspaceId,config.keyring,integrity,clock),new FishingLeadStore(store,config.keyring,integrity,'sunday_fishing_academy',clock),clock);return {runtime:{config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},store:new AcademyOfferStore(store,config,family,clock)};}
export const GET=(request:Request)=>academyOfferHttp(request,dependencies);
export const POST=(request:Request)=>academyOfferHttp(request,dependencies);
