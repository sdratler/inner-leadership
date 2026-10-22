import {ordinaryFixtureInterval} from './academy-calendar-fixture-times.ts';
import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {travelCreditFixture} from './academy-travel-credit-fixture.ts';
import {AcademyTravelCreditService} from '../../../src/features/fishing/academy-travel-credit-service.ts';
import {AcademySessionCreditStore} from '../../../src/features/fishing-stage/academy-session-credit-store.ts';
import type {IdentityStore,SqlSession} from '../../../src/features/identity/store.ts';
import {handleFishingCalendar} from '../../../src/features/fishing/program-calendar-http.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';

const fixtures:Awaited<ReturnType<typeof travelCreditFixture>>[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function fixture(){const f=await travelCreditFixture();fixtures.push(f);return f;}
async function ready(){const f=await fixture();await f.changeSchedule();await f.recordChange();return f;}
const count=async(f:Awaited<ReturnType<typeof fixture>>,table:string)=>(await f.pool.query(`SELECT count(*)::int AS n FROM ls_fishing_stage.${table} WHERE workspace_id=$1`,[f.workspaceId])).rows[0]!.n as number;
const privatePlan=(f:Awaited<ReturnType<typeof fixture>>)=>f.db.transaction(async tx=>(await f.program.readSessionCreditSelectionInTransaction(tx,f.owner,f.selection)).plan);
const archived=(f:Awaited<ReturnType<typeof fixture>>)=>f.db.transaction(tx=>new AcademySessionCreditStore(tx,f.ring).selected(f.workspaceId,f.enrollmentId,f.learnerId));

test('exact37 drives actual same-transaction issuance and one bookable original notice; restart readback is public and financial records unchanged',async()=>{
 const f=await ready(),before=await f.protectedSnapshot(),oldPlan=await privatePlan(f),response=await f.declare(),plan=await privatePlan(f);
 expect(response.receipt.outcome).toBe('issued');expect(response.current).toMatchObject({recordedMaximumOneWayMinutes:37,responseOutcome:'issued',credit:{id:response.receipt.creditId,state:'outstanding'},replacement:null});expect(response.current.specificDateOrSeatGuaranteed).toBe(false);
 expect(plan.revision).toBe(oldPlan.revision+1);expect({...plan,revision:oldPlan.revision,makeups:oldPlan.makeups}).toEqual(oldPlan);expect(plan.makeups).toHaveLength(1);expect(plan.makeups[0]!.notice).toMatchObject({occurrenceId:f.originalOccurrenceId,entitlementId:response.receipt.creditId,state:'protected',travelCredit:{creditId:response.receipt.creditId,activityBindingId:f.activity.id}});
 expect(await count(f,'academy_session_credits')).toBe(1);expect(await count(f,'academy_session_credit_events')).toBe(1);expect(await f.service().context(f.parent,f.selection)).toEqual(response.current);expect(await f.protectedSnapshot()).toEqual(before);
 expect(JSON.stringify(response)).not.toMatch(/purchaseId|purchaseLineId|householdId|guardianSha256|parentAccountId|estimateReference|payload_ciphertext|learnerArtifact|PRIVATE_SYNTHETIC|settlement|merchant|acceptedTerms/);
});
test('new responses and concurrent distinct commands retain the same root; existing request and operator decision fields remain untouched',async()=>{
 const f=await ready();let plan=await f.current();const o=plan.occurrences[0]!;await f.stage(f.parent,f.enrollmentId).execute(f.parent,f.ref,{action:'notice',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'ordinary_absence'});plan=await f.current();const n=plan.notices.find(n=>n.occurrenceId===o.id)!;await f.stage(f.parent,f.enrollmentId).execute(f.parent,f.ref,{action:'request_makeup',operationId:randomUUID(),expectedRevision:plan.revision,noticeId:n.id});const old=(await privatePlan(f)).makeups[0]!;
 const a=await f.declarationCommand(),b={...a,operationId:randomUUID()},results=await Promise.all([f.service().declare(f.parent,a),f.service().declare(f.parent,b)]);expect(new Set(results.map(r=>r.receipt.creditId)).size).toBe(1);expect(await count(f,'academy_session_credits')).toBe(1);
 const now=(await privatePlan(f)).makeups[0]!;expect(now.notice.id).toBe(old.notice.id);expect(now.notice.entitlementId).toBe(old.notice.entitlementId);expect({...now,notice:old.notice}).toEqual(old);expect(now.notice.state).toBe(old.notice.state);
});
test('exact committed lost-response retry reauthorizes after its notice append and later ordinary reservation; archive remains outstanding',async()=>{
 const f=await ready(),command=await f.declarationCommand();let uncertain=true;
 const db:IdentityStore={transaction:async work=>{const result=await f.db.transaction(work);if(uncertain){uncertain=false;throw Error('SYNTHETIC_COMMITTED_RESPONSE_LOST');}return result;}};
 await expect(new AcademyTravelCreditService(db,f.config,f.merchant).declare(f.parent,command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await count(f,'academy_session_credits')).toBe(1);const old=await archived(f);await f.reserve();const response=await f.service().declare(f.parent,command);
 expect(response.receipt).toMatchObject({replayed:true,outcome:'issued',creditId:old[0]!.id});expect(response.current.credit).toEqual({id:old[0]!.id,state:'replacement_reserved'});expect(await archived(f)).toEqual(old);expect(await count(f,'academy_travel_declarations')).toBe(1);expect(await count(f,'academy_session_credit_events')).toBe(1);
 await expect(f.service().declare(f.parent,{...command,familyCannotAttend:false})).rejects.toMatchObject({code:'CONFLICT'});
});
test('failure after notice append but before outer receipt rolls back Stage, declaration, evidence, credit and event together',async()=>{
 const f=await ready(),before=await privatePlan(f),protectedBefore=await f.protectedSnapshot(),command=await f.declarationCommand();
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:<T extends object>(sql:string,args?:readonly unknown[])=>{if(sql.startsWith('INSERT INTO ls_fishing_stage.academy_travel_commands'))throw Error('SYNTHETIC_FINAL_RECEIPT_FAILURE');return tx.query<T>(sql,args);}} satisfies SqlSession))};
 await expect(new AcademyTravelCreditService(db,f.config,f.merchant).declare(f.parent,command)).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(await privatePlan(f)).toEqual(before);expect(await f.protectedSnapshot()).toEqual(protectedBefore);for(const table of ['academy_travel_declarations','academy_session_policy_evidence','academy_session_credits','academy_session_credit_events'])expect(await count(f,table)).toBe(0);
 expect((await f.service().declare(f.parent,command)).receipt.outcome).toBe('issued');
});
test.each([['within',37,true],['can_attend',45,false]]as const)('%s records an actual guardian response without creating a new credit or notice',async(_name,minutes,cannot)=>{
 const f=await fixture();await f.changeSchedule();await f.recordChange(minutes);const before=await privatePlan(f),response=await f.declare(cannot);expect(response.receipt.outcome).toBe('no_credit');expect(response.current.responseOutcome).toBe('no_credit');expect((await f.service().context(f.parent,f.selection)).responseOutcome).toBe('no_credit');expect(response.current.credit).toBeNull();expect(await privatePlan(f)).toEqual(before);expect(await count(f,'academy_session_credits')).toBe(0);
});

test('saved guardian statement with unresolved actual original duration remains explicitly review-required on restart without a credit',async()=>{
 const f=await fixture();await f.changeSchedule();await f.revise(f.originalOccurrenceId,f.at(30),f.at(32.5));await f.recordChange();const response=await f.declare();expect(response.receipt.outcome).toBe('facts_required');expect(response.current).toMatchObject({responseOutcome:'facts_required',credit:null,replacement:null});expect((await f.service().context(f.parent,f.selection)).responseOutcome).toBe('facts_required');expect(await count(f,'academy_session_credits')).toBe(0);
});

test('parent replacement logistics follow the actual bound foreign timetable and disappear on released-seat authority',async()=>{
 const f=await ready(),response=await f.declare(),target=await f.reserve(),before=await f.service().context(f.parent,f.selection);expect(before.replacement).toMatchObject({occurrenceId:target.id,logistics:{time:target.time,location:target.location}});
 expect(await f.db.transaction(tx=>f.program.readSessionCreditReplacementInTransaction(tx,f.parent,f.selection,randomUUID()))).toBeNull();
 const other=await f.account('parent');await expect(f.db.transaction(tx=>f.program.readSessionCreditReplacementInTransaction(tx,other,f.selection,response.receipt.creditId!))).rejects.toBeDefined();
 const plan=(await f.replacementStage().read(f.owner,f.replacementRef))!,operationId=randomUUID();const teaching=ordinaryFixtureInterval(f.at(384),f.at(386));await f.replacementStage({operationId,resources:[{occurrenceId:target.id,expectedRevision:target.revision,venueId:f.venueCommand.id}],makeupFitDecisionId:null}).execute(f.owner,f.replacementRef,{action:'revise',operationId,expectedRevision:plan.revision,occurrenceId:target.id,expectedOccurrenceRevision:target.revision,details:{time:{kind:'scheduled',startsAt:teaching.startsAt,endsAt:teaching.endsAt,timeZone:'America/New_York'},location:f.venueCommand.label,directions:'SYNTHETIC current replacement directions',equipment:'SYNTHETIC',logisticalNote:'SYNTHETIC current replacement',childCapacity:4},reason:'SYNTHETIC current replacement timetable'});
 expect((await f.service().context(f.parent,f.selection)).replacement).toMatchObject({occurrenceId:target.id,logistics:{time:{startsAt:teaching.startsAt,endsAt:teaching.endsAt},location:f.venueCommand.label}});
 await f.pool.query("UPDATE ls_fishing_stage.seat_reservations SET state='released' WHERE workspace_id=$1 AND enrollment_id=$2 AND stage_id=$3 AND origin='makeup'",[f.workspaceId,f.enrollmentId,f.replacementRef.stageId]);expect(await f.service().context(f.parent,f.selection)).toMatchObject({credit:{id:response.receipt.creditId,state:'review_required'},replacement:null});
});
test('replacement attendance alone stays review-required; independently approved matching original activity establishes current delivery without rewriting archive',async()=>{
 const f=await ready(),response=await f.declare(),old=await archived(f);await f.reserve();await f.completeReplacement();expect((await f.service().context(f.parent,f.selection)).credit).toEqual({id:response.receipt.creditId,state:'review_required'});
 expect((await f.program.calendarOperatorChoices(f.owner,f.replacementRef)).roster).toContainEqual({enrollmentId:f.enrollmentId,learnerId:f.learnerId,displayName:'Synthetic travel child'});expect(await f.program.readEnrollment(f.owner,f.enrollmentId)).toMatchObject({stageId:f.ref.stageId,cohortId:f.ref.cohortId});
 await f.bindActivity('replacement');expect((await f.service().context(f.parent,f.selection)).credit).toEqual({id:response.receipt.creditId,state:'delivered'});expect(await archived(f)).toEqual(old);
});
test('foreign makeup attendance and cached receipt require the exact current reserved seat, source notice and guardian',async()=>{
 const f=await ready();await f.declare();await f.reserve();const {command}=await f.completeReplacement();
 expect((await f.replacementStage().execute(f.owner,f.replacementRef,command)).replayed).toBe(true);
 await f.pool.query("UPDATE ls_fishing_stage.seat_reservations SET state='released' WHERE workspace_id=$1 AND enrollment_id=$2 AND stage_id=$3 AND origin='makeup'",[f.workspaceId,f.enrollmentId,f.replacementRef.stageId]);
 await expect(f.replacementStage().execute(f.owner,f.replacementRef,command)).rejects.toMatchObject({code:'FORBIDDEN'});
 expect((await f.program.calendarOperatorChoices(f.owner,f.replacementRef)).roster).toEqual([]);expect((await f.service().context(f.parent,f.selection)).credit?.state).toBe('review_required');
});
test('current guardian revocation also denies a cached cross-cohort attendance operation without changing the original enrollment',async()=>{
 const f=await ready();await f.declare();await f.reserve();const {command}=await f.completeReplacement();await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3',[f.workspaceId,f.learnerId,f.parent.id]);
 await expect(f.replacementStage().execute(f.owner,f.replacementRef,command)).rejects.toMatchObject({code:'FORBIDDEN'});
 expect((await f.pool.query('SELECT stage_id,state FROM ls_fishing_stage.enrollments WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.enrollmentId])).rows).toEqual([{stage_id:f.ref.stageId,state:'confirmed'}]);
});
test('revoking original A and importing B cannot fulfill the archived A credit through a B-compatible replacement',async()=>{
 const f=await ready(),response=await f.declare(),old=await archived(f);await f.reserve();await f.completeReplacement();await f.pool.query('INSERT INTO ls_fishing_stage.academy_travel_source_revocations(workspace_id,id,binding_id,revoked_by,revoked_at) VALUES($1,$2,$3,$4,clock_timestamp())',[f.workspaceId,randomUUID(),f.activity.id,f.owner.id]);await f.bindActivity('original','synthetic-other-activity-B');await f.bindActivity('replacement','synthetic-other-activity-B');
 expect((await f.service().context(f.parent,f.selection)).credit).toEqual({id:response.receipt.creditId,state:'review_required'});expect(await archived(f)).toEqual(old);
});
test('current session and guardian revocation deny cached receipt and private read; cross-family cannot borrow change or child',async()=>{
 const f=await ready(),command=await f.declarationCommand();await f.service().declare(f.parent,command);const other=await f.account('parent'),before=await archived(f);await expect(f.service().context(other,f.selection)).rejects.toBeDefined();await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3',[f.workspaceId,f.learnerId,f.parent.id]);await expect(f.service().declare(f.parent,command)).rejects.toBeDefined();await expect(f.service().context(f.parent,f.selection)).rejects.toBeDefined();expect(await archived(f)).toEqual(before);
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=true WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3',[f.workspaceId,f.learnerId,f.parent.id]);await f.revoke();await expect(f.service().declare(f.parent,command)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
test('native history must contain a real published venue/time change; default unadmitted merchant cannot issue',async()=>{
 const f=await fixture();expect((await f.service().context(f.owner,f.selection)).candidateChange).toBeNull();await f.changeSchedule();const command=await f.changeCommand();await expect(f.service().recordChange(f.owner,{...command,beforeStageRevision:command.beforeStageRevision-1})).rejects.toBeDefined();await f.recordChange();expect((await f.notAdmitted().context(f.parent,f.selection)).mayRespond).toBe(false);await expect(f.notAdmitted().declare(f.parent,await f.declarationCommand())).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await count(f,'academy_session_credits')).toBe(0);
});
test('actual session-cookie and CSRF HTTP composition returns strict public context and protects role/idempotency boundaries',async()=>{
 const f=await ready(),ownerLogin=await f.login(f.owner.id+'@example.invalid'),headers={cookie:SESSION_COOKIE+'='+ownerLogin.token,origin:f.config.origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':f.sessions.csrf(ownerLogin.token)},command=await f.declarationCommand(),url=f.config.origin+'/api/calendar/fishing/';
 const read=await handleFishingCalendar(new Request(url+'travel-credit?'+new URLSearchParams(f.selection),{headers:{cookie:SESSION_COOKIE+'='+f.parentToken}}),['travel-credit'],async()=>({runtime:f.runtime,store:f.db,merchant:f.merchant}));expect(read.status).toBe(200);expect(read.headers.get('cache-control')).toBe('private, no-store');expect((await read.json()).data.recordedMaximumOneWayMinutes).toBe(37);
 const wrong=await handleFishingCalendar(new Request(url+'travel-declaration',{method:'POST',headers:{...headers,'idempotency-key':command.operationId},body:JSON.stringify(command)}),['travel-declaration'],async()=>({runtime:f.runtime,store:f.db,merchant:f.merchant}));expect(wrong.status).toBe(403);
 const request=new Request(url+'travel-declaration',{method:'POST',headers:{...headers,cookie:SESSION_COOKIE+'='+f.parentToken,'x-csrf-token':f.sessions.csrf(f.parentToken),'idempotency-key':command.operationId},body:JSON.stringify(command)}),response=await handleFishingCalendar(request,['travel-declaration'],async()=>({runtime:f.runtime,store:f.db,merchant:f.merchant}));expect(response.status).toBe(200);expect((await response.json()).data.receipt.outcome).toBe('issued');
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3',[f.workspaceId,f.learnerId,f.parent.id]);
 const denied=await handleFishingCalendar(new Request(url+'travel-credit?'+new URLSearchParams(f.selection),{headers:{cookie:SESSION_COOKIE+'='+f.parentToken}}),['travel-credit'],async()=>({runtime:f.runtime,store:f.db,merchant:f.merchant}));expect(denied.status).toBe(403);expect(JSON.stringify(await denied.json())).not.toMatch(/creditId|Recorded family|Synthetic travel child|purchaseId/);
});
