import type { Actor,PaymentState } from '../fishing/contract.ts';
import { invariant } from './domain.ts';
import { FishingPaymentStore } from './store.ts';

/** Read-only aggregate for the existing Finance Lab. No scenario write path. */
export async function paymentActuals(store:FishingPaymentStore,actor:Actor){return store.read(actor,async c=>{
 invariant(c.actor.role==='practitioner','NOT_FOUND');
 const rows=await c.tx.query<{state:PaymentState}>('SELECT state_json AS state FROM ls_fishing_payments.purchases WHERE workspace_id=$1 ORDER BY id',[c.actor.workspaceId]);
 const households=new Set<string>();let contracted=0,received=0,refunded=0,fees:number|null=0,unpaid=0,paid=0,partPaid=0;
 for(const row of rows){const p=await store.purchase(c,row.state.purchaseId);await store.access(c,p.offer,'read',true);households.add(p.offer.householdId);contracted+=p.state.originalTotalCents;received+=p.state.paidCents;refunded+=p.state.refundedCents;fees=fees===null||p.state.feesCents===null?null:fees+p.state.feesCents;
  unpaid+=p.state.dues.reduce((a,d)=>a+Math.max(0,d.amountCents-d.paidCents),0);if(p.state.state==='paid')paid++;else if(p.state.paidCents>0)partPaid++;
 }
 const founders=await c.tx.query<{state:string;count:number}>('SELECT state,count(*)::integer AS count FROM ls_fishing_payments.founder_households WHERE workspace_id=$1 GROUP BY state',[c.actor.workspaceId]);
 const unknown=await c.tx.query<{count:number}>("SELECT count(*)::integer AS count FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND operation_json->>'state'='unknown'",[c.actor.workspaceId]);
 // Campaign-specific remaining inventory belongs to an explicitly selected
 // campaign; never subtract multiple campaigns from a fictional universal20.
 return {currency:'USD' as const,asOf:c.now.toISOString(),source:'native_settlement_facts' as const,measured:true,households:households.size,childPurchases:rows.length,paidPurchases:paid,partPaidPurchases:partPaid,
  contractedCents:contracted,cashReceivedCents:received,refundsCents:refunded,grossPaymentsLessRefundsCents:received-refunded,actualFeesCents:fees,originalContractUnpaidCents:unpaid,unknownProviderOperations:unknown[0]?.count??null,
  founderReserved:founders.filter(x=>x.state==='reserved').reduce((s,x)=>s+x.count,0),founderClaimed:founders.filter(x=>x.state==='claimed').reduce((s,x)=>s+x.count,0),founderReconciliation:founders.filter(x=>x.state==='reconciliation_required').reduce((s,x)=>s+x.count,0),
  earnedServiceCents:null,remainingServiceSessions:null,processorSettlementCents:null,processorPendingCents:null,netAfterDisputesCents:null,accountingProfileRequired:true,personalIncomeCents:null,projections:null,revisedDebtUnselected:true};
 });}
