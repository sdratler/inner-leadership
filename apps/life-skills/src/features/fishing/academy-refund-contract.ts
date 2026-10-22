/** Proposal-only commands. No provider dispatch, approval token or caller cash/attendance facts. */
import {z} from 'zod';
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const academyRefundQuerySchema=z.strictObject({purchaseId:uuid,reason:z.enum(['voluntary','operator','disciplinary'])});
export const academyFamilyCancellationSchema=z.strictObject({commandId:uuid,id:uuid,householdId:uuid,payerAccountId:uuid,purchaseIds:z.array(uuid).min(2).max(20).refine(ids=>new Set(ids).size===ids.length),requestReference:z.string().trim().min(1).max(160).refine(v=>!/[\u0000-\u001f\u007f]/.test(v))});
export const academyFamilyFeeReservationSchema=z.strictObject({commandId:uuid,id:uuid,cancellationId:uuid,expectedRevision:z.literal(1),expectedPreviewSha256:sha,feeAllocation:z.array(z.strictObject({purchaseId:uuid,childId:uuid,administrationCents:z.number().int().nonnegative().max(20000)})).min(2).max(20)});
export type AcademyRefundQuery=z.infer<typeof academyRefundQuerySchema>;
export type AcademyFamilyCancellation=z.infer<typeof academyFamilyCancellationSchema>;
export type AcademyFamilyFeeReservation=z.infer<typeof academyFamilyFeeReservationSchema>;
export type AcademyRefundReviewReason='shared_service_review_required'|'start_timing_review_required'|'before_third_lesson_window_review_required'|'makeup_attendance_review_required'|'attendance_record_required'|'refund_outcome_reconciliation_required';
