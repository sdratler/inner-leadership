/** Browser-safe projection only. A valid DTO is never credit, booking, delivery
 * or guardian authority. Server composition must call the authenticated native
 * service; it must not expose the historical private credit record over HTTP. */
import {z} from 'zod';
export const academySessionCreditPublicVersion='JLFA-SESSION-CREDIT-PARENT-20261021-01' as const;
export const academySessionCreditPublicSummarySchema=z.strictObject({
 version:z.literal(academySessionCreditPublicVersion),enrollmentId:z.uuid(),learnerId:z.uuid(),
 credits:z.array(z.strictObject({id:z.uuid(),originalOccurrenceId:z.uuid(),originalOrdinal:z.number().int().min(1).max(12),state:z.enum(['outstanding','replacement_reserved','delivered'])})).max(1000)
}).superRefine((value,context)=>{
 if(new Set(value.credits.map(c=>c.id)).size!==value.credits.length||new Set(value.credits.map(c=>c.originalOccurrenceId)).size!==value.credits.length)context.addIssue({code:'custom',message:'DUPLICATE_ORIGINAL_SESSION_CREDIT'});
});
export type AcademySessionCreditPublicSummary=z.infer<typeof academySessionCreditPublicSummarySchema>;
