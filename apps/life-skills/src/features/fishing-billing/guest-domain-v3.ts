import 'server-only';
import {z} from 'zod';
import {
 billingId,billingInstant,createFamilyOfferSchema,publishedOfferSchema,ledgerReceiptSchema,
} from './contracts.ts';
import {ledgerReceiptV2Schema,newYorkDate,type LedgerReceiptV2} from './contracts-v2.ts';
import {calculateLedger,missingPolicy} from './ledger-math.ts';
import {requireBilling} from './billing-errors.ts';
import {
 BILLING_GUEST_V3,guestBalanceV3Schema,type GuestFamilyOffer,type GuestBalanceV3,
} from '../../lib/fishing-billing-guest-contract-v3.ts';
import {
 bindGuestIssuedMaterial,verifyGuestFamilyOffer,verifyGuestFinancialAcceptance,
} from '../../lib/fishing-billing-guest-material-v3.ts';

/** Pure server-side domain only. Native code must authenticate current family,
 * grant, displayed document bytes/release and actual parent evidence. Parsing,
 * hashing and calling these functions establish none of that authority. */
const creationContextSchema=z.object({workspaceId:billingId,actorId:billingId,now:billingInstant}).strict();
const stateChangeSchema=z.object({paused:z.boolean().optional(),cancel:z.literal(true).optional()}).strict()
 .refine(change=>change.paused!==undefined||change.cancel===true,'STATE_CHANGE_REQUIRED');

/** Construct a NEW guest draft from shared creation validation; no existing
 * account quote/acceptance is converted or given a fabricated parent account. */
export function createGuestFamilyOffer(definition:unknown,input:unknown,context:unknown):GuestFamilyOffer{
 const d=publishedOfferSchema.parse(definition),command=createFamilyOfferSchema.parse(input),c=creationContextSchema.parse(context);
 requireBilling(command.definitionId===d.id&&Date.parse(c.now)>=Date.parse(d.effectiveAt));
 const overrides=new Map(command.override?.amounts.map(a=>[a.lineId,a.amountMinor])??[]);
 requireBilling(!command.override||overrides.size===command.override.amounts.length&&overrides.size===command.children.length&&command.children.every(l=>overrides.has(l.lineId)));
 return verifyGuestFamilyOffer({
  version:BILLING_GUEST_V3,id:command.id,workspaceId:c.workspaceId,familyId:command.familyId,revision:1,
  state:'draft',definition:d,createdAt:c.now,issuedAt:null,acceptance:null,paused:false,
  override:command.override?{reason:command.override.reason,actorId:c.actorId}:null,
  lines:command.children.map(l=>({id:l.lineId,childId:l.childId,period:l.period,groupId:l.groupId,dueAt:l.dueAt,amountMinor:overrides.get(l.lineId)??d.unitAmountMinor})),
 });
}

export function issueGuestFamilyOffer(input:unknown,expectedVersion:number,now:string):GuestFamilyOffer{
 const q=verifyGuestFamilyOffer(input),issuedAt=billingInstant.parse(now);
 requireBilling(q.revision===expectedVersion&&q.state==='draft','CONFLICT');
 requireBilling(Date.parse(issuedAt)>=Date.parse(q.createdAt));
 return verifyGuestFamilyOffer({...q,revision:q.revision+1,state:'issued',issuedAt});
}

/** Consume genuine evidence supplied by the future native resolver. This pure
 * transition neither issues a grant nor creates a signature, journal or debt
 * row. Native persistence must commit acceptance and obligations atomically. */
export function acceptGuestFamilyOffer(input:unknown,expectedVersion:number,evidence:unknown):GuestFamilyOffer{
 const q=verifyGuestFamilyOffer(input),acceptance=verifyGuestFinancialAcceptance(evidence);
 requireBilling(q.revision===expectedVersion&&q.state==='issued','CONFLICT');
 requireBilling(missingPolicy(q).length===0,'UNAVAILABLE');
 const expected=bindGuestIssuedMaterial({
  workspaceId:q.workspaceId,familyId:q.familyId,quoteId:q.id,issuedRevision:q.revision,
  definition:q.definition,lines:q.lines,createdAt:q.createdAt,issuedAt:q.issuedAt,override:q.override,
 });
 requireBilling(acceptance.offer.sha256===expected.sha256,'CONFLICT');
 return verifyGuestFamilyOffer({...q,revision:q.revision+1,state:'accepted',acceptance});
}

/** Cancellation/pause retains the original acceptance and all financial facts.
 * It never writes off a balance, reverses a receipt or resumes a cancelled offer. */
export function changeGuestBillingState(input:unknown,expectedVersion:number,change:unknown):GuestFamilyOffer{
 const q=verifyGuestFamilyOffer(input),next=stateChangeSchema.parse(change);
 requireBilling(q.revision===expectedVersion,'CONFLICT');
 return verifyGuestFamilyOffer({...q,revision:q.revision+1,paused:next.paused??q.paused,state:next.cancel?'cancelled':q.state});
}

function validateReceiptChronology(quote:GuestFamilyOffer,receipts:LedgerReceiptV2[]){
 const acceptance=quote.acceptance,byId=new Map(receipts.map(r=>[r.id,r]));
 for(const r of receipts){
  requireBilling(acceptance!==null);
  requireBilling(Date.parse(r.recordedAt)>=Date.parse(acceptance!.acceptedAt));
  if('receivedAt' in r){
   const received=Date.parse(r.receivedAt),accepted=Date.parse(acceptance!.acceptedAt);
   requireBilling(['card','refund','dispute'].includes(r.kind)?Math.floor(received/1000)>=Math.floor(accepted/1000):received>=accepted);
  }else requireBilling(r.receivedDate>=newYorkDate(acceptance!.acceptedAt));
  if(r.originalReceiptId===null)continue;
  const original=byId.get(r.originalReceiptId);if(!original)continue; // Shared ledger rejects orphan corrections.
  requireBilling(Date.parse(r.recordedAt)>=Date.parse(original.recordedAt));
  if('receivedAt' in r){
   // A date-only original has no invented receipt instant, even on DST dates.
   requireBilling('receivedAt' in original?Date.parse(r.receivedAt)>=Date.parse(original.receivedAt):newYorkDate(r.receivedAt)>=original.receivedDate);
  }
 }
}

/** Complete validated guest snapshot, ONE existing money calculator. Missing,
 * wrong-version or inconsistent facts fail instead of becoming zero paid. */
export function projectGuestBalanceV3(input:unknown,rawReceipts:readonly LedgerReceiptV2[],pendingAttemptIds:string[]=[]):GuestBalanceV3{
 const quote=verifyGuestFamilyOffer(input),receipts=rawReceipts.map(r=>ledgerReceiptV2Schema.parse(r));
 validateReceiptChronology(quote,receipts);
 return guestBalanceV3Schema.parse({...calculateLedger(quote,receipts,pendingAttemptIds),version:BILLING_GUEST_V3});
}

/** Accept either an exact legacy instant or explicit Florida calendar date.
 * Existing receipt payloads retain their precision and actual provenance. */
export function validateGuestCashReceipt(input:unknown,old:readonly LedgerReceiptV2[],raw:unknown):LedgerReceiptV2{
 const q=verifyGuestFamilyOffer(input),receipt=ledgerReceiptV2Schema.parse(raw),balance=projectGuestBalanceV3(q,old);
 requireBilling(q.state==='accepted'&&receipt.kind==='cash'&&receipt.quoteId===q.id&&receipt.familyId===q.familyId);
 requireBilling(receipt.allocations.length>0&&receipt.allocations.every(a=>a.amountMinor<=(balance.lines.find(l=>l.lineId===a.lineId)?.remainingMinor??0)));
 projectGuestBalanceV3(q,[...old,receipt]);return receipt;
}

/** Append-only cash correction; original receipts and real provider facts are
 * immutable. Shared ledger enforces original kind, scope and return ceilings. */
export function validateGuestReversal(input:unknown,old:readonly LedgerReceiptV2[],raw:unknown){
 const q=verifyGuestFamilyOffer(input),receipt=ledgerReceiptSchema.parse(raw);
 requireBilling(receipt.kind==='cash_reversal');projectGuestBalanceV3(q,[...old,receipt]);return receipt;
}
