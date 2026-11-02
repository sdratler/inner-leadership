import {z} from 'zod';
import {trip390Quote} from './academy-trip390-contract.ts';

/** This module has no provider, account, database or sender mutations. */
export const trip390HeldCapabilities=Object.freeze({checkout:false,outbound:false,customerInvitations:false,publicProjection:false,ownerWorkspace:false});
const gates=['agePolicy','cancellationPolicy','taxConfiguration','operatorApproval','insurance','venuePermission','transport','food','staffing','dates','minimumEnrollment','merchantAdmission'] as const;
export type Trip390Gate=typeof gates[number];
export function trip390CheckoutBlockers(evidence:Partial<Record<Trip390Gate,string>>={}){return gates.filter(key=>typeof evidence[key]!=='string'||!evidence[key]!.trim());}
/** Production checkout cannot be enabled by filling a candidate config object. */
export function trip390Checkout(){return {enabled:false as const,reason:'separate_reviewed_runtime_admission_required'};}
const vehicleSchema=z.object({seats:z.number().int().nonnegative(),staff:z.number().int().nonnegative(),otherPassengers:z.number().int().nonnegative(),cargoSeatReduction:z.number().int().nonnegative(),approvedChildLimit:z.number().int().nonnegative(),approved:z.literal(true)}).strict();
export function trip390Capacity(input:unknown){const result=vehicleSchema.safeParse(input);if(!result.success)return 0;const v=result.data;return Math.max(0,Math.min(45,v.approvedChildLimit,v.seats-v.staff-v.otherPassengers-v.cargoSeatReduction));}
export function trip390SeatDecision(capacity:number,occupied:number,requested:number){if(![capacity,occupied,requested].every(Number.isSafeInteger)||capacity<0||occupied<0||requested<1||occupied>capacity)throw new Error('INVALID_CAPACITY');return requested<=capacity-occupied?'available_for_test_hold':'waitlist';}
export function trip390ShopHelperCost(sessions:number){if(!Number.isInteger(sessions)||sessions<1||sessions>2)throw new Error('INVALID_SESSIONS');return sessions*2*15000;}
/** Verified civil dates only. No timezone-dependent Date parsing or age-at-signup reuse. */
export function trip390AgeOnDate(birth:string,departure:string){
 const parse=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('INVALID_DATE');const [y,m,d]=value.split('-').map(Number) as [number,number,number];const date=new Date(Date.UTC(y,m-1,d));if(date.toISOString().slice(0,10)!==value)throw new Error('INVALID_DATE');return [y,m,d] as const;};
 const b=parse(birth),t=parse(departure);if(departure<birth)throw new Error('INVALID_DATE');return t[0]-b[0]-(t[1]<b[1]||(t[1]===b[1]&&t[2]<b[2])?1:0);
}
export function trip390Readiness(value:{firstTime:boolean;preparation1:boolean;preparation2:boolean;returningPreparationVerified:boolean;guardianConsent:boolean;emergencyComplete:boolean;pickupAssigned:boolean;licenseReviewed:boolean;ownerApproved:boolean}){return (value.firstTime?value.preparation1&&value.preparation2:value.returningPreparationVerified)&&value.guardianConsent&&value.emergencyComplete&&value.pickupAssigned&&value.licenseReviewed&&value.ownerApproved;}
type PublicEvent={id:string;status:'draft'|'proposed'|'confirmed'|'cancelled';publicApproved:boolean;publicTitle:string;startsAt:string;timeZone:'America/New_York';revision:number};
export function trip390PublicEvent(event:PublicEvent){if(!event.publicApproved||event.status==='draft'||event.status==='cancelled'||!Number.isFinite(Date.parse(event.startsAt)))return null;return {id:event.id,title:event.publicTitle,startsAt:event.startsAt,timeZone:event.timeZone,status:event.status,revision:event.revision,bookable:false};}
export function trip390ReminderPreview(value:{state:'queued'|'sent'|'unknown'|'failed';offerVersion:string;channel:'email'|'whatsapp';whatsappConsent:boolean;bookingActive:boolean;scheduleRevision:number;currentRevision:number;language:'en'|'he'|null}){
 const reasons:string[]=[];if(value.state==='sent'||value.state==='unknown')reasons.push('historical_or_unreconciled');if(value.offerVersion!=='JLFA-KEYS390-v1')reasons.push('legacy_offer');if(!value.bookingActive)reasons.push('inactive_booking');if(value.scheduleRevision!==value.currentRevision)reasons.push('stale_schedule');if(!value.language)reasons.push('missing_message_language');if(value.channel==='whatsapp'&&!value.whatsappConsent)reasons.push('no_whatsapp_consent');return {send:false as const,state:reasons.length?'held':'dry_run',reasons};
}
/** A server-side policy proposal, not a replacement for the existing auth checks.
 * Caller must first derive Fishing scope and actor role from the authenticated session.
 * No access revocation is mounted before paid-entitlement inventory/admission. */
export function trip390CapabilityDecision(input:{scope:'fishing'|'unrelated';role:'owner'|'parent'|'student';inventoryAdmitted:boolean}){if(input.scope==='unrelated')return 'defer_to_existing_policy';if(input.role==='owner')return 'require_existing_owner_authorization';return input.inventoryAdmitted?'deny_fishing_customer_capability':'cutover_not_admitted';}
export function trip390TestOrder(childIds:readonly string[]){if(!childIds.length||new Set(childIds).size!==childIds.length)throw new Error('INVALID_CHILDREN');return {quote:trip390Quote(childIds.length),childIds:[...childIds],state:'test_only',paid:false,readyToTravel:false};}
