import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,nativeProgramFixture,programNow,programRing,programKey,programClock} from '../fixtures/fishing-native-program-v3.ts';
import {FishingFulfillmentNativeV1} from '../../src/features/fishing-billing/fulfillment-native-v1.ts';
import {FishingServicePlanNativeV1} from '../../src/features/fishing-billing/service-plan-native-v1.ts';
import {SERVICE_PLAN_V1,type ServicePlanPreviewV1} from '../../src/features/fishing-billing/service-plan-contract-v1.ts';
import {FULFILLMENT_V1,type FulfillmentCommandV1} from '../../src/features/fishing-billing/fulfillment-contract-v1.ts';
import type {SqlSession} from '../../src/features/identity/store.ts';
import {FishingGuestServiceMaterialNativeV4} from '../../src/features/fishing-billing/guest-service-material-native-v4.ts';
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4,type ServiceAcceptCommandV4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {bindServiceFinancialDraftV4,bindServiceIssuedMaterialV4,verifyServiceFinancialDraftV4,verifyServiceOfferBindingV4,bindServiceDisplayBundleV4,
 serviceFinancialStatementSha256V4,serviceRecurringStatementSha256V4,validateServiceAcceptCommandV4,verifyServiceGrantRecordV4,verifyServiceFinancialAcceptanceV4} from '../../src/features/fishing-billing/guest-service-material-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import {digest} from '../../src/features/contact-ops/server/digests.ts';
import {verifyGuestIssuedMaterial} from '../../src/lib/fishing-billing-guest-material-v3.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_fulfillment_v1.sql','utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();vi.restoreAllMocks();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native family/first lessons/quote/trip plan SQL; no injected lesson or
// skills resolver. Synthetic references are not legal/operating/payment proof.
// PGlite serial transactions do not prove normal PostgreSQL competition.
async function ready(readiness='needs_foundation',firstSequence=1,longMonth=false){
 const f=await nativeProgramFixture(engine);await f.source().record(f.owner,f.group());
 const dates=longMonth?['2035-01-15T21:30:00Z','2035-01-22T21:30:00Z','2035-01-29T21:30:00Z','2035-01-30T21:00:00Z',
  '2035-02-05T21:30:00Z','2035-02-06T21:00:00Z','2035-02-13T21:00:00Z','2035-02-20T21:00:00Z','2035-02-12T21:30:00Z','2035-02-27T21:00:00Z']:
  ['2035-01-31T21:30:00Z','2035-02-07T21:30:00Z','2035-02-14T21:30:00Z','2035-02-15T21:00:00Z',
   '2035-02-21T21:30:00Z','2035-02-22T21:00:00Z','2035-03-01T21:00:00Z','2035-03-08T21:00:00Z'];
 const lessons=dates.map(()=>randomUUID());for(const [index,date] of dates.entries())await f.source().record(f.owner,f.lesson(lessons[index]!,index===0?firstSequence:index+1,date));
 await f.source().record(f.owner,f.progression(0,dates[0]!.slice(0,10)+'T00:00:00Z',readiness));await f.source().record(f.owner,f.progression(1,dates[3]!.slice(0,10)+'T00:00:00Z','verified_catchup'));
 const offer=f.offer([lessons[0]!,lessons[3]!]),created=await f.billing().createAnchoredOffer(f.owner,offer);
 const fulfillment=()=>new FishingFulfillmentNativeV1(f.workspace,f.source(),f.billing(),programRing,programKey,programClock);
 const departure=(date:string,tripKind:'keys'|'local'):Extract<FulfillmentCommandV1,{action:'record_departure'}>=>({version:FULFILLMENT_V1,action:'record_departure',id:randomUUID(),groupId:f.groupId,operationId:randomUUID(),expectedRevision:0,
  fields:{state:'scheduled',tripKind,startsAt:date+'T13:00:00Z',endsAt:date+'T23:00:00Z',timeZone:'America/New_York',fullDay:true,childCapacity:2,
   venueSource:{id:'SYNTHETIC-NOT-VENUE-APPROVAL',sha256:'a'.repeat(64)},capacitySource:{id:'SYNTHETIC-DECLARED-NOT-SAFETY-APPROVAL',sha256:'b'.repeat(64)},
   planningContext:{location:'SYNTHETIC Florida meeting point',details:'SYNTHETIC planning only; ordinary operating admission remains separate.'}}});
 const keys=departure(longMonth?'2035-02-04':'2035-02-18','keys'),local=departure(longMonth?'2035-02-11':'2035-02-25','local');await fulfillment().recordDeparture(f.owner,keys);await fulfillment().recordDeparture(f.owner,local);
 const tripPlan=await fulfillment().preparePlan(f.owner,{version:FULFILLMENT_V1,action:'prepare_plan',quoteId:offer.id,operationId:randomUUID(),expectedRevision:0,expectedQuoteRevision:1,
  children:created.quote.lines.map(line=>({lineId:line.id,keys:{id:keys.id,expectedRevision:1},local:{id:local.id,expectedRevision:1}}))});
 const indices=longMonth?[[0,1,2,4,8],[3,5,6,7,9]]:[[0,1,2,4],[3,5,6,7]];
 const command:ServicePlanPreviewV1={version:SERVICE_PLAN_V1,quoteId:offer.id,expectedQuoteRevision:1,tripPlan:{expectedRevision:1,expectedDigest:tripPlan.digest},
  children:created.quote.lines.map((line,index)=>({lineId:line.id,expectedProgressionRevision:1,lessons:indices[index]!.map(n=>({id:lessons[n]!,expectedRevision:1}))}))};
 const service=()=>new FishingServicePlanNativeV1(f.workspace,f.source(),fulfillment(),programKey);
 return {...f,lessons,dates,offer,created,fulfillment,keys,local,command,service};
}
async function state(workspace:string){return (await engine.query(`SELECT 'source' AS kind,count(*)::int AS count FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1
 UNION ALL SELECT 'fulfillment',count(*)::int FROM ls_fishing_billing.fulfillment_versions WHERE workspace_id=$1
 UNION ALL SELECT 'quotes',count(*)::int FROM ls_fishing_billing.quotes WHERE workspace_id=$1
 UNION ALL SELECT 'commands',count(*)::int FROM ls_fishing_billing.commands WHERE workspace_id=$1
 UNION ALL SELECT 'obligations',count(*)::int FROM ls_fishing_billing.obligations WHERE workspace_id=$1 ORDER BY kind`,[workspace])).rows;}
it('reads a complete source-bound monthly schedule for both staggered siblings without writing or granting seats/payment',async()=>{
 const f=await ready(),before=await state(f.workspace),result=await f.service().preview(f.owner,f.command);
 expect(result.snapshot.classification).toBe('prospective_schedule_not_reserved_paid_or_operating_approval');
 expect(result.snapshot.children.map(child=>child.weeklyLessons.length)).toEqual([4,4]);
 expect(result.snapshot.children.map(child=>child.foundation.basis)).toEqual(['planned_first_two','verified_catchup']);
 expect(result.snapshot.children[0]!.foundation.lessonIds).toEqual([f.lessons[0],f.lessons[1]]);
 expect(result.snapshot.children[1]!.progression.evidence?.id).toBe('SYNTHETIC-OWNER-VERIFIED-SKILLS');
 const last=result.snapshot.children[1]!.weeklyLessons[3]!;expect((Date.parse(last.weekEndsAt)-Date.parse(last.weekStartsAt))/3600000).toBe(167);
 const reordered={...f.command,children:[...f.command.children].reverse().map(child=>({...child,lessons:[...child.lessons].reverse()}))};
 expect(await f.service().preview(f.owner,reordered)).toEqual(result);expect(await state(f.workspace)).toEqual(before);
 expect((await f.billing().readAnchoredOffer(f.owner,f.offer.id)).quote).toEqual(f.created.quote);
});
it('rejects a missing weekly lesson instead of silently promising a complete standard month',async()=>{
 const f=await ready(),command=structuredClone(f.command);command.children[0]!.lessons.pop();
 await expect(f.service().preview(f.owner,command)).rejects.toThrow('CONFLICT');
 await expect(f.service().preview(f.owner,{...f.command,children:f.command.children.slice(1)})).rejects.toThrow('CONFLICT');
});
it('requires and reads the fifth actual weekly lesson for each longer child month',async()=>{
 const f=await ready('needs_foundation',1,true),result=await f.service().preview(f.owner,f.command);
 expect(result.snapshot.children.map(child=>child.weeklyLessons.length)).toEqual([5,5]);
 expect(result.snapshot.children[0]!.weeklyLessons[4]!.startsAt).toBe('2035-02-12T21:30:00Z');
 const incomplete=structuredClone(f.command);incomplete.children[0]!.lessons.pop();await expect(f.service().preview(f.owner,incomplete)).rejects.toThrow('CONFLICT');
});
it('requires the selected actual first two curriculum lessons before the first trip',async()=>{
 const f=await ready();await f.source().record(f.owner,f.lesson(f.lessons[1]!,3,f.dates[1]!,1));
 const command=structuredClone(f.command);command.children[0]!.lessons[1]!.expectedRevision=2;
 await expect(f.service().preview(f.owner,command)).rejects.toThrow('CONFLICT');
});
it('does not count a selected second foundation lesson occurring only after an included trip',async()=>{
 const f=await ready('needs_foundation',1,true);await f.source().record(f.owner,f.lesson(f.lessons[1]!,3,f.dates[1]!,1));await f.source().record(f.owner,f.lesson(f.lessons[8]!,2,f.dates[8]!,1));
 const command=structuredClone(f.command);command.children[0]!.lessons[1]!.expectedRevision=2;command.children[0]!.lessons[4]!.expectedRevision=2;
 await expect(f.service().preview(f.owner,command)).rejects.toThrow('CONFLICT');
});
it('uses actual evidenced prior foundation progress and still requires a scheduled second lesson when only one is complete',async()=>{
 const f=await ready('foundation_one_complete'),result=await f.service().preview(f.owner,f.command);
 expect(result.snapshot.children[0]!.foundation).toMatchObject({basis:'verified_first_plus_planned_second',lessonIds:[f.lessons[1]],evidence:{id:'SYNTHETIC-OWNER-VERIFIED-SKILLS'}});
 const complete=await ready('foundation_complete',3),verified=await complete.service().preview(complete.owner,complete.command);
 expect(verified.snapshot.children[0]!.foundation).toMatchObject({basis:'verified_foundation',lessonIds:[]});
 await expect(f.service().preview(f.owner,{...f.command,readiness:'foundation_complete'})).rejects.toThrow();
});
it('rejects stale lesson/progression/trip-plan versions, unknown lessons and caller dates',async()=>{
 const f=await ready();
 for(const alter of [
  (c:ServicePlanPreviewV1)=>{c.children[0]!.lessons[1]!.expectedRevision=2;},
  (c:ServicePlanPreviewV1)=>{c.children[0]!.expectedProgressionRevision=2;},
  (c:ServicePlanPreviewV1)=>{c.tripPlan.expectedRevision=2;},
  (c:ServicePlanPreviewV1)=>{c.tripPlan.expectedDigest='f'.repeat(64);},
  (c:ServicePlanPreviewV1)=>{c.children[0]!.lessons[1]!.id=randomUUID();},
 ]){const command=structuredClone(f.command);alter(command);await expect(f.service().preview(f.owner,command)).rejects.toThrow('CONFLICT');}
 await expect(f.service().preview(f.owner,{...f.command,startsAt:'2035-01-01T00:00:00Z'})).rejects.toThrow();
});
it('refuses an actual lesson overlapping a trip and suppresses cancelled or changed source plans',async()=>{
 const f=await ready(),overlap=randomUUID();await f.source().record(f.owner,f.lesson(overlap,9,'2035-02-18T13:00:00Z'));
 const command=structuredClone(f.command);command.children[0]!.lessons[2]!.id=overlap;
 await expect(f.service().preview(f.owner,command)).rejects.toThrow('CONFLICT');
 await f.fulfillment().recordDeparture(f.owner,{...f.keys,operationId:randomUUID(),expectedRevision:1,fields:{...f.keys.fields,state:'cancelled'}});
 await expect(f.service().preview(f.owner,f.command)).rejects.toThrow('CONFLICT');
 expect((await f.fulfillment().readPlan(f.owner,f.offer.id)).departureSourceState).toBe('changed');
});
it('rechecks the original first-lesson anchor and never turns an issued or cancelled quote into a new prospective promise',async()=>{
 const f=await ready();await f.source().record(f.owner,f.lesson(f.lessons[0]!,1,f.dates[0]!,1,'cancelled'));
 await expect(f.service().preview(f.owner,f.command)).rejects.toThrow('CONFLICT');
 const issued=await ready();await issued.billing().issueAnchoredOffer(issued.owner,{operationId:randomUUID(),quoteId:issued.offer.id,expectedVersion:1});
 await expect(issued.service().preview(issued.owner,{...issued.command,expectedQuoteRevision:2})).rejects.toThrow('CONFLICT');
});
it('enforces actual native owner/family/demo isolation rather than accepting a readiness flag',async()=>{
 const f=await ready();await expect(f.service().preview(f.parent,f.command)).rejects.toThrow('UNAVAILABLE');
 const other=await ready();await expect(other.service().preview(other.owner,f.command)).rejects.toThrow('UNAVAILABLE');
 await engine.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)',[f.workspace,'ls-owner-20350102',f.owner.id]);
 await engine.query('INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[f.workspace,f.owner.id,'ls-owner-20350102','SYNTHETIC-service-plan']);
 await expect(f.service().preview(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');
});
it('authenticates native lesson data before using it and rechecks session loss at terminal read',async()=>{
 const f=await ready(),original=f.db.transaction.bind(f.db);let revoke=false;
 vi.spyOn(f.db,'transaction').mockImplementation(work=>original(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,v);
  if(revoke&&sql.includes("h.kind='progression'"))await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,programNow]);
  return !revoke&&sql.includes("h.kind='lesson'")?rows.map(row=>({...row,ciphertext:'CORRUPTION'})):rows;
 }})));
 await expect(f.service().preview(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');revoke=true;
 await expect(f.service().preview(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');
 expect((await engine.query<{revoked_at:Date|null}>('SELECT revoked_at FROM ls_identity.sessions WHERE token_digest=$1',[f.owner.sessionDigest])).rows[0]!.revoked_at).toBe(null);
});
it('closes the new same-transaction planning callback handle after readback',async()=>{
 const f=await ready();let retained:SqlSession|undefined;
 const read=await f.fulfillment().withPlanData(f.owner,f.offer.id,async(c,_data,planning)=>{retained=c.tx;return planning;});
 expect(read.departureSourceState).toBe('unchanged');await expect(async()=>retained!.query('SELECT 1')).rejects.toThrow('UNAVAILABLE');
});
async function materialV4(){
 const f=await ready(),native=new FishingGuestServiceMaterialNativeV4(f.workspace,f.service()),command={version:BILLING_SERVICE_V4,action:'prepare_service_financial_draft',plan:f.command,policyKind:'selected_650_product_policy'};
 const draft=await native.preview(f.owner,command),offer=bindServiceIssuedMaterialV4(draft,'2035-01-02T15:01:00.000Z');
 const bundle=bindServiceDisplayBundleV4(offer,{version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,id:randomUUID(),locale:'he',offerSnapshotSha256:offer.sha256,
  serviceSnapshotSha256:digest(offer.material.schedule.snapshot),financialTerms:{source:offer.material.financial.definition.terms,displayedTextSha256:'a'.repeat(64),releaseEvidenceId:randomUUID()}});
 const presentation={version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,grantId:randomUUID(),displayBundleId:bundle.id,displayBundleSha256:bundle.sha256,locale:'he',evidenceId:randomUUID(),
  affirmation:{version:'SYNTHETIC-UNAPPROVED-V4-STATEMENT',guardianAuthorityText:'SYNTHETIC authority statement',financialTermsText:'SYNTHETIC financial statement',serviceScheduleText:'SYNTHETIC complete schedule statement'}};
 const accept:ServiceAcceptCommandV4={version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,operationId:randomUUID(),expectedQuoteRevision:2,offerSnapshotSha256:offer.sha256,
  displayBundleId:bundle.id,displayBundleSha256:bundle.sha256,displayChallenge:'A'.repeat(43),parent:{submittedName:'SYNTHETIC named parent',guardianAuthorityAttested:true,financialTermsAffirmed:true,serviceScheduleAffirmed:true},recurring:{kind:'one_time_only'}};
 return {...f,native,materialCommand:command,draft,offer,bundle,presentation,accept};
}
it('V4 native material binds actual complete service and policy in the same read transaction without upgrading V3 or issuing anything',async()=>{
 const f=await materialV4(),before=await state(f.workspace),draft=await f.native.preview(f.owner,f.materialCommand);
 expect(draft).toEqual(f.draft);expect(verifyServiceFinancialDraftV4(draft)).toEqual(draft);
 expect(draft.material.version).toBe(BILLING_SERVICE_V4);expect(draft.material.basis.version).toBe('JLFA-FISHING-BILLING-GUEST-v3');expect(draft.material.basis.state).toBe('draft');
 expect(f.offer.material.financial.lines.map(line=>line.amountMinor)).toEqual([65000,65000]);
 expect(f.offer.material.policy).toMatchObject({kind:'selected_650_product_policy',preAttendanceRetentionMinor:10000,oneLessonBeforeTripRetentionTotalMinor:20000,absenceNoticeHours:24});
 expect(await state(f.workspace)).toEqual(before);expect((await f.billing().readAnchoredOffer(f.owner,f.offer.material.financial.quoteId)).quote).toEqual(f.created.quote);
 expect((await engine.query('SELECT * FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
 await expect(f.native.preview(f.parent,f.materialCommand)).rejects.toThrow('UNAVAILABLE');
});
it('V4 material fails closed across versions, scope, source changes and invented or incomplete schedules',async()=>{
 const f=await materialV4();expect(()=>verifyGuestIssuedMaterial(f.offer)).toThrow();
 for(const edit of [
  (m:typeof f.draft.material)=>{m.schedule.snapshot.children[0]!.childId=randomUUID();},
  (m:typeof f.draft.material)=>{m.schedule.snapshot.children[0]!.weeklyLessons.pop();},
  (m:typeof f.draft.material)=>{m.schedule.snapshot.children[0]!.period.endsAt='2035-03-01T21:30:00.000Z';},
  (m:typeof f.draft.material)=>{m.schedule.snapshot.quoteRevision=2;},
  (m:typeof f.draft.material)=>{m.policy.renewal.sha256='f'.repeat(64);},
 ]){const m=structuredClone(f.draft.material);edit(m);expect(()=>bindServiceFinancialDraftV4(m)).toThrow();}
 const tampered=structuredClone(f.offer);tampered.material.financial.lines[0]!.amountMinor--;expect(()=>verifyServiceOfferBindingV4(tampered)).toThrow();
 await expect(f.native.preview(f.owner,{...f.materialCommand,amountMinor:1})).rejects.toThrow();
 await f.fulfillment().recordDeparture(f.owner,{...f.keys,operationId:randomUUID(),expectedRevision:1,fields:{...f.keys.fields,state:'cancelled'}});
 await expect(f.native.preview(f.owner,f.materialCommand)).rejects.toThrow('CONFLICT');
});
it('V4 explicit custom terms keep their own versioned references and require owner refund review rather than inventing standard fees',async()=>{
 const f=await materialV4(),custom=await f.native.preview(f.owner,{...f.materialCommand,policyKind:'custom_terms_document'});
 expect(custom.material.policy).toEqual({kind:'custom_terms_document',refundDisposition:'owner_review_under_exact_released_terms',cancellation:f.created.quote.definition.policies.cancellation,
  weather:f.created.quote.definition.policies.weather,renewal:f.created.quote.definition.policies.renewal,servicePeriod:f.created.quote.definition.policies.service_period});
 expect(custom.sha256).not.toBe(f.draft.sha256);expect(f.draft.material.policy.kind).toBe('selected_650_product_policy');
});
it('V4 proposed financial affirmation binds the exact material, selected language and separate schedule statement without becoming an acceptance',async()=>{
 const f=await materialV4(),before=await state(f.workspace);
 expect(validateServiceAcceptCommandV4(f.offer,f.bundle,f.accept,f.presentation,null)).toEqual(f.accept);
 const statement=serviceFinancialStatementSha256V4(f.offer,f.bundle,f.presentation);expect(statement).toMatch(/^[a-f0-9]{64}$/);
 expect(serviceFinancialStatementSha256V4(f.offer,f.bundle,{...f.presentation,affirmation:{...f.presentation.affirmation,serviceScheduleText:'SYNTHETIC different displayed schedule statement'}})).not.toBe(statement);
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,{...f.accept,parent:{...f.accept.parent,serviceScheduleAffirmed:false}},f.presentation,null)).toThrow();
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,f.accept,{...f.presentation,locale:'en'},null)).toThrow();
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,{...f.accept,version:'JLFA-FISHING-BILLING-GUEST-v3'},f.presentation,null)).toThrow();
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,{...f.accept,offerSnapshotSha256:'f'.repeat(64)},f.presentation,null)).toThrow();
 expect(await state(f.workspace)).toEqual(before);
});
it('V4 separately binds affirmative recurring consent to only the selected exact child/amount/first-period/anniversary/cancellation terms',async()=>{
 const f=await materialV4(),line=f.offer.material.financial.lines[1]!,lines=[{lineId:line.id,childId:line.childId,periodId:line.period.id,amountMinor:line.amountMinor,currency:'USD' as const,
  firstPeriodStartsAt:line.period.startsAt,nextRenewalAt:line.period.endsAt}];
 const presentation={version:BILLING_SERVICE_V4,purpose:'separate_recurring_card_authorization',grantId:f.presentation.grantId,displayBundleId:f.bundle.id,displayBundleSha256:f.bundle.sha256,
  locale:'he',evidenceId:randomUUID(),textVersion:'SYNTHETIC-UNAPPROVED-MANDATE',amountTimingCancellationText:'SYNTHETIC exact amount, anniversary and cancellation text'};
 const statementSha256=serviceRecurringStatementSha256V4(f.offer,f.bundle,lines,presentation),command={...f.accept,recurring:{kind:'separate_affirmative_card_authorization',amountTimingCancellationAffirmed:true,lines,statementSha256}};
 expect(validateServiceAcceptCommandV4(f.offer,f.bundle,command,f.presentation,presentation).recurring.kind).toBe('separate_affirmative_card_authorization');
 for(const changed of [{...lines[0]!,amountMinor:1},{...lines[0]!,nextRenewalAt:line.period.startsAt},{...lines[0]!,childId:randomUUID()}])
  expect(()=>serviceRecurringStatementSha256V4(f.offer,f.bundle,[changed],presentation)).toThrow();
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,command,f.presentation,null)).toThrow();
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,{...command,recurring:{...command.recurring,amountTimingCancellationAffirmed:false}},f.presentation,presentation)).toThrow();
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,{...command,recurring:{...command.recurring,statementSha256:serviceFinancialStatementSha256V4(f.offer,f.bundle,f.presentation)}},f.presentation,presentation)).toThrow();
 expect(()=>validateServiceAcceptCommandV4(f.offer,f.bundle,f.accept,f.presentation,presentation)).toThrow();
 expect(lines).toHaveLength(1);expect(f.accept.recurring).toEqual({kind:'one_time_only'});
});
it('V4 grant/evidence readback uses explicit new purpose/version/AAD and never accepts a V3 token or fake V3 signature',async()=>{
 const f=await materialV4(),id=randomUUID(),grant={version:BILLING_SERVICE_V4,materialVersion:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,id:f.presentation.grantId,
  offer:f.offer,displayBundle:f.bundle,recipientBindingEvidenceId:randomUUID(),admissionPolicy:{id:'SYNTHETIC-UNAPPROVED-ADMISSION',sha256:'c'.repeat(64)},tokenDigest:'d'.repeat(64),issuedByAccountId:f.owner.id,
  issuedAt:'2035-01-02T15:01:00.000Z',expiresAt:'2035-01-02T15:31:00.000Z'};
 expect(verifyServiceGrantRecordV4(grant)).toEqual(grant);
 expect(()=>verifyServiceGrantRecordV4({...grant,version:'JLFA-FISHING-BILLING-GUEST-v3'})).toThrow();
 const evidence={version:BILLING_SERVICE_V4,kind:'service_guest_grant',action:SERVICE_FINANCIAL_ACTION_V4,id,grantId:grant.id,offer:f.offer,displayed:f.bundle,
  parent:{...f.accept.parent,statementSha256:serviceFinancialStatementSha256V4(f.offer,f.bundle,f.presentation),privateEvidenceId:id},assuranceEvidenceId:randomUUID(),operationId:f.accept.operationId,
  acceptedAt:'2035-01-02T15:02:00.000Z',recurring:{kind:'one_time_only'},recurringPrivateEvidenceId:null};
 expect(verifyServiceFinancialAcceptanceV4(evidence,f.presentation,null)).toEqual(evidence);
 expect(()=>verifyServiceFinancialAcceptanceV4({...evidence,kind:'guest_grant'},f.presentation,null)).toThrow();
 expect(()=>verifyServiceFinancialAcceptanceV4({...evidence,parent:{...evidence.parent,privateEvidenceId:randomUUID()}},f.presentation,null)).toThrow();
 const oldAad='ls_fishing_billing/guest_grant/v3/'+f.workspace+'/'+grant.id,encrypted=seal('SYNTHETIC V3 BYTES',oldAad,programRing);
 expect(()=>unseal(encrypted,serviceGuestAadV4('grant',f.workspace,grant.id),programRing)).toThrow();
 expect((await engine.query('SELECT * FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
