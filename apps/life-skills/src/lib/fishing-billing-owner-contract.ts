import {z} from 'zod';
import {
 BILLING_DTO_VERSION,billingId,commandSchema,cashCommandSchema,reversalCommandSchema,operationReceiptSchema,
} from '../features/fishing-billing/contracts.ts';

/** Owner transport contract only. No mounted route or financial admission. */
export const FISHING_BILLING_OWNER_PATH='/api/private/fishing-billing';
export const billingOwnerCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('cash'),command:cashCommandSchema}).strict(),
 z.object({action:z.literal('reverse_cash'),command:reversalCommandSchema}).strict(),
 z.object({action:z.literal('state'),command:commandSchema.extend({
  quoteId:billingId,paused:z.boolean().optional(),cancel:z.literal(true).optional(),
 }).strict().refine(c=>c.paused!==undefined||c.cancel===true)}).strict(),
]);
export type BillingOwnerCommand=z.infer<typeof billingOwnerCommandSchema>;
export const billingOwnerSnapshotSchema=operationReceiptSchema.shape.result;
export const billingOwnerReadSchema=z.discriminatedUnion('state',[
 z.object({version:z.literal(BILLING_DTO_VERSION),state:z.literal('ready'),current:billingOwnerSnapshotSchema}).strict(),
 z.object({version:z.literal(BILLING_DTO_VERSION),state:z.literal('confirmed'),receipt:operationReceiptSchema,current:billingOwnerSnapshotSchema}).strict(),
 z.object({version:z.literal(BILLING_DTO_VERSION),state:z.literal('unresolved'),operationId:billingId}).strict(),
]);
export type BillingOwnerRead=z.infer<typeof billingOwnerReadSchema>;
/** An unresolved lookup or transport error never authorizes a fresh operation ID.
 * A confirmed historical receipt is accompanied by a new authorized balance. */
