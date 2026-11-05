import {z} from 'zod';
import en from './academy-trip390-en.json' with {type:'json'};
import he from './academy-trip390-he.json' with {type:'json'};
import {trip390ReservationNotice,TRIP390_RESERVATION_NOTICE_VERSION} from './academy-trip390-reservation-notice.ts';
import {trip390StudentConduct,TRIP390_STUDENT_CONDUCT_VERSION} from './academy-trip390-student-conduct.ts';

/** Frozen historical v3: decode/replay only, with exact original offer and consent bytes. */
export const TRIP390_V3_OFFER = Object.freeze({version:'JLFA-KEYS390-v2',currency:'USD',priceCents:39000,keysTrips:1,preparationSessions:2,minimumAge:9,maximumYouthAge:15,automaticRenewal:false,siblingDiscount:false} as const);
export const TRIP390_V3_INTEREST_VERSION='JLFA-TRIP390-INTEREST-v3';
export const TRIP390_V3_NOTICE_VERSION='JLFA-TRIP390-INTEREST-NOTICE-20261104-07-v1';
export const trip390V3Copy={en,he};
const text=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'control_characters');
export const TRIP390_DRIVING_VERSION='JLFA-SUNDAY-TOTAL-DRIVE-v1';
export const trip390DrivingLimitSchema=z.enum(['up_to_30','up_to_60','up_to_90','up_to_120','flexible']);
const snapshot={language:z.enum(['en','he']),text:z.string().max(16000),textDigest:z.string().regex(/^[a-f0-9]{64}$/)};
const conductSchema=z.object({...snapshot,version:z.literal(TRIP390_STUDENT_CONDUCT_VERSION)}).strict();
const reservationSchema=z.object({...snapshot,version:z.literal(TRIP390_RESERVATION_NOTICE_VERSION)}).strict();
export const trip390V3InterestSchema=z.object({
 version:z.literal(TRIP390_V3_INTEREST_VERSION),offerVersion:z.literal(TRIP390_V3_OFFER.version),
 guardianName:text(100),email:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),
 phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
 city:text(120).refine(value=>Array.from(value).length>=2,'city_required'),
 postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
 messageLanguage:z.enum(['en','he']),instructionLanguage:z.enum(['en','he','either']).optional(),
 children:z.array(z.object({id:z.string().uuid(),name:text(100),ageYears:z.number().int().min(9).max(15),experience:z.enum(['new','some','experienced','not_sure'])}).strict()).min(1).max(10),
 lessonDayDriving:z.object({version:z.literal(TRIP390_DRIVING_VERSION),limit:trip390DrivingLimitSchema}).strict(),
 acknowledgment:z.object({version:z.literal(TRIP390_V3_NOTICE_VERSION),language:z.enum(['en','he']),conductExplained:z.literal(true),interestPrivacySafety:z.literal(true),whatsapp:z.boolean(),studentConduct:conductSchema,reservationNotice:reservationSchema}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(value.acknowledgment.whatsapp&&!value.phone)ctx.addIssue({code:'custom',path:['phone'],message:'whatsapp_phone_required'});
 if(new Set(value.children.map(child=>child.id)).size!==value.children.length)ctx.addIssue({code:'custom',path:['children'],message:'duplicate_child'});
 const conduct=value.acknowledgment.studentConduct,expectedConduct=trip390StudentConduct(value.acknowledgment.language);
 const notice=value.acknowledgment.reservationNotice,expectedNotice=trip390ReservationNotice(value.acknowledgment.language);
 if(notice.language!==value.acknowledgment.language||notice.text!==expectedNotice.text||notice.textDigest!==expectedNotice.textDigest)ctx.addIssue({code:'custom',path:['acknowledgment','reservationNotice'],message:'displayed_reservation_notice_mismatch'});
 if(conduct.language!==value.acknowledgment.language||conduct.text!==expectedConduct.text||conduct.textDigest!==expectedConduct.textDigest)ctx.addIssue({code:'custom',path:['acknowledgment','studentConduct'],message:'displayed_conduct_mismatch'});
});

export const trip390V3Notice=Object.fromEntries((['en','he'] as const).map(locale=>{const {form,hero}=trip390V3Copy[locale];return [locale,{conduct:form.conduct,interest:trip390ReservationNotice(locale).acknowledgment,privacy:form.privacy_short,whatsapp:form.whatsapp,interestNote:hero.interest_note}];}));
