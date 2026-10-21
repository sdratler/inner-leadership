import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {agreementAcceptanceFixture,agreementBundleFixture} from '../../fixtures/academy-agreements.ts';
import {groupTravelFixture} from './academy-group-calendar-travel-fixture.ts';
import {handleFishingCalendar} from '../../../src/features/fishing/program-calendar-http.ts';
import {fishingCalendarSearch,fishingCalendarTimelineSchema} from '../../../src/features/fishing/program-calendar-contract.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
import {academyGroupPublicationVersion} from '../../../src/features/fishing/academy-group-calendar-publication-contract.ts';
import {travelDigest} from '../../../src/features/fishing/academy-travel-credit-source.ts';

const live:Awaited<ReturnType<typeof groupTravelFixture>>[]=[];afterEach(async()=>{for(const f of live.splice(0))await f.close();});
async function fixture(locale:'en'|'he'='en',childAccountsEnabled=false){const f=await groupTravelFixture({locale,childAccountsEnabled});live.push(f);return f;}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const selection=(f:Fixture,second=false)=>({learnerId:second?f.second.learnerId:f.learnerId,enrollmentId:second?f.secondEnrollment:f.enrollmentId,reference:f.ref});
const query=(f:Fixture,learnerId:string|null=f.learnerId)=>new URLSearchParams({from:f.sunday.slice(0,7)+'-01',to:f.sunday.slice(0,7)+'-28',...(learnerId?{learnerId}:{})}).toString();
async function paidBlock(f:Fixture,family:{parent:Fixture['parent'];learnerId:string;householdId:string},occurrenceIds:string[]){
 const plan=await f.current(),fit={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,purpose:'enrollment',decision:'approved',targetOccurrenceId:null,targetRevision:null,note:'SYNTHETIC independent later block'};await f.program.recordFit(f.owner,fit);
 const acceptance={commandId:randomUUID(),id:randomUUID(),blockId:randomUUID(),stageId:f.ref.stageId,learnerId:family.learnerId,householdId:family.householdId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash,expectedPlanRevision:plan.revision,occurrenceIds,currency:'USD',priceCents:65000,purchasedLessons:4,automaticFutureCharges:false,agreementAcceptance:agreementAcceptanceFixture(agreementBundleFixture())};await f.program.acceptMonthlyBlockTerms(family.parent,acceptance);
 const block={id:acceptance.blockId,acceptanceId:acceptance.id,occurrenceIds},holdId=randomUUID();await f.program.reserveOfferHold(f.owner,{commandId:randomUUID(),holdId,stageId:f.ref.stageId,learnerId:family.learnerId,householdId:family.householdId,payerAccountId:family.parent.id,expectedCohortRevision:1,reason:'SYNTHETIC separate later block',block});
 const offer={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,payerAccountId:family.parent.id,householdId:family.householdId,policyApprovalId:f.policyId,expiresAt:f.at(24),lines:[{id:randomUUID(),learnerId:family.learnerId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,holdId,mode:'monthly_block' as const,block,dueAt:[f.at(0)]}]};await f.program.approveOffer(f.owner,offer);const purchaseId=(await f.paymentStore.registerApprovedOffer(f.owner,randomUUID(),offer.id,1)).purchaseIds[0]!;await f.settle({family:family as Awaited<ReturnType<Fixture['family']>>,purchaseId,offer});const payment=(await f.paymentStore.readPayment(f.owner,purchaseId))!,enrollmentId=randomUUID();await f.program.confirmEnrollment(f.owner,{commandId:randomUUID(),id:enrollmentId,stageId:f.ref.stageId,purchaseId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,policyApprovalId:f.policyId,expectedPaymentRevision:payment.revision});return {enrollmentId,purchaseId};
}
async function get(f:Fixture,token:string,path:string,search:string){return handleFishingCalendar(new Request(f.config.origin+'/api/calendar/fishing/'+path+'?'+search,{headers:{cookie:SESSION_COOKIE+'='+encodeURIComponent(token)}}),[path],async()=>({runtime:f.runtime,store:f.db}));}

for(const locale of ['en','he']as const)test('actual '+locale+' family HTTP calendar replaces the old physical time once and projects only this purchased child original',async()=>{
 const f=await fixture(locale),before=await f.protectedSnapshot(),response=await get(f,f.parentToken,'timeline',query(f));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');const body=(await response.json()).data;expect(fishingCalendarTimelineSchema.safeParse(body).success).toBe(true);
 const trip=body.items.find((e:{id:string})=>e.id===f.eventId);expect(trip).toMatchObject({state:'published',startsAt:f.trip.startsAt,endsAt:f.trip.endsAt,selections:[selection(f)],shared:{weeklyService:'per_original',originalActivity:'not_inferred',originals:[{occurrenceId:f.originalOccurrenceId,ordinal:1,participation:'review_required'}]}});expect(trip.shared.originals).toHaveLength(1);expect(body.items.filter((e:{id:string})=>e.id===f.eventId)).toHaveLength(1);expect(body.items.some((e:{id:string})=>e.id===f.originalOccurrenceId)).toBe(false);
 expect(JSON.stringify(body)).not.toMatch(new RegExp([f.second.learnerId,f.secondEnrollment,f.secondPurchase,'guardianDigest','purchaseId','qualifiedAdultAccountIds','sourceReviewId','paymentEvidenceSha256','payload_ciphertext'].join('|')));
 const loaded=await get(f,f.parentToken,'plan',fishingCalendarSearch(selection(f)));expect(loaded.status).toBe(200);const plan=(await loaded.json()).data;expect(plan.sharedEvents).toEqual([trip]);expect(plan.view.occurrences).toHaveLength(4);expect(plan.view.occurrences[0].id).toBe(f.originalOccurrenceId);expect(plan.view.occurrences[0].state).toBe('published');expect(plan.operator.roster).toEqual([]);expect(await f.protectedSnapshot()).toEqual(before);
});

test('owner sees one event for the group while another family cannot borrow selected-child or enrollment context',async()=>{
 const f=await fixture(),owner=await f.login(f.owner.id+'@example.invalid'),second=await f.login(f.second.parent.id+'@example.invalid'),before=await f.protectedSnapshot();
 const response=await get(f,owner.token,'timeline',query(f,null));expect(response.status).toBe(200);const events=(await response.json()).data.items,trip=events.find((e:{id:string})=>e.id===f.eventId);expect(trip.shared.originals).toHaveLength(1);expect(trip.shared.originals[0].participation).toBe('operator_context');expect(trip.selections).toHaveLength(1);expect(trip.selections[0].enrollmentId).toBeNull();
 expect((await get(f,second.token,'timeline',query(f))).status).toBe(404);expect((await get(f,second.token,'plan',fishingCalendarSearch(selection(f)))).status).toBe(404);
 const own=await get(f,second.token,'timeline',query(f,f.second.learnerId));expect(own.status).toBe(200);const ownEvents=(await own.json()).data;expect(ownEvents.items.find((e:{id:string})=>e.id===f.eventId).shared.originals[0].participation).toBe('keys');expect(JSON.stringify(ownEvents)).not.toContain(f.enrollmentId);expect(JSON.stringify(ownEvents)).not.toContain(f.learnerId);
 const noSelection=await get(f,f.parentToken,'timeline',query(f,null));expect(noSelection.status).toBe(200);expect((await noSelection.json()).data.items).toEqual([]);expect(await f.protectedSnapshot()).toEqual(before);
});

test('actual local-alternative adoption remains explicit in current family calendar without a trip seat, second original or payment inference',async()=>{
 const f=await fixture();await f.service().recordChange(f.owner,await f.sharedChangeCommand());const result=await f.declare(true),declaration=await f.latestDeclaration(),review=await f.review({kind:'local_alternative',guardianDeclarationId:declaration.id,guardianDeclarationSha256:travelDigest(declaration),retainedCreditId:result.receipt.creditId});await f.publication().execute(f.owner,{version:academyGroupPublicationVersion,action:'publish',operationId:randomUUID(),eventId:f.eventId,expectedDraftRevision:review.eventRevision,expectedPublicationRevision:f.published.publicationRevision,sourceReviewId:review.id});const before=await f.protectedSnapshot();
 const response=await get(f,f.parentToken,'timeline',query(f));expect(response.status).toBe(200);const events=(await response.json()).data.items,trip=events.find((e:{id:string})=>e.id===f.eventId);expect(trip.shared.originals).toHaveLength(1);expect(trip.shared.originals[0].participation).toBe('local_alternative');expect(trip.shared.originals[0].occurrenceId).toBe(f.originalOccurrenceId);expect(trip.shared.weeklyService).toBe('per_original');expect(trip.shared.originalActivity).toBe('not_inferred');expect(events.some((e:{id:string})=>e.id===f.originalOccurrenceId)).toBe(false);expect(JSON.stringify(trip)).not.toContain(result.receipt.creditId);expect(await f.protectedSnapshot()).toEqual(before);
});

test('current revoked guardian or session cannot replay an earlier successful shared calendar read',async()=>{
 const f=await fixture();expect((await get(f,f.parentToken,'timeline',query(f))).status).toBe(200);await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3',[f.workspaceId,f.learnerId,f.parent.id]);expect([403,404]).toContain((await get(f,f.parentToken,'timeline',query(f))).status);expect([403,404]).toContain((await get(f,f.parentToken,'plan',fishingCalendarSearch(selection(f)))).status);await f.revoke();expect((await get(f,f.parentToken,'timeline',query(f))).status).toBe(401);
});


test('a newly paid child does not inherit a saved trip seat or the displaced original physical booking',async()=>{
 const f=await fixture(),family=await f.family(),enrolled=await paidBlock(f,family,(await f.current()).occurrences.slice(0,4).map(o=>o.id)),login=await f.login(family.parent.id+'@example.invalid'),before=await f.protectedSnapshot(),context={learnerId:family.learnerId,enrollmentId:enrolled.enrollmentId,reference:f.ref};
 const response=await get(f,login.token,'timeline',query(f,family.learnerId));expect(response.status).toBe(200);const events=(await response.json()).data.items,trip=events.find((e:{id:string})=>e.id===f.eventId);expect(events.some((e:{id:string})=>e.id===f.originalOccurrenceId)).toBe(false);expect(trip.shared.originals).toMatchObject([{selection:context,occurrenceId:f.originalOccurrenceId,participation:'review_required'}]);expect(trip.shared.originals).toHaveLength(1);expect(JSON.stringify(trip)).not.toContain(f.enrollmentId);expect(JSON.stringify(trip)).not.toContain(f.secondEnrollment);
 const loaded=await get(f,login.token,'plan',fishingCalendarSearch(context));expect(loaded.status).toBe(200);const plan=(await loaded.json()).data;expect(plan.sharedEvents).toEqual([trip]);expect(plan.view.occurrences[0].id).toBe(f.originalOccurrenceId);expect(plan.view.occurrences[0].state).toBe('published');expect(await f.protectedSnapshot()).toEqual(before);
});

test('separately enabled own-child shared reads remain read-only and foreign-child context is denied',async()=>{
 const f=await fixture('en',true),child=await f.account('child',f.learnerId as Parameters<typeof f.account>[1]),other=await f.account('child',f.second.learnerId),own=await f.login(child.id+'@example.invalid'),foreign=await f.login(other.id+'@example.invalid'),before=await f.protectedSnapshot();
 const response=await get(f,own.token,'timeline',query(f));expect(response.status).toBe(200);expect((await response.json()).data.items.find((e:{id:string})=>e.id===f.eventId).shared.originals[0].selection).toEqual(selection(f));
 const loaded=await get(f,own.token,'plan',fishingCalendarSearch(selection(f)));expect(loaded.status).toBe(200);const plan=(await loaded.json()).data;expect(plan.view.role).toBe('child');expect(plan.operator.roster).toEqual([]);expect(plan.lessonLinks).toEqual([]);expect(JSON.stringify(plan.sharedEvents)).not.toMatch(/purchaseId|paidCents|guardianDigest|parentAccountId/);expect([403,404]).toContain((await get(f,foreign.token,'timeline',query(f))).status);expect((await get(f,foreign.token,'plan',fishingCalendarSearch(selection(f)))).status).toBe(403);expect(await f.protectedSnapshot()).toEqual(before);
});


test('a renewed nonoverlapping four-lesson block stays readable and cannot inherit an earlier block shared trip',async()=>{
 const f=await fixture(),ids=(await f.current()).occurrences.slice(4,8).map(o=>o.id),renewed=await paidBlock(f,{parent:f.parent,learnerId:f.learnerId,householdId:f.householdId},ids),before=await f.protectedSnapshot(),context={learnerId:f.learnerId,enrollmentId:renewed.enrollmentId,reference:f.ref};
 const loaded=await get(f,f.parentToken,'plan',fishingCalendarSearch(context));expect(loaded.status).toBe(200);const plan=(await loaded.json()).data;expect(plan.view.occurrences.map((o:{id:string})=>o.id)).toEqual(ids);expect(plan.sharedEvents).toBeUndefined();
 const timeline=await get(f,f.parentToken,'timeline',query(f));expect(timeline.status).toBe(200);const trip=(await timeline.json()).data.items.find((e:{id:string})=>e.id===f.eventId);expect(trip.shared.originals).toHaveLength(1);expect(trip.shared.originals[0].selection.enrollmentId).toBe(f.enrollmentId);expect(JSON.stringify(trip)).not.toContain(renewed.enrollmentId);expect(await f.protectedSnapshot()).toEqual(before);
});
