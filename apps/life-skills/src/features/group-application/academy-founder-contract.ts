import {z} from 'zod';
import {academyOwnerEnrollmentBindingSchema,type AcademyOwnerEnrollmentBinding} from '../fishing/academy-enrollment-contract.ts';
export type FounderNativeFamily={source:AcademyOwnerEnrollmentBinding;householdId:string;parentAccountId:string;children:{registrationChildId:string;learnerId:string}[];verifiedBy:string;verifiedAt:string};
export const FOUNDER_DECISION='JLFA-FREE-FOUNDER-30-20261023-03';
export const FOUNDER_CAPACITY=30;
export const FOUNDER_TIMEZONE='America/New_York';
export const FOUNDER_REMINDER_DEFAULTS=[3,6] as const;
export const founderStatusSchema=z.enum(['pending_verification','interest_list','provisional','confirmed','scheduling_hold','offered','redeemed','expired','withdrawn']);
export type FounderStatus=z.infer<typeof founderStatusSchema>;
export const occupiedFounderStatuses:readonly FounderStatus[]=['provisional','confirmed','scheduling_hold','offered','redeemed'];
export const occupiesFounder=(status:FounderStatus)=>occupiedFounderStatuses.includes(status);
export type FounderPublicResult={status:'reserved'|'interest_list'|'regular_registration'|'pending_verification'|'confirmed'|'closed';initialStatus?:'reserved'|'regular_registration'|'pending_verification';reference:string;email:'queued'|'sent'|'delivery_problem'|'unknown'|'not_queued';receiptEmail?:string;founderRateReserved?:boolean;deadline:string|null;timezone:typeof FOUNDER_TIMEZONE};
/** Missing historical failure evidence stays uncertain; an exception is not a
 * provider rejection. Only a persisted known failure supports failure copy. */
export function founderPublicEmailState(input:{outboxState?:string|undefined;exception:boolean;knownDeliveryFailure?:boolean}):FounderPublicResult['email']{
 if(input.knownDeliveryFailure)return 'delivery_problem';
 if(input.exception||input.outboxState==='unknown')return 'unknown';
 if(input.outboxState==='sent')return 'sent';
 if(input.outboxState==='queued')return 'queued';
 return 'not_queued';
}
/** Initial interest has no expiry. Old deadline values remain historical audit
 * data; only explicit closure or unresolved delivery prevents confirmation. */
export function founderPublicConfirmationState(input:{sentAt:string|null;deadline:string|null;exception:boolean;status:string;confirmed:boolean;now:Date}){
 const closed=['expired','withdrawn'].includes(input.status);
 const confirmed=input.confirmed&&!closed;
 return {confirmed,unusable:!confirmed&&closed,available:!confirmed&&!!input.sentAt&&!input.exception&&!closed};
}
export const founderOwnerCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('bind_native_family'),binding:academyOwnerEnrollmentBindingSchema}),
 z.object({action:z.literal('resend'),window:z.enum(['interest','payment'])}),
 z.object({action:z.literal('pause')}),z.object({action:z.literal('resume')}),
 z.object({action:z.literal('request_offer_closure')}),
 z.object({action:z.literal('scheduling_hold')}),z.object({action:z.literal('withdraw')}),
 z.object({action:z.literal('resolve_identity'),outcome:z.enum(['distinct_family','ineligible'])}),
 z.object({action:z.literal('extend'),window:z.enum(['interest','payment']),deadline:z.iso.datetime()}),
 z.object({action:z.literal('approve_offer'),groupId:z.uuid(),firstSession:z.iso.datetime(),plan:z.enum(['prepay','monthly_block'])}),
 z.object({action:z.literal('delivery_review'),messageId:z.uuid(),outcome:z.enum(['sent','not_sent','bounce','suppressed']),sentAt:z.iso.datetime().optional(),providerId:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional()}),
]).and(z.object({operationId:z.uuid(),familyId:z.uuid(),expectedRevision:z.number().int().positive(),reason:z.string().trim().min(3).max(600)}));
export type FounderOwnerCommand=z.infer<typeof founderOwnerCommandSchema>;
/** Calendar-day arithmetic preserves Florida wall time across DST, unlike 168h. */
export function floridaCalendarDays(instant:Date,days:number):Date{
 const parts=(d:Date)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:FOUNDER_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const p=parts(instant),target=Date.UTC(p.year!,p.month!-1,p.day!+days,p.hour!,p.minute!,p.second!,instant.getUTCMilliseconds());let result=target;
 for(let i=0;i<4;i++){const q=parts(new Date(result));const wall=Date.UTC(q.year!,q.month!-1,q.day!,q.hour!,q.minute!,q.second!,instant.getUTCMilliseconds());result+=target-wall;}
 return new Date(result);
}
export function floridaDeadline(value:string,locale:'en'|'he'){return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:FOUNDER_TIMEZONE,dateStyle:'full',timeStyle:'short'}).format(new Date(value))+' (America/New_York)';}
export function founderPrice(plan:'prepay'|'monthly_block',founder:boolean,additionalSibling:boolean){return plan==='monthly_block'?650:founder?(additionalSibling?1550:1650):(additionalSibling?1650:1750);}
