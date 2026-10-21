import {z} from 'zod';

/** Private server facts, never browser proof or a credit/booking grant. Activity
 * identity and session kind require their own approved original source binding. */
export const academyOriginalObligationVersion='JLFA-ORIGINAL-OBLIGATION-20261021-01' as const;
const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),cents=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),text=z.string().min(1).max(160);
export const academyOriginalObligationSelectionSchema=z.strictObject({selectedEnrollmentId:uuid,originalOccurrenceId:uuid});
export type AcademyOriginalObligationSelection=z.infer<typeof academyOriginalObligationSelectionSchema>;
export const academyOriginalDeliveryStepSchema=z.strictObject({stageId:uuid,stageRevision:positive,occurrenceId:uuid,occurrenceRevision:positive,state:z.enum(['draft','published','completed','cancelled']),
 moduleId:text,moduleVersion:text,templateVersion:text,templateSourceSha256:hash,
 attendance:z.strictObject({state:z.enum(['present','late','absent','no_show']),recordedAt:z.iso.datetime({offset:true}),recordedBy:uuid}).nullable(),
 notice:z.strictObject({id:uuid,state:z.enum(['protected','best_effort','operator_review','operator_undelivered']),originalOccurrenceRevision:positive,entitlementId:uuid.nullable(),replacementOccurrenceId:uuid.nullable(),replacementReservationId:uuid.nullable()}).nullable(),
 reservationState:z.enum(['reserved','confirmed','released']).nullable()});
export const academyOriginalDeliverySchema=z.strictObject({state:z.enum(['undelivered','delivered','review_required']),reason:z.enum(['purchased_session_undelivered','selected_child_delivery_recorded','attendance_record_required','past_session_unresolved','unscheduled_session','makeup_cycle','makeup_fork','shared_makeup_target','purchased_root_collision','nested_entitlement_review','reservation_review','delivery_chain_conflict','original_provenance_required','replacement_activity_binding_required']),
 rootEntitlementId:uuid.nullable(),effectiveOccurrenceId:uuid,chain:z.array(academyOriginalDeliveryStepSchema).min(1).max(12)});
export type AcademyOriginalDelivery=z.infer<typeof academyOriginalDeliverySchema>;
export type AcademyOriginalDeliveryStep=z.infer<typeof academyOriginalDeliveryStepSchema>;
export type AcademyMakeupSeatProof=Readonly<{workspaceId:string;sourceStageId:string;entitlementId:string;enrollmentId:string;learnerId:string;occurrenceId:string;reservationId:string;seatStageId:string;origin:string;state:'reserved'|'confirmed'|'released'}>;
export const academyOriginalObligationSchema=z.strictObject({version:z.literal(academyOriginalObligationVersion),workspaceId:uuid,enrollmentId:uuid,enrollmentRevision:positive,learnerId:uuid,householdId:uuid,payerAccountId:uuid,purchaseId:text,purchaseLineId:text,guardianDigest:hash,acceptedTermsVersion:text,
 original:z.strictObject({cohortId:uuid,stageId:uuid,stage:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),stageRevision:positive,occurrenceId:uuid,occurrenceRevision:positive,ordinal:z.number().int().min(1).max(12),moduleId:text,moduleVersion:text,templateVersion:text,templateApprovalId:uuid,templateSourceSha256:hash}),
 purchaseScope:z.strictObject({kind:z.enum(['monthly_block','full_stage']),purchasedLessons:z.union([z.literal(4),z.literal(12)]),occurrenceIds:z.array(uuid).min(4).max(12).refine(ids=>new Set(ids).size===ids.length)}).refine(v=>v.occurrenceIds.length===v.purchasedLessons&&(v.kind==='monthly_block')===(v.purchasedLessons===4)),
 payment:z.strictObject({state:z.enum(['verified_fully_paid','review_required']),reason:z.enum(['all_original_dues_paid','payment_not_fully_settled','payment_reconciliation_required']),revision:positive,originalTotalCents:cents,paidCents:cents,refundedCents:cents,dues:z.array(z.strictObject({id:text,index:z.union([z.literal(1),z.literal(2),z.literal(3)]),amountCents:cents,paidCents:cents,state:z.enum(['pending','action_required','failed','part_paid','paid','reconciliation_required'])})).min(1).max(3),evidenceSha256:hash}),
 delivery:academyOriginalDeliverySchema,plans:z.array(z.strictObject({stageId:uuid,revision:positive,sha256:hash})).min(1).max(16),evidenceSha256:hash,mayIssueCredit:z.literal(false),mayBook:z.literal(false),mayMarkDelivered:z.literal(false)});
export type AcademyOriginalObligation=z.infer<typeof academyOriginalObligationSchema>;
