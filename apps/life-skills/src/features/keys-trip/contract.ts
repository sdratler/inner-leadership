import {z} from 'zod';

/** A standalone interest request, independent of the monthly Academy offer. */
export const KEYS_TRIP=Object.freeze({id:'keys-2026-12-06',date:'2026-12-06',title:'Extreme Saltwater Bridge Fishing',version:'JLFA-KEYS-20261206-v1',minimumAge:10,maximumAge:17} as const);
export const KEYS_INTEREST_VERSION='JLFA-KEYS-INTEREST-20261126-v1';
export const KEYS_CONSENT=Object.freeze({
 version:'JLFA-KEYS-INTEREST-CONSENT-20261126-v1',language:'en',
 noticeText:'I am a parent or guardian. I agree that the Jewish Leadership Fishing Academy may store these details privately and contact me about this trip. This interest request does not reserve a seat, enroll a child, accept a price or authorize payment.',
 whatsappText:'You may also contact me individually on WhatsApp about this trip.',
 futureEmailText:'Email me about future Fishing Academy trips.',
} as const);
const text=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'control_characters');
const multiline=(max:number)=>z.string().trim().max(max).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\p{Cf}]/u.test(value),'control_characters');
export function normalizeKeysPhone(input:string){const value=input.trim().replace(/[\s().-]/g,'');return /^[2-9]\d{9}$/.test(value)?'+1'+value:/^1\d{10}$/.test(value)?'+'+value:value;}
const email=z.string().trim().email().max(254).transform(value=>value.toLowerCase());
const phone=z.string().trim().regex(/^\+[1-9]\d{7,14}$/);
export const keysPickupSchema=z.enum(['north_miami_beach','hollywood','miami_beach','boca_raton','discuss']);
export const KEYS_PICKUP_LABELS={north_miami_beach:'North Miami Beach',hollywood:'Hollywood',miami_beach:'Miami Beach',boca_raton:'Boca Raton',discuss:'Other / please discuss'} as const;
const pickups=z.array(keysPickupSchema).max(5).refine(values=>new Set(values).size===values.length,'duplicate_pickup');
const contactFields={guardianName:text(120),email,phone,city:text(100),postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),availability:z.enum(['yes','maybe','future']),pickupPreferences:pickups} as const;
export const keysInterestSchema=z.object({
 version:z.literal(KEYS_INTEREST_VERSION),tripId:z.literal(KEYS_TRIP.id),tripVersion:z.literal(KEYS_TRIP.version),
 ...contactFields,messageLanguage:z.literal('en'),
 children:z.array(z.object({id:z.string().uuid(),name:text(80),ageYears:z.number().int().min(10).max(17)}).strict()).min(1).max(10),
 notes:multiline(600),
 consent:z.object({version:z.literal(KEYS_CONSENT.version),language:z.literal('en'),contact:z.literal(true),whatsapp:z.boolean(),futureEmail:z.boolean(),noticeText:z.literal(KEYS_CONSENT.noticeText),whatsappText:z.literal(KEYS_CONSENT.whatsappText),futureEmailText:z.literal(KEYS_CONSENT.futureEmailText)}).strict(),
}).strict().superRefine((value,ctx)=>{if(new Set(value.children.map(child=>child.id)).size!==value.children.length)ctx.addIssue({code:'custom',path:['children'],message:'duplicate_child'});});
export type KeysInterest=z.infer<typeof keysInterestSchema>;
export function isKeysInterest(value:unknown):value is KeysInterest{return Boolean(value&&typeof value==='object'&&'version' in value&&value.version===KEYS_INTEREST_VERSION);}
export const keysCommandSchema=z.object({operationId:z.string().uuid(),fields:keysInterestSchema}).strict();
export type KeysCommand=z.infer<typeof keysCommandSchema>;
export const keysContactCorrectionSchema=z.object({version:z.literal('JLFA-KEYS-CONTACT-CORRECTION-v1'),...contactFields,reason:text(500)}).strict();
export type KeysContactCorrection=z.infer<typeof keysContactCorrectionSchema>;
export const keysOwnerUpdateSchema=z.object({operationId:z.string().uuid(),applicationId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),status:z.enum(['new','contacted','waiting','closed']),note:multiline(5000).refine(value=>value.length>0,'note_required'),nextAction:z.string().trim().max(500).nullable(),dueDate:z.iso.date().nullable(),waitingCondition:z.string().trim().max(500).nullable(),contactCorrection:keysContactCorrectionSchema.optional()}).strict().superRefine((value,ctx)=>{
 if(Boolean(value.nextAction)!==Boolean(value.dueDate))ctx.addIssue({code:'custom',path:['dueDate'],message:'dated_action_required'});
 if(value.status==='waiting'&&!value.waitingCondition)ctx.addIssue({code:'custom',path:['waitingCondition'],message:'waiting_condition_required'});
 if(value.status!=='closed'&&!value.nextAction&&!value.waitingCondition)ctx.addIssue({code:'custom',path:['nextAction'],message:'next_action_required'});
});
export type KeysOwnerUpdate=z.infer<typeof keysOwnerUpdateSchema>;
export function keysCurrentContact(fields:KeysInterest,correction?:KeysContactCorrection){return correction?{guardianName:correction.guardianName,email:correction.email,phone:correction.phone,city:correction.city,postalCode:correction.postalCode,availability:correction.availability,pickupPreferences:correction.pickupPreferences}:{guardianName:fields.guardianName,email:fields.email,phone:fields.phone,city:fields.city,postalCode:fields.postalCode,availability:fields.availability,pickupPreferences:fields.pickupPreferences};}
