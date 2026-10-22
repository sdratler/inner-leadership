/** MAIN-owned readback seam. Types are NOT identity, merchant or payment proof.
 * No network client, credential lookup, execution capability or default mapping.
 * Existing synthetic payment execution and the ILS ledger remain untouched.
 */
import type {AccountId,IdentityClock} from "../identity/types.ts";
import type {MerchantBinding} from "../fishing-payments/domain.ts";
import type {ProviderOperation,Receipt,ReceiptReadback} from "../fishing-payments/ports.ts";

export const stripeReadPortsVersion="rm-fishing-stripe-read-v1" as const;
export const stripeReadBounds=Object.freeze({
 calls:12,listItems:100,objectBytes:131072,requestMilliseconds:5000,totalMilliseconds:20000,
});
/** Opaque correlation only, never a substitute for native ownership/mapping. */
export const stripeFishingMetadata=Object.freeze({
 operation:"rm_operation_id",purchase:"rm_purchase_id",due:"rm_due_id",
});
export type StripeReadObject=
 |"event"|"invoice"|"checkout_session"|"payment_intent"|"charge"|"refund"|"balance_transaction";
export type StripeReadRequest=Readonly<{object:StripeReadObject;id:string}>;
export type StripeInvoicePaymentQuery=
 |Readonly<{invoiceId:string;limit:100}>
 |Readonly<{paymentIntentId:string;limit:100}>;

/** MAIN must bind the intended existing merchant, test mode and pinned SDK/API
 * version from independently verified server configuration. A supplied flag or
 * nonempty verifiedBindingId is not itself that verification. No live fallback.
 * Unknown raw SDK objects are validated/whitelisted by the reader before use.
 * Fixed requests only: no arbitrary URL, create, send, finalize, pay or refund.
 */
export interface StripeTestReadClient {
 readonly binding:Readonly<MerchantBinding&{livemode:false}>;
 retrieve(request:StripeReadRequest,signal:AbortSignal):Promise<unknown>;
 /** One bounded page. has_more is reconciliation-required, never truncation.
  * Map only to /v1/invoice_payments with the explicit invoice or PI filter.
  */
 listInvoicePayments(query:StripeInvoicePaymentQuery,signal:AbortSignal):Promise<unknown>;
}

/** Actual same-workspace native records, not provider metadata or request JSON.
 * MAIN resolves these under ordinary current identity/authority checks before
 * provider reads; the native allocation service reauthorizes before any effect.
 * Customer binding belongs to this payer+merchant+test mode. Invoice/purchase/
 * line/due belong to the same persisted confirmed hosted operation. The reader
 * must reject any disagreement; missing PI/session IDs do not authorize guessing.
 */
export type NativeStripeInvoiceBinding=Readonly<{
 nativeRevision:string;customerBindingId:string;payerAccountId:AccountId;
 customerId:string;invoiceId:string;purchaseLineId:string;
 paymentIntentId:string|null;checkoutSessionId:string|null;
 hostedOperation:ProviderOperation;
}>;
export type NativeStripeReceiptBinding=
 |Readonly<{kind:"payment";invoice:NativeStripeInvoiceBinding}>
 |Readonly<{
  kind:"refund";invoice:NativeStripeInvoiceBinding;refundOperation:ProviderOperation;
  /** From the existing native payment settlement, not refund amount/metadata. */
  originalPaymentIntentId:string;
 }>;
export interface StripeReadbackDependencies {
 readonly client:StripeTestReadClient;
 readonly clock:IdentityClock;
 /** Durable already-verified receipt only, never a browser-provided receipt.
  * Resolve existing native object/operation mappings, not email, amount, name or
  * client_reference_id. No database lock is held across subsequent SDK reads.
  */
 resolveNativeBinding(receipt:Receipt,signal:AbortSignal):Promise<NativeStripeReceiptBinding|null>;
}
/** Deliberately NOT SyntheticHostedProvider: this cannot silently enable its
 * execution, inbox or create path. Real mounting/SDK verifier remain MAIN gates.
 * Output is the existing minimal readback DTO; no raw payload/contact/card data.
 */
export interface StripeTestReceiptReadPort {
 readonly execution:"stripe_test_read_only";
 reconcileReceipt(receipt:Receipt):Promise<ReceiptReadback>;
}

// Wire shape references, inspected 16 October 2026; no account/provider action:
// https://docs.stripe.com/api/invoice-payment/object
// https://docs.stripe.com/api/invoice-payment/list
// https://docs.stripe.com/api/charges/object
// https://docs.stripe.com/api/refunds/object
// Refund objects need mode proof from their bound event/charge, not an invented
// refund.livemode field. Unsupported API shapes stay unresolved, never guessed.
