/** Real disposable native SQL/auth/commands; agreements and merchant are synthetic only. */
import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {programFixture,type ProgramFixture} from './native-program-fixture.ts';
import {agreementAcceptanceFixture,agreementBundleFixture} from '../../fixtures/academy-agreements.ts';
import {owner03PolicyVersion} from '../../../src/features/fishing-payments/owner03-policy.ts';

const fixtures:ProgramFixture[]=[];
afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function fixture(capacity=2){
 const f=await programFixture({capacity,policyVersion:owner03PolicyVersion,confirmation:{kind:'all_native_dues_paid'},owner03Bundle:agreementBundleFixture(),termsDocument:'SYNTHETIC monthly purchase terms only. No actual legal approval.'});fixtures.push(f);
 const plan=await f.createPlan(),family=await f.family();
 const fit={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,purpose:'enrollment' as const,decision:'approved' as const,targetOccurrenceId:null,targetRevision:null,note:'SYNTHETIC monthly fit only'};await f.program.recordFit(f.owner,fit);
 const commands=(offset=0)=>{
  const acceptance={commandId:randomUUID(),id:randomUUID(),blockId:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,householdId:family.householdId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash,expectedPlanRevision:plan.revision,occurrenceIds:plan.occurrences.slice(offset,offset+4).map(o=>o.id),currency:'USD' as const,priceCents:65000 as const,purchasedLessons:4 as const,automaticFutureCharges:false as const,agreementAcceptance:agreementAcceptanceFixture()};
  const block={id:acceptance.blockId,acceptanceId:acceptance.id,occurrenceIds:acceptance.occurrenceIds};
  const hold={commandId:randomUUID(),holdId:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,householdId:family.householdId,payerAccountId:family.parent.id,expectedCohortRevision:1,reason:'SYNTHETIC four places only',block};
  const offer={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,payerAccountId:family.parent.id,householdId:family.householdId,policyApprovalId:f.policyId,expiresAt:f.at(24),lines:[{id:randomUUID(),learnerId:family.learnerId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,holdId:hold.holdId,mode:'monthly_block' as const,block,dueAt:[f.at(0)]}]};
  return {acceptance,hold,offer};
 };
 async function approve(c=commands()){await f.program.acceptMonthlyBlockTerms(family.parent,c.acceptance);await f.program.reserveOfferHold(f.owner,c.hold);await f.program.approveOffer(f.owner,c.offer);return c;}
 async function issue(c=commands()){await approve(c);const issued=await f.paymentStore.registerApprovedOffer(f.owner,randomUUID(),c.offer.id,1);return {...c,family,purchaseId:issued.purchaseIds[0]!};}
 async function confirm(p:Awaited<ReturnType<typeof issue>>){return f.program.confirmEnrollment(f.owner,{commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,purchaseId:p.purchaseId,fitDecisionId:fit.id,termsAcceptanceId:p.acceptance.id,policyApprovalId:f.policyId,expectedPaymentRevision:(await f.paymentStore.readPayment(f.owner,p.purchaseId))!.revision});}
 return {...f,plan,family,newFamily:f.family,fit,commands,approve,issue,confirm};
}
async function snapshot(f:Pick<ProgramFixture,'pool'|'workspaceId'>){
 const tables=['ls_fishing_stage.block_acceptances','ls_fishing_stage.seat_reservations','ls_fishing_stage.offer_approvals','ls_fishing_stage.command_receipts','ls_fishing_stage.enrollments','ls_fishing_payments.purchases','ls_identity.auth_mail_outbox'];
 return Promise.all(tables.map(async table=>(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows));
}

test('one independently accepted block reserves four places and issues one $650 purchase, with durable replay and parent readback',async()=>{
 const f=await fixture(),c=f.commands();const accepted=await Promise.all([f.program.acceptMonthlyBlockTerms(f.family.parent,c.acceptance),f.program.acceptMonthlyBlockTerms(f.family.parent,c.acceptance)]);expect(accepted.map(r=>r.replayed).sort()).toEqual([false,true]);
 await f.program.reserveOfferHold(f.owner,c.hold);await f.program.approveOffer(f.owner,c.offer);const issueId=randomUUID(),issued=await f.paymentStore.registerApprovedOffer(f.owner,issueId,c.offer.id,1);expect((await f.paymentStore.registerApprovedOffer(f.owner,issueId,c.offer.id,1)).purchaseIds).toEqual(issued.purchaseIds);
 const purchaseId=issued.purchaseIds[0]!,state=await f.paymentStore.readPayment(f.owner,purchaseId);expect(state).toMatchObject({originalTotalCents:65000,currency:'USD',dues:[{index:1,amountCents:65000,state:'pending'}]});
 expect((await f.pool.query('SELECT occurrence_id FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 ORDER BY occurrence_id',[f.workspaceId])).rows.map(r=>r.occurrence_id).sort()).toEqual([...c.acceptance.occurrenceIds].sort());
 expect((await f.pool.query('SELECT id FROM ls_fishing_stage.block_acceptances WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(1);
 await f.settle({family:f.family,purchaseId,offer:c.offer});expect(await f.paymentStore.familyView(f.family.parent,purchaseId)).toMatchObject({totalCents:65000,paidCents:65000,state:'paid'});
 const enrolled=await f.confirm({...c,family:f.family,purchaseId});expect(await f.program.readEnrollment(f.family.parent,enrolled.id)).toMatchObject({state:'confirmed',purchaseScope:{kind:'monthly_block',blockId:c.acceptance.blockId,acceptanceId:c.acceptance.id,occurrenceIds:c.acceptance.occurrenceIds}});
 await f.publish();const home=await f.stage(f.family.parent,enrolled.id).read(f.family.parent,f.ref);expect(home!.occurrences.map(o=>o.id).sort()).toEqual([...c.acceptance.occurrenceIds].sort());expect(home!.lessonReferences).toHaveLength(4);expect(await f.program.familyPayment(f.family.parent,enrolled.id)).toMatchObject({totalCents:65000,paidCents:65000});
 const other=await f.newFamily();expect(await f.program.readEnrollment(other.parent,enrolled.id)).toBeNull();expect(await f.stage(other.parent,enrolled.id).read(other.parent,f.ref)).toBeNull();
});

test('another block needs new guardian acceptance and creates a separate four-lesson debt only on explicit issuance',async()=>{
 const f=await fixture(),first=await f.issue(),before=await snapshot(f),second=f.commands(4);
 await expect(f.program.reserveOfferHold(f.owner,{...second.hold,block:{...second.hold.block,acceptanceId:first.acceptance.id}})).rejects.toThrow();expect(await snapshot(f)).toEqual(before);
 await f.program.acceptMonthlyBlockTerms(f.family.parent,second.acceptance);expect((await f.pool.query('SELECT id FROM ls_fishing_payments.purchases WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(1);
 const next=await f.issue(second);expect(next.purchaseId).not.toBe(first.purchaseId);const states=await Promise.all([first,next].map(p=>f.paymentStore.readPayment(f.owner,p.purchaseId)));expect(states.map(s=>s!.dues.map(d=>d.amountCents))).toEqual([[65000],[65000]]);
 expect((await f.pool.query('SELECT id FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(8);
});

test('role, current guardian, source hash, plan revision and actual occurrence membership are checked before acceptance writes',async()=>{
 const f=await fixture(),c=f.commands(),other=await f.newFamily(),before=await snapshot(f);
 for(const [actor,command] of [[f.owner,c.acceptance],[other.parent,c.acceptance],[f.family.parent,{...c.acceptance,sourceSha256:'0'.repeat(64)}],[f.family.parent,{...c.acceptance,expectedPlanRevision:2}],[f.family.parent,{...c.acceptance,occurrenceIds:[randomUUID(),...c.acceptance.occurrenceIds.slice(1)]}]] as const)await expect(f.program.acceptMonthlyBlockTerms(actor,command)).rejects.toThrow();
 expect(await snapshot(f)).toEqual(before);await f.program.acceptMonthlyBlockTerms(f.family.parent,c.acceptance);
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,f.family.learnerId]);const saved=await snapshot(f);await expect(f.program.acceptMonthlyBlockTerms(f.family.parent,c.acceptance)).rejects.toThrow();await expect(f.program.reserveOfferHold(f.owner,c.hold)).rejects.toThrow();expect(await snapshot(f)).toEqual(saved);
});

test('overlapping places for the same child and over-capacity places are rejected atomically',async()=>{
 const f=await fixture(1),first=await f.approve(),overlap=f.commands();await f.program.acceptMonthlyBlockTerms(f.family.parent,overlap.acceptance);const before=await snapshot(f);await expect(f.program.reserveOfferHold(f.owner,overlap.hold)).rejects.toThrow();expect(await snapshot(f)).toEqual(before);
 const other=await f.newFamily(),c=f.commands(),acceptance={...c.acceptance,learnerId:other.learnerId,householdId:other.householdId};await f.program.acceptMonthlyBlockTerms(other.parent,acceptance);const held=await snapshot(f);await expect(f.program.reserveOfferHold(f.owner,{...c.hold,learnerId:other.learnerId,householdId:other.householdId,payerAccountId:other.parent.id})).rejects.toThrow();expect(await snapshot(f)).toEqual(held);
 expect(first.hold.block.occurrenceIds).toHaveLength(4);
});

test('physical acceptance scope tampering cannot override the encrypted guardian acceptance',async()=>{
 const f=await fixture(),c=f.commands();await f.program.acceptMonthlyBlockTerms(f.family.parent,c.acceptance);const replaced=[...c.acceptance.occurrenceIds.slice(0,3),f.plan.occurrences[4]!.id];
 // Simulate storage corruption only in the owned disposable database. The
 // application never disables this trigger; normal mutation denial is below.
 await f.pool.query('ALTER TABLE ls_fishing_stage.block_acceptances DISABLE TRIGGER immutable_program_block_terms');
 try{await f.pool.query('UPDATE ls_fishing_stage.block_acceptances SET occurrence_ids=$3::uuid[] WHERE workspace_id=$1 AND id=$2',[f.workspaceId,c.acceptance.id,replaced]);}finally{await f.pool.query('ALTER TABLE ls_fishing_stage.block_acceptances ENABLE TRIGGER immutable_program_block_terms');}
 const before=await snapshot(f);await expect(f.program.reserveOfferHold(f.owner,{...c.hold,block:{...c.hold.block,occurrenceIds:replaced}})).rejects.toThrow();expect(await snapshot(f)).toEqual(before);
});

test('persisted renewed signatures cannot be updated or deleted through ordinary SQL',async()=>{
 const f=await fixture(),c=f.commands();await f.program.acceptMonthlyBlockTerms(f.family.parent,c.acceptance);const before=await snapshot(f);
 await expect(f.pool.query('UPDATE ls_fishing_stage.block_acceptances SET accepted_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2',[f.workspaceId,c.acceptance.id])).rejects.toThrow('IMMUTABLE_PROGRAM_HISTORY');
 await expect(f.pool.query('DELETE FROM ls_fishing_stage.block_acceptances WHERE workspace_id=$1 AND id=$2',[f.workspaceId,c.acceptance.id])).rejects.toThrow('IMMUTABLE_PROGRAM_HISTORY');expect(await snapshot(f)).toEqual(before);
});

test('new rejection or revoked guardian denies issuance and issue replay without another purchase',async()=>{
 const f=await fixture(),c=await f.approve(),issueId=randomUUID();await f.paymentStore.registerApprovedOffer(f.owner,issueId,c.offer.id,1);
 await f.program.recordFit(f.owner,{...f.fit,commandId:randomUUID(),id:randomUUID(),decision:'rejected'});const before=await snapshot(f);await expect(f.paymentStore.registerApprovedOffer(f.owner,issueId,c.offer.id,1)).rejects.toThrow();await expect(f.paymentStore.registerApprovedOffer(f.owner,randomUUID(),c.offer.id,1)).rejects.toThrow();expect(await snapshot(f)).toEqual(before);
 await f.program.recordFit(f.owner,{...f.fit,commandId:randomUUID(),id:randomUUID()});await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,f.family.learnerId]);const revoked=await snapshot(f);await expect(f.paymentStore.registerApprovedOffer(f.owner,issueId,c.offer.id,1)).rejects.toThrow();expect(await snapshot(f)).toEqual(revoked);
});

test('Owner03 cannot turn a four-lesson acceptance into retired automatic installments',async()=>{
 const f=await fixture(),c=f.commands();await f.program.acceptMonthlyBlockTerms(f.family.parent,c.acceptance);await f.program.reserveOfferHold(f.owner,c.hold);const before=await snapshot(f),{block:ignored,...line}=c.offer.lines[0]!;void ignored;
 await expect(f.program.approveOffer(f.owner,{...c.offer,lines:[{...line,mode:'installments',dueAt:[f.at(0),f.at(31*24),f.at(62*24)]}]})).rejects.toThrow();expect(await snapshot(f)).toEqual(before);
});


test('monthly enrollment needs authentic full payment and cannot record attendance, safety or weekly facts for an unpurchased lesson',async()=>{
 const f=await fixture(),p=await f.issue(),before=await snapshot(f);await expect(f.confirm(p)).rejects.toThrow();expect(await snapshot(f)).toEqual(before);
 await f.settle(p);const enrolled=await f.confirm(p),own=f.plan.occurrences[0]!.id,outside=f.plan.occurrences[4]!.id;
 await f.pool.query("UPDATE ls_calendar.availability SET starts_at=$3 WHERE workspace_id=$1 AND practitioner_id=$2 AND kind='open'",[f.workspaceId,f.owner.id,f.at(-24)]);
 await f.revise(own,f.at(-8),f.at(-5));await f.revise(outside,f.at(-4),f.at(-1));await f.publish();
 const current=async(id:string)=>{const plan=(await f.stage().read(f.owner,f.ref))!,o=plan.occurrences.find(o=>o.id===id)!;return {operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:id,expectedOccurrenceRevision:o.revision};};
 for(const id of [own,outside])await f.stage().execute(f.owner,f.ref,{...await current(id),action:'complete',reason:'SYNTHETIC instructor delivered actual three-hour fixture session'});
 await f.stage().execute(f.owner,f.ref,{...await current(own),action:'attendance',enrollmentId:enrolled.id,state:'present',reason:'SYNTHETIC actual purchased lesson attendance'});
 const planBefore=(await f.stage().read(f.owner,f.ref))!;
 await expect(f.stage().execute(f.owner,f.ref,{...await current(outside),action:'attendance',enrollmentId:enrolled.id,state:'present',reason:'SYNTHETIC outside purchase must fail'})).rejects.toThrow();
 await expect(f.stage().execute(f.owner,f.ref,{...await current(outside),action:'observe_skills',enrollmentId:enrolled.id,observations:[{skillId:'equipment_care',level:'demonstrated',evidence:'SYNTHETIC outside purchase must fail'}]})).rejects.toThrow();
 await expect(f.stage().execute(f.owner,f.ref,{...await current(outside),action:'safety_intervention',enrollmentId:enrolled.id,decision:'warning',reason:'SYNTHETIC outside purchase must fail',supervisingAdult:'Synthetic Instructor',handoff:'awaiting_authorized_guardian'})).rejects.toMatchObject({code:'FORBIDDEN'});
 expect(await f.stage().read(f.owner,f.ref)).toEqual(planBefore);const parent=(await f.stage(f.family.parent,enrolled.id).read(f.family.parent,f.ref))!;expect(parent.occurrences).toHaveLength(4);expect(parent.occurrences.some(o=>o.id===outside)).toBe(false);expect(parent.attendance).toEqual([expect.objectContaining({occurrenceId:own,state:'present'})]);
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,f.family.learnerId]);expect(await f.program.readEnrollment(f.family.parent,enrolled.id)).toBeNull();expect(await f.stage(f.family.parent,enrolled.id).read(f.family.parent,f.ref)).toBeNull();expect(await f.program.readEnrollment(f.owner,enrolled.id)).toMatchObject({state:'confirmed',authorizedAccountIds:[]});
});
