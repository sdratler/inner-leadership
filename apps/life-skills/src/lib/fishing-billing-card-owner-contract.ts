import {z} from 'zod';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {cardAttemptSchema,cardPreparationReceiptSchema,prepareCardCommandSchema} from '../features/fishing-billing/card-contracts.ts';
import {billingOwnerSnapshotV2Schema} from './fishing-billing-owner-contract-v2.ts';

export const BILLING_CARD_OWNER_VERSION='JLFA-FISHING-OWNER-CARD-v1' as const;
export const FISHING_BILLING_CARD_OWNER_PATH='/api/private/fishing-billing/card';
export const billingCardOwnerCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),command:prepareCardCommandSchema}).strict(),
 z.object({action:z.literal('create_checkout'),command:z.object({quoteId:billingId,attemptId:billingId}).strict()}).strict(),
]);
/** Historical attempt data does not make its old Checkout link actionable.
 * The transport supplies a separate URL only after fresh authorized readback. */
export const billingCardOwnerAttemptSchema=cardAttemptSchema.omit({checkoutUrl:true});
const projected={attempt:billingCardOwnerAttemptSchema,current:billingOwnerSnapshotV2Schema,checkoutUrl:z.string().url().nullable()};
export const billingCardOwnerReadSchema=z.discriminatedUnion('state',[
 z.object({version:z.literal(BILLING_CARD_OWNER_VERSION),state:z.literal('attempt'),...projected}).strict(),
 z.object({version:z.literal(BILLING_CARD_OWNER_VERSION),state:z.literal('prepared'),receipt:cardPreparationReceiptSchema,...projected}).strict(),
 z.object({version:z.literal(BILLING_CARD_OWNER_VERSION),state:z.literal('unresolved'),quoteId:billingId,operationId:billingId}).strict(),
]);
export type BillingCardOwnerCommand=z.infer<typeof billingCardOwnerCommandSchema>;
export type BillingCardOwnerRead=z.infer<typeof billingCardOwnerReadSchema>;
