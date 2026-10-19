import type { ApprovedOffer, Actor, FishingPurchaseLine, IdentityClock, IdentityStore, PaymentState, SqlSession } from '../fishing/contract.ts';
import type { AccountFacts } from '../identity/types.ts';
import type { MerchantBinding, SettlementFact } from './domain.ts';

/** MAIN supplies native relationship/capacity/terms authority inside this same tx.
 * None of these callbacks may deserialize authority from request JSON or network.
 * Missing implementation leaves the module unmounted, never permissive.
 */
export interface FishingAuthority {
 loadApprovedOffer(tx:SqlSession,actor:AccountFacts,offerId:string):Promise<ApprovedOffer|null>;
 authorize(tx:SqlSession,actor:AccountFacts,offer:ApprovedOffer,action:'read'|'issue'|'hosted'|'refund'|'reminder'):Promise<boolean>;
 withdrawalFacts(tx:SqlSession,actor:AccountFacts,offer:ApprovedOffer,line:FishingPurchaseLine):Promise<WithdrawalFacts>;
 reminderPolicy(tx:SqlSession,offer:ApprovedOffer,now:Date):Promise<ReminderPolicy>;
}
export type WithdrawalFacts=Readonly<{attended:number;revision:string;reason:'voluntary'|'operator';multiChildPrestart:boolean;reviewedTermsId:string|null}>;
export type ReminderPolicy=Readonly<{approvedPolicyId:string|null;parentAccountId:string;consented:boolean;channel:'in_app'|'email'|'whatsapp';quietNow:boolean;eligibleNow:boolean;stripeAlreadyNotifies:boolean;copyVersion:string|null}>;
export type NativeContext={tx:SqlSession;actor:AccountFacts;now:Date};
export type PurchaseRecord={offer:ApprovedOffer;line:FishingPurchaseLine;state:PaymentState};
export type OperationKind='hosted_invoice'|'refund';
export type ProviderOperation=Readonly<{id:string;kind:OperationKind;workspaceId:string;purchaseId:string;dueId:string|null;refundPaymentId:string|null;providerAccountId:string;livemode:boolean;amountCents:number;currency:'USD';idempotencyKey:string;state:'reserved'|'unknown'|'confirmed';requestDigest:string;result:HostedResult|RefundResult|null}>;
export type HostedResult=Readonly<{kind:'hosted_invoice';providerObjectId:string;url:string;providerAccountId:string;livemode:boolean;currency:'USD';amountCents:number;purchaseId:string;dueId:string;idempotencyKey:string}>;
export type RefundResult=Readonly<{kind:'refund';providerObjectId:string;providerAccountId:string;livemode:boolean;currency:'USD';amountCents:number;purchaseId:string;idempotencyKey:string;status:'pending'|'succeeded'|'failed'}>;
export type Receipt=Readonly<{eventId:string;eventType:string;objectId:string;providerAccountId:string;livemode:boolean;apiVersion:string;digest:string;createdAt:string}>;
export type ReceiptReadback=Readonly<{receiptId:string;resolvedObjectId:string;providerAccountId:string;livemode:boolean;readAt:string;facts:readonly SettlementFact[];dues:readonly Readonly<{purchaseId:string;operationId:string;dueId:string;state:'pending'|'action_required'|'failed'}>[]} >;
/** Tests inject a synthetic transport. Production mounting/provider capability
 * is deliberately absent. MAIN must separately admit a real transport.
 */
export interface SyntheticHostedProvider {
 readonly execution:'synthetic';
 readonly binding:MerchantBinding;
 create(operation:ProviderOperation):Promise<HostedResult|RefundResult>;
 readOperation(operation:ProviderOperation):Promise<HostedResult|RefundResult|null>;
 reconcileReceipt(receipt:Receipt):Promise<ReceiptReadback>;
}
export interface PaymentDependencies {database:IdentityStore;clock:IdentityClock;authority:FishingAuthority;merchant:MerchantBinding|null;provider?:SyntheticHostedProvider;}
export type OperatorCommand=Readonly<{actor:Actor;commandId:string}>;

/** Separate from SyntheticHostedProvider: admitting invoices must not admit
 * refunds, automatic charging, subscriptions, messages or receipt processing.
 * Root verifies the actual merchant/credential before server composition. */
export type StripeTestHostedBinding=Readonly<MerchantBinding&{livemode:false;apiVersion:'2026-09-30.endive'}>;
export type StripeTestHostedContext=Readonly<{
 offer:ApprovedOffer;purchaseLineId:string;operation:ProviderOperation;
 customer:Readonly<{bindingId:string;revision:number;payerAccountId:string;customerId:string;merchantBindingId:string;verifiedAt:string}>;
 authorizationVersion:string;linkExpiresAt:string;
 /** First/prepay uses actual offer expiry. Later installments require an actual
  * Root-loaded approved link policy; no inferred grace/date from offer expiry. */
 laterDuePolicy:Readonly<{id:string;revision:number;sourceVersion:string}>|null;
}>;
export type StripeTestHostedPhase='create'|'add_line'|'finalize'|'close';
export type StripeTestHostedAction=
 |Readonly<{phase:'create'}>
 |Readonly<{phase:'read'|'add_line'|'finalize';invoiceId:string}>
 |Readonly<{phase:'close';invoiceId:string;closureDecisionId:string}>;
/** Private server DTO. A URL here is an observation, never permission to expose
 * it. Root must commit native bindings under fresh authority before publication. */
export type StripeTestHostedObservation=Readonly<{
 contextDigest:string;invoiceId:string;customerId:string;
 status:'draft'|'open'|'paid'|'void';hasLine:boolean;
 amountDueCents:number;paidCents:number;remainingCents:number;url:string|null;
}>;
export interface StripeTestHostedProvider {
 readonly execution:'stripe_test_hosted_invoice';readonly binding:StripeTestHostedBinding;
 perform(context:StripeTestHostedContext,action:StripeTestHostedAction,signal:AbortSignal):Promise<StripeTestHostedObservation>;
}
export type StripeTestHostedClaim=Readonly<{id:string;context:StripeTestHostedContext;action:
 Readonly<{phase:'create'}>|Readonly<{phase:'add_line'|'finalize';invoiceId:string}>|Readonly<{phase:'close';invoiceId:string;closureDecisionId:string}>}>;
/** ROOT-OWNED native coordinator, deliberately not implemented by PAY.
 * Every method reloads real records; request JSON/proof labels are not authority.
 * No database transaction/lock may remain open while provider.perform runs.
 *
 * prepare: ordinary current identity, offer/guardian/capacity/terms, exact due,
 * merchant and existing verified customer; unique operation per purchased due.
 * claim: persist UNKNOWN + immutable context/phase/request journal before I/O.
 * Phase progress lives in a SEPARATE journal, not extra operation_json fields:
 * the current native receipt resolver strictly validates that legacy shape.
 * Creation uses an unknown operation; close preserves the legacy operation/
 * result, whether confirmed or UNKNOWN after finalization/mapping failure, and
 * journals its own UNKNOWN close phase separately. A durable known invoice ID
 * is mandatory; an unknown create without that ID cannot close/search/recreate.
 * consume: fresh reauthorization and GLOBAL one-dispatch fence per operation/
 * phase, independent of actor/command replay; false must never dispatch again.
 * observe: verify the persisted consumed claim and durably retain minimal IDs/
 * result, even if authority was revoked; NEVER grant/expose a URL. Failure leaves
 * UNKNOWN, and no later phase can advance without that durable observation.
 * inspect: current authorized native context and known ID only; never provider
 * search/name/email matching. A missing ID cannot authorize another create.
 * publish: called inside the supplied current transaction. Recheck exact journal,
 * offer/due/customer/permission revisions; atomically insert immutable mappings,
 * confirm operation and ready link. No enrollment or settlement write. Closure
 * requires a separate current operator decision; record close-pending before I/O
 * and verify terminal provider state before declaring closed. Root's admitted
 * existing job/manual path must enforce expiry; due_date is not expiry proof. */
export interface StripeTestHostedCoordinator {
 prepare(actor:Actor,commandId:string,purchaseId:string,dueId:string):Promise<StripeTestHostedContext>;
 claim(actor:Actor,commandId:string,operationId:string,phase:StripeTestHostedPhase):Promise<StripeTestHostedClaim|null>;
 consume(actor:Actor,claim:StripeTestHostedClaim):Promise<boolean>;
 /** Distinct financial-owner closure authorization, inside a fresh transaction:
  * current verified operator + merchant + known persisted invoice/offer/history
  * + explicit closure effect decision. May close an owned stale link after
  * guardian revocation without granting ordinary family/read/hosted access. */
 authorizeClosure(c:NativeContext,claim:StripeTestHostedClaim):Promise<void>;
 /** Read an ALREADY consumed close claim only. No new claim/dispatch: enables
  * known-ID GET reconciliation after a lost void reply and guardian revocation.
  * Require the same current financial-owner/decision/history proof. */
 inspectClosure(actor:Actor,operationId:string,closureDecisionId:string):Promise<StripeTestHostedClaim|null>;
 observe(claim:StripeTestHostedClaim,observation:StripeTestHostedObservation):Promise<void>;
 inspect(actor:Actor,operationId:string):Promise<Readonly<{context:StripeTestHostedContext;invoiceId:string|null}>>;
 /** Reconcile only the known object and its journal in the supplied transaction;
  * no create, fresh idempotency key, cash fact, grant or public URL. */
 reconcile(c:NativeContext,context:StripeTestHostedContext,observation:StripeTestHostedObservation):Promise<void>;
 /** MUST run in the command AUTHORIZE transaction before cached result lookup,
  * not only inside publish work. Reload current native context, customer/policy
  * revisions and closing/closed state under the same locks; deny revoked or
  * close-pending links even when an earlier command cached a ready URL. */
 authorizePublication(c:NativeContext,context:StripeTestHostedContext):Promise<void>;
 publish(c:NativeContext,context:StripeTestHostedContext,observation:StripeTestHostedObservation):Promise<import('./domain.ts').FamilyHostedAction|null>;
}
export type StripeTestHostedDependencies=Readonly<{provider:StripeTestHostedProvider;coordinator:StripeTestHostedCoordinator}>;
