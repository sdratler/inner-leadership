import {identityRuntime} from '@/features/identity/runtime.ts';
import {PublicGroupApplicationStore} from '@/features/group-application/store.ts';
import {FishingLeadStore} from '@/features/contact-ops/server/fishing-lead-store.ts';
import {AcademyFamilyStore} from '@/features/fishing/academy-family-store.ts';
import {AcademyHostedStore} from '@/features/fishing/academy-hosted-store.ts';
import {academyHostedHttp} from '@/features/fishing/academy-hosted-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const {config,store,clock,services}=await identityRuntime(),integrity=config.lookupKey.toString('hex'),family=new AcademyFamilyStore(store,config,new PublicGroupApplicationStore(store,config.workspaceId,config.keyring,integrity,clock),new FishingLeadStore(store,config.keyring,integrity,'sunday_fishing_academy',clock),clock);
 // Root installs a separately verified actual TEST capability only after its
 // effect/merchant/customer/expiry gates. Flags or request claims cannot do so.
 return {runtime:{config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},store:new AcademyHostedStore(store,config,family,null,clock)};}
export const POST=(request:Request)=>academyHostedHttp(request,dependencies);
