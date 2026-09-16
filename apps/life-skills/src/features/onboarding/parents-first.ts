import { createHash } from 'node:crypto';
import { ingestProviderReceipt, verifyAndNormalizeGreenInvoice } from '../payments/provider-adapter.ts';
import type { ProviderReceiptInput, ProviderReceiptResult, ReceiptStore, VerifiedPaymentEvent } from '../payments/provider-types.ts';
import { buildAdministrativePatch, parseStableLeadId } from '../labels/crm-contract.ts';

export const FIRST_SESSION_PAYMENT_URL = 'https://mrng.to/RQYMwyQ88C';
export interface ConsentClearance { affirmative: boolean; approvedPolicyVersion: string; signerReference: string; recordedAt: string; }
export interface StaffPaymentClearance { orderId:string; method:'bank_transfer'|'cash'; amountMinor:number; currency:string; approvedBy:string; auditRecordId:string; receivedAt:string; }
export interface CashBookingApproval { orderId:string; approvedBy:string; auditRecordId:string; }
export interface PaymentEvidence { source:'authenticated_provider_query'|'documented_authenticated_callback'; accountId:string; normalized:VerifiedPaymentEvent; }
export interface PaymentVerifier { verify(input:ProviderReceiptInput):Promise<PaymentEvidence|undefined>; }
export type CallbackResult = {status:200;result:ProviderReceiptResult}|{status:401|503;reason:string};

/** Internal receiver seam; not a second public webhook. Provider-specific verification is mandatory. */
export async function receiveVerifiedPayment(input:ProviderReceiptInput, deps:{accountId:string;verifier?:PaymentVerifier;store:ReceiptStore}):Promise<CallbackResult>{
  if(!deps.verifier || !deps.accountId) return {status:503,reason:'provider_verification_not_configured'};
  let proof:PaymentEvidence|undefined;
  try { proof=await deps.verifier.verify(input); } catch { return {status:503,reason:'provider_verification_unavailable'}; }
  if(!proof || proof.accountId!==deps.accountId || proof.normalized.providerAccountId!==deps.accountId
    || !['authenticated_provider_query','documented_authenticated_callback'].includes(proof.source)) return {status:401,reason:'unverified_payment'};
  // The normalized schema is ours. It is never represented as Morning's webhook schema.
  const e=proof.normalized;
  const normalized=verifyAndNormalizeGreenInvoice({...input,rawBody:JSON.stringify({eventId:e.providerEventId,providerAccountId:e.providerAccountId,purpose:e.purpose,status:e.status,transactions:e.transactions,orderId:e.orderId})},{accountId:deps.accountId,verify:()=>true});
  if(!normalized.ok) return {status:401,reason:'invalid_provider_evidence'};
  normalized.event.rawDigest=createHash('sha256').update(input.rawBody).digest('hex');
  try { return {status:200,result:await ingestProviderReceipt(normalized.event,input.receivedAt,deps.store)}; }
  catch { return {status:503,reason:'durable_processing_incomplete'}; }
}

/** Internal staff service only. Clearances must come from trusted private records,
 * not respondent fields. The approved version registry is trusted configuration. */
export async function manualSchedulingEligibility(input:{orderId:string;consent?:ConsentClearance;method:'card'|'bank_transfer'|'cash';staffReceipt?:StaffPaymentClearance;cashApproval?:CashBookingApproval}, store:ReceiptStore, config:{approvedConsentVersions:readonly string[]}){
  return store.withReceiptLock(`eligibility:${input.orderId}`,async()=>{
    const order=await store.findOrder(input.orderId);
    const c=input.consent;
    if(!order || !c || c.affirmative!==true || typeof c.approvedPolicyVersion!=='string' || !config.approvedConsentVersions.includes(c.approvedPolicyVersion) || typeof c.signerReference!=='string' || !c.signerReference.trim() || !Number.isFinite(Date.parse(c.recordedAt)))
      return {eligible:false,paymentState:'unverified' as const,scheduling:'manual' as const,reason:'approved_consent_required'};
    const allocation=await store.findOrderAllocation(input.orderId);
    const reversed=allocation?await store.hasRefundedTransaction(allocation.transactionId):false;
    if(reversed) return {eligible:false,paymentState:'refunded' as const,scheduling:'manual' as const,reason:'staff_review_required'};
    const s=input.staffReceipt;
    const staffPaid=!!s && s.orderId===input.orderId && s.method===input.method && s.amountMinor===55000 && s.currency==='ILS' && !!s.approvedBy?.trim() && !!s.auditRecordId?.trim() && Number.isFinite(Date.parse(s.receivedAt));
    const paid=!!allocation || staffPaid;
    const a=input.cashApproval;
    const cashDue=input.method==='cash'&&!!a&&a.orderId===input.orderId&&!!a.approvedBy?.trim()&&!!a.auditRecordId?.trim();
    return {eligible:paid||cashDue,paymentState:paid?'paid' as const:input.method==='bank_transfer'?'reported' as const:'due' as const,scheduling:'manual' as const,reason:paid?'verified_payment':cashDue?'approved_cash_due':'receipt_not_verified'};
  });
}

const OWNED_FIELDS=new Set(['Form sent','Form submitted','Payment link sent','Payment method','Payment status','Payment allocation','Booking status','Message receipt','Update provenance']);
/** Stable-ID, field-owned projection. Never copies notes, identities or confidential intake. */
export function administrativePatch(leadId:string, changes:Record<string,string>){
  parseStableLeadId(leadId);
  for(const name of Object.keys(changes)) if(!OWNED_FIELDS.has(name)) throw new Error('unowned_crm_field');
  return {leadId,fields:{...changes}};
}

export { buildAdministrativePatch };
