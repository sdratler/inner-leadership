/** Browser-safe ordinary proposal contract. No provider credentials or approval token. */
import {z} from 'zod';
import {academyOwnerEnrollmentBindingSchema,type AcademyOwnerEnrollmentBinding} from './academy-enrollment-contract.ts';
import {academyFamilyFeeReservationSchema} from './academy-refund-contract.ts';
export const academyRefundUiVersion='JLFA-REFUND-PROPOSAL-20261021-01' as const;
const uuid=z.uuid(),base={version:z.literal(academyRefundUiVersion),operationId:uuid,nativeCommandId:uuid,binding:academyOwnerEnrollmentBindingSchema};
export const academyRefundUiQuerySchema=z.strictObject({applicationId:uuid});
export const academyRefundUiCommandSchema=z.discriminatedUnion('action',[
 z.strictObject({...base,action:z.literal('create_family'),cancellationId:uuid,purchaseIds:z.array(uuid).min(2).max(20).refine(ids=>new Set(ids).size===ids.length),jointPrestartRequestConfirmed:z.literal(true),requestReference:z.string().trim().min(1).max(160).refine(v=>!/[\u0000-\u001f\u007f]/.test(v))}),
 z.strictObject({...base,action:z.literal('reserve_family_fee'),reservationId:uuid,cancellationId:uuid,expectedPreviewSha256:academyFamilyFeeReservationSchema.shape.expectedPreviewSha256,feeAllocation:academyFamilyFeeReservationSchema.shape.feeAllocation})
]).refine(c=>c.operationId!==c.nativeCommandId);
export type AcademyRefundUiCommand=z.infer<typeof academyRefundUiCommandSchema>;
export type AcademyRefundProposalView={state:'proposal';paidCents:number;attendedCount:number;retainedLessonCents:number;administrationCents:number;refundCents:number}|{state:'policy_required'|'reconciliation_required'|'not_ready';reason:string};
export type AcademyRefundPurchaseView={id:string;childId:string;displayName:string;stageId:string;stageLabel:string;proposal:AcademyRefundProposalView};
export type AcademyRefundGroupView={id:string;state:'allocation_required'|'reserved'|'policy_required'|'reconciliation_required';reason?:string;reviewSha256?:string;familyFeeCents:20000;totalRefundCents?:number;members:{purchaseId:string;childId:string;displayName:string;administrationCents?:number;refundCents?:number}[]};
export type AcademyRefundUiContext={state:'not_ready'}|{state:'not_admitted'}|{state:'ready';binding:AcademyOwnerEnrollmentBinding;purchases:AcademyRefundPurchaseView[];groups:AcademyRefundGroupView[];effect:'none';providerApproval:'not_admitted'};
