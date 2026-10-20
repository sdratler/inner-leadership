import {z} from 'zod';
import {academyRegistrationNotice,academyRegistrationNoticeHashes} from './academy-registration-notice.ts';
export const ACADEMY_REGISTRATION_VERSION='JLFA-REGISTRATION-20261020-01-v1' as const;
export const academyExactGradeSchema=z.enum(['3','4','5','6','7','8','9','10','11','12']);
export const registrationDaySchema=z.enum(['sunday','monday','tuesday','wednesday','thursday','friday','flexible']);
export const registrationTimeSchema=z.enum(['morning','afternoon','evening','flexible']);
const flexibleExclusive=(v:string[])=>new Set(v).size===v.length&&(!v.includes('flexible')||v.length===1);
export const academyRegistrationSchema=z.object({
 version:z.literal(ACADEMY_REGISTRATION_VERSION),
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
 paymentSelection:z.object({childId:z.string().uuid(),plan:z.enum(['prepay','installments']),acceptedOfferId:z.string().uuid().optional(),offerRevision:z.number().int().positive().optional()}).strict().optional(),
 consent:z.object({kind:z.literal('registration_contact'),documentId:z.literal(academyRegistrationNotice.id),version:z.literal(academyRegistrationNotice.version),language:z.enum(['en','he']),textSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
}).strict().superRefine((v,c)=>{
 if(new Set(v.learners.map(l=>l.id)).size!==v.learners.length)c.addIssue({code:'custom',path:['learners'],message:'duplicate_child'});
 if(v.paymentSelection&&!v.learners.some(l=>l.id===v.paymentSelection?.childId))c.addIssue({code:'custom',path:['paymentSelection','childId'],message:'child_mismatch'});
 if(v.consent.textSha256!==academyRegistrationNoticeHashes[v.consent.language])c.addIssue({code:'custom',path:['consent'],message:'notice_mismatch'});
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
export function registrationConsent(language:'en'|'he'){return {kind:'registration_contact' as const,documentId:academyRegistrationNotice.id,version:academyRegistrationNotice.version,language,textSha256:academyRegistrationNoticeHashes[language]};}
export const academyGradeLabels={en:{'3':'Grade 3','4':'Grade 4','5':'Grade 5','6':'Grade 6','7':'Grade 7','8':'Grade 8','9':'Grade 9','10':'Grade 10','11':'Grade 11','12':'Grade 12'},he:{'3':'כיתה ג׳','4':'כיתה ד׳','5':'כיתה ה׳','6':'כיתה ו׳','7':'כיתה ז׳','8':'כיתה ח׳','9':'כיתה ט׳','10':'כיתה י׳','11':'כיתה י״א','12':'כיתה י״ב'}} as const;
