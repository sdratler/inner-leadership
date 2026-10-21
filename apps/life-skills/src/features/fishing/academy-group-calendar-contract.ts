import {z} from 'zod';
import {academyFloridaDay} from './academy-operator-day.ts';

export const academyGroupCalendarVersion='JLFA-GROUP-CALENDAR-20261021-01' as const;
const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().min(1).max(1000000);
const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),label=z.string().trim().min(1).max(160);
export const academyGroupCalendarQuerySchema=z.strictObject({from:month,to:month}).refine(v=>{const difference=(Number(v.to.slice(0,4))-Number(v.from.slice(0,4)))*12+Number(v.to.slice(5))-Number(v.from.slice(5));return difference>=0&&difference<12;});
export const academyGroupOriginSelectionSchema=z.strictObject({cohortId:uuid,stageId:uuid,stage:z.number().int().min(1).max(4),occurrenceId:uuid,expectedRevision:revision});
export type AcademyGroupOriginSelection=z.infer<typeof academyGroupOriginSelectionSchema>;
const time=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('undated'),timeZone:z.literal('America/New_York')}),
 z.strictObject({kind:z.literal('scheduled'),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),timeZone:z.literal('America/New_York')}),
]);
/** Original learning identity is retained separately from the physical event.
 * A draft link is neither a seat nor a weekly service or activity credit. */
export const academyGroupOriginSchema=z.strictObject({selection:academyGroupOriginSelectionSchema,planRevision:revision,
 ordinal:z.number().int().min(1).max(12),moduleId:label,moduleVersion:label,templateApprovalId:uuid,templateSourceSha256:hash,
 instructorId:uuid,originalTime:time,originalLocation:z.string().max(2400),originalSha256:hash});
export type AcademyGroupOrigin=z.infer<typeof academyGroupOriginSchema>;
const placement=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('needs_placement'),reason:z.string().trim().min(1).max(1200)}),
 z.strictObject({kind:z.literal('proposed'),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),venueId:uuid}),
]);
const draftFields={calendarMonth:month,label,placement,originals:z.array(academyGroupOriginSelectionSchema).max(100)};
export const academyGroupDraftCommandSchema=z.strictObject({version:z.literal(academyGroupCalendarVersion),action:z.literal('save_draft'),operationId:uuid,eventId:uuid,
 expectedRevision:z.number().int().min(0).max(999999),...draftFields}).superRefine((v,c)=>{
 const ids=new Set<string>(),groups=new Set<string>();for(const o of v.originals){if(ids.has(o.occurrenceId)||groups.has(o.cohortId))c.addIssue({code:'custom',message:'One original weekly meeting per group is required'});ids.add(o.occurrenceId);groups.add(o.cohortId);}
 if(v.placement.kind==='proposed'){
  const p=v.placement,start=Date.parse(p.startsAt),end=Date.parse(p.endsAt),date=academyFloridaDay(p.startsAt);
  if(end<=start||end-start>24*3600000||date!==academyFloridaDay(new Date(end-1).toISOString())||date.slice(0,7)!==v.calendarMonth||new Date(date+'T12:00:00Z').getUTCDay()!==0)c.addIssue({code:'custom',message:'The proposed Keys interval must be on one Sunday in the selected month'});
 }
});
export type AcademyGroupDraftCommand=z.infer<typeof academyGroupDraftCommandSchema>;
export const academyGroupEventRecordSchema=z.strictObject({version:z.literal(academyGroupCalendarVersion),workspaceId:uuid,eventId:uuid,operatorId:uuid,
 kind:z.literal('monthly_core_keys'),calendarMonth:month,revision,previousSha256:hash.nullable(),label,placement,
 state:z.enum(['needs_placement','review_required']),originals:z.array(academyGroupOriginSchema).max(100),operationId:uuid,recordedAt:z.iso.datetime({offset:true})})
 .refine(v=>v.revision===1?v.previousSha256===null:v.previousSha256!==null)
 .refine(v=>v.state===(v.placement.kind==='needs_placement'?'needs_placement':'review_required'));
export type AcademyGroupEventRecord=z.infer<typeof academyGroupEventRecordSchema>;
export const academyGroupDraftReceiptSchema=z.strictObject({version:z.literal(academyGroupCalendarVersion),operationId:uuid,eventId:uuid,revision,sha256:hash,
 state:z.enum(['needs_placement','review_required']),resourceEffect:z.literal('none'),purchaseEffect:z.literal('none')});
export type AcademyGroupDraftReceipt=z.infer<typeof academyGroupDraftReceiptSchema>;
export const academyGroupDraftReplySchema=z.strictObject({receipt:academyGroupDraftReceiptSchema.extend({replayed:z.boolean()}).strict()});
export const academyGroupPlanningChoiceSchema=z.strictObject({cohortId:uuid,stageId:uuid,stage:z.number().int().min(1).max(4),label,planRevision:revision,originals:z.array(academyGroupOriginSchema).length(12)});
export const academyGroupCalendarContextSchema=z.strictObject({version:z.literal(academyGroupCalendarVersion),availability:z.enum(['ready','not_configured']),
 events:z.array(academyGroupEventRecordSchema).max(120),groups:z.array(academyGroupPlanningChoiceSchema).max(1000)});
export type AcademyGroupCalendarContext=z.infer<typeof academyGroupCalendarContextSchema>;
