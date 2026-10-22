import {z} from 'zod';

export const academyTravelCreditVersion='JLFA-TRAVEL-CREDIT-20261021-01' as const;
const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive().max(1000),text=z.string().trim().min(1).max(160);
export const travelSelectionSchema=z.strictObject({selectedEnrollmentId:uuid,originalOccurrenceId:uuid});
const sourceReference=z.strictObject({sourceId:text,revision:text,sha256:hash});
/** Read-only imported source provenance. Neither an operator checkbox nor a
 * synthetic fixture may approve a real curriculum activity or equivalence. */
export const travelActivityBindingSchema=z.strictObject({version:z.literal(academyTravelCreditVersion),id:uuid,workspaceId:uuid,
 templateApprovalId:uuid,templateSourceSha256:hash,moduleId:text,moduleVersion:text,activityId:text,sessionKind:z.enum(['ordinary','keys','offshore']),
 curriculum:sourceReference,catalog:sourceReference,learnerArtifactId:uuid,learnerArtifactSha256:hash,
 approval:z.strictObject({id:text,approvedBy:uuid,approvedAt:z.iso.datetime({offset:true}),provenance:text})});
export type TravelActivityBinding=z.infer<typeof travelActivityBindingSchema>;
export const travelLogisticsSchema=z.strictObject({stageRevision:positive,occurrenceRevision:positive,state:z.enum(['draft','published','completed','cancelled']),
 time:z.strictObject({kind:z.literal('scheduled'),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),timeZone:z.literal('America/New_York')}),
 location:z.string().min(1).max(1200),sha256:hash});
export const travelChangeCommandSchema=z.strictObject({operationId:uuid,selection:travelSelectionSchema,beforeStageRevision:positive,changedStageRevision:positive,
 expectedStageRevision:positive,revisedOneWayMinutes:z.number().int().min(0).max(1440),estimateReference:z.string().trim().min(1).max(1200)});
export const travelDeclarationCommandSchema=z.strictObject({operationId:uuid,selection:travelSelectionSchema,changeId:uuid,changeSha256:hash,familyCannotAttend:z.boolean()});
export const travelChangeRecordSchema=z.strictObject({version:z.literal(academyTravelCreditVersion),id:uuid,workspaceId:uuid,enrollmentId:uuid,learnerId:uuid,stageId:uuid,
 originalOccurrenceId:uuid,before:travelLogisticsSchema,changed:travelLogisticsSchema,kind:z.enum(['academy_venue','academy_schedule']),
 revisedOneWayMinutes:z.number().int().min(0).max(1440),estimateReference:z.string().trim().min(1).max(1200),operatorId:uuid,recordedAt:z.iso.datetime({offset:true}),
 command:travelChangeCommandSchema,sha256:hash});
export const academyPhysicalTravelVersion='JLFA-PHYSICAL-TRAVEL-20261021-01-v2' as const;
export const physicalTravelBindingSchema=z.strictObject({eventId:uuid,publicationId:uuid,publicationRevision:z.number().int().min(1).max(1000000),tripSha256:hash});
export const physicalTravelChangeCommandSchema=z.strictObject({version:z.literal(academyPhysicalTravelVersion),operationId:uuid,selection:travelSelectionSchema,expectedStageRevision:positive,physical:physicalTravelBindingSchema,revisedOneWayMinutes:z.number().int().min(0).max(1440),estimateReference:z.string().trim().min(1).max(1200)});
export const physicalTravelChangeRecordSchema=travelChangeRecordSchema.extend({version:z.literal(academyPhysicalTravelVersion),physical:physicalTravelBindingSchema,command:physicalTravelChangeCommandSchema}).refine(v=>v.before.stageRevision===v.changed.stageRevision);
export const travelStoredChangeSchema=z.union([travelChangeRecordSchema,physicalTravelChangeRecordSchema]);
export const travelAnyChangeCommandSchema=z.union([travelChangeCommandSchema,physicalTravelChangeCommandSchema]);
export type TravelChangeRecord=z.infer<typeof travelStoredChangeSchema>;
export const travelDeclarationRecordSchema=z.strictObject({version:z.literal(academyTravelCreditVersion),id:uuid,workspaceId:uuid,enrollmentId:uuid,learnerId:uuid,changeId:uuid,
 changeSha256:hash,parentAccountId:uuid,guardianSha256:hash,drivePreferenceSha256:hash,familyCannotAttend:z.boolean(),recordedAt:z.iso.datetime({offset:true}),command:travelDeclarationCommandSchema});
export type TravelDeclarationRecord=z.infer<typeof travelDeclarationRecordSchema>;
export const travelNoticeProvenanceSchema=z.strictObject({version:z.literal(academyTravelCreditVersion),creditId:uuid,changeId:uuid,declarationId:uuid,activityBindingId:uuid,evidenceSha256:hash});
export type TravelNoticeProvenance=z.infer<typeof travelNoticeProvenanceSchema>;
export const travelCreditFrameSchema=z.strictObject({version:z.literal(academyTravelCreditVersion),selection:travelSelectionSchema,stageRevision:positive,
 availability:z.enum(['ready','source_review_required','payment_review_required','delivery_review_required','change_required','guardian_response_required']),
 originalOrdinal:z.number().int().min(1).max(12),current:travelLogisticsSchema,
 candidateChange:z.strictObject({before:travelLogisticsSchema,changed:travelLogisticsSchema}).nullable(),
 change:z.strictObject({id:uuid,sha256:hash,before:travelLogisticsSchema,changed:travelLogisticsSchema,revisedOneWayMinutes:z.number().int().min(0).max(1440)}).nullable(),
 recordedMaximumOneWayMinutes:z.number().int().min(5).max(120).nullable(),
 declaration:z.strictObject({id:uuid,familyCannotAttend:z.boolean()}).nullable(),
 responseOutcome:z.enum(['issued','retained','no_credit','facts_required']).nullable(),
 credit:z.strictObject({id:uuid,state:z.enum(['outstanding','replacement_reserved','delivered','review_required'])}).nullable(),
 replacement:z.strictObject({occurrenceId:uuid,logistics:travelLogisticsSchema}).nullable(),
 mayRecordChange:z.boolean(),mayRespond:z.boolean(),specificDateOrSeatGuaranteed:z.literal(false),physical:physicalTravelBindingSchema.extend({state:z.enum(['published','completed','cancelled'])}).optional()});
export type TravelCreditFrame=z.infer<typeof travelCreditFrameSchema>;
export const travelCommandReceiptSchema=z.strictObject({version:z.literal(academyTravelCreditVersion),operationId:uuid,changeId:uuid,declarationId:uuid.nullable(),creditId:uuid.nullable(),
 outcome:z.enum(['change_recorded','issued','retained','no_credit','facts_required']),stageRevision:positive,replayed:z.literal(false)});
export type TravelCommandReceipt=z.infer<typeof travelCommandReceiptSchema>;
