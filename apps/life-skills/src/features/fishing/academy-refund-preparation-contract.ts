/** Preparation is not a provider approval token or permission to execute money. */
import {z} from 'zod';
import {academySharedServiceEvidenceSchema} from './academy-shared-service-contract.ts';
import {owner03PolicyVersion,owner03FamilyFeeDecision,owner03RefundInputSchema} from '../fishing-payments/owner03-policy.ts';
export const academyRefundPreparationVersion='JLFA-REFUND-PREPARED-20261021-01' as const;
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),ref=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),cents=z.number().int().nonnegative().max(100000000);
export const refundPreparationSelectionSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('purchase'),purchaseId:uuid}),z.strictObject({kind:z.literal('family'),cancellationId:uuid})
]);
export const refundPreparationCommandSchema=z.strictObject({version:z.literal(academyRefundPreparationVersion),operationId:uuid,id:uuid,selection:refundPreparationSelectionSchema,expectedReviewSha256:sha,confirmation:z.literal('prepare_only_no_execution')}).refine(c=>c.operationId!==c.id);
const provenance=z.strictObject({sourceApprovalId:uuid,sourceSha256:sha,acceptanceId:uuid,paymentRevision:z.number().int().positive(),settlementSha256:sha,guardianSha256:sha,enrollmentId:uuid.nullable(),enrollmentRevision:z.number().int().positive().nullable(),plans:z.array(z.strictObject({stageId:uuid,revision:z.number().int().nonnegative(),sha256:sha})).max(100),sharedServices:z.array(academySharedServiceEvidenceSchema).min(1).max(12).optional()});
export const refundPreparationFactsSchema=z.strictObject({version:z.literal(academyRefundPreparationVersion),policyVersion:z.literal(owner03PolicyVersion),legalStatus:z.literal('OWNER_SELECTED_REVIEW_DRAFT'),selection:refundPreparationSelectionSchema,householdId:uuid,payerAccountId:uuid,currency:z.literal('USD'),
 family:z.strictObject({cancellationId:uuid,reservationId:uuid,decisionId:z.literal(owner03FamilyFeeDecision),groupSha256:sha,membershipSha256:sha,reviewSha256:sha,proposalSha256:sha}).nullable(),
 members:z.array(z.strictObject({input:owner03RefundInputSchema,provenance,originalPayment:z.strictObject({paymentId:ref,providerReceiptId:ref,hostedOperationId:uuid,providerObjectId:ref,providerAccountId:ref,livemode:z.boolean(),currency:z.literal('USD'),amountCents:cents.positive(),apiVersion:z.string().min(1).max(80)}),refundCents:cents.positive(),administrationCents:cents,retainedLessonCents:cents})).min(1).max(20),effect:z.literal('none'),providerApproval:z.literal('not_admitted'),execution:z.literal('denied')});
export const refundPreparationResultSchema=z.strictObject({id:uuid,revision:z.literal(1),state:z.literal('prepared_only'),reviewSha256:sha,effect:z.literal('none'),providerApproval:z.literal('not_admitted'),execution:z.literal('denied')});
export type RefundPreparationSelection=z.infer<typeof refundPreparationSelectionSchema>;
export type RefundPreparationCommand=z.infer<typeof refundPreparationCommandSchema>;
export type RefundPreparationFacts=z.infer<typeof refundPreparationFactsSchema>;
export function refundPreparationView(facts:RefundPreparationFacts,reviewSha256:string){return {version:academyRefundPreparationVersion,selection:facts.selection,reviewSha256,currency:facts.currency,legalStatus:facts.legalStatus,effect:facts.effect,providerApproval:facts.providerApproval,execution:facts.execution,totalRefundCents:facts.members.reduce((n,m)=>n+m.refundCents,0),members:facts.members.map(m=>({purchaseId:m.input.purchase.purchaseId,childId:m.input.purchase.childId,refundCents:m.refundCents,administrationCents:m.administrationCents,retainedLessonCents:m.retainedLessonCents})),family:facts.family?{cancellationId:facts.family.cancellationId,reservationId:facts.family.reservationId}:null};}
