import {identityRuntime} from '@/features/identity/runtime.ts';
import {AcademyFounderStore} from '@/features/group-application/academy-founder-store.ts';
import {founderOwnerHttp} from '@/features/group-application/academy-founder-http.ts';
import {AppError} from '@/lib/errors.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request){
 return founderOwnerHttp(request,async()=>{
  if(process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED!=='true')throw new AppError('UNAVAILABLE');
  const {store,config,services,clock}=await identityRuntime(),integrity=config.lookupKey.toString('hex');
  // The free-registration release has no native enrollment or payment adapter.
  // The existing HTTP/store guards report those capabilities unavailable.
  return {runtime:{config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},
   store:new AcademyFounderStore(store,config.workspaceId,config.keyring,integrity,clock,null,null)};
 });
}
export const GET=handle;
export const POST=handle;
