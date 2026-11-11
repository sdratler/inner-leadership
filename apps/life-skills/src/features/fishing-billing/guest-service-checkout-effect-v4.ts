import 'server-only';
import {z} from 'zod';
import {billingId} from './contracts.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from './card-binding.ts';
import type {BillingLedgerContext} from './native.ts';
import type {CardAttempt} from './card-contracts.ts';
import type {CheckoutRequest} from './card-checkout-request.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import type {BILLING_SERVICE_V4} from './guest-service-contract-v4.ts';

/** Existing Root SDK effect shape; parsing never admits an effect. */
export const serviceCheckoutEffectV4Schema=z.object({effect:z.literal('create_checkout'),binding:billingStripeBindingSchema,operationId:billingId,quoteId:billingId,amountMinor:z.number().int().positive().max(100_000_000),configurationId:z.string().regex(/^pmc_[A-Za-z0-9]+$/)}).strict();
export type ServiceCheckoutDecisionV4=Readonly<{
 version:typeof BILLING_SERVICE_V4;purpose:'create_checkout';effect:z.infer<typeof serviceCheckoutEffectV4Schema>;
 snapshot:ServiceOwnerSnapshotV4;attempt:CardAttempt;request:CheckoutRequest;
}>;
/** Independent native CREATE_CHECKOUT admission, distinct from owner, read,
 * reconciliation and reservation. Fresh actual family/terms/account/card-only
 * configuration/service eligibility and original UNKNOWN/request must bind in
 * this SAME native TX. Read-only native admission facts must stay locked through
 * its commit. No owner Actor, cached boolean or DTO supplies this permission.
 * Root MUST pair authorizeCheckoutEffect with its official SDK admission both
 * before account reads and immediately before POST. This point-in-time adapter
 * installs neither SDK/transport/runtime nor permission for later retries. */
export interface ServiceCheckoutEffectAuthorityV4{
 target(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>):Promise<void>;
 authorize(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>,decision:ServiceCheckoutDecisionV4):Promise<void>;
}
