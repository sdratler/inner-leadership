import 'server-only';
import type {BillingLedgerContext} from './native.ts';
import type {BillingStripeBinding} from './card-binding.ts';
import type {CardAttempt} from './card-contracts.ts';
import type {CheckoutRequest} from './card-checkout-request.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import type {BILLING_SERVICE_V4} from './guest-service-contract-v4.ts';

export type ServiceCardReservationV4=Readonly<{
 version:typeof BILLING_SERVICE_V4;purpose:'reserve_checkout';phase:'before_reservation'|'terminal';
 snapshot:ServiceOwnerSnapshotV4;attempt:CardAttempt;request:CheckoutRequest;
}>;
/** Independent current SERVICE reservation authority, never owner permission
 * or reconciliation/SDK effect authority. Both methods use the SAME physical
 * owner reservation transaction; no nested transaction, network, cached flag
 * or caller approval. Missing authority denies new UNKNOWN reservations. */
export interface ServiceCardReservationAuthorityV4{
 target(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>):Promise<void>;
 /** Read-only native decision binding actual workspace/account/configuration,
  * original attempt/frozen request/current quote+children/remaining amounts and
  * current service policy. Terminal runs AFTER all mutable owner hooks/history
  * checks and freshly reads actual UNKNOWN/dispatch/quote rows in context.tx.
  * Hold actual admission facts stable with native locks through commit. Only
  * synchronous validation/revocation follows; Source3's pure locked owner/session
  * read postlude does not replace this independent admission. */
 authorize(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>,reservation:ServiceCardReservationV4):Promise<void>;
}
