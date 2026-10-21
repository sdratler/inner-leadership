import {z} from 'zod';
import {academyFloridaDay} from './academy-operator-day.ts';
import {academyGroupOriginSchema} from './academy-group-calendar-contract.ts';

export const academyGroupPublicationVersion='JLFA-GROUP-PUBLICATION-20261021-01' as const;
export const academyKeysPublicationTables=Object.freeze(['activity_evidence','attendance','publication_commands','publication_links','publication_members','publications','resources','source_reviews','source_revocations']);
export const academyKeysImmutableTriggers=Object.freeze(['activity_evidence:immutable_activity_evidence','attendance:immutable_shared_attendance','publication_commands:immutable_publication_command','publication_links:immutable_publication_link','publication_members:immutable_publication_member','publications:immutable_publication','source_reviews:immutable_source_review','source_revocations:immutable_source_revocation']);
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().min(1).max(1000000),text=z.string().trim().min(1).max(160),note=z.string().trim().min(1).max(1200),instant=z.iso.datetime({offset:true});
const source=z.strictObject({id:text,revision:text,sha256:sha,approvalReference:note});
export const academyKeysTripSchema=z.strictObject({kind:z.literal('monthly_core_keys'),durationKind:z.literal('full_day'),startsAt:instant,endsAt:instant,timeZone:z.literal('America/New_York'),
 venueId:uuid,venueKind:z.literal('keys'),labelEn:text,labelHe:text,address:note,directions:note,equipment:note,guardianInformation:note,
 approvedChildCapacity:z.number().int().min(1).max(1000),qualifiedAdultAccountIds:z.array(uuid).min(1).max(100).refine(a=>new Set(a).size===a.length),
 sitePermission:source,qualifiedAdultCoverage:source,insurance:source,firstAid:source,weatherAndWaterPlan:source,guardianPickupAndEmergencyPlan:source,
 fishingTuitionExtraCents:z.literal(0),foodAndGas:z.literal('families_pay_directly'),academyArrangements:z.literal('disclosed_actual_cost_only')})
 .refine(v=>{const start=Date.parse(v.startsAt),end=Date.parse(v.endsAt);return end>start&&end-start<=24*3600000&&academyFloridaDay(v.startsAt)===academyFloridaDay(new Date(end-1).toISOString())&&new Date(academyFloridaDay(v.startsAt)+'T12:00:00Z').getUTCDay()===0;});
export const academyKeysMemberSchema=z.strictObject({enrollmentId:uuid,enrollmentRevision:revision,learnerId:uuid,purchaseId:text,purchaseLineId:text,originalOccurrenceId:uuid,
 guardianDigest:sha,paymentEvidenceSha256:sha,acceptedTermsVersion:text,localAlternativeOrRemedy:source,originalActivityBindingId:uuid,originalActivitySha256:sha,
 participation:z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('keys'),guardianTripPermission:source}),
  z.strictObject({kind:z.literal('local_alternative'),guardianDeclarationId:uuid,guardianDeclarationSha256:sha,retainedCreditId:uuid.nullable()}),
  z.strictObject({kind:z.literal('review_required'),reason:note,retainedCreditId:uuid.nullable()}),
 ])});
export type AcademyKeysMember=z.infer<typeof academyKeysMemberSchema>;
/** Read-only independently adopted evidence. No HTTP command accepts this body
 * and no operator UI writes it. Synthetic fixture records never approve a trip. */
export const academyKeysSourceReviewSchema=z.strictObject({version:z.literal(academyGroupPublicationVersion),id:uuid,workspaceId:uuid,eventId:uuid,eventRevision:revision,eventSha256:sha,
 originals:z.array(academyGroupOriginSchema).min(1).max(100),trip:academyKeysTripSchema,members:z.array(academyKeysMemberSchema).min(1).max(1000),
 initialProgramReadiness:source,readiness:z.array(z.strictObject({cohortId:uuid,participationReadiness:source})).min(1).max(100),curriculum:source,legalAndAgreementApproval:source,
 approval:z.strictObject({source,approvedBy:uuid,approvedAt:instant,expiresAt:instant,provenance:note})}).superRefine((v,c)=>{
 const originals=new Map(v.originals.map(o=>[o.selection.occurrenceId,o])),groups=new Set(v.originals.map(o=>o.selection.cohortId)),learners=new Set<string>();
 if(originals.size!==v.originals.length||groups.size!==v.originals.length)c.addIssue({code:'custom',message:'One original per group is required'});
 const travelers=v.members.filter(m=>m.participation.kind==='keys');if(!travelers.length||travelers.length>v.trip.approvedChildCapacity)c.addIssue({code:'custom',message:'Adopted child capacity requires actual Keys travelers'});
 for(const member of v.members){if(!originals.has(member.originalOccurrenceId)||learners.has(member.learnerId))c.addIssue({code:'custom',message:'One paid original and one physical seat per child is required'});learners.add(member.learnerId);}
 if(v.readiness.length!==groups.size||new Set(v.readiness.map(r=>r.cohortId)).size!==groups.size||v.readiness.some(r=>!groups.has(r.cohortId)))c.addIssue({code:'custom',message:'Every linked group requires independently evidenced readiness'});
 if(Date.parse(v.approval.approvedAt)>=Date.parse(v.approval.expiresAt)||Date.parse(v.trip.endsAt)>Date.parse(v.approval.expiresAt))c.addIssue({code:'custom',message:'Approval must cover the event interval'});
});
export type AcademyKeysSourceReview=z.infer<typeof academyKeysSourceReviewSchema>;
const common={version:z.literal(academyGroupPublicationVersion),operationId:uuid,eventId:uuid};
export const academyKeysPublishCommandSchema=z.strictObject({...common,action:z.literal('publish'),expectedDraftRevision:revision,expectedPublicationRevision:z.number().int().min(0).max(999999),sourceReviewId:uuid});
export const academyKeysCancelCommandSchema=z.strictObject({...common,action:z.literal('cancel'),expectedPublicationRevision:revision,reason:note});
export const academyKeysAttendanceCommandSchema=z.strictObject({...common,action:z.literal('attendance'),expectedPublicationRevision:revision,learnerId:uuid,expectedAttendanceRevision:z.number().int().min(0).max(999999),state:z.enum(['present','late','absent','no_show']),reason:note});
export const academyKeysCompleteCommandSchema=z.strictObject({...common,action:z.literal('complete'),expectedPublicationRevision:revision,reason:note});
export const academyKeysCommandSchema=z.discriminatedUnion('action',[academyKeysPublishCommandSchema,academyKeysCancelCommandSchema,academyKeysAttendanceCommandSchema,academyKeysCompleteCommandSchema]);
export type AcademyKeysCommand=z.infer<typeof academyKeysCommandSchema>;
export const academyKeysPublicationSchema=z.strictObject({version:z.literal(academyGroupPublicationVersion),workspaceId:uuid,eventId:uuid,id:uuid,revision,previousSha256:sha.nullable(),
 draftRevision:revision,draftSha256:sha,operatorId:uuid,sourceReviewId:uuid,sourceReviewSha256:sha,trip:academyKeysTripSchema,originals:z.array(academyGroupOriginSchema).min(1).max(100),members:z.array(academyKeysMemberSchema).min(1).max(1000),
 state:z.enum(['published','completed','cancelled']),operationId:uuid,recordedAt:instant,reason:note.nullable(),
 outcomeRights:z.literal('original_learning_outcomes_and_local_alternatives_preserved')}).refine(v=>v.revision===1?v.previousSha256===null:v.previousSha256!==null);
export type AcademyKeysPublication=z.infer<typeof academyKeysPublicationSchema>;
/** Physical service and displaced learning fulfillment are separate records.
 * No attendance boolean can mark a module/activity fulfilled or issue money. */
export const academyKeysAttendanceRecordSchema=z.strictObject({version:z.literal(academyGroupPublicationVersion),workspaceId:uuid,id:uuid,eventId:uuid,publicationId:uuid,publicationRevision:revision,
 learnerId:uuid,enrollmentId:uuid,originalOccurrenceId:uuid,revision,previousSha256:sha.nullable(),state:z.enum(['present','late','absent','no_show']),reason:note,actorId:uuid,operationId:uuid,recordedAt:instant})
 .refine(v=>v.revision===1?v.previousSha256===null:v.previousSha256!==null);
export type AcademyKeysAttendanceRecord=z.infer<typeof academyKeysAttendanceRecordSchema>;
export const academyKeysReceiptSchema=z.strictObject({version:z.literal(academyGroupPublicationVersion),operationId:uuid,eventId:uuid,publicationId:uuid,publicationRevision:revision,
 attendanceId:uuid.nullable(),state:z.enum(['published','completed','cancelled','attendance_recorded']),sha256:sha,financialEffect:z.literal('none'),activityFulfillment:z.literal('not_inferred')});
export type AcademyKeysReceipt=z.infer<typeof academyKeysReceiptSchema>;

/** Allowlisted ordinary owner projection; excludes private purchase, guardian,
 * source bodies and hashes. Readback cannot adopt or edit trusted evidence. */
export const academyKeysOwnerQuerySchema=z.strictObject({eventId:uuid});
const sourceState=z.enum(['ready','revoked','outdated','requires_review','runtime_not_admitted']);
const ownerTrip=z.strictObject({labelEn:text,labelHe:text,startsAt:instant,endsAt:instant,address:note,directions:note,equipment:note,guardianInformation:note});
export const academyKeysOwnerContextSchema=z.strictObject({version:z.literal(academyGroupPublicationVersion),eventId:uuid,draftRevision:revision,availability:z.enum(['ready','not_configured']),
 reviews:z.array(z.strictObject({id:uuid,sourceId:text,sourceRevision:text,approvedAt:instant,expiresAt:instant,state:sourceState,trip:ownerTrip,memberCount:z.number().int().min(1).max(1000)})).max(100),
 publication:z.strictObject({id:uuid,revision,state:z.enum(['published','completed','cancelled']),sourceState,trip:ownerTrip,canAttend:z.boolean(),canComplete:z.boolean(),canCancel:z.boolean(),
 members:z.array(z.strictObject({learnerId:uuid,displayName:text,groupLabel:text,stage:z.number().int().min(1).max(4),participantReference:uuid,participation:z.enum(['keys','local_alternative','review_required']),attendance:z.enum(['present','late','absent','no_show']).nullable(),attendanceRevision:z.number().int().min(0).max(1000000)})).max(1000)}).nullable()});
export type AcademyKeysOwnerContext=z.infer<typeof academyKeysOwnerContextSchema>;
export const academyKeysReplySchema=z.strictObject({receipt:academyKeysReceiptSchema.extend({replayed:z.boolean()}).strict()});
