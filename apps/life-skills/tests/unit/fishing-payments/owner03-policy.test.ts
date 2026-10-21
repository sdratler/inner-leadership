/** Synthetic references only. Pure Owner03 arithmetic/contract tests; no
 * actual accepted legal agreement, native payment/attendance or refund proof. */
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {owner03PolicyVersion,owner03FamilyFeeDecision,owner03PurchasePolicy,owner03RefundProposal,owner03FamilyPrestartProposal,validateOwner03Purchase,Owner03PolicyInputError,type Owner03Purchase,type Owner03RefundInput,type Owner03RefundProposal,type Owner03FamilyPrestartInput,type Owner03FamilyPrestartProposal} from '../../../src/features/fishing-payments/owner03-policy.ts';

type PrepayBasis='ordinary_primary_prepay'|'ordinary_sibling_prepay'|'founder_initial_primary_prepay'|'founder_initial_sibling_prepay';
function purchase(mode:'monthly_block'|'stage_prepay'|'installments'='monthly_block',basis:PrepayBasis='ordinary_primary_prepay'):Owner03Purchase{
 const prices={ordinary_primary_prepay:175000,ordinary_sibling_prepay:165000,founder_initial_primary_prepay:165000,founder_initial_sibling_prepay:155000},childId=randomUUID(),purchaseLineId=randomUUID(),priceCents=mode==='monthly_block'?65000:mode==='installments'?195000:prices[basis],priceBasis=mode==='monthly_block'?'monthly_block_full_rate':mode==='installments'?'three_full_rate_dues':basis;
 const common={policyVersion:owner03PolicyVersion,program:'sunday_fishing_academy',purchaseId:randomUUID(),purchaseLineId,childId,stageId:randomUUID(),stage:1,currency:'USD',acceptedOffer:{id:randomUUID(),revision:1,policyVersion:owner03PolicyVersion,purchaseLineId,childId,priceCents,priceBasis,eligibilityEvidenceId:'SYNTHETIC_NATIVE_ELIGIBILITY_REFERENCE',acceptanceId:randomUUID(),termsVersion:'SYNTHETIC_REVIEW_DRAFT_ONLY'}};
 return validateOwner03Purchase(mode==='monthly_block'?{...common,mode,blockId:randomUUID(),purchasedLessons:4,priceCents,priceBasis}:{...common,mode,purchasedLessons:12,priceCents,priceBasis});
}
function refund(p:Owner03Purchase=purchase(),count=1):Owner03RefundInput{
 const scopeId=p.mode==='monthly_block'?p.blockId:p.stageId;return {purchase:p,payment:{purchaseId:p.purchaseId,childId:p.childId,currency:'USD',paidCents:p.priceCents,refundedCents:0,settlementReferences:['pi_SYNTHETIC_CAPTURE']},attendance:{scopeId,attendedCount:count,lessons:Array.from({length:count},()=>({lessonId:randomUUID(),purchaseId:p.purchaseId,childId:p.childId,scopeId,outcome:'attended'}))},reason:'voluntary',timing:count===0?'prestart':'after_start',multiChildPrestart:false};
}
function proposal(input:unknown):Owner03RefundProposal{const result=owner03RefundProposal(input);expect(result.status).toBe('PROPOSAL_ONLY');if(result.status!=='PROPOSAL_ONLY')throw Error('EXPECTED_PROPOSAL_ONLY');return result;}
const prepayCases:[PrepayBasis,number,number,number,number][]=[
 ['ordinary_primary_prepay',175000,14583,160417,125833],
 ['ordinary_sibling_prepay',165000,13750,151250,117500],
 ['founder_initial_primary_prepay',165000,13750,151250,117500],
 ['founder_initial_sibling_prepay',155000,12917,142083,109167],
];

it('a650 purchase authorizes one four-lesson block with no automatically owed future blocks',()=>{
 const p=purchase(),policy=owner03PurchasePolicy(p);expect(policy).toMatchObject({status:'PURCHASE_POLICY',mode:'monthly_block',priceCents:65000,purchasedLessons:4,requiredPayments:1,commitment:'four_paid_lessons',allocation:{numeratorCents:65000,denominatorLessons:4},automaticFutureCharges:false,futurePurchaseObligations:[],effect:'none',legalStatus:'OWNER_SELECTED_REVIEW_DRAFT'});expect(policy.references).toMatchObject({purchaseId:p.purchaseId,childId:p.childId,scopeId:p.mode==='monthly_block'?p.blockId:null});
});
it.each(prepayCases)('12lesson %s consumes the actual accepted price %i without a future installment', (basis,price)=>{
 const policy=owner03PurchasePolicy(purchase('stage_prepay',basis));expect(policy).toMatchObject({status:'PURCHASE_POLICY',mode:'stage_prepay',priceCents:price,purchasedLessons:12,requiredPayments:1,commitment:'twelve_paid_lessons',automaticFutureCharges:false,futurePurchaseObligations:[],effect:'none'});
});
it.each([[1,16250,0,48750],[2,32500,10000,22500]])('monthly after%i retains%i plus%i and refunds%i cents',(count,retained,fee,amount)=>{
 const q=proposal(refund(purchase(),count));expect(q).toMatchObject({retainedLessonCents:retained,administrationCents:fee,refundCents:amount,purchasedLessons:4,attendedCount:count,effect:'none'});
});
it.each(prepayCases)('prepay %s rounds total proportional retention once and uses per-child fees', (basis,price,retainedOne,refundOne,refundTwo)=>{
 const p=purchase('stage_prepay',basis),one=proposal(refund(p,1)),two=proposal(refund(p,2));expect(one).toMatchObject({paidCents:price,retainedLessonCents:retainedOne,administrationCents:0,refundCents:refundOne});expect(two).toMatchObject({administrationCents:20000,refundCents:refundTwo});expect(two.retainedLessonCents+two.administrationCents+two.refundCents).toBe(price);
 if(price===175000)expect(two.retainedLessonCents).toBe(29167);if(price===155000)expect(two.retainedLessonCents).toBe(25833);
});
it('every separately purchased monthly block renews its OWN first/two-lesson window',()=>{
 const first=purchase(),months=[first,...Array.from({length:2},()=>{const p=purchase();return {...p,childId:first.childId,stageId:first.stageId,acceptedOffer:{...p.acceptedOffer,childId:first.childId}};})];
 for(const p of months){expect(proposal(refund(p,1)).refundCents).toBe(48750);expect(proposal(refund(p,2)).refundCents).toBe(22500);expect(owner03PurchasePolicy(p)).toMatchObject({futurePurchaseObligations:[],requiredPayments:1});}
 expect(new Set(months.map(p=>p.purchaseId)).size).toBe(3);expect(new Set(months.map(p=>proposal(refund(p,1)).references.scopeId)).size).toBe(3);
 const old=refund(months[0]!,1),next=refund(months[1]!,1);expect(()=>owner03RefundProposal({...next,attendance:old.attendance})).toThrow(Owner03PolicyInputError);
});
it('two siblings with differing prepay prices retain independent fees and references, without a household cap',()=>{
 const p=purchase('stage_prepay','founder_initial_primary_prepay'),sibling=purchase('stage_prepay','founder_initial_sibling_prepay'),a=proposal(refund(p,2)),b=proposal(refund(sibling,2));
 expect([a.refundCents,b.refundCents]).toEqual([117500,109167]);expect(a.administrationCents+b.administrationCents).toBe(40000);expect(a.references.childId).not.toBe(b.references.childId);expect(a.references.purchaseId).not.toBe(b.references.purchaseId);
 const afterOne=[proposal(refund(p,1)),proposal(refund(sibling,1))];expect(afterOne.map(q=>q.administrationCents)).toEqual([0,0]);expect(afterOne.map(q=>q.refundCents)).toEqual([151250,142083]);
});
it('two siblings buying monthly blocks each receive the selected100 fee after two lessons',()=>{
 const quotes=[proposal(refund(purchase(),2)),proposal(refund(purchase(),2))];expect(quotes.map(q=>q.refundCents)).toEqual([22500,22500]);expect(quotes.reduce((n,q)=>n+q.administrationCents,0)).toBe(20000);
});
it.each(['monthly_block','stage_prepay'] as const)('single-child voluntary prestart %s preserves the selected200 fee',mode=>{
 const p=purchase(mode),q=proposal(refund(p,0));expect(q).toMatchObject({attendedCount:0,retainedLessonCents:0,administrationCents:20000,refundCents:p.priceCents-20000});
});
it('joint prestart requests through the per-child API report the selected family fee and require allocation',()=>{
 for(const p of [purchase(),purchase('stage_prepay','ordinary_sibling_prepay')]){const r=owner03RefundProposal({...refund(p,0),multiChildPrestart:true});expect(r).toMatchObject({status:'POLICY_REQUIRED',reason:'family_prestart_allocation_required',familyFeeDecisionId:owner03FamilyFeeDecision,familyAdministrationCents:20000,allocationRequired:true,references:{purchaseId:p.purchaseId,childId:p.childId}});expect(r).not.toHaveProperty('refundCents');expect(r).not.toHaveProperty('administrationCents');}
});
it.each([['monthly_block',3],['monthly_block',4],['stage_prepay',3],['stage_prepay',12]] as const)('three-plus remains unresolved for%s count%i',(mode,count)=>{
 const result=owner03RefundProposal(refund(purchase(mode),count));expect(result).toMatchObject({status:'POLICY_REQUIRED',reason:'three_or_more_attended'});expect(result).not.toHaveProperty('refundCents');
});
it.each(['operator','disciplinary'] as const)('%s cancellation/removal never borrows voluntary fees or invents a new debt',reason=>{
 for(const mode of ['monthly_block','stage_prepay'] as const)for(const count of [0,1,2]){const q=owner03RefundProposal({...refund(purchase(mode),count),reason});expect(q).toMatchObject({status:'POLICY_REQUIRED',reason:reason==='operator'?'operator_cancellation_review':'disciplinary_fee_review'});expect(q).not.toHaveProperty('refundCents');expect(q).not.toHaveProperty('administrationCents');expect(q).not.toHaveProperty('debtCents');}
});
it('operator-cancelled and undelivered lessons do not advance actual attendance or the refund window',()=>{
 const i=refund(),record=i.attendance.lessons[0]!,lessons=[record,{...record,lessonId:randomUUID(),outcome:'operator_cancelled' as const},{...record,lessonId:randomUUID(),outcome:'not_delivered' as const}],input={...i,attendance:{...i.attendance,lessons}};expect(proposal(input)).toMatchObject({attendedCount:1,refundCents:48750,administrationCents:0});
 expect(()=>owner03RefundProposal({...input,attendance:{...input.attendance,attendedCount:3}})).toThrow(Owner03PolicyInputError);
});
it('zero attendance after the scope has begun does not invent a prestart cancellation rule',()=>{
 expect(owner03RefundProposal({...refund(purchase(),0),timing:'after_start'})).toMatchObject({status:'POLICY_REQUIRED',reason:'zero_attendance_after_start'});
});
it('historical installments remain explicitly denied rather than reclassified into monthly purchases',()=>{
 const p=purchase('installments');expect(owner03PurchasePolicy(p)).toMatchObject({status:'POLICY_REQUIRED',reason:'historical_installment_mode'});expect(owner03RefundProposal(refund(p,1))).toMatchObject({status:'POLICY_REQUIRED',reason:'historical_installment_mode'});
 expect(()=>owner03PurchasePolicy({...p,policyVersion:'RM-STRIPE-STAGE-LIFECYCLE-20261015-10'})).toThrow(Owner03PolicyInputError);
});
it('partial/unpaid purchases require an actual fully paid basis, without promising a refund',()=>{
 const i=refund();for(const paidCents of [0,100,64999,65001])expect(owner03RefundProposal({...i,payment:{...i.payment,paidCents}})).toMatchObject({status:'POLICY_REQUIRED',reason:'fully_paid_purchase_required'});
});
it('prior refunds reduce only the remaining proposal and cannot generate a negative balance or debt',()=>{
 const i=refund(),q=proposal({...i,payment:{...i.payment,refundedCents:10000}});expect(q).toMatchObject({retainedLessonCents:16250,alreadyRefundedCents:10000,refundCents:38750});expect(q.refundCents+q.alreadyRefundedCents+q.retainedLessonCents+q.administrationCents).toBe(65000);
 expect(owner03RefundProposal({...i,payment:{...i.payment,refundedCents:50000}})).toMatchObject({status:'POLICY_REQUIRED',reason:'refund_balance_review'});
});

const invalids:readonly [string,(i:Owner03RefundInput)=>unknown][]=[
 ['negative attended count',i=>({...i,attendance:{...i.attendance,attendedCount:-1}})],
 ['fractional attended count',i=>({...i,attendance:{...i.attendance,attendedCount:1.5}})],
 ['string attended count',i=>({...i,attendance:{...i.attendance,attendedCount:'1'}})],
 ['count beyond four-lesson basis',i=>({...i,attendance:{...i.attendance,attendedCount:5}})],
 ['empty purchase ID',i=>({...i,purchase:{...i.purchase,purchaseId:''}})],
 ['foreign payment child',i=>({...i,payment:{...i.payment,childId:randomUUID()}})],
 ['foreign payment purchase',i=>({...i,payment:{...i.payment,purchaseId:randomUUID()}})],
 ['foreign lesson child',i=>({...i,attendance:{...i.attendance,lessons:i.attendance.lessons.map(l=>({...l,childId:randomUUID()}))}})],
 ['foreign lesson purchase',i=>({...i,attendance:{...i.attendance,lessons:i.attendance.lessons.map(l=>({...l,purchaseId:randomUUID()}))}})],
 ['foreign lesson scope',i=>({...i,attendance:{...i.attendance,lessons:i.attendance.lessons.map(l=>({...l,scopeId:randomUUID()}))}})],
 ['duplicate lesson slot',i=>({...i,attendance:{...i.attendance,attendedCount:2,lessons:[i.attendance.lessons[0]!,i.attendance.lessons[0]!]}})],
 ['duplicate captured transaction',i=>({...i,payment:{...i.payment,settlementReferences:['pi_SYNTHETIC','pi_SYNTHETIC']}})],
 ['missing capture reference',i=>({...i,payment:{...i.payment,settlementReferences:[]}})],
 ['currency mismatch',i=>({...i,payment:{...i.payment,currency:'ILS'}})],
 ['negative paid amount',i=>({...i,payment:{...i.payment,paidCents:-1}})],
 ['fractional cents',i=>({...i,payment:{...i.payment,paidCents:65000.5}})],
 ['refund above cash',i=>({...i,payment:{...i.payment,refundedCents:65001}})],
 ['unknown reason',i=>({...i,reason:'automatic_expulsion'})],
 ['coerced sibling context',i=>({...i,multiChildPrestart:'false'})],
 ['prestart after attendance',i=>({...i,timing:'prestart'})],
 ['arbitrary future charge',i=>({...i,chargeFutureBlock:true})],
 ['wrong accepted child',i=>({...i,purchase:{...i.purchase,acceptedOffer:{...i.purchase.acceptedOffer,childId:randomUUID()}}})],
 ['unaccepted amount',i=>({...i,purchase:{...i.purchase,acceptedOffer:{...i.purchase.acceptedOffer,priceCents:100}}})],
 ['missing current accepted policy',i=>({...i,purchase:{...i.purchase,acceptedOffer:{...i.purchase.acceptedOffer,policyVersion:'older-policy'}}})],
];
it.each(invalids)('strictly rejects %s',(_label,change)=>{expect(()=>owner03RefundProposal(change(refund()))).toThrow(Owner03PolicyInputError);});
it('rejects invalid prices/modes/eligibility without silently changing an accepted offer',()=>{
 const p=purchase('stage_prepay');for(const priceCents of [100,155000,195000,175000.5,-1])expect(()=>owner03PurchasePolicy({...p,priceCents,acceptedOffer:{...p.acceptedOffer,priceCents}})).toThrow(Owner03PolicyInputError);
 const founder=purchase('stage_prepay','founder_initial_primary_prepay');expect(()=>owner03PurchasePolicy({...founder,stage:2})).toThrow(Owner03PolicyInputError);expect(()=>owner03PurchasePolicy({...p,mode:'prepay'})).toThrow(Owner03PolicyInputError);expect(()=>owner03PurchasePolicy({...purchase(),purchasedLessons:12})).toThrow(Owner03PolicyInputError);
});
it('returns stable per-child purchase/capture/lesson references without mutating input or consuming any action',()=>{
 const i=refund(purchase(),2);i.payment.settlementReferences.push('pi_A_SECOND_REFERENCE');const frozen=JSON.stringify(i),a=proposal(i),b=proposal(i);expect(b).toEqual(a);expect(JSON.stringify(i)).toBe(frozen);expect(a.references).toMatchObject({purchaseId:i.purchase.purchaseId,purchaseLineId:i.purchase.purchaseLineId,childId:i.purchase.childId,scopeId:i.attendance.scopeId,acceptanceId:i.purchase.acceptedOffer.acceptanceId});
 expect(proposal({...i,payment:{...i.payment,settlementReferences:[...i.payment.settlementReferences].reverse()},attendance:{...i.attendance,lessons:[...i.attendance.lessons].reverse()}})).toEqual(a);expect(a).toMatchObject({legalStatus:'OWNER_SELECTED_REVIEW_DRAFT',effect:'none'});
});
it('invalid input never exposes supplied private values or a raw validation cause',()=>{
 let error:unknown;try{owner03RefundProposal({private:'SYNTHETIC_PRIVATE_INPUT_CANARY'});}catch(caught){error=caught;}expect(error).toBeInstanceOf(Owner03PolicyInputError);expect(String(error)).not.toContain('SYNTHETIC_PRIVATE_INPUT_CANARY');expect(error).not.toHaveProperty('cause');
});

function familyInput(purchases:Owner03Purchase[]=[purchase(),purchase()]):Owner03FamilyPrestartInput{
 const householdId=randomUUID(),payerAccountId=randomUUID();return {policyVersion:owner03PolicyVersion,decisionId:owner03FamilyFeeDecision,cancellationId:randomUUID(),householdId,payerAccountId,nativeGroupReference:'SYNTHETIC_NATIVE_GROUP_NOT_AUTHORITY',nativeGroupRevision:1,priorOutcome:'none',members:purchases.map(p=>{const i=refund(p,0);return {householdId,payerAccountId,refundInput:{...i,payment:{...i.payment,settlementReferences:['pi_SYNTHETIC_'+p.purchaseId.replaceAll('-','')]}}};}),feeAllocation:null};
}
function allocate(i:Owner03FamilyPrestartInput,amounts:readonly number[]){return {...i,feeAllocation:amounts.map((amount,index)=>({purchaseId:i.members[index]!.refundInput.purchase.purchaseId,childId:i.members[index]!.refundInput.purchase.childId,administrationCents:amount}))};}
function familyProposal(i:unknown):Extract<Owner03FamilyPrestartProposal,{status:'PROPOSAL_ONLY'}>{const r=owner03FamilyPrestartProposal(i);expect(r.status).toBe('PROPOSAL_ONLY');if(r.status!=='PROPOSAL_ONLY')throw Error('EXPECTED_FAMILY_PROPOSAL');return r;}

it('joint prestart has ONE known200 family fee and no guessed per-child refunds without allocation',()=>{
 const i=familyInput(),q=owner03FamilyPrestartProposal(i);expect(q).toMatchObject({status:'ALLOCATION_REQUIRED',familyAdministrationCents:20000,totalPaidCents:130000,totalRefundCents:110000,allocationRequired:true,decisionId:owner03FamilyFeeDecision,policyVersion:owner03PolicyVersion,effect:'none'});expect(q).not.toHaveProperty('children');expect(q).not.toHaveProperty('feeAllocation');expect(q.binding).toMatchObject({cancellationId:i.cancellationId,householdId:i.householdId,payerAccountId:i.payerAccountId,nativeGroupReference:i.nativeGroupReference,nativeGroupRevision:1});
 for(const m of i.members)expect(q.binding.members.some(s=>s.references.purchaseId===m.refundInput.purchase.purchaseId&&s.references.childId===m.refundInput.purchase.childId&&s.references.settlementReferences[0]===m.refundInput.payment.settlementReferences[0])).toBe(true);
});
it('omitted and empty allocation still disclose the selected family total and allocation-required state',()=>{
 const i=familyInput(),{feeAllocation:omitted,...withoutAllocation}=i;expect(omitted).toBeNull();for(const input of [withoutAllocation,{...i,feeAllocation:[]}])expect(owner03FamilyPrestartProposal(input)).toMatchObject({status:'ALLOCATION_REQUIRED',familyAdministrationCents:20000,totalRefundCents:110000});
});
it.each([[10000,10000],[20000,0],[0,20000],[12345,7655]])('only the explicit monthly sibling allocation %i/%i is applied',(a,b)=>{
 const i=familyInput(),q=familyProposal(allocate(i,[a,b]));expect(q.children.reduce((n,c)=>n+c.administrationCents,0)).toBe(20000);expect(q.children.reduce((n,c)=>n+c.refundCents,0)).toBe(110000);
 for(const [index,fee] of [a,b].entries()){const p=i.members[index]!.refundInput.purchase,c=q.children.find(c=>c.references.purchaseId===p.purchaseId)!;expect(c).toMatchObject({administrationCents:fee,refundCents:65000-fee!,retainedLessonCents:0,attendedCount:0,references:{childId:p.childId,purchaseId:p.purchaseId},effect:'none'});}
});
it('differing sibling prepayments share one fee while keeping actual paid purchase/child references',()=>{
 const i=familyInput([purchase('stage_prepay','founder_initial_primary_prepay'),purchase('stage_prepay','founder_initial_sibling_prepay')]),unallocated=owner03FamilyPrestartProposal(i);expect(unallocated).toMatchObject({status:'ALLOCATION_REQUIRED',familyAdministrationCents:20000,totalPaidCents:320000,totalRefundCents:300000});const q=familyProposal(allocate(i,[5000,15000]));
 expect(q.children.find(c=>c.references.purchaseId===i.members[0]!.refundInput.purchase.purchaseId)).toMatchObject({paidCents:165000,administrationCents:5000,refundCents:160000});expect(q.children.find(c=>c.references.purchaseId===i.members[1]!.refundInput.purchase.purchaseId)).toMatchObject({paidCents:155000,administrationCents:15000,refundCents:140000});expect(q.totalRefundCents).toBe(300000);
});
it('family grouping, rather than per-child flags, prevents two200 fees for one joint cancellation',()=>{
 const i=familyInput();expect(i.members.every(m=>m.refundInput.multiChildPrestart===false)).toBe(true);const q=familyProposal(allocate(i,[20000,0]));expect(q.familyAdministrationCents).toBe(20000);expect(q.children.map(c=>c.administrationCents).sort((a,b)=>a-b)).toEqual([0,20000]);expect(q.totalRefundCents).toBe(110000);
});
it('the family decision leaves every after-start per-child fee/window unchanged even with a joint-context flag',()=>{
 for(const mode of ['monthly_block','stage_prepay'] as const)for(const count of [1,2]){const i=refund(purchase(mode),count);expect(owner03RefundProposal({...i,multiChildPrestart:true})).toEqual(owner03RefundProposal(i));}
});
it.each(['pending','unknown','completed','duplicate'] as const)('native cancellation outcome %s requires reconciliation instead of another fee',priorOutcome=>{
 const i=allocate(familyInput(),[10000,10000]),q=owner03FamilyPrestartProposal({...i,priorOutcome});expect(q).toMatchObject({status:'RECONCILIATION_REQUIRED',reason:'prior_cancellation_outcome',familyAdministrationCents:20000,effect:'none'});expect(q).not.toHaveProperty('children');expect(q).not.toHaveProperty('totalRefundCents');
});
it('any prior child refund requires reconciliation before family allocation',()=>{
 const i=familyInput(),first=i.members[0]!,q=owner03FamilyPrestartProposal({...allocate(i,[10000,10000]),members:[{...first,refundInput:{...first.refundInput,payment:{...first.refundInput.payment,refundedCents:1}}},i.members[1]!]});expect(q).toMatchObject({status:'RECONCILIATION_REQUIRED',reason:'prior_refund'});expect(q).not.toHaveProperty('children');
});
it('duplicate purchases or shared settlement references cannot be double-counted as family refund cash',()=>{
 const i=familyInput();expect(owner03FamilyPrestartProposal({...i,members:[i.members[0],i.members[0]]})).toMatchObject({status:'RECONCILIATION_REQUIRED',reason:'duplicate_purchase'});
 const a=i.members[0]!,b=i.members[1]!;expect(owner03FamilyPrestartProposal({...i,members:[a,{...b,refundInput:{...b.refundInput,payment:{...b.refundInput.payment,settlementReferences:a.refundInput.payment.settlementReferences}}}]})).toMatchObject({status:'RECONCILIATION_REQUIRED',reason:'shared_settlement_reference'});
});
const invalidFamilyAllocations:readonly [string,(i:Owner03FamilyPrestartInput)=>unknown][]=[
 ['double200 fees',i=>allocate(i,[20000,20000])],
 ['underallocated fee',i=>allocate(i,[10000,9999])],
 ['overallocated fee',i=>allocate(i,[10000,10001])],
 ['no fee despite explicit entries',i=>allocate(i,[0,0])],
 ['missing child allocation',i=>allocate(i,[20000])],
 ['negative allocation',i=>allocate(i,[-1,20001])],
 ['fractional cents',i=>allocate(i,[10000.5,9999.5])],
 ['foreign allocated child',i=>{const a=allocate(i,[10000,10000]);return {...a,feeAllocation:a.feeAllocation.map((r,index)=>index===0?{...r,childId:randomUUID()}:r)};}],
 ['foreign allocated purchase',i=>{const a=allocate(i,[10000,10000]);return {...a,feeAllocation:a.feeAllocation.map((r,index)=>index===0?{...r,purchaseId:randomUUID()}:r)};}],
 ['duplicate allocated purchase',i=>{const a=allocate(i,[10000,10000]);return {...a,feeAllocation:[a.feeAllocation[0],a.feeAllocation[0]]};}],
 ['different household',i=>({...i,members:i.members.map((m,index)=>index===0?{...m,householdId:randomUUID()}:m)})],
 ['different payer',i=>({...i,members:i.members.map((m,index)=>index===0?{...m,payerAccountId:randomUUID()}:m)})],
 ['empty cancellation ID',i=>({...i,cancellationId:''})],
 ['missing native provenance',i=>({...i,nativeGroupReference:''})],
 ['invalid group revision',i=>({...i,nativeGroupRevision:0})],
 ['wrong source decision',i=>({...i,decisionId:'older-unit-unknown'})],
 ['caller authorization flag',i=>({...i,authorized:true})],
];
it.each(invalidFamilyAllocations)('family contract strictly rejects %s',(_label,change)=>{expect(()=>owner03FamilyPrestartProposal(change(familyInput()))).toThrow(Owner03PolicyInputError);});
it('the family helper preserves historical/operator/disciplinary and after-start policy gates',()=>{
 const make=(r:Owner03RefundInput)=>{const i=familyInput();return {...i,members:[{...i.members[0]!,refundInput:{...r,payment:{...r.payment,settlementReferences:['pi_OTHER_SYNTHETIC_SCOPE']}}},i.members[1]!]};};
 expect(owner03FamilyPrestartProposal(make(refund(purchase('installments'),0)))).toMatchObject({status:'POLICY_REQUIRED',reason:'historical_installment_mode'});
 for(const reason of ['operator','disciplinary'] as const)expect(owner03FamilyPrestartProposal(make({...refund(purchase(),0),reason}))).toMatchObject({status:'POLICY_REQUIRED',reason:reason==='operator'?'operator_cancellation_review':'disciplinary_fee_review'});
 expect(owner03FamilyPrestartProposal(make(refund(purchase(),1)))).toMatchObject({status:'POLICY_REQUIRED',reason:'family_prestart_scope_required'});expect(owner03FamilyPrestartProposal(make(refund(purchase(),3)))).toMatchObject({status:'POLICY_REQUIRED',reason:'three_or_more_attended'});
});
it('canonical grouping/allocation is immutable, order-independent and explicitly requires eventual Root authority',()=>{
 const i=allocate(familyInput(),[12000,8000]),before=JSON.stringify(i),a=familyProposal(i),b=familyProposal({...i,members:[...i.members].reverse(),feeAllocation:[...i.feeAllocation].reverse()});expect(b).toEqual(a);expect(JSON.stringify(i)).toBe(before);expect(Object.isFrozen(a.binding)).toBe(true);expect(Object.isFrozen(a.binding.members)).toBe(true);expect(Object.isFrozen(a.binding.members[0]!.references.settlementReferences)).toBe(true);
 expect(a).toMatchObject({authorityRequirement:'ROOT_NATIVE_GROUP_PROVENANCE_AND_ONCE_ONLY_RESERVATION',legalStatus:'OWNER_SELECTED_REVIEW_DRAFT',effect:'none'});expect(a.canonicalGroup).toContain(i.cancellationId);expect(a.canonicalGroup).toContain(i.householdId);expect(a.canonicalGroup).toContain(i.payerAccountId);
 const different=familyProposal({...i,cancellationId:randomUUID()});expect(different.canonicalGroup).not.toBe(a.canonicalGroup);expect(familyProposal(allocate(i,[8000,12000])).canonicalProposal).not.toBe(a.canonicalProposal);
});
