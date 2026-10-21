/** Actual disposable native purchase/receipt/attendance authority. No provider or legal admission. */
import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {programFixture,type ProgramFixture} from './native-program-fixture.ts';
import {agreementAcceptanceFixture,agreementBundleFixture} from '../../fixtures/academy-agreements.ts';
import {owner03PolicyVersion} from '../../../src/features/fishing-payments/owner03-policy.ts';
const fixtures:ProgramFixture[]=[];
afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function fixture(){
 const f=await programFixture({capacity:3,policyVersion:owner03PolicyVersion,confirmation:{kind:'all_native_dues_paid'},owner03Bundle:agreementBundleFixture(),termsDocument:'SYNTHETIC refund source only, not approved legal terms.'});fixtures.push(f);await f.createPlan();
 await f.pool.query("UPDATE ls_calendar.availability SET starts_at=$3 WHERE workspace_id=$1 AND practitioner_id=$2 AND kind='open'",[f.workspaceId,f.owner.id,f.at(-48)]);
 const current=async()=>(await f.stage().read(f.owner,f.ref))!;
 async function schedule(indices=Array.from({length:8},(_,i)=>i)){for(const i of indices){const plan=await current();await f.revise(plan.occurrences[i]!.id,f.at(24+i*24),f.at(27+i*24));}}
 async function purchase(family:Awaited<ReturnType<typeof f.family>>,indices=[0,1,2,3],mode:'monthly_block'|'prepay'='monthly_block'){
  const plan=await current(),fit={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,purpose:'enrollment' as const,decision:'approved' as const,targetOccurrenceId:null,targetRevision:null,note:'PRIVATE SYNTHETIC native refund fit'};await f.program.recordFit(f.owner,fit);
  const acceptance={commandId:randomUUID(),id:randomUUID(),blockId:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,householdId:family.householdId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash,expectedPlanRevision:plan.revision,occurrenceIds:indices.map(i=>plan.occurrences[i]!.id),currency:'USD',priceCents:65000,purchasedLessons:4,automaticFutureCharges:false,agreementAcceptance:agreementAcceptanceFixture()};
  if(mode==='monthly_block')await f.program.acceptMonthlyBlockTerms(family.parent,acceptance);else await f.program.acceptTerms(family.parent,{commandId:acceptance.commandId,id:acceptance.id,stageId:acceptance.stageId,learnerId:acceptance.learnerId,householdId:acceptance.householdId,sourceApprovalId:acceptance.sourceApprovalId,sourceSha256:acceptance.sourceSha256,agreementAcceptance:acceptance.agreementAcceptance});
  const block={id:acceptance.blockId,acceptanceId:acceptance.id,occurrenceIds:acceptance.occurrenceIds},hold={commandId:randomUUID(),holdId:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,householdId:family.householdId,payerAccountId:family.parent.id,expectedCohortRevision:1,reason:'SYNTHETIC actual purchased scope',...(mode==='monthly_block'?{block}:{})};await f.program.reserveOfferHold(f.owner,hold);
  const offer={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,payerAccountId:family.parent.id,householdId:family.householdId,policyApprovalId:f.policyId,expiresAt:f.at(24),lines:[{id:randomUUID(),learnerId:family.learnerId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,holdId:hold.holdId,mode,dueAt:[f.at(0)],...(mode==='monthly_block'?{block}:{})}]};await f.program.approveOffer(f.owner,offer);
  const issued=await f.paymentStore.registerApprovedOffer(f.owner,randomUUID(),offer.id,1);return {family,fit,acceptance,hold,offer,purchaseId:issued.purchaseIds[0]!};
 }
 async function confirm(p:Awaited<ReturnType<typeof purchase>>){const payment=(await f.paymentStore.readPayment(f.owner,p.purchaseId))!;return f.program.confirmEnrollment(f.owner,{commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,purchaseId:p.purchaseId,fitDecisionId:p.fit.id,termsAcceptanceId:p.acceptance.id,policyApprovalId:f.policyId,expectedPaymentRevision:payment.revision});}
 async function attend(enrollmentId:string,index:number,state:'present'|'late'|'absent'|'no_show'='present'){
  let plan=await current(),o=plan.occurrences[index]!;
  if(o.state!=='completed'){await f.revise(o.id,f.at(-24+index*4),f.at(-21+index*4));plan=await current();o=plan.occurrences[index]!;await f.stage().execute(f.owner,f.ref,{action:'complete',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'SYNTHETIC actual delivered lesson'});}
  plan=await current();o=plan.occurrences[index]!;await f.stage().execute(f.owner,f.ref,{action:'attendance',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,enrollmentId,state,reason:'SYNTHETIC observed attendance or correction'});
 }
 return {...f,current,schedule,purchase,confirm,attend};
}
async function protectedRows(f:ProgramFixture){return Promise.all(['ls_fishing_payments.operations','ls_fishing_payments.purchases','ls_fishing_payments.settlements','ls_fishing_payments.outbox','ls_fishing_stage.enrollments','ls_identity.auth_mail_outbox'].map(async table=>(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows));}
async function jointFamily(){
 const f=await fixture();await f.schedule();const first=await f.family(),learnerId=await f.person('minor','SYNTHETIC sibling'),second={...first,learnerId};
 await f.pool.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[f.workspaceId,first.householdId,learnerId]);await f.pool.query("INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,clock_timestamp(),'synthetic-joint-family',$4)",[f.workspaceId,learnerId,first.parent.id,f.owner.id]);
 const a=await f.purchase(first),b=await f.purchase(second),receiptA=await f.settle(a),receiptB=await f.settle(b);const command={commandId:randomUUID(),id:randomUUID(),householdId:first.householdId,payerAccountId:first.parent.id,purchaseIds:[a.purchaseId,b.purchaseId],requestReference:'SYNTHETIC complete joint voluntary cancellation request'};
 const allocation=[{purchaseId:a.purchaseId,childId:first.learnerId,administrationCents:5000},{purchaseId:b.purchaseId,childId:learnerId,administrationCents:15000}];return {...f,a,b,receiptA,receiptB,command,allocation};
}

test('native prestart preview verifies saved cash, real scheduled scope and signature without enrollment or refund effects',async()=>{
 const f=await fixture();await f.schedule();const p=await f.purchase(await f.family());await expect(f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).rejects.toThrow();await f.settle(p);const before=await protectedRows(f);
 const first=await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'});expect(first).toMatchObject({status:'PROPOSAL_ONLY',mode:'monthly_block',purchasedLessons:4,attendedCount:0,administrationCents:20000,refundCents:45000,effect:'none',providerApproval:'not_admitted'});expect(first).not.toHaveProperty('token');expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toEqual(first);expect(await protectedRows(f)).toEqual(before);
 await expect(f.program.previewOwner03Refund(p.family.parent,{purchaseId:p.purchaseId,reason:'voluntary'})).rejects.toMatchObject({code:'FORBIDDEN'});await expect(f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary',paidCents:65000})).rejects.toThrow();expect(await protectedRows(f)).toEqual(before);
});
test('actual latest per-child attendance produces one and two lesson refunds; missed third delivery does not extend the window',async()=>{
 const f=await fixture();await f.schedule();const p=await f.purchase(await f.family());await f.settle(p);const e=await f.confirm(p);await f.publish();
 await f.attend(e.id,0,'late');expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'PROPOSAL_ONLY',attendedCount:1,administrationCents:0,refundCents:48750});
 await f.attend(e.id,0,'absent');expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'POLICY_REQUIRED',reason:'zero_attendance_after_start'});
 await f.attend(e.id,0);await f.attend(e.id,1);expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'PROPOSAL_ONLY',attendedCount:2,administrationCents:10000,refundCents:22500});
 await f.attend(e.id,2,'no_show');expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'POLICY_REQUIRED',reason:'before_third_lesson_window_review_required'});
 await f.attend(e.id,2);expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'POLICY_REQUIRED',reason:'three_or_more_attended'});
});
test('a later paid block has its own attendance/refund window and cannot inherit earlier attended lessons',async()=>{
 const f=await fixture();await f.schedule();const family=await f.family(),first=await f.purchase(family);await f.settle(first);const e1=await f.confirm(first);await f.publish();await f.attend(e1.id,0);await f.attend(e1.id,1);
 const second=await f.purchase(family,[4,5,6,7]);await f.settle(second);const e2=await f.confirm(second);await f.attend(e2.id,4);
 const later=await f.program.previewOwner03Refund(f.owner,{purchaseId:second.purchaseId,reason:'voluntary'});expect(later).toMatchObject({status:'PROPOSAL_ONLY',attendedCount:1,refundCents:48750,references:{scopeId:second.acceptance.blockId}});
 expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:first.purchaseId,reason:'voluntary'})).toMatchObject({status:'PROPOSAL_ONLY',attendedCount:2,refundCents:22500});
});
test('zero attendance with undated lessons is not proof of prestart, and missing delivered attendance requires review',async()=>{
 const f=await fixture(),p=await f.purchase(await f.family());await f.settle(p);expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'POLICY_REQUIRED',reason:'start_timing_review_required'});
 const e=await f.confirm(p);await f.revise((await f.current()).occurrences[0]!.id,f.at(-8),f.at(-5));await f.publish();const plan=await f.current(),o=plan.occurrences[0]!;await f.stage().execute(f.owner,f.ref,{action:'complete',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'SYNTHETIC delivered without attendance record'});
 expect(e.id).toBeTruthy();expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'POLICY_REQUIRED',reason:'attendance_record_required'});
});
test('a current source/guardian/processed receipt and settlement journal are revalidated on every read',async()=>{
 const f=await fixture();await f.schedule();const p=await f.purchase(await f.family()),receipt=await f.settle(p),query={purchaseId:p.purchaseId,reason:'voluntary'};const original=await f.program.previewOwner03Refund(f.owner,query);
 await f.pool.query('UPDATE ls_fishing_payments.inbox SET processed_at=NULL WHERE event_id=$1',[receipt.eventId]);await expect(f.program.previewOwner03Refund(f.owner,query)).rejects.toThrow();await f.pool.query('UPDATE ls_fishing_payments.inbox SET processed_at=clock_timestamp() WHERE event_id=$1',[receipt.eventId]);expect(await f.program.previewOwner03Refund(f.owner,query)).toEqual(original);
 await f.pool.query("UPDATE ls_fishing_payments.settlements SET digest=$2 WHERE workspace_id=$1",[f.workspaceId,'0'.repeat(64)]);await expect(f.program.previewOwner03Refund(f.owner,query)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
test('full-stage prepay uses genuine per-child stage signature and the actual twelve-lesson paid price',async()=>{
 const f=await fixture();await f.schedule(Array.from({length:12},(_,i)=>i));const p=await f.purchase(await f.family(),[0,1,2,3],'prepay');await f.settle(p);const e=await f.confirm(p);await f.publish();await f.attend(e.id,0);await f.attend(e.id,1);
 expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'PROPOSAL_ONLY',mode:'stage_prepay',purchasedLessons:12,paidCents:175000,attendedCount:2,administrationCents:20000,refundCents:125833});
});

test.each(['absent','missing'] as const)('a confirmed future makeup cannot erase the original third delivery or its %s attendance evidence',async attendance=>{
 const f=await fixture();await f.schedule();const p=await f.purchase(await f.family());await f.settle(p);const e=await f.confirm(p);await f.publish();
 let view=(await f.stage(p.family.parent,e.id).read(p.family.parent,f.ref))!;const original=view.occurrences[2]!;
 await f.stage(p.family.parent,e.id).execute(p.family.parent,f.ref,{action:'notice',operationId:randomUUID(),expectedRevision:view.revision,occurrenceId:original.id,expectedOccurrenceRevision:original.revision,reason:'ordinary_absence'});
 view=(await f.stage(p.family.parent,e.id).read(p.family.parent,f.ref))!;const notice=view.notices[0]!,target=(await f.current()).occurrences[4]!,fit={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,learnerId:p.family.learnerId,purpose:'makeup' as const,decision:'approved' as const,targetOccurrenceId:target.id,targetRevision:target.revision,note:'SYNTHETIC exact replacement review'};await f.program.recordFit(f.owner,fit);
 const operationId=randomUUID(),plan=await f.current();await f.stage(f.owner,null,{operationId,resources:[],makeupFitDecisionId:fit.id}).execute(f.owner,f.ref,{action:'confirm_makeup',operationId,expectedRevision:plan.revision,noticeId:notice.id,replacementOccurrenceId:target.id,expectedReplacementRevision:target.revision,reason:'SYNTHETIC confirmed replacement'});
 await f.attend(e.id,0);await f.attend(e.id,1);
 if(attendance==='absent')await f.attend(e.id,2,'absent');else{await f.revise(original.id,f.at(-8),f.at(-5));const current=await f.current(),o=current.occurrences[2]!;await f.stage().execute(f.owner,f.ref,{action:'complete',operationId:randomUUID(),expectedRevision:current.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'SYNTHETIC delivered original without attendance'});}
 const before=await protectedRows(f);expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:p.purchaseId,reason:'voluntary'})).toMatchObject({status:'POLICY_REQUIRED',reason:attendance==='absent'?'before_third_lesson_window_review_required':'attendance_record_required'});expect(await protectedRows(f)).toEqual(before);
});

test('joint native cancellation records complete sibling membership and reserves exactly one explicitly allocated family fee, with exact retry and no effects',async()=>{
 const f=await jointFamily(),before=await protectedRows(f);expect(await f.program.createOwner03FamilyCancellation(f.owner,f.command)).toMatchObject({state:'cancellation_group',replayed:false});
 expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:f.a.purchaseId,reason:'voluntary'})).toMatchObject({status:'POLICY_REQUIRED',reason:'family_prestart_allocation_required',familyAdministrationCents:20000});
 const view=await f.program.readOwner03FamilyCancellation(f.owner,f.command.id);expect(view).toMatchObject({status:'ALLOCATION_REQUIRED',familyAdministrationCents:20000,totalPaidCents:130000,totalRefundCents:110000});expect(view).not.toHaveProperty('token');if(!('reviewSha256' in view))throw Error('REVIEW_REQUIRED');
 const reserve={commandId:randomUUID(),id:randomUUID(),cancellationId:f.command.id,expectedRevision:1,expectedPreviewSha256:view.reviewSha256,feeAllocation:f.allocation};expect(await f.program.reserveOwner03FamilyFee(f.owner,reserve)).toMatchObject({state:'family_fee_reserved',replayed:false});expect(await f.program.reserveOwner03FamilyFee(f.owner,reserve)).toMatchObject({id:reserve.id,replayed:true});expect(await f.program.createOwner03FamilyCancellation(f.owner,f.command)).toMatchObject({replayed:true});
 const saved=await f.program.readOwner03FamilyCancellation(f.owner,f.command.id);expect(saved).toMatchObject({status:'RESERVED_PROPOSAL_ONLY',familyAdministrationCents:20000,totalRefundCents:110000,reservationId:reserve.id,providerApproval:'not_admitted',effect:'none'});if(!('children' in saved))throw Error('RESERVATION_REQUIRED');expect(saved.children.map(c=>c.refundCents).sort()).toEqual([50000,60000]);expect(saved.children.reduce((sum,c)=>sum+c.administrationCents,0)).toBe(20000);
 await expect(f.program.reserveOwner03FamilyFee(f.owner,{...reserve,id:randomUUID(),commandId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});await expect(f.program.reserveOwner03FamilyFee(f.owner,{...reserve,feeAllocation:f.allocation.map(a=>({...a,administrationCents:10000}))})).rejects.toMatchObject({code:'CONFLICT'});
 expect(await f.program.previewOwner03Refund(f.owner,{purchaseId:f.b.purchaseId,reason:'voluntary'})).toMatchObject({status:'RECONCILIATION_REQUIRED'});expect(await protectedRows(f)).toEqual(before);
 for(const table of ['refund_cancellations','refund_fee_reservations'])for(const action of ['UPDATE','DELETE'])await expect(f.pool.query(action==='UPDATE'?`UPDATE ls_fishing_stage.${table} SET request_sha256=request_sha256 WHERE workspace_id=$1`:`DELETE FROM ls_fishing_stage.${table} WHERE workspace_id=$1`,[f.workspaceId])).rejects.toThrow('IMMUTABLE_PROGRAM_HISTORY');
});

test('competing explicit family allocations serialize to one reservation and one fee',async()=>{
 const f=await jointFamily();await f.program.createOwner03FamilyCancellation(f.owner,f.command);const view=await f.program.readOwner03FamilyCancellation(f.owner,f.command.id);if(!('reviewSha256' in view))throw Error('REVIEW_REQUIRED');const base={cancellationId:f.command.id,expectedRevision:1,expectedPreviewSha256:view.reviewSha256},before=await protectedRows(f);
 const results=await Promise.allSettled([f.program.reserveOwner03FamilyFee(f.owner,{...base,id:randomUUID(),commandId:randomUUID(),feeAllocation:f.allocation}),f.program.reserveOwner03FamilyFee(f.owner,{...base,id:randomUUID(),commandId:randomUUID(),feeAllocation:f.allocation.map(a=>({...a,administrationCents:10000}))})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toMatchObject([{reason:{code:'CONFLICT'}}]);
 expect((await f.pool.query('SELECT count(*)::integer AS n,sum(fee_cents)::integer AS cents FROM ls_fishing_stage.refund_fee_reservations WHERE workspace_id=$1',[f.workspaceId])).rows).toEqual([{n:1,cents:20000}]);expect(await protectedRows(f)).toEqual(before);
});

test('family reservation rechecks exact preview, current guardian and processed settlement; no fee is saved on stale or invalid evidence',async()=>{
 const f=await jointFamily();await f.program.createOwner03FamilyCancellation(f.owner,f.command);const view=await f.program.readOwner03FamilyCancellation(f.owner,f.command.id);if(!('reviewSha256' in view))throw Error('REVIEW_REQUIRED');const reserve={commandId:randomUUID(),id:randomUUID(),cancellationId:f.command.id,expectedRevision:1,expectedPreviewSha256:view.reviewSha256,feeAllocation:f.allocation};
 await expect(f.program.reserveOwner03FamilyFee(f.a.family.parent,reserve)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(f.program.reserveOwner03FamilyFee(f.owner,{...reserve,feeAllocation:f.allocation.map(a=>({...a,administrationCents:20000}))})).rejects.toThrow();
 await f.pool.query('UPDATE ls_fishing_payments.inbox SET processed_at=NULL WHERE event_id IN($1,$2)',[f.receiptA.eventId,f.receiptB.eventId]);await expect(f.program.reserveOwner03FamilyFee(f.owner,reserve)).rejects.toThrow();await f.pool.query('UPDATE ls_fishing_payments.inbox SET processed_at=clock_timestamp() WHERE event_id IN($1,$2)',[f.receiptA.eventId,f.receiptB.eventId]);
 const plan=await f.current();await f.revise(plan.occurrences[0]!.id,f.at(25),f.at(28));await expect(f.program.reserveOwner03FamilyFee(f.owner,reserve)).rejects.toMatchObject({code:'CONFLICT'});expect((await f.pool.query('SELECT id FROM ls_fishing_stage.refund_fee_reservations WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(0);
 const fresh=await f.program.readOwner03FamilyCancellation(f.owner,f.command.id);if(!('reviewSha256' in fresh))throw Error('REVIEW_REQUIRED');const valid={...reserve,expectedPreviewSha256:fresh.reviewSha256};await f.program.reserveOwner03FamilyFee(f.owner,valid);
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,f.b.family.learnerId]);await expect(f.program.reserveOwner03FamilyFee(f.owner,valid)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(f.program.readOwner03FamilyCancellation(f.owner,f.command.id)).rejects.toMatchObject({code:'FORBIDDEN'});
});

test('joint cancellation cannot cross household/payer, duplicate a child or purchase, or replace immutable membership',async()=>{
 const f=await jointFamily(),other=await f.purchase(await f.family());await f.settle(other);
 await expect(f.program.createOwner03FamilyCancellation(f.owner,{...f.command,purchaseIds:[f.a.purchaseId,other.purchaseId]})).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(()=>f.program.createOwner03FamilyCancellation(f.owner,{...f.command,purchaseIds:[f.a.purchaseId,f.a.purchaseId]})).toThrow();
 const renewed=await f.purchase(f.a.family,[4,5,6,7]);await f.settle(renewed);await expect(f.program.createOwner03FamilyCancellation(f.owner,{...f.command,purchaseIds:[f.a.purchaseId,renewed.purchaseId]})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await f.program.createOwner03FamilyCancellation(f.owner,f.command);await expect(f.program.createOwner03FamilyCancellation(f.owner,{...f.command,commandId:randomUUID(),id:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});expect(()=>f.program.createOwner03FamilyCancellation(f.owner,{...f.command,paidCents:130000})).toThrow();expect((await f.pool.query('SELECT id FROM ls_fishing_stage.refund_cancellations WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(1);
});

test('another joint request cannot reserve a second fee for the same family; changed saved facts require reconciliation',async()=>{
 const f=await jointFamily(),a2=await f.purchase(f.a.family,[4,5,6,7]),b2=await f.purchase(f.b.family,[4,5,6,7]);await f.settle(a2);await f.settle(b2);
 const second={...f.command,id:randomUUID(),commandId:randomUUID(),purchaseIds:[a2.purchaseId,b2.purchaseId],requestReference:'SYNTHETIC separate request requires fee reconciliation'};await f.program.createOwner03FamilyCancellation(f.owner,f.command);await f.program.createOwner03FamilyCancellation(f.owner,second);
 const firstView=await f.program.readOwner03FamilyCancellation(f.owner,f.command.id),secondView=await f.program.readOwner03FamilyCancellation(f.owner,second.id);if(!('reviewSha256' in firstView)||!('reviewSha256' in secondView))throw Error('REVIEW_REQUIRED');
 const first={id:randomUUID(),commandId:randomUUID(),cancellationId:f.command.id,expectedRevision:1,expectedPreviewSha256:firstView.reviewSha256,feeAllocation:f.allocation};await f.program.reserveOwner03FamilyFee(f.owner,first);
 const another={id:randomUUID(),commandId:randomUUID(),cancellationId:second.id,expectedRevision:1,expectedPreviewSha256:secondView.reviewSha256,feeAllocation:[{purchaseId:a2.purchaseId,childId:f.a.family.learnerId,administrationCents:10000},{purchaseId:b2.purchaseId,childId:f.b.family.learnerId,administrationCents:10000}]};await expect(f.program.reserveOwner03FamilyFee(f.owner,another)).rejects.toMatchObject({code:'CONFLICT'});expect(await f.program.readOwner03FamilyCancellation(f.owner,second.id)).toMatchObject({status:'RECONCILIATION_REQUIRED',reason:'prior_cancellation_outcome'});
 const plan=await f.current();await f.revise(plan.occurrences[0]!.id,f.at(25),f.at(28));expect(await f.program.readOwner03FamilyCancellation(f.owner,f.command.id)).toMatchObject({status:'RECONCILIATION_REQUIRED',reservationId:first.id});await expect(f.program.reserveOwner03FamilyFee(f.owner,first)).rejects.toMatchObject({code:'CONFLICT'});expect((await f.pool.query('SELECT count(*)::integer AS n,sum(fee_cents)::integer AS cents FROM ls_fishing_stage.refund_fee_reservations WHERE workspace_id=$1',[f.workspaceId])).rows).toEqual([{n:1,cents:20000}]);
});
