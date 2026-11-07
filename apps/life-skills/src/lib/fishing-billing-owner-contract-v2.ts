import {z} from 'zod';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {BILLING_DTO_V2,cashDateCommandSchema,operationReceiptV2Schema,reversalCommandV2Schema} from '../features/fishing-billing/contracts-v2.ts';
import {billingStateCommandV2Schema} from '../features/fishing-billing/state-contracts-v2.ts';

/** Separate prospective transport; existing exact-instant V1 remains intact. */
export const FISHING_BILLING_OWNER_V2_PATH='/api/private/fishing-billing/v2';
export const billingOwnerCommandV2Schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('cash_date'),command:cashDateCommandSchema}).strict(),
 z.object({action:z.literal('reverse_cash'),command:reversalCommandV2Schema}).strict(),
 z.object({action:z.literal('state'),command:billingStateCommandV2Schema}).strict(),
]);
export type BillingOwnerCommandV2=z.infer<typeof billingOwnerCommandV2Schema>;
export type BillingOwnerOperationReceiptV2=z.infer<typeof operationReceiptV2Schema>;
export const billingOwnerSnapshotV2Schema=operationReceiptV2Schema.shape.result;
export const billingOwnerReadV2Schema=z.discriminatedUnion('state',[
 z.object({version:z.literal(BILLING_DTO_V2),state:z.literal('ready'),current:billingOwnerSnapshotV2Schema}).strict(),
 z.object({version:z.literal(BILLING_DTO_V2),state:z.literal('confirmed'),receipt:operationReceiptV2Schema,current:billingOwnerSnapshotV2Schema}).strict(),
 z.object({version:z.literal(BILLING_DTO_V2),state:z.literal('unresolved'),operationId:billingId}).strict(),
]);
export type BillingOwnerReadV2=z.infer<typeof billingOwnerReadV2Schema>;
