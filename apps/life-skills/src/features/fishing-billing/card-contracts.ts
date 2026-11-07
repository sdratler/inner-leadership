import {z} from 'zod';
import {billingId,billingAmount,billingInstant,allocationSchema} from './contracts.ts';
import {billingStripeBindingSchema} from './card-binding.ts';
export const CARD_VERSION='JLFA-FISHING-CARD-v1' as const;
const positive=billingAmount.refine(n=>n>0);
export const cardSelectionSchema=z.array(allocationSchema).min(1).max(10);
export const prepareCardCommandSchema=z.object({
 operationId:billingId,quoteId:billingId,expectedVersion:z.number().int().positive(),
 selection:cardSelectionSchema,
}).strict();
export type PrepareCardCommand=z.infer<typeof prepareCardCommandSchema>;
export const cardPreparationReceiptSchema=z.object({
 version:z.literal(CARD_VERSION),operationId:billingId,quoteId:billingId,
 entityVersion:z.number().int().positive(),replayed:z.boolean(),
 result:z.object({attemptId:billingId,amountMinor:positive,allocations:cardSelectionSchema}).strict(),
}).strict();
export const cardAttemptSchema=z.object({
 version:z.literal(CARD_VERSION),id:billingId,workspaceId:billingId,quoteId:billingId,familyId:billingId,
 actorId:billingId,revision:z.number().int().positive(),balanceVersion:z.number().int().positive(),binding:billingStripeBindingSchema,
 command:prepareCardCommandSchema,requestDigest:z.string().regex(/^[a-f0-9]{64}$/),
 preparation:cardPreparationReceiptSchema,createdAt:billingInstant,
 state:z.enum(['prepared','unknown','open','pending','failed','expired','paid','stale','review_required']),
 dispatchId:billingId.nullable(),sessionId:z.string().regex(/^cs_[A-Za-z0-9_]+$/).nullable(),
 checkoutUrl:z.string().url().nullable(),paymentIntentId:z.string().regex(/^pi_[A-Za-z0-9_]+$/).nullable(),
}).strict();
export type CardAttempt=z.infer<typeof cardAttemptSchema>;
export const providerRefundSchema=z.object({
 id:z.string().regex(/^re_[A-Za-z0-9_]+$/),amountMinor:positive,
 state:z.enum(['pending','succeeded','failed']),occurredAt:billingInstant,
}).strict();
export type ProviderRefund=z.infer<typeof providerRefundSchema>;
/** Only the root's account-bound official SDK read adapter produces this.
 * Stripe metadata supplies opaque IDs; native order/attempt/amount still bind. */
export const providerPaymentSnapshotSchema=z.object({
 accountId:z.string().regex(/^acct_[A-Za-z0-9_]+$/),livemode:z.literal(false),
 apiVersion:z.literal('2026-09-30.endive'),quoteId:billingId,attemptId:billingId,
 sessionId:z.string().regex(/^cs_[A-Za-z0-9_]+$/),paymentIntentId:z.string().regex(/^pi_[A-Za-z0-9_]+$/),
 currency:z.literal('USD'),amountMinor:positive,receivedMinor:billingAmount,
 status:z.enum(['pending','failed','paid']),method:z.literal('card'),
 paidAt:billingInstant.nullable(),observedAt:billingInstant,
 refunds:z.array(providerRefundSchema).max(100),
 dispute:z.enum(['none','open','funds_withdrawn','funds_reinstated']),
}).strict();
export type ProviderPaymentSnapshot=z.infer<typeof providerPaymentSnapshotSchema>;
export const cardExceptionSchema=z.object({
 version:z.literal('JLFA-FISHING-CARD-EXCEPTION-v1'),id:billingId,workspaceId:billingId,quoteId:billingId,familyId:billingId,
 eventId:z.string(),eventDigest:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string(),snapshot:providerPaymentSnapshotSchema,
 state:z.enum(['open','resolved']),recordedAt:billingInstant,
}).strict();
export const cardSessionResultSchema=z.object({
 accountId:z.string().regex(/^acct_[A-Za-z0-9_]+$/),livemode:z.literal(false),
 apiVersion:z.literal('2026-09-30.endive'),quoteId:billingId,attemptId:billingId,
 id:z.string().regex(/^cs_[A-Za-z0-9_]+$/),amountMinor:positive,currency:z.literal('USD'),
 url:z.string().url(),paymentStatus:z.enum(['unpaid','paid','no_payment_required']),
}).strict();
