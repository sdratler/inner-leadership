import {syntheticDateCashFixtures} from './fixtures-v2.ts';
import {syntheticId} from './fixtures.ts';
import {DISPUTE_FACTS_VERSION,disputeFactsSchema,disputePaymentBindingSchema,type DisputeMovement} from './dispute-contracts-v1.ts';
import {planDisputeReconciliation,type BillingDisputeAllocationAuthority} from './disputes.ts';
/** Synthetic only. No status, amount, allocation or provider ID is approval. */
export function syntheticDisputeFixture(){
 const family=syntheticDateCashFixtures(),original=family.balance.receipts.find(r=>r.kind==='card')!;
 const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-DISPUTE-ONLY'};
 const paymentBinding=disputePaymentBindingSchema.parse({binding,workspaceId:family.quote.workspaceId,quoteId:family.quote.id,
  familyId:family.quote.familyId,attemptId:syntheticId(701),originalReceiptId:original.id,chargeId:'ch_SYNTHETIC',paymentIntentId:original.provider!.transactionId});
 const withdrawal:DisputeMovement={balanceTransactionId:'txn_SYNTHETIC_WITHDRAWAL',sourceDisputeId:'du_SYNTHETIC',direction:'withdrawal',
  currency:'USD',exchangeRate:null,grossMinor:-20000,principalMinor:20000,feeMinor:1500,netMinor:-21500,occurredAt:'2035-01-04T15:00:00Z'};
 const reinstatement:DisputeMovement={balanceTransactionId:'txn_SYNTHETIC_REINSTATEMENT',sourceDisputeId:'du_SYNTHETIC',direction:'reinstatement',
  currency:'USD',exchangeRate:null,grossMinor:20000,principalMinor:20000,feeMinor:-500,netMinor:20500,occurredAt:'2035-01-05T15:00:00Z'};
 const facts=disputeFactsSchema.parse({version:DISPUTE_FACTS_VERSION,binding,quoteId:family.quote.id,attemptId:paymentBinding.attemptId,
  disputeId:'du_SYNTHETIC',chargeId:paymentBinding.chargeId,paymentIntentId:paymentBinding.paymentIntentId,currency:'USD',disputedMinor:20000,
  createdAt:'2035-01-03T15:00:00Z',observedAt:'2035-01-06T15:00:00Z',status:'needs_response',sourceEventId:'evt_SYNTHETIC_DISPUTE',
  sourceEventDigest:'c'.repeat(64),movementCoverage:'complete',movements:[withdrawal]});
 return {syntheticOnly:true as const,quote:family.quote,receipts:family.balance.receipts,paymentBinding,facts,withdrawal,reinstatement,
  recordedAt:'2035-01-06T15:00:00Z',allocationEvidence:{id:'SYNTHETIC-NATIVE-ALLOCATION-NOT-APPROVAL',sha256:'d'.repeat(64)}};
}
export async function syntheticDisputeViewFixtures(){
 const f=syntheticDisputeFixture();let id=850;
 const input={...f,history:[],newId:()=>syntheticId(id++)};
 const authority:BillingDisputeAllocationAuthority={resolve:async({movement,history})=>({
  allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:movement.principalMinor!}],evidence:f.allocationEvidence,
  withdrawalAdjustmentId:movement.direction==='withdrawal'?null:history.find(a=>a.kind==='dispute_withdrawal')!.id,
 })};
 return {syntheticOnly:true as const,withdrawn:await planDisputeReconciliation(input,authority),
  reinstated:await planDisputeReconciliation({...input,facts:{...f.facts,status:'won',movements:[f.reinstatement,f.withdrawal]}},authority),
  unresolved:await planDisputeReconciliation(input,null)};
}
