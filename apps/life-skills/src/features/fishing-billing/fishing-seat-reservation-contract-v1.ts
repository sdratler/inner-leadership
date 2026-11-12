import {z} from 'zod';
import {billingId,billingInstant,sourceReferenceSchema,servicePeriodSchema} from './contracts.ts';

export const SEAT_RESERVATION_V1='JLFA-FISHING-SEAT-RESERVATION-v1' as const;
const id=billingId.refine(v=>v===v.toLowerCase(),'CANONICAL_UUID_REQUIRED');
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const instant=billingInstant.refine(v=>Number.isFinite(Date.parse(v))&&!(/\.(\d+)/.exec(v)?.[1]?.slice(3)??'').replace(/0+$/,''),'MILLISECOND_PRECISION_REQUIRED');
export const seatResourceV1Schema=z.object({kind:z.enum(['lesson','departure']),id,groupId:id,revision:z.number().int().positive(),digest:sha,
 startsAt:instant,endsAt:instant}).strict().refine(v=>Date.parse(v.startsAt)<Date.parse(v.endsAt),'RESOURCE_INTERVAL');
export type SeatResourceV1=z.infer<typeof seatResourceV1Schema>;
const outside=z.object({childId:id,startsAt:instant,endsAt:instant}).strict().refine(v=>Date.parse(v.startsAt)<Date.parse(v.endsAt),'OCCUPANT_INTERVAL');
export const seatPoolV1Schema=z.object({id,capacity:z.number().int().min(0).max(1000),source:sourceReferenceSchema,
 // Actual native nonpaying/founder/other occupants, not merely paying boys.
 outsideOccupants:z.array(outside).max(1000)}).strict();
export const seatResourceAdmissionV1Schema=z.object({resource:seatResourceV1Schema,pools:z.array(seatPoolV1Schema).min(1).max(8)}).strict()
 .refine(v=>new Set(v.pools.map(p=>p.id)).size===v.pools.length,'DUPLICATE_POOL');
export type SeatResourceAdmissionV1=z.infer<typeof seatResourceAdmissionV1Schema>;
export const seatScopeV1Schema=z.object({workspaceId:id,quoteId:id,familyId:id,offerSha256:sha,
 children:z.array(z.object({lineId:id,childId:id,groupId:id,period:servicePeriodSchema,
  resources:z.array(seatResourceV1Schema).min(1).max(12)}).strict()).min(1).max(10)}).strict();
export type SeatScopeV1=z.infer<typeof seatScopeV1Schema>;
export const seatClaimV1Schema=z.object({poolId:id,childId:id,resource:seatResourceV1Schema}).strict();
export type SeatClaimV1=z.infer<typeof seatClaimV1Schema>;
export const seatReservationRecordV1Schema=z.object({version:z.literal(SEAT_RESERVATION_V1),purpose:z.literal('v4_service_offer'),
 classification:z.literal('native_provisional_membership_not_paid_or_operating_authority'),scope:seatScopeV1Schema,createdAt:instant,
 admissions:z.array(seatResourceAdmissionV1Schema).min(1).max(120),claims:z.array(seatClaimV1Schema).min(1).max(960)}).strict();
export type SeatReservationRecordV1=z.infer<typeof seatReservationRecordV1Schema>;
