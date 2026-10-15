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
