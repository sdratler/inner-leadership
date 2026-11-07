import {policyKeys,type FamilyOffer,type LedgerReceipt} from './contracts.ts';
import {requireBilling} from './billing-errors.ts';
export type MoneyReceipt=Omit<LedgerReceipt,'receivedAt'>;
export function missingPolicy(offer:FamilyOffer){
 return policyKeys.filter(key=>!offer.definition.policies[key]||(key==='payment_due'&&offer.lines.some(l=>!l.dueAt)));
}
/** Shared money/allocation calculation. Callers validate their explicit date or
 * instant format first; no receipt time is manufactured by this arithmetic. */
export function calculateLedger<R extends MoneyReceipt>(quote:FamilyOffer,receipts:R[],pendingAttemptIds:string[]){
 const lineIds=new Set(quote.lines.map(l=>l.id)),byId=new Map<string,R>(),ops=new Set<string>(),providerFacts=new Set<string>();
 for(const r of receipts){
  requireBilling(r.quoteId===quote.id&&r.familyId===quote.familyId&&!byId.has(r.id)&&!ops.has(r.operationId));
  requireBilling(r.allocations.every(a=>lineIds.has(a.lineId))&&!!quote.acceptance);
  requireBilling(Date.parse(r.recordedAt)>=Date.parse(quote.createdAt));
  if(r.provider){const key=r.kind+':'+r.provider.accountId+':'+r.provider.mode+':'+r.provider.transactionId;requireBilling(!providerFacts.has(key));providerFacts.add(key);}
  byId.set(r.id,r);ops.add(r.operationId);
 }
 const returnedTotals=new Map<string,number>(),returnedLines=new Map<string,number>();
 for(const r of receipts.filter(r=>r.originalReceiptId!==null)){
  const original=byId.get(r.originalReceiptId!);
  requireBilling(original&&['cash','card'].includes(original.kind));
  requireBilling(r.kind==='cash_reversal'?original!.kind==='cash':original!.kind==='card');
  requireBilling(!r.provider||r.provider.accountId===original!.provider?.accountId&&r.provider.mode===original!.provider.mode);
  const total=(returnedTotals.get(original!.id)??0)+r.amountMinor;requireBilling(total<=original!.amountMinor);returnedTotals.set(original!.id,total);
  for(const a of r.allocations){
   const key=original!.id+':'+a.lineId,amount=(returnedLines.get(key)??0)+a.amountMinor;
   requireBilling(amount<=(original!.allocations.find(x=>x.lineId===a.lineId)?.amountMinor??0));returnedLines.set(key,amount);
  }
  const returnedAllocated=[...returnedLines].filter(([k])=>k.startsWith(original!.id+':')).reduce((s,[,n])=>s+n,0);
  const originalAllocated=original!.allocations.reduce((s,a)=>s+a.amountMinor,0);
  requireBilling(total-returnedAllocated<=original!.amountMinor-originalAllocated);
 }
 let unallocatedMinor=0;
 for(const r of receipts)unallocatedMinor+=(r.originalReceiptId?-1:1)*(r.amountMinor-r.allocations.reduce((s,a)=>s+a.amountMinor,0));
 requireBilling(unallocatedMinor>=0);
 const lines=quote.lines.map(l=>{
  const paidMinor=receipts.reduce((s,r)=>s+(r.originalReceiptId?-1:1)*(r.allocations.find(a=>a.lineId===l.id)?.amountMinor??0),0);
  requireBilling(paidMinor>=0);const dueMinor=quote.acceptance?l.amountMinor:0;
  return {lineId:l.id,childId:l.childId,period:l.period,groupId:l.groupId,quotedMinor:l.amountMinor,dueMinor,paidMinor,
   remainingMinor:Math.max(0,dueMinor-paidMinor),excessMinor:Math.max(0,paidMinor-dueMinor),dueAt:l.dueAt};
 });
 const sum=(key:'dueMinor'|'paidMinor'|'remainingMinor'|'excessMinor'|'quotedMinor')=>lines.reduce((s,l)=>s+l[key],0);
 const dueMinor=sum('dueMinor'),paidMinor=sum('paidMinor'),remainingMinor=sum('remainingMinor'),excessMinor=sum('excessMinor')+unallocatedMinor;
 const review=receipts.some(r=>r.kind==='dispute');
 const state=!quote.acceptance?'no_debt':review?'review_required':excessMinor>0?'overpaid':remainingMinor===0?'paid':paidMinor>0?'partial':'unpaid';
 return {quoteId:quote.id,familyId:quote.familyId,revision:quote.revision,state,lines,quotedMinor:sum('quotedMinor'),dueMinor,
  paidMinor,remainingMinor,excessMinor,unallocatedMinor,pendingAttemptIds,receipts,paused:quote.paused,cancelled:quote.state==='cancelled',
  collection:'test_only',missingPolicy:missingPolicy(quote),reminders:[]};
}
