import {z} from 'zod';
import en from './academy-trip390-en.json' with {type:'json'};
import he from './academy-trip390-he.json' with {type:'json'};
import cities from './academy-trip390-cities.json' with {type:'json'};

/** Additive candidate. Shared decoders/routes must be admitted by the existing integrator. */
export const TRIP390_OFFER = Object.freeze({version:'JLFA-KEYS390-v1',currency:'USD',priceCents:39000,keysTrips:1,preparationSessions:2,minimumAge:9,maximumYouthAge:null,automaticRenewal:false,siblingDiscount:false} as const);
export const TRIP390_INTEREST_VERSION='JLFA-TRIP390-INTEREST-v1';
export const TRIP390_NOTICE_VERSION='JLFA-TRIP390-INTEREST-NOTICE-v1';
export const trip390Copy={en,he};
const text=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'control_characters');
export const trip390InterestSchema=z.object({
 version:z.literal(TRIP390_INTEREST_VERSION),offerVersion:z.literal(TRIP390_OFFER.version),
 guardianName:text(100),email:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),
 phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional(),
 city:text(120).refine(value=>Array.from(value).length>=2,'city_required'),
 postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
 messageLanguage:z.enum(['en','he']),instructionLanguage:z.enum(['en','he','either']).optional(),
 children:z.array(z.object({id:z.string().uuid(),name:text(100),ageYears:z.number().int().min(0).max(120),experience:z.enum(['new','some','experienced','not_sure'])}).strict()).min(1).max(10),
 notes:text(600).optional(),
 acknowledgment:z.object({version:z.literal(TRIP390_NOTICE_VERSION),language:z.enum(['en','he']),conductExplained:z.literal(true),interestPrivacySafety:z.literal(true),whatsapp:z.boolean()}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(value.acknowledgment.whatsapp&&!value.phone)ctx.addIssue({code:'custom',path:['phone'],message:'whatsapp_phone_required'});
 if(new Set(value.children.map(child=>child.id)).size!==value.children.length)ctx.addIssue({code:'custom',path:['children'],message:'duplicate_child'});
});
export type Trip390Interest=z.infer<typeof trip390InterestSchema>;
export const trip390CommandSchema=z.object({operationId:z.string().uuid(),fields:trip390InterestSchema}).strict();
export type Trip390Command=z.infer<typeof trip390CommandSchema>;
export function trip390Location(value:Trip390Interest){return {city:value.city,cityKey:value.city.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g,' '),postalCode:value.postalCode,postalCode5:value.postalCode.slice(0,5)};}
export function trip390CitySuggestions(typed:string){const key=typed.trim().toLocaleLowerCase();return key?cities.suggestions.filter(city=>city.toLocaleLowerCase().includes(key)).slice(0,8):[];}
/** No adult/underage inquiry silently becomes an eligible booking. */
export function trip390AgeReview(age:number){return age<9?'below_minimum': 'age_policy_review_required';}
export function trip390Quote(children:number){if(!Number.isSafeInteger(children)||children<1||children>10)throw new Error('INVALID_CHILD_COUNT');return Object.freeze({offerVersion:TRIP390_OFFER.version,currency:'USD' as const,children,unitCents:39000,totalCents:children*39000,discountCents:0,automaticRenewal:false});}
export function trip390Metadata(locale:'en'|'he'){return {title:trip390Copy[locale].metadata.title,description:trip390Copy[locale].metadata.description,robots:{index:false,follow:false},openGraph:{title:trip390Copy[locale].metadata.title,description:trip390Copy[locale].metadata.social_description}};}
