import {z} from 'zod';
import {billingId,billingInstant,sourceReferenceSchema} from './contracts.ts';
import {fulfillmentPlanSnapshotV1Schema} from './fulfillment-contract-v1.ts';

export const SERVICE_PLAN_V1='JLFA-FISHING-SERVICE-PLAN-v1' as const;
const id=billingId.refine(v=>v===v.toLowerCase(),'CANONICAL_UUID_REQUIRED');
const revision=z.number().int().positive().max(2147483647),digest=z.string().regex(/^[a-f0-9]{64}$/);
const source=z.object({revision,digest}).strict();
const selectedLesson=z.object({id,expectedRevision:revision}).strict();
export const servicePlanPreviewV1Schema=z.object({version:z.literal(SERVICE_PLAN_V1),quoteId:id,expectedQuoteRevision:revision,
 tripPlan:z.object({expectedRevision:revision,expectedDigest:digest}).strict(),
 children:z.array(z.object({lineId:id,expectedProgressionRevision:revision,lessons:z.array(selectedLesson).min(1).max(10)
  .refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,'DUPLICATE_LESSON')}).strict()).min(1).max(10)
  .refine(rows=>new Set(rows.map(row=>row.lineId)).size===rows.length,'DUPLICATE_LINE'),
}).strict();
export type ServicePlanPreviewV1=z.infer<typeof servicePlanPreviewV1Schema>;
const weeklyLesson=z.object({id,revision,digest,sequence:z.number().int().min(1).max(1000),startsAt:billingInstant,endsAt:billingInstant,
 weekIndex:z.number().int().min(0).max(4),weekStartsAt:billingInstant,weekEndsAt:billingInstant,
}).strict();
const child=fulfillmentPlanSnapshotV1Schema.shape.children.element.extend({
 groupSource:source.extend({location:z.string().min(1).max(200),venueSource:sourceReferenceSchema}).strict(),
 progression:source.extend({eligibleFrom:billingInstant,readiness:z.enum(['needs_foundation','foundation_one_complete','foundation_complete','verified_catchup']),evidence:sourceReferenceSchema.nullable()}).strict(),
 weeklyLessons:z.array(weeklyLesson).min(4).max(10),
 foundation:z.object({basis:z.enum(['planned_first_two','verified_first_plus_planned_second','verified_foundation','verified_catchup']),
  lessonIds:z.array(id).max(2),evidence:sourceReferenceSchema.nullable()}).strict(),
}).strict();
export const servicePlanSnapshotV1Schema=z.object({version:z.literal(SERVICE_PLAN_V1),classification:z.literal('prospective_schedule_not_reserved_paid_or_operating_approval'),
 workspaceId:id,quoteId:id,quoteRevision:revision,familyId:id,quoteBasisDigest:digest,tripPlan:source,children:z.array(child).min(1).max(10),
}).strict();
export type ServicePlanSnapshotV1=z.infer<typeof servicePlanSnapshotV1Schema>;
