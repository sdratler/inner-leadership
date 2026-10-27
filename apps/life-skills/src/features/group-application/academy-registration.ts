import {z} from 'zod';
import {academyCommunicationPreferencesSchema} from './academy-communication-preferences.ts';
import {academyRegistrationAcknowledgmentsSchema} from './academy-registration-acknowledgments.ts';
import {academyRegistrationNotice,academyRegistrationNoticeHashes,academyExact05RegistrationNotice,academyExact05RegistrationNoticeHashes,academyLegacyRegistrationNotice,academyLegacyRegistrationNoticeHashes,academyPreviousFreeRegistrationNotice,academyPreviousFreeRegistrationNoticeHashes,academyNoticeHashes} from './academy-registration-notice.ts';
export const ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION='JLFA-FREE-REGISTRATION-20261023-03-v3' as const;
export const ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION='JLFA-FREE-REGISTRATION-20261025-03-v4' as const;
export const ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION='JLFA-FREE-REGISTRATION-20261026-05-v5' as const;
export const ACADEMY_REGISTRATION_VERSION='JLFA-FREE-REGISTRATION-20261027-06-v6' as const;
/** Historical free registrations retain their original eligibility and replay semantics. */
export function isFreeAcademyRegistrationVersion(version:string|undefined){return version===ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION||version===ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION||version===ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION||version===ACADEMY_REGISTRATION_VERSION;}
export function isFoundationAcademyRegistrationVersion(version:string|undefined){return version===ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION||version===ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION||version===ACADEMY_REGISTRATION_VERSION;}
export const academyExactGradeSchema=z.enum(['3','4','5','6','7','8','9','10','11','12']);
export const registrationDaySchema=z.enum(['sunday','monday','tuesday','wednesday','thursday','friday','flexible']);
export const registrationTimeSchema=z.enum(['morning','afternoon','evening','flexible']);
const flexibleExclusive=(v:string[])=>new Set(v).size===v.length&&(!v.includes('flexible')||v.length===1);
export const academyRegistrationSchema=z.object({
 version:z.enum(['JLFA-REGISTRATION-20261020-01-v1','JLFA-REGISTRATION-20261020-OWNER03-v2',ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION,ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION,ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION,ACADEMY_REGISTRATION_VERSION]),
 learners:z.array(z.object({id:z.string().uuid(),fullName:z.string().trim().min(1).max(120),ageYears:z.number().int().min(0).max(17),grade:academyExactGradeSchema,schooling:z.enum(['school','homeschool','discuss']),experience:z.enum(['new','some','experienced','not_sure'])}).strict()).min(1).max(10),
 postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
 preferredDays:z.array(registrationDaySchema).min(1).max(7).refine(flexibleExclusive,'flexible_exclusive'),
 preferredTimes:z.array(registrationTimeSchema).min(1).max(4).refine(flexibleExclusive,'flexible_exclusive'),
 driveMinutes:z.number().int().min(5).max(120),
 schoolHoursAvailability:z.enum(['flexible','permission_needed','outside_school_only','discuss']),
 preferredGroupLanguage:z.enum(['en','he','either']),
 stageInterest:z.enum(['foundation','independent','advanced','leadership','discuss']),
 optionalNotes:z.string().trim().max(600).optional(),
 keysInterest:z.enum(['interested','not_interested','discuss']).optional(),
 offshoreInterest:z.enum(['interested','not_interested','discuss']).optional(),
 receiptEmail:z.string().trim().email().max(254).transform(s=>s.toLowerCase()).optional(),
 intent:z.enum(['information','pay']),
 paymentSelection:z.object({childId:z.string().uuid(),plan:z.enum(['prepay','installments','monthly_block']),acceptedOfferId:z.string().uuid().optional(),offerRevision:z.number().int().positive().optional()}).strict().optional(),
 communicationPreferences:academyCommunicationPreferencesSchema.optional(),
 acknowledgments:academyRegistrationAcknowledgmentsSchema.optional(),
 consent:z.object({kind:z.literal('registration_contact'),documentId:z.literal(academyRegistrationNotice.id),version:z.enum([academyLegacyRegistrationNotice.version,academyPreviousFreeRegistrationNotice.version,academyExact05RegistrationNotice.version,academyRegistrationNotice.version]),language:z.enum(['en','he']),textSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
}).strict().superRefine((v,c)=>{
 if(v.communicationPreferences&&(!isFreeAcademyRegistrationVersion(v.version)||v.communicationPreferences.notice.language!==v.consent.language))c.addIssue({code:'custom',path:['communicationPreferences'],message:'communication_registration_notice_mismatch'});
 // Explicit proposed entry only. Never default/transform old answers or infer private history.
 if(isFoundationAcademyRegistrationVersion(v.version)&&v.stageInterest!=='foundation')c.addIssue({code:'custom',path:['stageInterest'],message:'foundation_proposed_entry_required'});
 if(isFreeAcademyRegistrationVersion(v.version)){
  if(!v.receiptEmail)c.addIssue({code:'custom',path:['receiptEmail'],message:'email_required'});
  if(v.intent!=='information'||v.paymentSelection)c.addIssue({code:'custom',path:['paymentSelection'],message:'free_registration_no_payment'});
  const expectedNotice=v.version===ACADEMY_REGISTRATION_VERSION?academyRegistrationNotice:v.version===ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION?academyExact05RegistrationNotice:academyPreviousFreeRegistrationNotice;
  if(v.consent.version!==expectedNotice.version)c.addIssue({code:'custom',path:['consent'],message:'free_registration_terms_required'});
  if(v.version===ACADEMY_REGISTRATION_VERSION){
   if(v.communicationPreferences?.version!=='academy-parent-communication-preferences-v2')c.addIssue({code:'custom',path:['communicationPreferences'],message:'current_whatsapp_only_preferences_required'});
   if(!v.acknowledgments)c.addIssue({code:'custom',path:['acknowledgments'],message:'current_acknowledgments_required'});
   else{
    const expected=v.learners.map(learner=>learner.id);
    if(v.acknowledgments.conduct.language!==v.consent.language||v.acknowledgments.programInformation.language!==v.consent.language)c.addIssue({code:'custom',path:['acknowledgments'],message:'acknowledgment_registration_language_mismatch'});
    if(v.acknowledgments.conduct.childIds.length!==expected.length||expected.some((id,index)=>v.acknowledgments!.conduct.childIds[index]!==id))c.addIssue({code:'custom',path:['acknowledgments','conduct','childIds'],message:'conduct_children_mismatch'});
   }
  }else if(v.acknowledgments)c.addIssue({code:'custom',path:['acknowledgments'],message:'acknowledgment_protocol_mismatch'});
 }else if(v.paymentSelection&&(v.version==='JLFA-REGISTRATION-20261020-OWNER03-v2'?v.paymentSelection.plan==='installments':v.paymentSelection.plan==='monthly_block'))c.addIssue({code:'custom',path:['paymentSelection','plan'],message:'purchase_version_mismatch'});
 if(new Set(v.learners.map(l=>l.id)).size!==v.learners.length)c.addIssue({code:'custom',path:['learners'],message:'duplicate_child'});
 if(v.paymentSelection&&!v.learners.some(l=>l.id===v.paymentSelection?.childId))c.addIssue({code:'custom',path:['paymentSelection','childId'],message:'child_mismatch'});
 if(!isFreeAcademyRegistrationVersion(v.version)&&(v.consent.version===academyExact05RegistrationNotice.version||v.consent.version===academyRegistrationNotice.version))c.addIssue({code:'custom',path:['consent'],message:'notice_protocol_mismatch'});
 const hashes=academyNoticeHashes(v.consent.version);
 if(!hashes||v.consent.textSha256!==hashes[v.consent.language])c.addIssue({code:'custom',path:['consent'],message:'notice_mismatch'});
 // Friday evening is never a bookable preference. Saturday is not a day option.
 if(v.preferredDays.includes('friday')&&v.preferredTimes.includes('evening'))c.addIssue({code:'custom',path:['preferredTimes'],message:'shabbos_unavailable'});
 if(v.intent==='pay'){
  if(!v.receiptEmail)c.addIssue({code:'custom',path:['receiptEmail'],message:'receipt_email_required'});
  if(!v.paymentSelection?.acceptedOfferId||!v.paymentSelection.offerRevision)c.addIssue({code:'custom',path:['paymentSelection'],message:'accepted_offer_required'});
  // Final participation/payment agreements have not been admitted. Contact
  // permission can save information; it can never authorize checkout.
  c.addIssue({code:'custom',path:['consent'],message:'participation_payment_agreements_required'});
 }
});
export type AcademyRegistration=z.infer<typeof academyRegistrationSchema>;
export function registrationConsent(language:'en'|'he',version:AcademyRegistration['version']=ACADEMY_REGISTRATION_VERSION){
 const historicalFree=version===ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION||version===ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION;
 const notice=version===ACADEMY_REGISTRATION_VERSION?academyRegistrationNotice:version===ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION?academyExact05RegistrationNotice:historicalFree?academyPreviousFreeRegistrationNotice:academyLegacyRegistrationNotice;
 const hashes=version===ACADEMY_REGISTRATION_VERSION?academyRegistrationNoticeHashes:version===ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION?academyExact05RegistrationNoticeHashes:historicalFree?academyPreviousFreeRegistrationNoticeHashes:academyLegacyRegistrationNoticeHashes;
 return {kind:'registration_contact' as const,documentId:notice.id,version:notice.version,language,textSha256:hashes[language]};
}
export const academyGradeLabels={en:{'3':'Grade 3','4':'Grade 4','5':'Grade 5','6':'Grade 6','7':'Grade 7','8':'Grade 8','9':'Grade 9','10':'Grade 10','11':'Grade 11','12':'Grade 12'},he:{'3':'כיתה ג׳','4':'כיתה ד׳','5':'כיתה ה׳','6':'כיתה ו׳','7':'כיתה ז׳','8':'כיתה ח׳','9':'כיתה ט׳','10':'כיתה י׳','11':'כיתה י״א','12':'כיתה י״ב'}} as const;
