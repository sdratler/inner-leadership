import {z} from 'zod';
import {billingId,billingInstant,servicePeriodSchema,sourceReferenceSchema} from './contracts.ts';
import {nativeEligibleLessonV3Schema} from './child-period-provenance-v3.ts';
import {newYorkDate} from './contracts-v2.ts';

export const FULFILLMENT_V1='JLFA-FISHING-FULFILLMENT-v1' as const;
const id=billingId.refine(v=>v===v.toLowerCase(),'CANONICAL_UUID_REQUIRED');
const sha=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive().max(2147483647);
const expected=z.number().int().min(0).max(2147483646);
const instant=billingInstant.refine(v=>!(/\.(\d+)/.exec(v)?.[1]?.slice(3)??'').replace(/0+$/,''),'MILLISECOND_PRECISION_REQUIRED');
export function isFloridaSunday(at:string){return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(new Date(at))==='Sun';}
export const departureFieldsV1Schema=z.object({
 state:z.enum(['scheduled','postponed','cancelled']),tripKind:z.enum(['keys','local']),
 startsAt:instant,endsAt:instant,timeZone:z.literal('America/New_York'),fullDay:z.literal(true),
 childCapacity:z.number().int().min(0).max(1000),venueSource:sourceReferenceSchema,capacitySource:sourceReferenceSchema,
 planningContext:z.object({location:z.string().trim().min(1).max(500),details:z.string().trim().min(1).max(2000)}).strict(),
}).strict().superRefine((v,c)=>{
 if(Date.parse(v.endsAt)<=Date.parse(v.startsAt)||!isFloridaSunday(v.startsAt)||newYorkDate(new Date(Date.parse(v.endsAt)-1).toISOString())!==newYorkDate(v.startsAt))
  c.addIssue({code:'custom',message:'FULL_DAY_SUNDAY_REQUIRED'});
});
const base={version:z.literal(FULFILLMENT_V1),operationId:id,expectedRevision:expected};
export const recordDepartureV1Schema=z.object({...base,action:z.literal('record_departure'),id,groupId:id,fields:departureFieldsV1Schema}).strict();
const selectedDeparture=z.object({id,expectedRevision:revision}).strict();
export const prepareFulfillmentV1Schema=z.object({...base,action:z.literal('prepare_plan'),quoteId:id,expectedQuoteRevision:revision,
 children:z.array(z.object({lineId:id,keys:selectedDeparture,local:selectedDeparture}).strict()).min(1).max(10),
}).strict().refine(v=>new Set(v.children.map(c=>c.lineId)).size===v.children.length,'DUPLICATE_LINE');
export const fulfillmentCommandV1Schema=z.discriminatedUnion('action',[recordDepartureV1Schema,prepareFulfillmentV1Schema]);
export type FulfillmentCommandV1=z.infer<typeof fulfillmentCommandV1Schema>;
export const departureSnapshotV1Schema=z.object({id,groupId:id,revision,digest:sha,fields:departureFieldsV1Schema}).strict();
export const fulfillmentPlanSnapshotV1Schema=z.object({
 quoteId:id,familyId:id,quoteBasisDigest:sha,
 classification:z.literal('prospective_plan_not_reserved_or_paid'),
 children:z.array(z.object({lineId:id,childId:id,groupId:id,period:servicePeriodSchema,firstEligibleLesson:nativeEligibleLessonV3Schema,
  keys:departureSnapshotV1Schema,local:departureSnapshotV1Schema,
 }).strict()).min(1).max(10),
}).strict();
const recordBase={version:z.literal(FULFILLMENT_V1),workspaceId:id,revision,recordedBy:id,recordedAt:instant,previousDigest:sha.nullable()};
export const departureRecordV1Schema=z.object({...recordBase,kind:z.literal('departure'),command:recordDepartureV1Schema}).strict();
export const fulfillmentPlanRecordV1Schema=z.object({...recordBase,kind:z.literal('plan'),command:prepareFulfillmentV1Schema,snapshot:fulfillmentPlanSnapshotV1Schema}).strict();
export const fulfillmentRecordV1Schema=z.discriminatedUnion('kind',[departureRecordV1Schema,fulfillmentPlanRecordV1Schema])
 .refine(r=>r.revision===r.command.expectedRevision+1&&(r.previousDigest===null)===(r.revision===1),'FULFILLMENT_HISTORY');
export type FulfillmentRecordV1=z.infer<typeof fulfillmentRecordV1Schema>;
export type FulfillmentPlanSnapshotV1=z.infer<typeof fulfillmentPlanSnapshotV1Schema>;
