import 'server-only';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSignupWorkerAdmission} from './academy-signup-worker-admission.ts';
import type {AcademyFounderStore} from './academy-founder-store.ts';
import type {AuthEmailTransport} from '../../providers/email/transport.ts';

/** No runtime/provider import here. Missing or mismatched policy closes before
 * transport construction. Values and recipient policy never enter logs. */
export function loadSignupPopulation(env:Readonly<Record<string,string|undefined>>,now:Date){
 if(env.LS_ACADEMY_SIGNUP_WORKER_ENABLED!=='true'||!env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON)return null;
 try{
  const sourceHash=(name:string)=>createHash('sha256').update(readFileSync(resolve(process.cwd(),name))).digest('hex');
  return createSignupWorkerAdmission(JSON.parse(env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON),{
   enabled:true,freeEnabled:env.LS_ACADEMY_FREE_REGISTRATION_ENABLED==='true',sendEnabled:env.LS_INQUIRY_EMAIL_SEND_ENABLED==='true',founderApproved:env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED==='true',
   sourceCommit:env.RAILWAY_GIT_COMMIT_SHA??'',releaseCommit:env.LIFE_SKILLS_RELEASE_COMMIT??'',workspaceId:env.LS_IDENTITY_WORKSPACE_ID??'',projectId:env.RAILWAY_PROJECT_ID??'',environmentId:env.RAILWAY_ENVIRONMENT_ID??'',serviceId:env.RAILWAY_SERVICE_ID??'',origin:env.LS_APP_ORIGIN??'',
   templateVersion:'JLFA-EXACT-COPY-20261026-05',templateModuleSha256:sourceHash('src/features/group-application/academy-founder-email.ts'),templateContractSha256:sourceHash('src/features/group-application/academy-founder-contract.ts'),templateCatalogSha256:sourceHash('src/features/group-application/academy-exact-email-copy.json'),templateFacadeSha256:sourceHash('src/features/group-application/academy-exact-copy.ts'),
   transportHashes:{gmail:sourceHash('src/providers/email/gmail.ts'),contract:sourceHash('src/providers/email/transport.ts'),resend:sourceHash('src/providers/email/resend.ts')},
  },now);
 }catch{return null;}
}
type TransportFactory=(env:Readonly<Record<string,string|undefined>>)=>{transport:AuthEmailTransport;from:string};
/** Existing post-commit callbacks use the same source and population boundary.
 * Source imports elsewhere may load provider class definitions; this loader
 * does not import/construct the effect adapter before admission. */
export async function dispatchAdmittedSignupCallback(reference:string,founder:Pick<AcademyFounderStore,'dispatchForApplication'>|undefined,origin:string,env:Readonly<Record<string,string|undefined>>,now:Date,makeTransport?:TransportFactory){
 if(!founder||env.LS_INQUIRY_EMAIL_QUEUE_ENABLED!=='true')return;
 const population=loadSignupPopulation(env,now);if(!population||origin!==population.origin)return;
 const factory=makeTransport??(await import('./inquiry-email.ts')).createInquiryEmailTransport;
 const {transport,from}=factory(env);
 await founder.dispatchForApplication(reference,transport,from,origin,population);
}
