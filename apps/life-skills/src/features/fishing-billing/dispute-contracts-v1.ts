import {z} from 'zod';
import {allocationSchema,balanceLineSchema,billingAmount,billingId,billingInstant,sourceReferenceSchema} from './contracts.ts';
import {billingStripeBindingSchema} from './card-binding.ts';

/** Additive proposal only. No HTTP, native permission, SDK verifier, persistence
 * or sender is installed by these client-safe shapes. Existing DTOs stay exact. */
export const DISPUTE_FACTS_VERSION='JLFA-FISHING-DISPUTE-FACTS-v1' as const;
export const DISPUTE_ADJUSTMENT_VERSION='JLFA-FISHING-DISPUTE-ADJUSTMENT-v1' as const;
export const DISPUTE_BALANCE_VERSION='JLFA-FISHING-DISPUTE-BALANCE-v1' as const;
const positive=billingAmount.refine(n=>n>0);
const signed=z.number().int().min(-100_000_000).max(100_000_000);
const disputeId=z.string().regex(/^(du|dp)_[A-Za-z0-9_]{1,150}$/);
export const disputeMovementSchema=z.object({
 balanceTransactionId:z.string().regex(/^txn_[A-Za-z0-9_]{1,150}$/),
 sourceDisputeId:disputeId,direction:z.enum(['withdrawal','reinstatement']),
 currency:z.literal('USD'),exchangeRate:z.null(),grossMinor:signed,
 principalMinor:positive.nullable(),feeMinor:signed.nullable(),netMinor:signed,
 occurredAt:billingInstant,
}).strict();
export type DisputeMovement=z.infer<typeof disputeMovementSchema>;
export const disputeFactsSchema=z.object({
 version:z.literal(DISPUTE_FACTS_VERSION),binding:billingStripeBindingSchema,
 quoteId:billingId,attemptId:billingId,disputeId,
 paymentIntentId:z.string().regex(/^pi_[A-Za-z0-9_]{1,150}$/),chargeId:z.string().regex(/^ch_[A-Za-z0-9_]{1,150}$/),
 currency:z.literal('USD'),disputedMinor:positive,createdAt:billingInstant,observedAt:billingInstant,
 status:z.enum(['warning_needs_response','warning_under_review','warning_closed','needs_response','under_review',
  'appeal_needs_response','appeal_under_review','won','lost','prevented']),
 sourceEventId:z.string().regex(/^evt_[A-Za-z0-9_]{1,150}$/),sourceEventDigest:z.string().regex(/^[a-f0-9]{64}$/),
 // Complete current SDK read, never an event delta. Null means unknown coverage.
 movementCoverage:z.enum(['complete','unknown']),movements:z.array(disputeMovementSchema).max(100),
}).strict();
export type DisputeFacts=z.infer<typeof disputeFactsSchema>;
export const disputePaymentBindingSchema=z.object({
 workspaceId:billingId,quoteId:billingId,familyId:billingId,attemptId:billingId,originalReceiptId:billingId,
 chargeId:z.string().regex(/^ch_[A-Za-z0-9_]{1,150}$/),paymentIntentId:z.string().regex(/^pi_[A-Za-z0-9_]{1,150}$/),
 binding:billingStripeBindingSchema,
}).strict();
export type DisputePaymentBinding=z.infer<typeof disputePaymentBindingSchema>;
export const disputeAdjustmentSchema=z.object({
 version:z.literal(DISPUTE_ADJUSTMENT_VERSION),id:billingId,
 workspaceId:billingId,quoteId:billingId,familyId:billingId,attemptId:billingId,originalReceiptId:billingId,
 chargeId:z.string().regex(/^ch_[A-Za-z0-9_]{1,150}$/),paymentIntentId:z.string().regex(/^pi_[A-Za-z0-9_]{1,150}$/),
 binding:billingStripeBindingSchema,disputeId,
 kind:z.enum(['dispute_withdrawal','dispute_reinstatement']),movement:disputeMovementSchema,
 withdrawalAdjustmentId:billingId.nullable(),allocations:z.array(allocationSchema).min(1).max(10),
 allocationEvidence:sourceReferenceSchema,sourceEventId:z.string().regex(/^evt_[A-Za-z0-9_]{1,150}$/),
 sourceEventDigest:z.string().regex(/^[a-f0-9]{64}$/),recordedAt:billingInstant,
}).strict().superRefine((a,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(new Set(a.allocations.map(x=>x.lineId)).size!==a.allocations.length)fail('DUPLICATE_ALLOCATION');
 if(a.movement.principalMinor===null||a.allocations.reduce((s,x)=>s+x.amountMinor,0)!==a.movement.principalMinor)fail('PRINCIPAL_ALLOCATION');
 if(a.movement.feeMinor===null||a.movement.netMinor!==a.movement.grossMinor-a.movement.feeMinor)fail('FEE_FACT');
 if(a.movement.principalMinor!==Math.abs(a.movement.grossMinor))fail('PRINCIPAL_FACT');
 if(a.disputeId!==a.movement.sourceDisputeId)fail('DISPUTE_ID');
 const withdrawal=a.kind==='dispute_withdrawal';
 if(a.movement.direction!==(withdrawal?'withdrawal':'reinstatement')||(withdrawal?a.movement.grossMinor>=0:a.movement.grossMinor<=0))fail('MOVEMENT_DIRECTION');
 if(withdrawal!==(a.withdrawalAdjustmentId===null))fail('WITHDRAWAL_LINK');
 if(Date.parse(a.movement.occurredAt)>Date.parse(a.recordedAt))fail('FUTURE_MOVEMENT');
});
export type DisputeAdjustment=z.infer<typeof disputeAdjustmentSchema>;
export const nativeDisputeAllocationSchema=z.object({
 allocations:z.array(allocationSchema).min(1).max(10),evidence:sourceReferenceSchema,
 // Reinstatement links an actual stored withdrawal; no new card/cash receipt.
 withdrawalAdjustmentId:billingId.nullable(),
}).strict();
export type NativeDisputeAllocation=z.infer<typeof nativeDisputeAllocationSchema>;
export const disputeBalanceSchema=z.object({
 version:z.literal(DISPUTE_BALANCE_VERSION),quoteId:billingId,familyId:billingId,revision:z.number().int().positive(),currency:z.literal('USD'),
 dueMinor:z.number().int().min(0),paidMinor:z.number().int().min(0),remainingMinor:z.number().int().min(0),excessMinor:z.number().int().min(0),unallocatedMinor:z.number().int().min(0),
 lines:z.array(balanceLineSchema.extend({basePaidMinor:z.number().int().min(0),withdrawalMinor:z.number().int().min(0),reinstatementMinor:z.number().int().min(0)})).max(10),
 financialState:z.enum(['no_debt','unpaid','partial','paid','overpaid']),processorFeeMinor:z.number().int(),
 collectionState:z.literal('held_pending_native_adoption'),history:z.array(disputeAdjustmentSchema).max(1000),
}).strict();
export const disputeReconciliationPlanSchema=z.object({
 state:z.enum(['ready','review_required']),reason:z.string().min(1).nullable(),additions:z.array(disputeAdjustmentSchema).max(100),
 balance:disputeBalanceSchema,statusEvidence:disputeFactsSchema,
}).strict().superRefine((p,c)=>{
 if(p.state==='ready'?p.reason!==null:p.reason===null||p.additions.length!==0)c.addIssue({code:'custom',message:'PLAN_STATE'});
});
export type DisputeBalance=z.infer<typeof disputeBalanceSchema>;
export type DisputeReconciliationPlan=z.infer<typeof disputeReconciliationPlanSchema>;
