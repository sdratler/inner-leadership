/** Test-only, real native commands and synthetic receipt pipeline. No provider
 * transport, production admission, source importer or application dependency. */
import {randomUUID} from 'node:crypto';
import {admitNativeCi,nativeCiTarget} from '../../database/native-ci-admission.ts';
import {programFixture} from '../../database/fishing/native-program-fixture.ts';
import {agreementAcceptanceFixture,agreementBundleFixture} from '../../fixtures/academy-agreements.ts';
import {owner03PolicyVersion} from '../../../src/features/fishing-payments/owner03-policy.ts';
import {ContactCutoverStore,type CutoverEvidence} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {FishingLeadStore} from '../../../src/features/contact-ops/server/fishing-lead-store.ts';
import {PublicGroupApplicationStore} from '../../../src/features/group-application/store.ts';
import {floridaGroupApplicationNotice} from '../../../src/features/group-application/contract.ts';
import {ACADEMY_INTAKE_VERSION} from '../../../src/features/group-application/academy-intake.ts';
import {AcademyFamilyStore} from '../../../src/features/fishing/academy-family-store.ts';
import {academyFamilyVersion} from '../../../src/features/fishing/academy-family-contract.ts';
import {AcademyRefundStore} from '../../../src/features/fishing/academy-refund-store.ts';
import {IdentityAuthService} from '../../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../../src/features/identity/rate-store.ts';
import {durableAuditSink} from '../../../src/features/identity/history.ts';
import {unseal} from '../../../src/features/identity/crypto.ts';
import {systemClock} from '../../../src/features/identity/types.ts';

const proof=(epoch:number):CutoverEvidence=>({batchId:'SYNTHETIC_REFUND_BROWSER',sourceFileId:'synthetic-only',sourceRevision:'synthetic-only',expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
export async function refundFormsFixture(origin:string,schedule?:'ordinary_sundays'){
 // Owner03 starts with the exclusive base catalog and calls this only after its upgrade.
 const upgrading=nativeCiTarget()?.suite==='tests/database/fishing/academy-owner03-upgrade.native.test.ts';
 const ci=await admitNativeCi(upgrading?['base']:['program']);
 // Native CI may publish this composition; use the existing explicit Sunday recipe.
 const physicalSchedule=schedule??(ci?'ordinary_sundays':undefined);
 if((!ci&&process.env.LS_ACADEMY_REFUND_FORMS_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY')||!/^https:\/\/localhost:310[56]$/.test(origin))throw Error('EXACT_REFUND_FORMS_TARGET_REQUIRED');
 if(schedule!==undefined&&(schedule!=='ordinary_sundays'||(!ci&&process.env.LS_ACADEMY_SAFETY_FORMS_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY')))throw Error('EXACT_SAFETY_SCHEDULE_REQUIRED');
 const f=await programFixture({capacity:4,policyVersion:owner03PolicyVersion,owner03Bundle:agreementBundleFixture(),termsDocument:'SYNTHETIC refund browser terms, not approved actual agreement.',confirmation:{kind:'all_native_dues_paid'}});
 try{
  f.config.origin=origin;const key=f.config.lookupKey.toString('hex'),cutover=new ContactCutoverStore(f.db,f.ring,key),leads=new FishingLeadStore(f.db,f.ring,key,'sunday_fishing_academy'),inquiries=new PublicGroupApplicationStore(f.db,f.workspaceId,f.ring,key),family=new AcademyFamilyStore(f.db,f.config,inquiries,leads),auth=new IdentityAuthService(f.db,f.config,systemClock),sessions=new IdentitySessions(f.db,f.config,systemClock);
  for(const [i,action]of ['prepare','freeze','switch_native'].entries())await cutover.advance(f.owner,{action:action as 'prepare'|'freeze'|'switch_native',operationId:action,proof:proof(i)});
  await f.createPlan();
  // Only the safety composition publishes these dates. Keep the refund-only
  // daily schedule unchanged; publication must obey the real operator-day gate.
  const firstSunday=new Date(f.at(48));firstSunday.setUTCHours(16,0,0,0);firstSunday.setUTCDate(firstSunday.getUTCDate()+(7-firstSunday.getUTCDay())%7);
  for(let i=0;i<8;i++){
   const startsAt=physicalSchedule===undefined?f.at(24+i*24):new Date(firstSunday.getTime()+i*7*86400000).toISOString(),endsAt=physicalSchedule===undefined?f.at(27+i*24):new Date(Date.parse(startsAt)+2*3600000).toISOString();
   if(physicalSchedule!==undefined){
    if(Date.parse(startsAt)<=Date.now()||new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(new Date(startsAt))!=='Sun')throw Error('FUTURE_SYNTHETIC_SUNDAY_REQUIRED');
    await f.pool.query("INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,'open')",[randomUUID(),f.workspaceId,f.owner.id,startsAt,endsAt]);
   }
   const p=(await f.stage(f.owner).read(f.owner,f.ref))!;await f.revise(p.occurrences[i]!.id,startsAt,endsAt);
  }
  const families=[];
  for(const locale of ['en','he']as const){
   const name=`Synthetic refund family ${locale}`,applicationId=(await inquiries.submit({operationId:randomUUID(),fields:{parentName:name,contact:locale==='en'?'+13055550171':'+13055550172',language:locale,cityArea:'Synthetic Florida',programId:'sunday_fishing_academy',scheduleContext:'program_format_interest',schedulePreference:['sunday'],academyFit:{version:'RM-FIT-20261014-04-v1',learners:[0,1].map(()=>({approximateAge:12,gear:'needs_advice' as const,experience:'new' as const})),maximumDriveMinutes:30,parentDropoff:'yes'},academyIntake:{version:ACADEMY_INTAKE_VERSION,postalCode:'33004',driveLimit:30,preferredGroupLanguage:locale,stagePreference:'foundation',keysTravel:'parent_drive',offshoreInterest:'not_interested',nextStep:'enrollment_followup',learners:[0,1].map(()=>({ageYears:12,gradeBand:'grade_6_8' as const,schooling:'school' as const,tackleBox:'need_advice' as const}))},permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:locale}}})).item.id;
   const preview=await leads.preview(f.owner,{action:'preview_add',operationId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:0,source:{kind:'inquiry',id:applicationId},relationship:'guardian'});if(preview.state!=='ready')throw Error('SYNTHETIC_LEAD_REQUIRED');await leads.confirm(f.owner,{action:'confirm',token:preview.token,confirmNewPerson:preview.newPerson});
   const context=await family.context(f.owner,applicationId);if(context.state!=='ready')throw Error('FAMILY_CONTEXT_REQUIRED');
   const parentEmail=`synthetic-refund-${locale}@example.invalid`,saved=(await family.setup(f.owner,{version:academyFamilyVersion,applicationId,operationId:randomUUID(),personId:context.personId,expectedEpoch:context.expectedEpoch,expectedAssociationVersion:context.expectedAssociationVersion,expectedFieldsDigest:context.fieldsDigest,parentEmail,locale,householdId:null,guardianVerified:true,verificationReference:'PRIVATE_SYNTHETIC_GUARDIAN',children:[0,1].map(i=>({learnerIndex:i,displayName:locale==='en'?`Synthetic child ${i+1}`:`ילד סינתטי ${i+1}`,existingLearnerId:null}))},randomUUID())).saved;
   const mail=(await f.pool.query("SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind='invite'",[f.workspaceId,saved.parentAccountId])).rows[0];await auth.consumePasswordToken('invite',JSON.parse(unseal(mail.payload_ciphertext,`auth-mail:${f.workspaceId}:${mail.id}`,f.ring)).token,'Ab12cd',randomUUID());const pre=await auth.preauth(),login=await auth.login(parentEmail,'Ab12cd',pre.token,randomUUID()),parent=await sessions.actor(login.token),purchases=[];
   for(const child of saved.children){
    const plan=(await f.stage(f.owner).read(f.owner,f.ref))!,fit={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,learnerId:child.learnerId,purpose:'enrollment' as const,decision:'approved' as const,targetOccurrenceId:null,targetRevision:null,note:'PRIVATE_SYNTHETIC_REFUND_FIT'};await f.program.recordFit(f.owner,fit);
    const acceptance={commandId:randomUUID(),id:randomUUID(),blockId:randomUUID(),stageId:f.ref.stageId,learnerId:child.learnerId,householdId:saved.householdId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash,expectedPlanRevision:plan.revision,occurrenceIds:plan.occurrences.slice(0,4).map(o=>o.id),currency:'USD',priceCents:65000,purchasedLessons:4,automaticFutureCharges:false,agreementAcceptance:agreementAcceptanceFixture()};await f.program.acceptMonthlyBlockTerms(parent,acceptance);
    const block={id:acceptance.blockId,acceptanceId:acceptance.id,occurrenceIds:acceptance.occurrenceIds},hold={commandId:randomUUID(),holdId:randomUUID(),stageId:f.ref.stageId,learnerId:child.learnerId,householdId:saved.householdId,payerAccountId:parent.id,expectedCohortRevision:1,reason:'SYNTHETIC paid purchase fixture',block};await f.program.reserveOfferHold(f.owner,hold);
    const offer={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,payerAccountId:parent.id,householdId:saved.householdId,policyApprovalId:f.policyId,expiresAt:f.at(24),lines:[{id:randomUUID(),learnerId:child.learnerId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,holdId:hold.holdId,mode:'monthly_block' as const,block,dueAt:[f.at(0)]}]};await f.program.approveOffer(f.owner,offer);const issued=await f.paymentStore.registerApprovedOffer(f.owner,randomUUID(),offer.id,1),purchaseId=issued.purchaseIds[0]!;await f.settle({family:{parent},purchaseId,offer});purchases.push({id:purchaseId,childId:child.learnerId,displayName:child.displayName});
   }
   families.push({locale,name,applicationId,parentEmail,parentId:parent.id,saved,purchases});
  }
  const store=new AcademyRefundStore(f.db,f.config,family,f.merchant),runtime={config:f.config,sessions,limits:new PostgresIdentityRateStore(f.db),audit:durableAuditSink(f.db),clock:systemClock};
  const protectedTables=['ls_service_interest.public_applications','ls_contact_ops.profiles','ls_education.guardian_authorities','ls_cases.families','ls_cases.family_members','ls_cases.cases','ls_cases.case_guardians','ls_education.account_grants','ls_calendar.appointments','ls_calendar.tasks','ls_contact_ops.outbound_projections','ls_payments.charges','ls_payments.credit_events','ls_fishing_stage.source_approvals','ls_fishing_stage.block_acceptances','ls_fishing_stage.offer_approvals','ls_fishing_stage.seat_reservations','ls_fishing_stage.enrollments','ls_fishing_payments.offers','ls_fishing_payments.purchases','ls_fishing_payments.commands','ls_fishing_payments.operations','ls_fishing_payments.outbox','ls_fishing_payments.settlements','ls_fishing_payments.inbox'];
  const protectedSnapshot=async()=>Promise.all(protectedTables.map(async table=>({table,rows:table==='ls_fishing_payments.inbox'?(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows:(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows})));
  return {...f,auth,sessions,family,store,runtime,families,protectedSnapshot};
 }catch(error){await f.close();throw error;}
}
