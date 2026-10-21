import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ApprovedOffer, FishingDue, FishingPurchaseLine, PaymentState } from '../fishing/contract.ts';
import { asId } from '../../lib/ids.ts';
import {owner03PolicyVersion} from './owner03-policy.ts';

export const POLICY_VERSION = 'RM-STRIPE-STAGE-LIFECYCLE-20261015-10';
export const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/);
export const cents = z.number().int().min(0).max(100_000_000);
export const signedFeeCents=z.number().int().min(-100_000_000).max(100_000_000);
export const instant = z.iso.datetime({ offset: true });
const basis = z.enum(['ordinary_primary_prepay','ordinary_sibling_prepay','founder_initial_primary_prepay','founder_initial_sibling_prepay','three_full_rate_dues','monthly_block_full_rate']);
const due = z.object({ id, index:z.union([z.literal(1),z.literal(2),z.literal(3)]),dueAt:instant,currency:z.literal('USD'),amountCents:cents.positive(),state:z.enum(['pending','action_required','failed','part_paid','paid','reconciliation_required']),paidCents:cents }).strict();
const lineBase = z.object({ id,learnerId:id,cohortId:id,stageId:id,stage:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),totalCents:cents.positive(),discountBasis:basis,
 eligibility:z.object({kind:z.enum(['ordinary','verified_founder','verified_sibling']),evidenceId:id,policyVersion:id}).strict(),dues:z.array(due).min(1).max(3),capacity:z.object({reservationId:id,revision:z.number().int().positive(),expiresAt:instant}).strict() }).strict();
const line=z.discriminatedUnion('mode',[
 lineBase.extend({sessions:z.literal(12),mode:z.enum(['prepay','installments'])}),
 lineBase.extend({sessions:z.literal(4),mode:z.literal('monthly_block'),block:z.strictObject({id:z.uuid(),acceptanceId:z.uuid(),occurrenceIds:z.array(z.uuid()).length(4).refine(v=>new Set(v).size===4)})})
]);
const schema=z.object({id,revision:z.number().int().positive(),workspaceId:id,program:z.enum(['sunday_fishing_academy','private_fishing_life_skills']),operatorAccountId:id,householdId:id,payerAccountId:id,currency:z.literal('USD'),lines:z.array(line).min(1).max(20),expiresAt:instant,policyVersion:id,sourceVersion:id,terms:z.object({version:id,acceptedBy:id,acceptedAt:instant}).strict()}).strict();
export function invariant(value:unknown,code:string):asserts value { if(!value)throw new Error(code); }
export function digest(value:unknown):string {
 const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
 return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
/** Called on reloaded server records, never a structural Quote supplied by a browser. */
export function approvedOffer(value:unknown):ApprovedOffer {
 const o=schema.parse(value); invariant(o.policyVersion===POLICY_VERSION||o.policyVersion===owner03PolicyVersion,'POLICY_VERSION');
 invariant(o.program==='sunday_fishing_academy','PROGRAM_PRICE_POLICY_REQUIRED');
 invariant(o.terms.acceptedBy===o.payerAccountId,'PAYER_TERMS');
 invariant(new Date(o.terms.acceptedAt).getTime()<new Date(o.expiresAt).getTime(),'TERMS_TIME');
 invariant(new Set(o.lines.map(x=>x.id)).size===o.lines.length&&new Set(o.lines.map(x=>x.learnerId)).size===o.lines.length,'DUPLICATE_LINE');
 const allDues=o.lines.flatMap(x=>x.dues);invariant(new Set(allDues.map(x=>x.id)).size===allDues.length,'DUPLICATE_DUE');
 for(const l of o.lines){
  // A block is a separate purchase, not a renamed three-dues obligation.
  // Native authority must bind these four occurrences and this renewed assent.
  if(l.mode==='monthly_block'){
   invariant(o.policyVersion===owner03PolicyVersion,'MONTHLY_BLOCK_POLICY');
   invariant(l.eligibility.kind==='ordinary'&&l.discountBasis==='monthly_block_full_rate'&&l.totalCents===65000,'MONTHLY_BLOCK_PRICE');
  }else{
   invariant(l.discountBasis!=='monthly_block_full_rate','DISCOUNT_MODE');
   invariant(o.policyVersion!==owner03PolicyVersion||l.mode!=='installments','RETIRED_INSTALLMENT_POLICY');
  }
  const founder=l.discountBasis.startsWith('founder_'),sibling=l.discountBasis.includes('_sibling_');
  invariant(l.eligibility.policyVersion===o.policyVersion,'ELIGIBILITY_POLICY');
  invariant(!founder||l.stage===1&&l.eligibility.kind==='verified_founder','FOUNDER_INITIAL_ONLY');
  invariant(!sibling||l.eligibility.kind!=='ordinary','SIBLING_EVIDENCE');
  const expected=l.mode==='monthly_block'?65000:l.mode==='installments'?195000:founder?(sibling?155000:165000):(sibling?165000:175000);
  invariant(l.totalCents===expected,'PRICE_MISMATCH');
  invariant(l.mode==='installments'?l.discountBasis==='three_full_rate_dues':l.discountBasis!=='three_full_rate_dues','DISCOUNT_MODE');
  invariant(l.dues.length===(l.mode==='installments'?3:1),'EXACT_DUES');
  let last=-Infinity;
  for(const [i,d] of l.dues.entries()){
   invariant(d.index===i+1&&d.amountCents===(l.mode==='installments'?65000:l.totalCents),'DUE_AMOUNT_INDEX');
   invariant(d.paidCents===0&&d.state==='pending','OFFER_ALREADY_PAID');
   const time=Date.parse(d.dueAt);invariant(time>last,'DUE_DATE_ORDER');last=time;
  }
  invariant(Date.parse(l.capacity.expiresAt)>=Date.parse(o.expiresAt),'CAPACITY_EXPIRY');
 }
 return {...structuredClone(o),workspaceId:asId(o.workspaceId,'workspace'),operatorAccountId:asId(o.operatorAccountId,'account'),payerAccountId:asId(o.payerAccountId,'account'),terms:{...o.terms,acceptedBy:asId(o.terms.acceptedBy,'account')},lines:o.lines.map(l=>({...l,learnerId:asId(l.learnerId,'person')}))};
}
export function activeOffer(o:ApprovedOffer,now:Date):void { invariant(Date.parse(o.expiresAt)>now.getTime(),'OFFER_EXPIRED'); }
export type SettlementFact=Readonly<{canonicalTransactionId:string;providerReceiptId:string;relatedProviderObjectId:string;operationId:string;purchaseId:string;purchaseLineId:string;dueId:string;providerAccountId:string;livemode:boolean;currency:'USD';kind:'payment'|'refund'|'dispute';cents:number;feeCents:number|null;originalPaymentId:string|null;occurredAt:string}>;
export function settled(state:PaymentState,facts:readonly SettlementFact[],recordedAt:string):PaymentState {
 const seen=new Set(state.settlements.map(x=>`${x.kind}:${x.canonicalTransactionId}`));
 const next=structuredClone(state);const settlements=[...next.settlements];const dues=next.dues.map(x=>({...x}));
 let fees=next.feesCents;
 for(const f of facts){
  id.parse(f.canonicalTransactionId);instant.parse(f.occurredAt);cents.positive().parse(f.cents);if(f.feeCents!==null)signedFeeCents.parse(f.feeCents);
  invariant(f.purchaseId===state.purchaseId&&f.currency==='USD'&&f.providerAccountId===state.providerAccountId&&f.livemode===state.livemode,'SETTLEMENT_BINDING');
  const d=dues.find(x=>x.id===f.dueId);invariant(d,'WRONG_DUE');
  const key=`${f.kind}:${f.canonicalTransactionId}`;invariant(!seen.has(key),'DUPLICATE_FACT');seen.add(key);
  if(f.kind==='refund'||f.kind==='dispute')invariant(f.originalPaymentId&&settlements.some(x=>x.kind==='payment'&&x.canonicalTransactionId===f.originalPaymentId&&x.purchaseLineId===f.purchaseLineId),'REFUND_REQUIRES_PAYMENT');
  settlements.push({canonicalTransactionId:f.canonicalTransactionId,providerReceiptId:f.providerReceiptId,purchaseLineId:f.purchaseLineId,kind:f.kind,cents:f.cents,occurredAt:f.occurredAt,recordedAt});
  if(f.kind==='payment')d.paidCents+=f.cents;
  d.state=d.paidCents>d.amountCents?'reconciliation_required':d.paidCents===d.amountCents?'paid':d.paidCents>0?'part_paid':d.state;
  fees=fees===null||f.feeCents===null?null:fees+f.feeCents;
 }
 const sum=(kind:SettlementFact['kind'])=>settlements.filter(x=>x.kind===kind).reduce((a,x)=>a+x.cents,0);
 const paid=sum('payment'),refunded=sum('refund');cents.parse(paid);cents.parse(refunded);
 const status=paid>state.originalTotalCents||refunded>paid||sum('dispute')>0?'reconciliation_required':refunded>0?'refund_recorded':paid===state.originalTotalCents?'paid':paid>0?'part_paid':state.state;
 return {...next,revision:next.revision+1,paidCents:paid,refundedCents:refunded,feesCents:fees,state:status,dues,settlements};
}
export function initialPayment(o:ApprovedOffer,l:FishingPurchaseLine,purchaseId:string,merchant:MerchantBinding):PaymentState {
 return {purchaseId,revision:1,workspaceId:o.workspaceId,offerId:o.id,providerAccountId:merchant.accountId,livemode:merchant.livemode,currency:'USD',originalTotalCents:l.totalCents,paidCents:0,refundedCents:0,feesCents:0,state:'unpaid',dues:structuredClone(l.dues),settlements:[],revisedDebt:null,policyVersion:o.policyVersion,sourceVersion:o.sourceVersion};
}
export type MerchantBinding=Readonly<{accountId:string;livemode:boolean;apiVersion:string;verifiedBindingId:string}>;
export function withdrawalProposal(price:number,attended:number,mode:'prepay'|'installments',reason:'voluntary'|'operator',multiChild:boolean){
 invariant(['prepay','installments'].includes(mode)&&['voluntary','operator'].includes(reason)&&typeof multiChild==='boolean','WITHDRAWAL_FACTS');
 cents.positive().parse(price);invariant(Number.isInteger(attended)&&attended>=0&&attended<=12,'ACTUAL_ATTENDANCE');
 if(mode==='installments')return {status:'POLICY_REQUIRED',reason:'installment_exit_unselected'} as const;
 if(reason==='operator')return {status:'OPERATOR_REVIEW',reason:'operator_nondelivery'} as const;
 if(attended>=3)return {status:'POLICY_REQUIRED',reason:'three_plus_unselected'} as const;
 if(attended===0&&multiChild)return {status:'POLICY_REQUIRED',reason:'prestart_fee_unit_unselected'} as const;
 const classCostCents=Number((2n*BigInt(price)*BigInt(attended)+12n)/24n),administrationCents=attended===1?0:20000;
 return {status:'PROPOSAL_ONLY',classCostCents,administrationCents,refundCents:price-classCostCents-administrationCents} as const;
}
export type FamilyPaymentView=Readonly<{purchaseId:string;currency:'USD';totalCents:number;paidCents:number;refundedCents:number;state:PaymentState['state'];dues:readonly Pick<FishingDue,'index'|'amountCents'|'dueAt'|'paidCents'|'state'>[];enrollmentGranted:false}>;
export type FamilyHostedAction=Readonly<{purchaseId:string;dueIndex:1|2|3;state:'ready';url:string}>;
export function familyPayment(s:PaymentState):FamilyPaymentView {return {purchaseId:s.purchaseId,currency:'USD',totalCents:s.originalTotalCents,paidCents:s.paidCents,refundedCents:s.refundedCents,state:s.state,dues:s.dues.map(d=>({index:d.index,amountCents:d.amountCents,dueAt:d.dueAt,paidCents:d.paidCents,state:d.state})),enrollmentGranted:false};}
