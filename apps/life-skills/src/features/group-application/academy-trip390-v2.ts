import documents from './academy-trip390-v2-documents.json' with {type:'json'};
import {z} from 'zod';
const TRIP390_PROGRAM_TERMS_VERSION='JLFA-PROGRAM-TERMS-20261104-06-v1' as const;
const TRIP390_STUDENT_AGREEMENT_VERSION='JLFA-STUDENT-AGREEMENT-20261104-06-v1' as const;

/** Frozen V2 historical facts and exact consent decoder. Read/replay only;
 * these prices and text are not another current offer or consent master. */
export const TRIP390_V2_OFFER = Object.freeze({version:'JLFA-KEYS390-v2',currency:'USD',priceCents:39000,keysTrips:1,preparationSessions:2,minimumAge:9,maximumYouthAge:15,automaticRenewal:false,siblingDiscount:false} as const);
export const TRIP390_V2_INTEREST_VERSION='JLFA-TRIP390-INTEREST-v2';
export const TRIP390_V2_NOTICE_VERSION='JLFA-TRIP390-INTEREST-NOTICE-20261104-06-v1';
export const trip390V2Notice={en:documents.en.notice,he:documents.he.notice};
const text=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'control_characters');
export const TRIP390_DRIVING_VERSION='JLFA-SUNDAY-TOTAL-DRIVE-v1';
export const trip390DrivingLimitSchema=z.enum(['up_to_30','up_to_60','up_to_90','up_to_120','flexible']);
const agreementSchema=z.object({version:z.literal(TRIP390_STUDENT_AGREEMENT_VERSION),language:z.enum(['en','he']),text:z.string().max(12000),textDigest:z.string().regex(/^[a-f0-9]{64}$/),guardianTypedName:text(100)}).strict();
export const trip390V2InterestSchema=z.object({
 version:z.literal(TRIP390_V2_INTEREST_VERSION),offerVersion:z.literal(TRIP390_V2_OFFER.version),
 guardianName:text(100),email:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),
 phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
 city:text(120).refine(value=>Array.from(value).length>=2,'city_required'),
 postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
 messageLanguage:z.enum(['en','he']),instructionLanguage:z.enum(['en','he','either']).optional(),
 children:z.array(z.object({id:z.string().uuid(),name:text(100),ageYears:z.number().int().min(9).max(15),experience:z.enum(['new','some','experienced','not_sure'])}).strict()).min(1).max(10),
 lessonDayDriving:z.object({version:z.literal(TRIP390_DRIVING_VERSION),limit:trip390DrivingLimitSchema}).strict(),
 acknowledgment:z.object({version:z.literal(TRIP390_V2_NOTICE_VERSION),language:z.enum(['en','he']),conductExplained:z.literal(true),interestPrivacySafety:z.literal(true),whatsapp:z.boolean(),studentAgreement:agreementSchema,programTerms:z.object({version:z.literal(TRIP390_PROGRAM_TERMS_VERSION),language:z.enum(['en','he']),text:z.string().max(16000),textDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(value.acknowledgment.whatsapp&&!value.phone)ctx.addIssue({code:'custom',path:['phone'],message:'whatsapp_phone_required'});
 if(new Set(value.children.map(child=>child.id)).size!==value.children.length)ctx.addIssue({code:'custom',path:['children'],message:'duplicate_child'});
 const agreement=value.acknowledgment.studentAgreement,expected=documents[value.acknowledgment.language].studentAgreement;
 const terms=value.acknowledgment.programTerms,expectedTerms=documents[value.acknowledgment.language].programTerms;
 if(terms.language!==value.acknowledgment.language||terms.text!==expectedTerms.text||terms.textDigest!==expectedTerms.textDigest)ctx.addIssue({code:'custom',path:['acknowledgment','programTerms'],message:'displayed_terms_mismatch'});
 if(agreement.language!==value.acknowledgment.language||agreement.text!==expected.text||agreement.textDigest!==expected.textDigest)ctx.addIssue({code:'custom',path:['acknowledgment','studentAgreement'],message:'displayed_agreement_mismatch'});
});

/** Frozen historical/read-and-replay schema; never a new reservation. */
export type Trip390V2Interest=z.infer<typeof trip390V2InterestSchema>;
