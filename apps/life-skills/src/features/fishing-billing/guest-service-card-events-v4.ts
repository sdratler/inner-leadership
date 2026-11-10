import 'server-only';
import {requireBilling} from './domain.ts';
import type {WorkspaceId} from '../identity/types.ts';
import type {IdentityStore} from '../identity/store.ts';
import type {Keyring} from '../identity/crypto.ts';
import type {BillingLedgerContext} from './native.ts';
import type {LedgerReceipt} from './contracts.ts';
import type {ProviderRefund} from './card-contracts.ts';
import type {BillingStripeBinding} from './card-binding.ts';
import type {BillingStripeInboxAuthority} from './stripe-test.ts';
import type {BillingStripeTestProvider} from './cards.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import {FishingServiceCurrentCardV4} from './guest-service-current-card-v4.ts';
import {FishingBillingCardEventProcessor} from './card-event-processor.ts';

export interface ServiceRefundAllocationAuthorityV4{
 /** Actual separately admitted per-child/period allocation, under the current
  * V4 native transaction. Null holds for review. This never requests a refund. */
 allocations(context:BillingLedgerContext,frame:ServiceOwnerSnapshotV4,refund:ProviderRefund,original:LedgerReceipt):Promise<LedgerReceipt['allocations']|null>;
}
/** Version-specific adapter into the EXISTING event/attempt/settlement state
 * machine. Genuine V4 history/consent and current independent service admission
 * come from the V4 native kernel; no V3 frame/account conversion is possible.
 * Same signed inbox, provider readback, original AAD, settlement uniqueness and
 * original processing receipt. This exposes reconciliation only, no Checkout
 * preparation/charge/refund, worker, runtime wiring or failure-chase policy. */
export class FishingServiceCardEventsV4 extends FishingBillingCardEventProcessor<ServiceOwnerSnapshotV4>{
 constructor(db:IdentityStore,workspaceId:WorkspaceId,ledger:FishingServiceCurrentCardV4,ring:Keyring,digestKey:Buffer,
  binding:BillingStripeBinding,inboxAuthority:BillingStripeInboxAuthority,provider:BillingStripeTestProvider|null=null,refundAuthority:ServiceRefundAllocationAuthorityV4|null=null){
  super({db,workspaceId,
   withReconciliation:(bound,id,work)=>ledger.withCurrentCardServiceV4(bound,id,l=>{
    requireBilling(l.context.workspaceId===workspaceId,'FORBIDDEN');return work(l);
   }),
   view:frame=>({quote:frame.quote,receipts:frame.balance.receipts}),
   refundAllocations:async(c,frame,refund,original)=>refundAuthority?refundAuthority.allocations(c,frame,refund,original):null,
  },ring,digestKey,binding,inboxAuthority,provider);
 }
}
