import {identityRuntime} from '@/features/identity/runtime.ts';
import {AcademyFounderStore} from '@/features/group-application/academy-founder-store.ts';
import {founderPublicHttp} from '@/features/group-application/academy-founder-http.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request){return founderPublicHttp(request,async()=>{const r=await identityRuntime();return {enabled:process.env.LS_ACADEMY_FREE_REGISTRATION_ENABLED==='true',store:new AcademyFounderStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString('hex'),r.clock),environment:process.env,limits:r.services.limits,rateKey:r.config.rateLimitKey};});}
export const GET=handle;export const POST=handle;
