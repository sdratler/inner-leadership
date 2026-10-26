import {dispatchAdmittedSignupCallback,loadSignupPopulation} from '@/features/group-application/academy-signup-population-runtime.ts';
import {identityRuntime} from '@/features/identity/runtime.ts';
import {AcademyFounderStore} from '@/features/group-application/academy-founder-store.ts';
import {founderPublicHttp} from '@/features/group-application/academy-founder-http.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request){return founderPublicHttp(request,async()=>{
 const r=await identityRuntime(),founder=new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock,null,null,loadSignupPopulation(process.env,r.clock.now()));
 return {enabled:process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED==='true',store:founder,environment:process.env,limits:r.services.limits,rateKey:r.config.rateLimitKey,
  afterConfirm:async(reference:string)=>{
   await dispatchAdmittedSignupCallback(reference,founder,r.config.origin,process.env,r.clock.now());
  }};
});}
export const GET=handle;export const POST=handle;
