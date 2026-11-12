import {requireBilling} from './billing-errors.ts';
export {requireBilling} from './billing-errors.ts';
import {calculateLedger,missingPolicy} from './ledger-math.ts';
export {missingPolicy} from './ledger-math.ts';
import {
 BILLING_DTO_VERSION,publishedOfferSchema,familyOfferSchema,ledgerReceiptSchema,balanceSchema,
 createFamilyOfferSchema,type PublishedOffer,type FamilyOffer,type LedgerReceipt,
 type BillingBalance,type CreateFamilyOffer,
} from './contracts.ts';

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
 for(const r of receipts){
  requireBilling(!!quote.acceptance);
  requireBilling(r.kind==='card'||r.kind==='refund'||r.kind==='dispute'?
   Math.floor(Date.parse(r.receivedAt)/1000)>=Math.floor(Date.parse(quote.acceptance!.acceptedAt)/1000):
   Date.parse(r.receivedAt)>=Date.parse(quote.acceptance!.acceptedAt));
 }
 return balanceSchema.parse({...calculateLedger(quote,receipts,pendingAttemptIds),version:BILLING_DTO_VERSION});
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
