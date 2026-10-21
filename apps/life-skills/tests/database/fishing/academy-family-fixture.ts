/** Actual retained SQL/auth/CSRF setup; disposable synthetic identities only.
 * Reading the isolated encrypted invitation here is test delivery, NOT mail or
 * production-token access. No provider transport or merchant action runs. */
import {randomUUID} from 'node:crypto';
import {afterEach,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {programFixture,type ProgramFixture} from './native-program-fixture.ts';
import {ContactCutoverStore,type CutoverEvidence} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {FishingLeadStore} from '../../../src/features/contact-ops/server/fishing-lead-store.ts';
import {PublicGroupApplicationStore} from '../../../src/features/group-application/store.ts';
import {floridaGroupApplicationNotice} from '../../../src/features/group-application/contract.ts';
import {ACADEMY_INTAKE_VERSION} from '../../../src/features/group-application/academy-intake.ts';
import {AcademyFamilyStore} from '../../../src/features/fishing/academy-family-store.ts';
import {academyFamilyHttp} from '../../../src/features/fishing/academy-family-http.ts';
import {academyFamilyVersion,type AcademyFamilyCommand} from '../../../src/features/fishing/academy-family-contract.ts';
import {IdentityAuthService} from '../../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../../src/features/identity/rate-store.ts';
import {durableAuditSink} from '../../../src/features/identity/history.ts';
import {systemClock} from '../../../src/features/identity/types.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
const fixtures:ProgramFixture[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
const proof=(epoch:number):CutoverEvidence=>({batchId:'SYNTHETIC_FAMILY_SETUP',sourceFileId:'synthetic-sheet',sourceRevision:'synthetic-only',expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true}); // Fixture only; no real cutover evidence.
export async function academyFamilyFixture(options:Parameters<typeof programFixture>[0]={}){
 const f=await programFixture(options);fixtures.push(f);const key=f.config.lookupKey.toString('hex'),cutover=new ContactCutoverStore(f.db,f.ring,key),leads=new FishingLeadStore(f.db,f.ring,key,'sunday_fishing_academy'),inquiries=new PublicGroupApplicationStore(f.db,f.workspaceId,f.ring,key);
 for(const [i,action]of ['prepare','freeze','switch_native'].entries())await cutover.advance(f.owner,{action:action as 'prepare'|'freeze'|'switch_native',operationId:action,proof:proof(i)});
 const store=new AcademyFamilyStore(f.db,f.config,inquiries,leads),auth=new IdentityAuthService(f.db,f.config,systemClock),sessions=new IdentitySessions(f.db,f.config,systemClock),runtime={config:f.config,sessions,limits:new PostgresIdentityRateStore(f.db),audit:durableAuditSink(f.db),clock:systemClock};
 const passwordLogin=async(email:string)=>{const pre=await auth.preauth();return (await auth.login(email,'Ab12cd',pre.token,randomUUID())).token;};
 const token=await passwordLogin(f.owner.id+'@example.invalid'),owner=await sessions.actor(token),csrf=sessions.csrf(token),origin=f.config.origin,endpoint='/api/private/group-applications/family';
 const get=(applicationId:string,session=token)=>academyFamilyHttp(new Request(origin+endpoint+'?applicationId='+applicationId,{headers:{cookie:SESSION_COOKIE+'='+session}}),async()=>({runtime,store}));
 const post=(body:AcademyFamilyCommand,headers:Record<string,string>={},session=token)=>academyFamilyHttp(new Request(origin+endpoint,{method:'POST',headers:{cookie:SESSION_COOKIE+'='+session,origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf,'idempotency-key':body.operationId,...headers},body:JSON.stringify(body)}),async()=>({runtime,store}));
 const inquiry=async(label='Synthetic owner setup',learnerCount=1)=>{if(!Number.isInteger(learnerCount)||learnerCount<1||learnerCount>10)throw Error('SYNTHETIC_LEARNER_COUNT_REQUIRED');return (await inquiries.submit({operationId:randomUUID(),fields:{parentName:label,contact:'+13055550182',language:'en',cityArea:'Synthetic Florida',programId:'sunday_fishing_academy',scheduleContext:'program_format_interest',schedulePreference:['sunday'],academyFit:{version:'RM-FIT-20261014-04-v1',learners:Array.from({length:learnerCount},()=>({approximateAge:12,gear:'needs_advice' as const,experience:'new' as const})),maximumDriveMinutes:30,parentDropoff:'yes'},academyIntake:{version:ACADEMY_INTAKE_VERSION,postalCode:'33004',driveLimit:30,preferredGroupLanguage:'en',stagePreference:'foundation',keysTravel:'parent_drive',offshoreInterest:'not_interested',nextStep:'enrollment_followup',learners:Array.from({length:learnerCount},()=>({ageYears:12,gradeBand:'grade_6_8' as const,schooling:'school' as const,tackleBox:'need_advice' as const}))},permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}}})).item.id;};
 const promote=async(applicationId:string)=>{const preview=await leads.preview(owner,{action:'preview_add',operationId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:0,source:{kind:'inquiry',id:applicationId},relationship:'guardian'});if(preview.state!=='ready')throw Error('READY_NATIVE_LEAD_REQUIRED');return leads.confirm(owner,{action:'confirm',token:preview.token,confirmNewPerson:preview.newPerson});};
 const command=async(applicationId:string):Promise<AcademyFamilyCommand>=>{const response=await get(applicationId);expect(response.status).toBe(200);const c=(await response.json()).data;expect(c.state).toBe('ready');return {version:academyFamilyVersion,applicationId,operationId:randomUUID(),personId:c.personId,expectedEpoch:c.expectedEpoch,expectedAssociationVersion:c.expectedAssociationVersion,expectedFieldsDigest:c.fieldsDigest,parentEmail:'synthetic-parent@example.invalid',locale:'en',householdId:null,guardianVerified:true,verificationReference:'PRIVATE_GUARDIAN_EVIDENCE',children:[{learnerIndex:0,displayName:'Synthetic Academy child',existingLearnerId:null}]};};
 const protectedState=async()=>Promise.all(['ls_cases.cases','ls_cases.case_guardians','ls_education.account_grants','ls_calendar.appointments','ls_calendar.tasks','ls_fishing_stage.enrollments','ls_fishing_payments.purchases','ls_payments.charges','ls_payments.credit_events','ls_contact_ops.outbound_projections'].map(async table=>({table,rows:(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows})));
 return {...f,auth,sessions,token,owner,leads,inquiries,store,runtime,get,post,inquiry,promote,command,passwordLogin,protectedState};
}
