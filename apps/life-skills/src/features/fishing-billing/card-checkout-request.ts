import {z} from 'zod';
import {billingId} from './contracts.ts';
import {billingStripeBindingSchema} from './card-binding.ts';
import {cardSelectionSchema} from './card-contracts.ts';

/** Existing immutable request format/AAD remains shared across V3/V4. DATA only. */
const positive=z.number().int().min(1).max(100_000_000);
const metadataSchema=z.object({billing_quote_id:billingId,billing_attempt_id:billingId}).strict();
export const frozenRequestSchema=z.object({
 binding:billingStripeBindingSchema,operationId:billingId,quoteId:billingId,expectedVersion:z.number().int().positive(),
 allocations:cardSelectionSchema,amountMinor:positive,idempotencyKey:billingId,
 params:z.object({mode:z.literal('payment'),client_reference_id:billingId,payment_method_configuration:z.string().regex(/^pmc_[A-Za-z0-9]+$/),
  integration_identifier:z.string().regex(/^jlfa_monthly_[a-z]{8}$/),metadata:metadataSchema,
  payment_intent_data:z.object({metadata:metadataSchema}).strict(),line_items:z.array(z.object({quantity:z.literal(1),price_data:z.object({currency:z.literal('usd'),unit_amount:positive,product_data:z.object({name:z.string().min(1).max(200)}).strict()}).strict()}).strict()).length(1),
 }).strict(),
}).strict();
export const requestRecordSchema=z.object({version:z.literal('JLFA-FISHING-CHECKOUT-REQUEST-v1'),workspaceId:billingId,attemptId:billingId,quoteId:billingId,actorId:billingId,digest:z.string().regex(/^[a-f0-9]{64}$/),request:frozenRequestSchema}).strict();
export type CheckoutRequest=z.infer<typeof frozenRequestSchema>;
