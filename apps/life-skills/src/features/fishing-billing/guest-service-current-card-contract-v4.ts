import 'server-only';
import type {LedgerReceipt} from './contracts.ts';
import type {BillingLedgerContext} from './native.ts';
import type {BillingStripeBinding} from './card-binding.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';

export type ServiceCardReconciliationScopeV4=Readonly<{
 action:'reconcile';programKey:'fishing_monthly_club';quoteId:string;familyId:string;
 childIds:readonly string[];offerSha256:string;acceptanceId:string;
}>;
export interface ServiceCardReconciliationAuthorityV4{
 /** Actual current Academy/schema/service/account admission BEFORE private
  * lookup. A binding-shaped object is not authority. No owner impersonation. */
 target(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>):Promise<void>;
 /** Current independent reconciliation access under these SAME native locks.
  * Read-only, holding actual permission facts stable through commit. Original
  * financial consent is historical evidence, not new payment/send authority. */
 authorize(context:Readonly<BillingLedgerContext>,binding:Readonly<BillingStripeBinding>,scope:ServiceCardReconciliationScopeV4):Promise<void>;
}
/** Borrowed server-only port. Producer verifies original signed event, provider
 * readback, attempt/settlement joins and idempotency; this is not that producer
 * or a failure-clock resolver. No provider/network call in this callback.
 * Advance claims synchronously, at most once, and updates the SAME quote and
 * receipt tables. A swallowed/unawaited failed advance aborts the transaction.
 * Attempt/event writes may precede or follow advance; original receipts and
 * quote material remain pinned. Paused/cancelled agreements may receive late
 * verified financial facts without resuming collection or issuing a refund. */
// Adapter/driver failure is UNAVAILABLE even if it carries a typed rejection
// code: COMMIT may have succeeded. Only the actual callback rejection identity
// can retain its AppError. Recover the original operation; do not auto-retry.
// A new callback invocation discards the previous invocation's error identity.
export type ServiceCurrentCardLedgerV4={
 context:Readonly<BillingLedgerContext>;frame:ServiceOwnerSnapshotV4;
 advance(receipts?:readonly LedgerReceipt[]):Promise<ServiceOwnerSnapshotV4>;
};
