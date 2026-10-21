/** Native authority/facts only: no real merchant, legal approval, credit grant,
 * activity equivalence, browser mount or production release acceptance. */
import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {originalObligationFixture} from './academy-original-obligation-fixture.ts';
import {programFixture} from './native-program-fixture.ts';
import {NativeFishingProgram} from '../../../src/features/fishing/native-program.ts';
import {academyOriginalObligationVersion} from '../../../src/features/fishing/academy-original-obligation-contract.ts';
import {digest} from '../../../src/features/fishing-payments/domain.ts';

const opened:{close:()=>Promise<unknown>}[]=[];afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.close()));});
async function fixture(mode:'monthly_block'|'prepay'='monthly_block'){const f=await originalObligationFixture(mode);opened.push(f);return f;}
test.each(['monthly_block','prepay'] as const)('actual %s purchase resolves only its saved original scope and immutable module/template binding, without writes or invented activity',async mode=>{
 const f=await fixture(mode),before=await f.snapshot(),result=await f.read(),reconstructed=new NativeFishingProgram(f.db,f.ring,{childAccountsEnabled:false,merchant:f.merchant});expect(await f.read(f.p.family.parent,0,reconstructed)).toEqual(result);
 expect(result).toMatchObject({version:academyOriginalObligationVersion,enrollmentId:f.enrollmentId,learnerId:f.p.family.learnerId,purchaseId:f.p.purchaseId,original:{occurrenceId:f.rootIds[0],ordinal:1,moduleId:'RM-101',templateApprovalId:f.templateId,templateSourceSha256:f.template.sourceSha256},purchaseScope:{kind:mode==='monthly_block'?'monthly_block':'full_stage',purchasedLessons:mode==='monthly_block'?4:12,occurrenceIds:f.rootIds.slice(0,mode==='monthly_block'?4:12)},payment:{state:'verified_fully_paid',reason:'all_original_dues_paid',paidCents:mode==='monthly_block'?65000:175000},delivery:{state:'undelivered'},mayIssueCredit:false,mayBook:false,mayMarkDelivered:false});
 expect(result).not.toHaveProperty('activityId');expect(result.original).not.toHaveProperty('activityId');expect(result.original).not.toHaveProperty('sessionKind');expect(result.delivery.chain[0]).toMatchObject({moduleId:'RM-101',moduleVersion:f.template.modules[0]!.moduleVersion});
 const {evidenceSha256,...facts}=result;expect(evidenceSha256).toBe(digest(facts));expect(await f.read(f.owner)).toMatchObject({enrollmentId:f.enrollmentId,delivery:result.delivery});expect(await f.snapshot()).toEqual(before);
 if(mode==='monthly_block')await expect(f.read(f.p.family.parent,4)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(f.db.transaction(tx=>f.program.readSessionCreditObligationInTransaction(tx,f.p.family.parent,{selectedEnrollmentId:f.enrollmentId,originalOccurrenceId:f.rootIds[0],paid:true}))).rejects.toMatchObject({code:'INVALID_REQUEST'});
});
test('historical first-due confirmation keeps actual twelve-slot scope but partial money stays review-required without lesson allocation',async()=>{
 const f=await programFixture({confirmation:{kind:'native_due_indices_paid',indices:[1]}});opened.push(f);await f.createPlan();const p=await f.prepare(await f.family(),'installments');await f.settle(p);const enrolled=await f.enroll(p),plan=(await f.stage().read(f.owner,f.ref))!;await f.revise(plan.occurrences[0]!.id,f.at(48),f.at(51));await f.publish();
 const result=await f.db.transaction(tx=>f.program.readSessionCreditObligationInTransaction(tx,p.family.parent,{selectedEnrollmentId:enrolled.result.id,originalOccurrenceId:plan.occurrences[0]!.id}));expect(result.purchaseScope.purchasedLessons).toBe(12);expect(result.payment).toMatchObject({state:'review_required',reason:'payment_not_fully_settled',originalTotalCents:195000,paidCents:65000,refundedCents:0,dues:[{index:1,paidCents:65000,state:'paid'},{index:2,paidCents:0,state:'pending'},{index:3,paidCents:0,state:'pending'}]});expect(result.mayIssueCredit).toBe(false);
});
test('no admitted merchant or a mismatched account/mode/API cannot reuse another purchase settlement as paid authority',async()=>{
 const f=await fixture(),before=await f.snapshot();for(const merchant of [null,{...f.merchant,accountId:'acct_wrong_original'},{...f.merchant,livemode:true},{...f.merchant,apiVersion:'not-the-processed-version'}])await expect(f.read(f.p.family.parent,0,new NativeFishingProgram(f.db,f.ring,{childAccountsEnabled:false,merchant}))).rejects.toThrow();expect(await f.snapshot()).toEqual(before);
});
test('actual cross-family, foreign-workspace operator, child and revoked guardian deny before private original facts are returned',async()=>{
 const f=await fixture(),other=await f.family(),foreign=await programFixture();opened.push(foreign);const child=await f.account('child',f.p.family.learnerId);for(const actor of [other.parent,foreign.owner,child])await expect(f.read(actor)).rejects.toThrow();
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,f.p.family.learnerId]);const before=await f.snapshot();await expect(f.read()).rejects.toThrow();expect(await f.snapshot()).toEqual(before);
});
test('real ordinary session is reloaded on repeated facts reads after logout',async()=>{
 const f=await fixture();await f.read();await f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2',[f.workspaceId,f.p.family.parent.id]);await expect(f.read()).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
test.each(['present','late'] as const)('actual completed original plus selected-child %s records delivery; payment or group completion alone does not',async state=>{
 const f=await fixture();await f.complete(0,state);expect((await f.read()).delivery).toMatchObject({state:'delivered',reason:'selected_child_delivery_recorded',chain:[{attendance:{state}}]});
});
test.each(['absent','no_show'] as const)('actual completed original plus %s remains undelivered with no fabricated attendance or cash effect',async state=>{
 const f=await fixture();await f.complete(0,state);const before=await f.snapshot();expect((await f.read()).delivery).toMatchObject({state:'undelivered',chain:[{attendance:{state}}]});expect(await f.snapshot()).toEqual(before);
});
test.each(['completed_missing','past_published'] as const)('%s requires review rather than inferring selected-child delivery',async kind=>{
 const f=await fixture();if(kind==='completed_missing')await f.complete();else await f.revise(f.rootIds[0]!,f.at(-24),f.at(-21));expect((await f.read()).delivery).toMatchObject({state:'review_required',reason:kind==='completed_missing'?'attendance_record_required':'past_session_unresolved'});
});
test('another selected learner attendance is not evidence for this original child',async()=>{
 const f=await fixture(),other=await f.purchase();await f.settle(other);const otherEnrollment=await f.enroll(other);await f.complete();const plan=await f.current(),o=plan.occurrences[0]!;await f.stage().execute(f.owner,f.ref,{action:'attendance',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,enrollmentId:otherEnrollment,state:'present',reason:'SYNTHETIC different child attendance'});expect((await f.read()).delivery).toMatchObject({state:'review_required',reason:'attendance_record_required'});
});
test('outstanding protected notice retains its exact original entitlement without creating a reservation or second credit',async()=>{
 const f=await fixture();await f.notice(1);const a=await f.read(f.p.family.parent,1),before=await f.snapshot(),b=await f.read(f.p.family.parent,1);expect(a.delivery.rootEntitlementId).toMatch(/^[a-f0-9-]{36}$/);expect(b.delivery).toEqual(a.delivery);expect(a.delivery).toMatchObject({state:'undelivered',chain:[{notice:{replacementReservationId:null}}]});expect(await f.snapshot()).toEqual(before);
});
test('actual native reservation and physical link retain root identity across reconstruction; reservation is not delivery',async()=>{
 const f=await fixture(),a=await f.makeup(),before=await f.snapshot(),b=await f.read();expect(a.delivery.rootEntitlementId).toMatch(/^[a-f0-9-]{36}$/);expect(b.delivery).toEqual(a.delivery);expect(a.delivery.state).toBe('undelivered');expect(a.delivery.chain).toHaveLength(2);expect(a.delivery.chain[0]).toMatchObject({notice:{entitlementId:a.delivery.rootEntitlementId,replacementOccurrenceId:f.rootIds[4]},reservationState:'reserved'});expect(a.delivery.chain[1]).toMatchObject({moduleId:'RM-105',attendance:null});expect(await f.snapshot()).toEqual(before);
});
test('actual cross-cohort replacement loads its own authenticated plan and matching physical seat while preserving the original root',async()=>{
 const f=await fixture(),target=await f.crossStageMakeup(),a=target.obligation;expect(a.plans).toHaveLength(2);expect(a.delivery).toMatchObject({state:'undelivered',effectiveOccurrenceId:target.target.id,chain:[{stageId:f.ref.stageId},{stageId:target.ref.stageId,moduleId:'RM-101'}]});expect((await f.read()).delivery.rootEntitlementId).toBe(a.delivery.rootEntitlementId);
});
test.each(['completed_missing','past_published'] as const)('a valid future replacement cannot mask %s original evidence',async kind=>{
 const f=await fixture(),reserved=await f.makeup();if(kind==='completed_missing')await f.complete();else await f.revise(f.rootIds[0]!,f.at(-24),f.at(-21));const result=await f.read();expect(result.delivery).toMatchObject({state:'review_required',reason:kind==='completed_missing'?'attendance_record_required':'past_session_unresolved',rootEntitlementId:reserved.delivery.rootEntitlementId});
});
test('recorded absent original can retain a reserved future replacement; later target attendance still needs approved original activity equivalence',async()=>{
 const f=await fixture(),reserved=await f.makeup();await f.complete(0,'absent');const pending=await f.read();expect(pending.delivery).toMatchObject({state:'undelivered',rootEntitlementId:reserved.delivery.rootEntitlementId});await f.complete(4,'present');const result=await f.read();expect(result.delivery).toMatchObject({state:'review_required',reason:'replacement_activity_binding_required',rootEntitlementId:reserved.delivery.rootEntitlementId});expect(result.delivery.chain[1]).toMatchObject({moduleId:'RM-105',attendance:{state:'present'}});expect(result.mayMarkDelivered).toBe(false);
});
test('a released physical makeup seat remains explicit review without dropping original entitlement or rebooking',async()=>{
 const f=await fixture(),a=await f.makeup(),id=a.delivery.chain[0]!.notice!.replacementReservationId;await f.pool.query("UPDATE ls_fishing_stage.seat_reservations SET state='released' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,id]);const before=await f.snapshot(),b=await f.read();expect(b.delivery).toMatchObject({state:'review_required',reason:'reservation_review',rootEntitlementId:a.delivery.rootEntitlementId});expect(await f.snapshot()).toEqual(before);
});
test('an unresolved refund journal is review-required while settled money and original entitlement survive unchanged',async()=>{
 const f=await fixture();await f.notice(1);const original=await f.read(f.p.family.parent,1),operation=(await f.pool.query('SELECT operation_json FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2',[f.workspaceId,f.p.purchaseId])).rows[0].operation_json,id=randomUUID(),value={...operation,id,kind:'refund',state:'unknown',dueId:null,refundPaymentId:'pi_synthetic_unknown_original',result:null,idempotencyKey:'synthetic-original-'+id};
 await f.pool.query("INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,'refund',NULL,$4,$5::jsonb)",[f.workspaceId,id,f.p.purchaseId,'a'.repeat(64),JSON.stringify(value)]);const before=await f.snapshot(),result=await f.read(f.p.family.parent,1);expect(result.payment).toMatchObject({state:'review_required',reason:'payment_reconciliation_required',paidCents:65000,refundedCents:0});expect(result.delivery.rootEntitlementId).toBe(original.delivery.rootEntitlementId);expect(await f.snapshot()).toEqual(before);
});
test.each(['unprocessed','digest','account'] as const)('processed native inbox %s mismatch cannot become paid original authority',async kind=>{
 const f=await fixture();if(kind==='unprocessed')await f.pool.query("UPDATE ls_fishing_payments.inbox SET processed_at=NULL WHERE(provider_account_id,livemode,event_id)IN(SELECT provider_account_id,livemode,fact_json->>'providerReceiptId' FROM ls_fishing_payments.settlements WHERE workspace_id=$1 AND purchase_id=$2)",[f.workspaceId,f.p.purchaseId]);else await f.pool.query("UPDATE ls_fishing_payments.inbox SET receipt_json=jsonb_set(receipt_json,$1::text[],$2::jsonb) WHERE(provider_account_id,livemode,event_id)IN(SELECT provider_account_id,livemode,fact_json->>'providerReceiptId' FROM ls_fishing_payments.settlements WHERE workspace_id=$3 AND purchase_id=$4)",[[kind==='digest'?'digest':'providerAccountId'],JSON.stringify(kind==='digest'?'0'.repeat(64):'acct_wrong_metadata'),f.workspaceId,f.p.purchaseId]);const before=await f.snapshot();await expect(f.read()).rejects.toThrow();expect(await f.snapshot()).toEqual(before);
});
test('a forged aggregate paid amount cannot replace actual processed settlement recomputation',async()=>{
 const f=await fixture();await f.pool.query("UPDATE ls_fishing_payments.purchases SET state_json=jsonb_set(state_json,'{paidCents}',to_jsonb(65001)) WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.p.purchaseId]);const before=await f.snapshot();await expect(f.read()).rejects.toThrow();expect(await f.snapshot()).toEqual(before);
});
