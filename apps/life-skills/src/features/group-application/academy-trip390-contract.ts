import {z} from 'zod';
import en from './academy-trip390-en.json' with {type:'json'};
import he from './academy-trip390-he.json' with {type:'json'};
import cities from './academy-trip390-cities.json' with {type:'json'};
import r2En from './academy-r2-en.json' with {type:'json'};
import r2He from './academy-r2-he.json' with {type:'json'};
import {trip390V3InterestSchema,TRIP390_V3_INTEREST_VERSION} from './academy-trip390-v3.ts';
import {trip390V1InterestSchema,TRIP390_V1_INTEREST_VERSION} from './academy-trip390-v1.ts';
import {trip390V2InterestSchema,TRIP390_V2_INTEREST_VERSION} from './academy-trip390-v2.ts';
import {trip390ReservationNotice,TRIP390_RESERVATION_NOTICE_VERSION} from './academy-trip390-reservation-notice.ts';
import {trip390StudentConduct,TRIP390_STUDENT_CONDUCT_VERSION} from './academy-trip390-student-conduct.ts';

/** Prospective acquisition tuple. Historical contracts below remain decode/replay only. */
export const TRIP390_OFFER = Object.freeze({version:'JLFA-ACADEMY650-20261105-R2',copyVersion:'JLFA-ACADEMY650-ACQUISITION-20261105-R2',currency:'USD',priceCents:65000,billingUnit:'month',fullDayOutingsPerMonth:2,localLessons:'weekly',minimumAge:9,maximumYouthAge:15,automaticRenewal:false,siblingDiscount:false} as const);
export const TRIP390_INTEREST_VERSION='JLFA-TRIP390-INTEREST-v4';
export const TRIP390_NOTICE_VERSION='JLFA-TRIP390-INTEREST-NOTICE-20261104-07-v1';
export const trip390Copy={en,he};
const text=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'control_characters');
export const TRIP390_DRIVING_VERSION='JLFA-LOCAL-LESSON-TOTAL-DRIVE-v2';
export const trip390DrivingLimitSchema=z.enum(['up_to_30','up_to_60','up_to_90','up_to_120','flexible']);
const snapshot={language:z.enum(['en','he']),text:z.string().max(16000),textDigest:z.string().regex(/^[a-f0-9]{64}$/)};
const conductSchema=z.object({...snapshot,version:z.literal(TRIP390_STUDENT_CONDUCT_VERSION)}).strict();
const reservationSchema=z.object({...snapshot,version:z.literal(TRIP390_RESERVATION_NOTICE_VERSION)}).strict();
export const trip390CurrentInterestSchema=z.object({
 version:z.literal(TRIP390_INTEREST_VERSION),offerVersion:z.literal(TRIP390_OFFER.version),
 guardianName:text(100),email:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),
 phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
 city:text(120).refine(value=>Array.from(value).length>=2,'city_required'),
 postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
 messageLanguage:z.enum(['en','he']),instructionLanguage:z.enum(['en','he','either']).optional(),
 children:z.array(z.object({id:z.string().uuid(),name:text(100),ageYears:z.number().int().min(9).max(15),experience:z.enum(['new','some','experienced','not_sure'])}).strict()).min(1).max(10),
 lessonDayDriving:z.object({version:z.literal(TRIP390_DRIVING_VERSION),limit:trip390DrivingLimitSchema}).strict(),
 acknowledgment:z.object({version:z.literal(TRIP390_NOTICE_VERSION),language:z.enum(['en','he']),conductExplained:z.literal(true),interestPrivacySafety:z.literal(true),whatsapp:z.boolean(),studentConduct:conductSchema,reservationNotice:reservationSchema}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(value.acknowledgment.whatsapp&&!value.phone)ctx.addIssue({code:'custom',path:['phone'],message:'whatsapp_phone_required'});
 if(new Set(value.children.map(child=>child.id)).size!==value.children.length)ctx.addIssue({code:'custom',path:['children'],message:'duplicate_child'});
 const conduct=value.acknowledgment.studentConduct,expectedConduct=trip390StudentConduct(value.acknowledgment.language);
 const notice=value.acknowledgment.reservationNotice,expectedNotice=trip390ReservationNotice(value.acknowledgment.language);
 if(notice.language!==value.acknowledgment.language||notice.text!==expectedNotice.text||notice.textDigest!==expectedNotice.textDigest)ctx.addIssue({code:'custom',path:['acknowledgment','reservationNotice'],message:'displayed_reservation_notice_mismatch'});
 if(conduct.language!==value.acknowledgment.language||conduct.text!==expectedConduct.text||conduct.textDigest!==expectedConduct.textDigest)ctx.addIssue({code:'custom',path:['acknowledgment','studentConduct'],message:'displayed_conduct_mismatch'});
});
/** Historical payload parsing never changes its original values or consent bytes. */
export const trip390InterestSchema=z.union([trip390V1InterestSchema,trip390V2InterestSchema,trip390V3InterestSchema,trip390CurrentInterestSchema]);
export type Trip390Interest=z.infer<typeof trip390InterestSchema>;
export type Trip390CurrentInterest=z.infer<typeof trip390CurrentInterestSchema>;
export const trip390CommandSchema=z.object({operationId:z.string().uuid(),fields:trip390CurrentInterestSchema}).strict();
export const trip390ReadableCommandSchema=z.object({operationId:z.string().uuid(),fields:trip390InterestSchema}).strict();
export function isCurrentTrip390Interest(value:Trip390Interest):value is Trip390CurrentInterest{return value.version===TRIP390_INTEREST_VERSION;}
export function isTrip390Version(value:unknown){return value===TRIP390_INTEREST_VERSION||value===TRIP390_V3_INTEREST_VERSION||value===TRIP390_V2_INTEREST_VERSION||value===TRIP390_V1_INTEREST_VERSION;}
export type Trip390Command=z.infer<typeof trip390CommandSchema>;
export function trip390Location(value:Trip390Interest){return {city:value.city,cityKey:value.city.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g,' '),postalCode:value.postalCode,postalCode5:value.postalCode.slice(0,5)};}
export function trip390CitySuggestions(typed:string){const key=typed.trim().toLocaleLowerCase();return key?cities.suggestions.filter(city=>city.toLocaleLowerCase().includes(key)).slice(0,8):[];}
/** No adult/underage inquiry silently becomes an eligible booking. */
export function trip390AgeReview(age:number){return age<9?'below_minimum':age>15?'above_maximum':'age_policy_review_required';}
export function trip390Quote(children:number){if(!Number.isSafeInteger(children)||children<1||children>10)throw new Error('INVALID_CHILD_COUNT');return Object.freeze({offerVersion:TRIP390_OFFER.version,currency:'USD' as const,children,unitCents:TRIP390_OFFER.priceCents,totalCents:children*TRIP390_OFFER.priceCents,discountCents:0,automaticRenewal:false});}
export function trip390Metadata(locale:'en'|'he'){const copy=locale==='he'?r2He:r2En;return {title:copy.pageTitle,description:copy.metaDescription,robots:{index:false,follow:false},openGraph:{title:copy.pageTitle,description:copy.metaDescription}};}
