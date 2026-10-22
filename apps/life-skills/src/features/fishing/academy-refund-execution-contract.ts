/** Private server protocol. A saved preparation is NOT execution permission.
 * The coordinator separately requires an executable trusted effect policy. */
import {z} from 'zod';
import {digest} from '../fishing-payments/domain.ts';
import {refundPreparationFactsSchema} from './academy-refund-preparation-contract.ts';
export const academyRefundExecutionVersion='JLFA-REFUND-EXECUTION-20261021-01' as const;
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),cents=z.number().int().positive().max(100000000),instant=z.iso.datetime({offset:true});
const decisionSchema=z.strictObject({id:opaque,revision:sha,expiresAt:instant});
export const refundExecutionMemberSchema=z.strictObject({operationId:uuid,purchaseId:uuid,childId:uuid,purchaseLineId:opaque,dueId:opaque,originalPaymentId:opaque,amountCents:cents});
export const refundExecutionBatchSchema=z.strictObject({version:z.literal(academyRefundExecutionVersion),id:uuid,workspaceId:uuid,ownerId:uuid,preparationId:uuid,preparationReviewSha256:sha,preparationRequestSha256:sha,preparationCiphertextSha256:sha,preparedFacts:refundPreparationFactsSchema,effectDecision:decisionSchema,createdAt:instant,members:z.array(refundExecutionMemberSchema).min(1).max(20)}).superRefine((b,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(digest(b.preparedFacts)!==b.preparationReviewSha256)fail('PREPARATION_REVIEW_HASH');
 if(b.id===b.preparationId||b.members.some(m=>m.operationId===b.id||m.operationId===b.preparationId)||new Set(b.members.map(m=>m.operationId)).size!==b.members.length||new Set(b.members.map(m=>m.purchaseId)).size!==b.members.length)fail('EXECUTION_IDENTITY');
 if(Date.parse(b.createdAt)>=Date.parse(b.effectDecision.expiresAt))fail('EXECUTION_APPROVAL_EXPIRED');
 if(b.members.length!==b.preparedFacts.members.length||new Set(b.members.map(m=>m.childId)).size!==b.members.length||b.preparedFacts.selection.kind==='family'!==(b.preparedFacts.family!==null))fail('PREPARATION_MEMBERSHIP');
 for(const m of b.members){const p=b.preparedFacts.members.find(p=>p.input.purchase.purchaseId===m.purchaseId);if(!p||p.input.purchase.childId!==m.childId||p.input.purchase.purchaseLineId!==m.purchaseLineId||p.originalPayment.paymentId!==m.originalPaymentId||p.refundCents!==m.amountCents||m.amountCents>p.originalPayment.amountCents)fail('PREPARATION_MEMBER_BINDING');}
 const merchant=b.preparedFacts.members[0]!.originalPayment;if(b.preparedFacts.members.some(p=>p.originalPayment.providerAccountId!==merchant.providerAccountId||p.originalPayment.livemode!==merchant.livemode||p.originalPayment.apiVersion!==merchant.apiVersion))fail('EXECUTION_MERCHANT_BINDING');
 if(b.preparedFacts.members.some(p=>p.input.payment.paidCents-p.retainedLessonCents-p.administrationCents!==p.refundCents||p.input.payment.refundedCents!==0))fail('PREPARATION_AMOUNT_BINDING');
});
export const refundExecutionCommandSchema=z.strictObject({version:z.literal(academyRefundExecutionVersion),commandId:uuid,id:uuid,preparationId:uuid,expectedReviewSha256:sha,confirmation:z.literal('execute_separately_approved_refund')}).refine(c=>new Set([c.commandId,c.id,c.preparationId]).size===3);
export const refundExecutionObservationSchema=z.strictObject({providerObjectId:z.string().regex(/^re_[A-Za-z0-9_]{1,150}$/),operationId:uuid,purchaseId:uuid,purchaseLineId:opaque,dueId:opaque,originalPaymentId:opaque,providerAccountId:opaque,livemode:z.boolean(),apiVersion:z.string().min(1).max(80),currency:z.literal('USD'),amountCents:cents,status:z.enum(['pending','succeeded','failed']),observedAt:instant});
export const refundExecutionClaimSchema=z.strictObject({id:uuid,batchId:uuid,operationId:uuid,requestSha256:sha,decisionId:opaque,decisionRevision:sha,claimedAt:instant});
export type RefundExecutionBatch=z.infer<typeof refundExecutionBatchSchema>;
export type RefundExecutionMember=z.infer<typeof refundExecutionMemberSchema>;
export type RefundExecutionCommand=z.infer<typeof refundExecutionCommandSchema>;
export type RefundExecutionClaim=z.infer<typeof refundExecutionClaimSchema>;
export type RefundExecutionObservation=z.infer<typeof refundExecutionObservationSchema>;
export type RefundExecutionState='reserved'|'unknown'|'observed_pending'|'observed_succeeded'|'observed_failed'|'settlement_verified';
/** An observation is not settlement. Validate exactly the claimed original
 * payment and immutable prepared allocation, including known-ID reconciliation. */
export function validateRefundExecutionObservation(raw:unknown,batch:RefundExecutionBatch,member:RefundExecutionMember,now:Date,knownId:string|null=null):RefundExecutionObservation{
 batch=refundExecutionBatchSchema.parse(batch);const canonical=batch.members.find(m=>m.operationId===member.operationId);if(!canonical||digest(canonical)!==digest(member))throw Error('REFUND_EXECUTION_BINDING');
 const observation=refundExecutionObservationSchema.parse(raw),prepared=batch.preparedFacts.members.find(p=>p.input.purchase.purchaseId===member.purchaseId);if(!prepared)throw Error('REFUND_EXECUTION_BINDING');const merchant=prepared.originalPayment;
 if(!Number.isFinite(now.valueOf())||Math.abs(now.valueOf()-Date.parse(observation.observedAt))>300000||observation.operationId!==member.operationId||observation.purchaseId!==member.purchaseId||observation.purchaseLineId!==member.purchaseLineId||observation.dueId!==member.dueId||observation.originalPaymentId!==member.originalPaymentId||observation.providerAccountId!==merchant.providerAccountId||observation.livemode!==merchant.livemode||observation.apiVersion!==merchant.apiVersion||observation.currency!=='USD'||observation.amountCents!==member.amountCents||knownId!==null&&observation.providerObjectId!==knownId)throw Error('REFUND_EXECUTION_BINDING');
 return observation;
}
export function refundExecutionState(known:RefundExecutionObservation|null,claimed:boolean,settled:boolean):RefundExecutionState{
 if(known&&!claimed)throw Error('REFUND_OBSERVATION_REQUIRES_CLAIM');
 if(settled){if(known?.status!=='succeeded')throw Error('REFUND_SETTLEMENT_REQUIRES_SUCCESS');return 'settlement_verified';}
 if(known)return known.status==='pending'?'observed_pending':known.status==='succeeded'?'observed_succeeded':'observed_failed';
 return claimed?'unknown':'reserved';
}
