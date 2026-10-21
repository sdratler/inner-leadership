import {z} from 'zod';

export const owner03PolicyVersion='JLFA-OWNER-20261020-REFUND-SAFETY-03' as const;
const uuid=z.uuid(),ref=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),cents=z.number().int().nonnegative().max(100000000);
const prepayBasis=z.enum(['ordinary_primary_prepay','ordinary_sibling_prepay','founder_initial_primary_prepay','founder_initial_sibling_prepay']);
const priceBasis=z.enum(['monthly_block_full_rate',...prepayBasis.options,'three_full_rate_dues']);
const acceptedOffer=z.strictObject({id:uuid,revision:z.number().int().positive(),policyVersion:z.literal(owner03PolicyVersion),purchaseLineId:uuid,childId:uuid,priceCents:cents.positive(),priceBasis,eligibilityEvidenceId:ref,acceptanceId:uuid,termsVersion:ref});
const base={policyVersion:z.literal(owner03PolicyVersion),program:z.literal('sunday_fishing_academy'),purchaseId:uuid,purchaseLineId:uuid,childId:uuid,stageId:uuid,stage:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),currency:z.literal('USD'),acceptedOffer};
export const owner03PurchaseSchema=z.discriminatedUnion('mode',[
 z.strictObject({...base,mode:z.literal('monthly_block'),blockId:uuid,purchasedLessons:z.literal(4),priceCents:z.literal(65000),priceBasis:z.literal('monthly_block_full_rate')}),
 z.strictObject({...base,mode:z.literal('stage_prepay'),purchasedLessons:z.literal(12),priceCents:cents.positive(),priceBasis:prepayBasis}),
 // Explicit denial lane only. No migration/reclassification of an old purchase.
 z.strictObject({...base,mode:z.literal('installments'),purchasedLessons:z.literal(12),priceCents:z.literal(195000),priceBasis:z.literal('three_full_rate_dues')}),
]);
const attendanceRecord=z.strictObject({lessonId:uuid,purchaseId:uuid,childId:uuid,scopeId:uuid,outcome:z.enum(['attended','operator_cancelled','not_delivered','not_attended'])});
export const owner03RefundInputSchema=z.strictObject({purchase:owner03PurchaseSchema,
 payment:z.strictObject({purchaseId:uuid,childId:uuid,currency:z.literal('USD'),paidCents:cents,refundedCents:cents,settlementReferences:z.array(ref).min(1).max(100)}),
 attendance:z.strictObject({scopeId:uuid,attendedCount:z.number().int().nonnegative().max(12),lessons:z.array(attendanceRecord).max(12)}),
 reason:z.enum(['voluntary','operator','disciplinary']),timing:z.enum(['prestart','after_start']),multiChildPrestart:z.boolean(),
});
export type Owner03Purchase=Readonly<z.infer<typeof owner03PurchaseSchema>>;
export type Owner03RefundInput=Readonly<z.infer<typeof owner03RefundInputSchema>>;
export type Owner03References=Readonly<{purchaseId:string;purchaseLineId:string;childId:string;stageId:string;scopeId:string;offerId:string;offerRevision:number;acceptanceId:string;eligibilityEvidenceId:string;termsVersion:string;settlementReferences:readonly string[];lessonReferences:readonly string[]}>;
export type Owner03PolicyRequiredReason='historical_installment_mode'|'operator_cancellation_review'|'disciplinary_fee_review'|'multi_child_prestart_fee_unit'|'three_or_more_attended'|'zero_attendance_after_start'|'fully_paid_purchase_required'|'refund_balance_review';
export type Owner03PolicyRequired=Readonly<{policyVersion:typeof owner03PolicyVersion;status:'POLICY_REQUIRED';reason:Owner03PolicyRequiredReason;references:Owner03References}>;
export type Owner03PurchasePolicy=Readonly<{
 policyVersion:typeof owner03PolicyVersion;status:'PURCHASE_POLICY';legalStatus:'OWNER_SELECTED_REVIEW_DRAFT';references:Owner03References;
 mode:'monthly_block'|'stage_prepay';currency:'USD';priceCents:number;purchasedLessons:4|12;requiredPayments:1;
 commitment:'four_paid_lessons'|'twelve_paid_lessons';allocation:Readonly<{numeratorCents:number;denominatorLessons:4|12}>;
 automaticFutureCharges:false;futurePurchaseObligations:readonly [];effect:'none';
}>;
export type Owner03RefundProposal=Readonly<{
 policyVersion:typeof owner03PolicyVersion;status:'PROPOSAL_ONLY';legalStatus:'OWNER_SELECTED_REVIEW_DRAFT';references:Owner03References;
 mode:'monthly_block'|'stage_prepay';currency:'USD';purchasedLessons:4|12;attendedCount:number;paidCents:number;
 retainedLessonCents:number;administrationCents:number;alreadyRefundedCents:number;refundCents:number;
 rounding:'positive_half_up_total_retention';effect:'none';
}>;
export class Owner03PolicyInputError extends Error{
 readonly code='OWNER03_POLICY_INPUT_INVALID';
 constructor(){super('Owner03 policy input invalid');this.name='Owner03PolicyInputError';}
}
function requireInput(value:unknown):asserts value{if(!value)throw new Owner03PolicyInputError();}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{try{return schema.parse(value);}catch{throw new Owner03PolicyInputError();}}

/** Pure opt-in policy for NEW accepted Owner03 purchases only. Root must load
 * actual saved purchase/accepted offer/eligibility, settled cash and the native
 * per-child attendance projection. IDs/version labels are not their authority.
 * Keep historical transactions, founder activation and actual legal/provider
 * admission in their existing Root gates. No DB, SDK, payment, refund, debt,
 * warning timer, consent activation or future block is created by this module.
 */
export function validateOwner03Purchase(raw:unknown):Owner03Purchase{
 const p=parse(owner03PurchaseSchema,raw),a=p.acceptedOffer;
 requireInput(a.purchaseLineId===p.purchaseLineId&&a.childId===p.childId&&a.priceCents===p.priceCents&&a.priceBasis===p.priceBasis);
 if(p.mode==='stage_prepay'){
  const expected={ordinary_primary_prepay:175000,ordinary_sibling_prepay:165000,founder_initial_primary_prepay:165000,founder_initial_sibling_prepay:155000} as const;
  requireInput(p.priceCents===expected[p.priceBasis]&&(!p.priceBasis.startsWith('founder_')||p.stage===1));
 }
 return p;
}
function references(p:Owner03Purchase,input?:Owner03RefundInput):Owner03References{return {purchaseId:p.purchaseId,purchaseLineId:p.purchaseLineId,childId:p.childId,stageId:p.stageId,scopeId:p.mode==='monthly_block'?p.blockId:p.stageId,offerId:p.acceptedOffer.id,offerRevision:p.acceptedOffer.revision,acceptanceId:p.acceptedOffer.acceptanceId,eligibilityEvidenceId:p.acceptedOffer.eligibilityEvidenceId,termsVersion:p.acceptedOffer.termsVersion,settlementReferences:input?[...input.payment.settlementReferences].sort():[],lessonReferences:input?input.attendance.lessons.map(l=>l.lessonId).sort():[]};}
function required(r:Owner03References,reason:Owner03PolicyRequiredReason):Owner03PolicyRequired{return {policyVersion:owner03PolicyVersion,status:'POLICY_REQUIRED',reason,references:r};}
export function owner03PurchasePolicy(raw:unknown):Owner03PurchasePolicy|Owner03PolicyRequired{
 const p=validateOwner03Purchase(raw),r=references(p);if(p.mode==='installments')return required(r,'historical_installment_mode');
 return {policyVersion:owner03PolicyVersion,status:'PURCHASE_POLICY',legalStatus:'OWNER_SELECTED_REVIEW_DRAFT',references:r,mode:p.mode,currency:'USD',priceCents:p.priceCents,purchasedLessons:p.purchasedLessons,requiredPayments:1,commitment:p.mode==='monthly_block'?'four_paid_lessons':'twelve_paid_lessons',allocation:{numeratorCents:p.priceCents,denominatorLessons:p.purchasedLessons},automaticFutureCharges:false,futurePurchaseObligations:[],effect:'none'};
}
/** One current outcome per PURCHASED LESSON SLOT, not a list of rescheduling
 * attempts. Root projects actual occurrence history into this scope. Cancelled
 * and undelivered slots cannot contribute to attendedCount; old block/other
 * child evidence cannot move this independently purchased refund window. */
export function validateOwner03RefundInput(raw:unknown):Owner03RefundInput{
 const input=parse(owner03RefundInputSchema,raw),p=validateOwner03Purchase(input.purchase),payment=input.payment,a=input.attendance,scope=p.mode==='monthly_block'?p.blockId:p.stageId;
 requireInput(payment.purchaseId===p.purchaseId&&payment.childId===p.childId&&payment.refundedCents<=payment.paidCents&&new Set(payment.settlementReferences).size===payment.settlementReferences.length);
 requireInput(a.scopeId===scope&&a.lessons.length<=p.purchasedLessons&&a.attendedCount<=p.purchasedLessons&&new Set(a.lessons.map(l=>l.lessonId)).size===a.lessons.length);
 requireInput(a.lessons.every(l=>l.purchaseId===p.purchaseId&&l.childId===p.childId&&l.scopeId===scope)&&a.attendedCount===a.lessons.filter(l=>l.outcome==='attended').length);
 requireInput(input.timing!=='prestart'||a.attendedCount===0);return {...input,purchase:p};
}
/** Integer cents, half-up rounding of TOTAL retained lesson value. This is
 * the same rational rounding as domain.withdrawalProposal, generalized from
 * twelve to four lessons. Never multiply a rounded one-lesson amount by two. */
function retained(price:number,attended:number,lessons:4|12){return Number((2n*BigInt(price)*BigInt(attended)+BigInt(lessons))/(2n*BigInt(lessons)));}
export function owner03RefundProposal(raw:unknown):Owner03RefundProposal|Owner03PolicyRequired{
 const input=validateOwner03RefundInput(raw),p=input.purchase,r=references(p,input),count=input.attendance.attendedCount;
 if(p.mode==='installments')return required(r,'historical_installment_mode');
 if(input.reason==='operator')return required(r,'operator_cancellation_review');
 if(input.reason==='disciplinary')return required(r,'disciplinary_fee_review');
 if(input.payment.paidCents!==p.priceCents)return required(r,'fully_paid_purchase_required');
 if(count>=3)return required(r,'three_or_more_attended');
 if(count===0&&input.timing!=='prestart')return required(r,'zero_attendance_after_start');
 if(count===0&&input.multiChildPrestart)return required(r,'multi_child_prestart_fee_unit');
 const retainedLessonCents=retained(p.priceCents,count,p.purchasedLessons),administrationCents=count===1?0:count===2&&p.mode==='monthly_block'?10000:20000;
 const refundCents=input.payment.paidCents-retainedLessonCents-administrationCents-input.payment.refundedCents;
 if(refundCents<0)return required(r,'refund_balance_review');
 return {policyVersion:owner03PolicyVersion,status:'PROPOSAL_ONLY',legalStatus:'OWNER_SELECTED_REVIEW_DRAFT',references:r,mode:p.mode,currency:'USD',purchasedLessons:p.purchasedLessons,attendedCount:count,paidCents:input.payment.paidCents,retainedLessonCents,administrationCents,alreadyRefundedCents:input.payment.refundedCents,refundCents,rounding:'positive_half_up_total_retention',effect:'none'};
}
