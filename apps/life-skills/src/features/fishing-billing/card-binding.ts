import {z} from 'zod';
/** Data shape only; actual account/secret/target/service permission stays server-owned. */
export const billingStripeBindingSchema=z.object({
 accountId:z.string().regex(/^acct_[A-Za-z0-9_]{1,150}$/),livemode:z.literal(false),
 apiVersion:z.literal('2026-09-30.endive'),verifiedBindingId:z.string().min(1).max(200),
}).strict();
export type BillingStripeBinding=z.infer<typeof billingStripeBindingSchema>;
