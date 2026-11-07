import {billingInstant,ledgerReceiptSchema,type FamilyOffer,type LedgerReceipt} from './contracts.ts';
import {projectBalanceV2,type LedgerReceiptV2} from './contracts-v2.ts';
import {requireBilling} from './billing-errors.ts';
import {
 DISPUTE_ADJUSTMENT_VERSION,DISPUTE_BALANCE_VERSION,disputeAdjustmentSchema,disputeFactsSchema,
 disputePaymentBindingSchema,nativeDisputeAllocationSchema,disputeBalanceSchema,disputeReconciliationPlanSchema,
 type DisputeAdjustment,type DisputeFacts,type DisputePaymentBinding,type DisputeMovement,type NativeDisputeAllocation,
 type DisputeReconciliationPlan,
} from './dispute-contracts-v1.ts';

/** Pure planning port. Root must perform current native authorization inside
 * its transaction, and its future SDK successor must bind signed/current facts.
 * Neither this interface nor an allocation's evidence string grants authority. */
export interface BillingDisputeAllocationAuthority{
 resolve(input:{payment:LedgerReceipt;movement:DisputeMovement;history:readonly DisputeAdjustment[]}):Promise<NativeDisputeAllocation|null>;
}
const same=(a:unknown,b:unknown):boolean=>{
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x).sort();
 return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));
};
const key=(a:DisputeAdjustment)=>a.binding.accountId+'/test/'+a.movement.balanceTransactionId;
const principal=(a:DisputeAdjustment)=>a.movement.principalMinor!;
function validateHistory(q:FamilyOffer,receipts:readonly LedgerReceiptV2[],raw:readonly DisputeAdjustment[]){
 requireBilling(raw.length<=1000&&receipts.length<=1000,'UNAVAILABLE');
 const history=raw.map(a=>disputeAdjustmentSchema.parse(a)),byId=new Map(history.map(a=>[a.id,a]));
 requireBilling(byId.size===history.length&&new Set(history.map(key)).size===history.length,'UNAVAILABLE');
 const totals=new Map<string,number>(),lineTotals=new Map<string,number>(),reinstated=new Map<string,number>(),restoredLines=new Map<string,number>();
 for(const a of history){
  const payment=receipts.find(r=>r.id===a.originalReceiptId);
  requireBilling(payment?.kind==='card'&&a.quoteId===q.id&&a.workspaceId===q.workspaceId&&a.familyId===q.familyId&&
   payment.provider?.accountId===a.binding.accountId&&payment.provider.mode==='test'&&payment.provider.transactionId===a.paymentIntentId&&
   Date.parse(a.recordedAt)>=Date.parse(q.createdAt)&&Math.floor(Date.parse(a.movement.occurredAt)/1000)>=Math.floor(Date.parse(payment.receivedAt)/1000),'UNAVAILABLE');
  requireBilling(!receipts.some(r=>r.kind==='dispute'&&r.originalReceiptId===payment!.id),'UNAVAILABLE');
  const sign=a.kind==='dispute_withdrawal'?1:-1;
  totals.set(payment!.id,(totals.get(payment!.id)??0)+sign*principal(a));
  for(const x of a.allocations){
   requireBilling(payment!.allocations.some(p=>p.lineId===x.lineId),'UNAVAILABLE');
   const k=payment!.id+'/'+x.lineId;lineTotals.set(k,(lineTotals.get(k)??0)+sign*x.amountMinor);
  }
  if(a.kind==='dispute_reinstatement'){
   const original=byId.get(a.withdrawalAdjustmentId!);
   requireBilling(original?.kind==='dispute_withdrawal'&&original.disputeId===a.disputeId&&original.originalReceiptId===a.originalReceiptId&&
    original.chargeId===a.chargeId&&original.paymentIntentId===a.paymentIntentId&&original.attemptId===a.attemptId&&same(original.binding,a.binding)&&
    Date.parse(a.movement.occurredAt)>=Date.parse(original.movement.occurredAt),'UNAVAILABLE');
   const total=(reinstated.get(original!.id)??0)+principal(a);requireBilling(total<=principal(original!),'UNAVAILABLE');reinstated.set(original!.id,total);
   for(const x of a.allocations){const k=original!.id+'/'+x.lineId,total=(restoredLines.get(k)??0)+x.amountMinor;
    requireBilling(total<=(original!.allocations.find(p=>p.lineId===x.lineId)?.amountMinor??0),'UNAVAILABLE');restoredLines.set(k,total);}
  }
 }
 for(const [id,amount] of totals){
  const p=receipts.find(r=>r.id===id)!,refunds=receipts.filter(r=>r.originalReceiptId===id);
  requireBilling(amount>=0&&amount+refunds.reduce((s,r)=>s+r.amountMinor,0)<=p.amountMinor,'UNAVAILABLE');
  for(const x of p.allocations){const net=lineTotals.get(id+'/'+x.lineId)??0;
   requireBilling(net>=0&&net+refunds.reduce((s,r)=>s+(r.allocations.find(v=>v.lineId===x.lineId)?.amountMinor??0),0)<=x.amountMinor,'UNAVAILABLE');}
 }
 return history;
}
/** Additive read model, deliberately distinct from BillingBalanceV2. Money
 * follows principal only. Native/runtime/UI/reminder adoption remains held. */
export function projectDisputeBalance(q:FamilyOffer,receipts:readonly LedgerReceiptV2[],raw:readonly DisputeAdjustment[]){
 const base=projectBalanceV2(q,receipts),history=validateHistory(q,receipts,raw);
 const lines=base.lines.map(l=>{
  const withdrawals=history.filter(a=>a.kind==='dispute_withdrawal').reduce((s,a)=>s+(a.allocations.find(x=>x.lineId===l.lineId)?.amountMinor??0),0);
  const reinstatements=history.filter(a=>a.kind==='dispute_reinstatement').reduce((s,a)=>s+(a.allocations.find(x=>x.lineId===l.lineId)?.amountMinor??0),0);
  const paidMinor=l.paidMinor-withdrawals+reinstatements;requireBilling(paidMinor>=0,'UNAVAILABLE');
  return {...l,basePaidMinor:l.paidMinor,withdrawalMinor:withdrawals,reinstatementMinor:reinstatements,paidMinor,
   remainingMinor:Math.max(0,l.dueMinor-paidMinor),excessMinor:Math.max(0,paidMinor-l.dueMinor)};
 });
 const paidMinor=lines.reduce((s,l)=>s+l.paidMinor,0),remainingMinor=lines.reduce((s,l)=>s+l.remainingMinor,0),excessMinor=lines.reduce((s,l)=>s+l.excessMinor,0)+base.unallocatedMinor;
 return disputeBalanceSchema.parse({version:DISPUTE_BALANCE_VERSION,quoteId:q.id,familyId:q.familyId,revision:q.revision,currency:'USD' as const,
  dueMinor:base.dueMinor,paidMinor,remainingMinor,excessMinor,unallocatedMinor:base.unallocatedMinor,lines,
  financialState:!q.acceptance?'no_debt' as const:excessMinor>0?'overpaid' as const:remainingMinor===0?'paid' as const:paidMinor>0?'partial' as const:'unpaid' as const,
  processorFeeMinor:history.reduce((s,a)=>s+a.movement.feeMinor!,0),collectionState:'held_pending_native_adoption' as const,history});
}
type PlanInput={quote:FamilyOffer;receipts:readonly LedgerReceiptV2[];history:readonly DisputeAdjustment[];
 paymentBinding:DisputePaymentBinding;facts:DisputeFacts;recordedAt:string;newId:()=>string};
export async function planDisputeReconciliation(input:PlanInput,authority:BillingDisputeAllocationAuthority|null):Promise<DisputeReconciliationPlan>{
 const q=input.quote,f=disputeFactsSchema.parse(input.facts),p=disputePaymentBindingSchema.parse(input.paymentBinding),at=billingInstant.parse(input.recordedAt);
 const history=validateHistory(q,input.receipts,input.history),base=projectDisputeBalance(q,input.receipts,history);
 const hold=(reason:string)=>disputeReconciliationPlanSchema.parse({state:'review_required',reason,additions:[],balance:base,statusEvidence:f});
 const original=input.receipts.find(r=>r.id===p.originalReceiptId);
 if(!original||original.kind!=='card')return hold('original_card_payment_required');
 const payment=ledgerReceiptSchema.parse(original);
 if(!q.acceptance||p.quoteId!==q.id||p.workspaceId!==q.workspaceId||p.familyId!==q.familyId||f.quoteId!==q.id||f.attemptId!==p.attemptId||
  f.paymentIntentId!==p.paymentIntentId||f.chargeId!==p.chargeId||!same(f.binding,p.binding)||
  payment.provider?.accountId!==p.binding.accountId||payment.provider.mode!=='test'||payment.provider.transactionId!==p.paymentIntentId)return hold('payment_scope_mismatch');
 if(Date.parse(f.observedAt)>Date.parse(at)||Date.parse(f.createdAt)>Date.parse(f.observedAt)||
  Math.floor(Date.parse(f.createdAt)/1000)<Math.floor(Date.parse(payment.receivedAt)/1000))return hold('provider_chronology_mismatch');
 if(f.movementCoverage!=='complete')return hold('movement_coverage_unknown');
 if(f.disputedMinor>payment.amountMinor)return hold('disputed_amount_exceeds_payment');
 if(f.movements.length===0&&!['warning_needs_response','warning_under_review','warning_closed','prevented'].includes(f.status))return hold('dispute_movements_not_observed');
 if(history.some(a=>Date.parse(a.recordedAt)>Date.parse(at)))return hold('history_chronology_mismatch');
 const related=history.filter(a=>a.binding.accountId===p.binding.accountId&&a.disputeId===f.disputeId);
 if(related.some(a=>!f.movements.some(m=>m.balanceTransactionId===a.movement.balanceTransactionId)))return hold('provider_history_missing');
 if(new Set(f.movements.map(m=>m.balanceTransactionId)).size!==f.movements.length)return hold('duplicate_movement_fact');
 const additions:DisputeAdjustment[]=[];
 // A complete current read may deliver reinstatement first. Withdrawals are
 // planned first by actual occurrence, never by webhook arrival order.
 const ordered=[...f.movements].sort((a,b)=>a.direction===b.direction?Date.parse(a.occurredAt)-Date.parse(b.occurredAt):a.direction==='withdrawal'?-1:1);
 for(const movement of ordered){
  if(movement.sourceDisputeId!==f.disputeId||movement.principalMinor===null||movement.feeMinor===null||
   Math.abs(movement.grossMinor)!==movement.principalMinor||movement.netMinor!==movement.grossMinor-movement.feeMinor||
   (movement.direction==='withdrawal'?movement.grossMinor>=0:movement.grossMinor<=0))return hold('principal_fee_fact_unresolved');
  if(Date.parse(movement.occurredAt)<Date.parse(f.createdAt)||Date.parse(movement.occurredAt)>Date.parse(f.observedAt))return hold('movement_chronology_mismatch');
  const existing=history.find(a=>key(a)===p.binding.accountId+'/test/'+movement.balanceTransactionId);
  if(existing){
   if(existing.originalReceiptId!==p.originalReceiptId||existing.disputeId!==f.disputeId||existing.attemptId!==p.attemptId||
    existing.chargeId!==p.chargeId||!same(existing.binding,p.binding)||!same(existing.movement,movement))return hold('movement_identity_conflict');
   continue;
  }
  if(movement.principalMinor>payment.amountMinor||movement.principalMinor>f.disputedMinor)return hold('principal_exceeds_payment');
  const approval=authority?await authority.resolve({payment,movement,history:[...history,...additions]}):null;
  if(!approval)return hold('native_allocation_required');
  const allocation=nativeDisputeAllocationSchema.parse(approval);
  const candidate=disputeAdjustmentSchema.safeParse({version:DISPUTE_ADJUSTMENT_VERSION,id:input.newId(),
   ...p,disputeId:f.disputeId,kind:movement.direction==='withdrawal'?'dispute_withdrawal':'dispute_reinstatement',movement,
   withdrawalAdjustmentId:allocation.withdrawalAdjustmentId,allocations:allocation.allocations,allocationEvidence:allocation.evidence,
   sourceEventId:f.sourceEventId,sourceEventDigest:f.sourceEventDigest,recordedAt:at});
  if(!candidate.success)return hold('native_allocation_invalid');
  additions.push(candidate.data);
  try{projectDisputeBalance(q,input.receipts,[...history,...additions]);}catch{return hold('allocation_or_movement_conflict');}
 }
 const balance=projectDisputeBalance(q,input.receipts,[...history,...additions]);
 return disputeReconciliationPlanSchema.parse({state:'ready',reason:null,additions,balance,statusEvidence:f});
}
