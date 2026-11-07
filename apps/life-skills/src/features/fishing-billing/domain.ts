import {AppError} from '../../lib/errors.ts';
import {
 BILLING_DTO_VERSION,publishedOfferSchema,familyOfferSchema,ledgerReceiptSchema,balanceSchema,
 policyKeys,createFamilyOfferSchema,type PublishedOffer,type FamilyOffer,type LedgerReceipt,
 type BillingBalance,type CreateFamilyOffer,
} from './contracts.ts';

export const requireBilling=(condition:unknown,code:'INVALID_REQUEST'|'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'UNAVAILABLE'='INVALID_REQUEST'):void=>{
 if(!condition)throw new AppError(code);
};
export function missingPolicy(offer:FamilyOffer){
 return policyKeys.filter(key=>!offer.definition.policies[key]||(key==='payment_due'&&offer.lines.some(l=>!l.dueAt)));
}
/** Pure domain transitions; the native facade must authorize every operation. */
export function createFamilyOffer(definition:PublishedOffer,input:CreateFamilyOffer,context:{workspaceId:string;actorId:string;now:string}):FamilyOffer{
 const d=publishedOfferSchema.parse(definition),c=createFamilyOfferSchema.parse(input);
 requireBilling(c.definitionId===d.id&&Date.parse(context.now)>=Date.parse(d.effectiveAt));
 const overrides=new Map(c.override?.amounts.map(a=>[a.lineId,a.amountMinor])??[]);
 requireBilling(!c.override||overrides.size===c.override.amounts.length&&overrides.size===c.children.length&&c.children.every(l=>overrides.has(l.lineId)));
 return familyOfferSchema.parse({
  version:BILLING_DTO_VERSION,id:c.id,workspaceId:context.workspaceId,familyId:c.familyId,revision:1,
  state:'draft',definition:d,lines:c.children.map(l=>({
   id:l.lineId,childId:l.childId,period:l.period,groupId:l.groupId,dueAt:l.dueAt,
   amountMinor:overrides.get(l.lineId)??d.unitAmountMinor,
  })),createdAt:context.now,issuedAt:null,acceptance:null,paused:false,
  override:c.override?{reason:c.override.reason,actorId:context.actorId}:null,
 });
}
export function issueFamilyOffer(input:FamilyOffer,expectedVersion:number,now:string):FamilyOffer{
 const q=familyOfferSchema.parse(input);
 requireBilling(q.revision===expectedVersion&&q.state==='draft','CONFLICT');
 requireBilling(Date.parse(now)>=Date.parse(q.createdAt));
 return familyOfferSchema.parse({...q,revision:q.revision+1,state:'issued',issuedAt:now});
}
export function acceptFamilyOffer(input:FamilyOffer,expectedVersion:number,actorId:string,terms:{id:string;sha256:string},now:string):FamilyOffer{
 const q=familyOfferSchema.parse(input);
 requireBilling(q.revision===expectedVersion&&q.state==='issued','CONFLICT');
 requireBilling(missingPolicy(q).length===0,'UNAVAILABLE');
 requireBilling(terms.id===q.definition.terms.id&&terms.sha256===q.definition.terms.sha256);
 return familyOfferSchema.parse({...q,revision:q.revision+1,state:'accepted',acceptance:{actorId,acceptedAt:now,terms:q.definition.terms,quoteRevision:q.revision}});
}
export function changeBillingState(input:FamilyOffer,expectedVersion:number,change:{paused?:boolean;cancel?:true}):FamilyOffer{
 const q=familyOfferSchema.parse(input);
 requireBilling(q.revision===expectedVersion,'CONFLICT');
 requireBilling(change.paused!==undefined||change.cancel);
 return familyOfferSchema.parse({...q,revision:q.revision+1,paused:change.paused??q.paused,state:change.cancel?'cancelled':q.state});
}

/** Complete authorized ledger snapshot only. Failure never becomes zero-paid.
 * Cancellation suppresses chasers; it does not invent a debt write-off/refund. */
export function projectBalance(input:FamilyOffer,rawReceipts:readonly LedgerReceipt[],pendingAttemptIds:string[]=[]):BillingBalance{
 const quote=familyOfferSchema.parse(input),receipts=rawReceipts.map(r=>ledgerReceiptSchema.parse(r));
 const lineIds=new Set(quote.lines.map(l=>l.id)),byId=new Map<string,LedgerReceipt>(),ops=new Set<string>(),providerFacts=new Set<string>();
 for(const r of receipts){
  requireBilling(r.quoteId===quote.id&&r.familyId===quote.familyId&&!byId.has(r.id)&&!ops.has(r.operationId));
  requireBilling(r.allocations.every(a=>lineIds.has(a.lineId))&&!!quote.acceptance);
  requireBilling(Date.parse(r.recordedAt)>=Date.parse(quote.createdAt));
  requireBilling(r.kind==='card'||r.kind==='refund'||r.kind==='dispute'?
   Math.floor(Date.parse(r.receivedAt)/1000)>=Math.floor(Date.parse(quote.acceptance!.acceptedAt)/1000):
   Date.parse(r.receivedAt)>=Date.parse(quote.acceptance!.acceptedAt));
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
  // Returning allocated money cannot exceed that allocation, and unallocated
  // returns cannot consume more than the original unallocated remainder.
  const returnedAllocated=[...returnedLines].filter(([k])=>k.startsWith(original!.id+':')).reduce((s,[,n])=>s+n,0);
  const originalAllocated=original!.allocations.reduce((s,a)=>s+a.amountMinor,0);
  requireBilling(total-returnedAllocated<=original!.amountMinor-originalAllocated);
 }
 let unallocatedMinor=0;
 for(const r of receipts){
  const sign=r.originalReceiptId?-1:1;
  unallocatedMinor+=sign*(r.amountMinor-r.allocations.reduce((s,a)=>s+a.amountMinor,0));
 }
 requireBilling(unallocatedMinor>=0);
 const lines=quote.lines.map(l=>{
  const paidMinor=receipts.reduce((s,r)=>s+(r.originalReceiptId?-1:1)*(r.allocations.find(a=>a.lineId===l.id)?.amountMinor??0),0);
  requireBilling(paidMinor>=0);
  const dueMinor=quote.acceptance?l.amountMinor:0;
  return {lineId:l.id,childId:l.childId,period:l.period,groupId:l.groupId,quotedMinor:l.amountMinor,dueMinor,
   paidMinor,remainingMinor:Math.max(0,dueMinor-paidMinor),excessMinor:Math.max(0,paidMinor-dueMinor),dueAt:l.dueAt};
 });
 const sum=(key:'dueMinor'|'paidMinor'|'remainingMinor'|'excessMinor'|'quotedMinor')=>lines.reduce((s,l)=>s+l[key],0);
 const dueMinor=sum('dueMinor'),paidMinor=sum('paidMinor'),remainingMinor=sum('remainingMinor'),excessMinor=sum('excessMinor')+unallocatedMinor;
 const review=receipts.some(r=>r.kind==='dispute');
 const state=!quote.acceptance?'no_debt':review?'review_required':excessMinor>0?'overpaid':remainingMinor===0?'paid':paidMinor>0?'partial':'unpaid';
 return balanceSchema.parse({
  version:BILLING_DTO_VERSION,quoteId:quote.id,familyId:quote.familyId,revision:quote.revision,state,lines,
  quotedMinor:sum('quotedMinor'),dueMinor,paidMinor,remainingMinor,excessMinor,unallocatedMinor,pendingAttemptIds,
  receipts,paused:quote.paused,cancelled:quote.state==='cancelled',collection:'test_only',missingPolicy:missingPolicy(quote),reminders:[],
 });
}
export function validateCashReceipt(quote:FamilyOffer,receipts:readonly LedgerReceipt[],receipt:LedgerReceipt):LedgerReceipt{
 const r=ledgerReceiptSchema.parse(receipt),b=projectBalance(quote,receipts);
 requireBilling(quote.state==='accepted'&&r.kind==='cash'&&r.quoteId===quote.id&&r.familyId===quote.familyId);
 requireBilling(r.allocations.length>0&&r.allocations.every(a=>a.amountMinor<=(b.lines.find(l=>l.lineId===a.lineId)?.remainingMinor??0)));
 requireBilling(Date.parse(r.receivedAt)>=Date.parse(quote.acceptance!.acceptedAt));
 projectBalance(quote,[...receipts,r]);return r;
}
export function validateReversal(quote:FamilyOffer,receipts:readonly LedgerReceipt[],receipt:LedgerReceipt):LedgerReceipt{
 const r=ledgerReceiptSchema.parse(receipt);
 requireBilling(r.kind==='cash_reversal');projectBalance(quote,[...receipts,r]);return r;
}
