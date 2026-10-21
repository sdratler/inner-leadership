import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {groupPublicationFixture} from './academy-group-calendar-publication-fixture.ts';
import {readAcademySharedPhysicalEvents} from '../../../src/features/fishing/academy-group-calendar-publication-fence.ts';
import {assertNoFishingInstructorConflict} from '../../../src/features/calendar/fishing-resource-fence.ts';
import {academyOperatorDays} from '../../../src/features/fishing/academy-operator-day.ts';
import {academySharedTeachingEvents} from '../../../src/features/fishing/academy-group-calendar-publication-fence.ts';
import type {StageCommand} from '../../../src/features/fishing-stage/contract.ts';
import {AcademyGroupPublicationService} from '../../../src/features/fishing/academy-group-calendar-publication-service.ts';
import {AcademyGroupPublicationStore} from '../../../src/features/fishing/academy-group-calendar-publication-store.ts';
import {academyGroupPublicationVersion} from '../../../src/features/fishing/academy-group-calendar-publication-contract.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';

const live:Awaited<ReturnType<typeof groupPublicationFixture>>[]=[];
afterEach(async()=>{for(const f of live.splice(0))await f.close();});
async function fixture(serviceReady=false){const f=await groupPublicationFixture(serviceReady);live.push(f);return f;}
async function publicationStats(f:Awaited<ReturnType<typeof fixture>>){return(await f.pool.query('SELECT (SELECT count(*)::int FROM ls_academy_calendar.publications WHERE workspace_id=$1) AS publications,(SELECT count(*)::int FROM ls_academy_calendar.publication_commands WHERE workspace_id=$1) AS commands,(SELECT count(*)::int FROM ls_academy_calendar.resources WHERE workspace_id=$1 AND active) AS resources,(SELECT count(*)::int FROM ls_academy_calendar.attendance WHERE workspace_id=$1) AS attendance',[f.workspaceId])).rows[0];}

test('fixture-seeded shared event has one physical instructor/venue reservation across two original groups; purchased12/parent/paid data stay unchanged',async()=>{
 const f=await fixture(),before=await f.preserved(),parents=await Promise.all(f.families.map(p=>f.stage(p.family.parent,p.enrollment.result.id).read(p.family.parent,p.ref))),saved=await f.fixtureBind();
 const events=await f.db.transaction(tx=>readAcademySharedPhysicalEvents(tx,f.ring,f.workspaceId));expect(events).toEqual([saved]);expect(academyOperatorDays(academySharedTeachingEvents(events,f.owner.id,f.owner.id))).toMatchObject([{date:f.sunday,ordinaryEventIds:[],keysEventIds:[saved.eventId],ordinaryMilliseconds:0}]);
 expect((await f.pool.query('SELECT kind,count(*)::int AS count FROM ls_academy_calendar.resources WHERE workspace_id=$1 AND active GROUP BY kind ORDER BY kind',[f.workspaceId])).rows).toEqual([{kind:'instructor',count:1},{kind:'venue',count:1}]);
 expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active',[f.workspaceId])).rows[0].count).toBe(0);
 expect(await f.preserved()).toEqual(before);expect(await Promise.all(f.families.map(p=>f.stage(p.family.parent,p.enrollment.result.id).read(p.family.parent,p.ref)))).toEqual(parents);for(const view of parents)expect(view?.occurrences).toHaveLength(12);
 const secondOriginal=(await f.read(f.ref))!.occurrences[1]!;await f.schedule(f.ref,8,10,undefined,2);expect((await f.pool.query('SELECT active FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND occurrence_id=$2',[f.workspaceId,saved.originals[0]!.selection.occurrenceId])).rows.every(r=>r.active===false)).toBe(true);expect((await f.read(f.ref))!.occurrences.find(o=>o.id===secondOriginal.id)?.time.kind).toBe('scheduled');
});

test('actual clinical booking and ordinary instruction cannot occupy a shared Keys date; failed writes preserve all native state',async()=>{
 const f=await fixture(),saved=await f.fixtureBind(),booking=await f.clinical(),before=await f.snapshot();
 await expect(f.calendar.create(f.owner,randomUUID(),booking(f.wall(f.sunday,10)))).rejects.toMatchObject({code:'CONFLICT'});expect(await f.snapshot()).toEqual(before);
 const group=await f.group();await f.schedule(group,18,20,f.sunday);const afterDraft=await f.snapshot();await expect((await f.publication(group)).execute()).rejects.toMatchObject({code:'CAPACITY'});expect(await f.snapshot()).toEqual(afterDraft);
 await expect(f.db.transaction(tx=>assertNoFishingInstructorConflict(tx,f.workspaceId,f.owner.id,saved.trip.startsAt,saved.trip.endsAt))).rejects.toMatchObject({code:'CONFLICT'});
});

test('current shared binding blocks old original changes and exact cached revise receipt; no plan/resources/receipts change',async()=>{
 const f=await fixture(),plan=(await f.read(f.ref))!,o=plan.occurrences[0]!,operationId=randomUUID();
 const command:StageCommand={action:'revise',operationId,expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'SYNTHETIC same time deliberate revision',details:{time:{...o.time,timeZone:'America/New_York'},location:o.location,directions:o.directions,equipment:o.equipment,logisticalNote:o.logisticalNote,childCapacity:o.childCapacity}};
 const stage=f.stage(f.owner,null,{operationId,resources:[{occurrenceId:o.id,expectedRevision:o.revision,venueId:f.venueCommand.id}],makeupFitDecisionId:null});await stage.execute(f.owner,f.ref,command);expect((await stage.execute(f.owner,f.ref,command)).replayed).toBe(true);
 // The fixture review pins prior immutable originals; regenerate its exact
 // snapshot by using a new fixture rather than pretending this edit is approved.
 const g=await fixture(),p=(await g.read(g.ref))!,original=p.occurrences[0]!;await g.fixtureBind();const before=await g.snapshot();
 for(const action of ['cancel','complete']as const)await expect(g.stage().execute(g.owner,g.ref,{action,operationId:randomUUID(),expectedRevision:p.revision,occurrenceId:original.id,expectedOccurrenceRevision:original.revision,reason:'SYNTHETIC old physical endpoint'})).rejects.toMatchObject({code:'CONFLICT'});
 expect(await g.snapshot()).toEqual(before);
 // Bind the historical fixture event after the first edit only to check the
 // cached-command fence; this is intentionally NOT current publication proof.
 await f.fixtureBind();const after=await f.snapshot();await expect(stage.execute(f.owner,f.ref,command)).rejects.toMatchObject({code:'CONFLICT'});expect(await f.snapshot()).toEqual(after);
});

test('completed or cancelled shared history cannot silently reactivate originals; completed Keys day still excludes ordinary instruction',async()=>{
 const f=await fixture();await f.fixtureBind();await f.fixtureBind('completed');const group=await f.group();await f.schedule(group,18,20,f.sunday);await expect((await f.publication(group)).execute()).rejects.toMatchObject({code:'CAPACITY'});
 await f.fixtureBind('cancelled');const p=(await f.read(f.ref))!,o=p.occurrences[0]!,before=await f.snapshot();await expect(f.stage().execute(f.owner,f.ref,{action:'cancel',operationId:randomUUID(),expectedRevision:p.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'SYNTHETIC cannot resurrect cancelled-trip old identity'})).rejects.toMatchObject({code:'CONFLICT'});expect(await f.snapshot()).toEqual(before);
 expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_academy_calendar.resources WHERE workspace_id=$1 AND active',[f.workspaceId])).rows[0].count).toBe(0);
});

test('partial overlay or disabled history trigger fails closed for current Stage and reciprocal clinical reads',async()=>{
 const f=await fixture();await f.fixtureBind();await f.pool.query('ALTER TABLE ls_academy_calendar.publications DISABLE TRIGGER immutable_publication');
 try{await expect(f.db.transaction(tx=>readAcademySharedPhysicalEvents(tx,f.ring,f.workspaceId))).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(f.db.transaction(tx=>assertNoFishingInstructorConflict(tx,f.workspaceId,f.owner.id,f.wall(f.sunday,18),f.wall(f.sunday,19)))).rejects.toMatchObject({code:'UNAVAILABLE'});
 }finally{await f.pool.query('ALTER TABLE ls_academy_calendar.publications ENABLE TRIGGER immutable_publication');}
 await f.pool.query('ALTER TABLE ls_academy_calendar.activity_evidence RENAME TO synthetic_unknown_activity');
 try{await expect(f.db.transaction(tx=>assertNoFishingInstructorConflict(tx,f.workspaceId,f.owner.id,f.wall(f.sunday,18),f.wall(f.sunday,19)))).rejects.toMatchObject({code:'UNAVAILABLE'});}finally{await f.pool.query('ALTER TABLE ls_academy_calendar.synthetic_unknown_activity RENAME TO activity_evidence');}
});

test('existing pending safety intervention retains its exact authorized historical handoff after shared displacement and cancellation',async()=>{
 const f=await fixture(),family=f.families[0]!,plan=(await f.read(f.ref))!,original=plan.occurrences[0]!;
 await f.stage().execute(f.owner,f.ref,{action:'safety_intervention',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:original.id,expectedOccurrenceRevision:original.revision,enrollmentId:family.enrollment.result.id,decision:'stop_activity',reason:'SYNTHETIC prior original intervention',supervisingAdult:'SYNTHETIC qualified adult',handoff:'awaiting_authorized_guardian'});
 const pending=(await f.read(f.ref))!,intervention=pending.safetyOperator!.interventions[0]!;await f.fixtureBind();await f.fixtureBind('cancelled');
 const handoff:StageCommand={action:'safety_handoff',operationId:randomUUID(),expectedRevision:pending.revision,occurrenceId:original.id,expectedOccurrenceRevision:original.revision,enrollmentId:family.enrollment.result.id,interventionId:intervention.id,authorizedGuardianReference:'SYNTHETIC current native authorized guardian',handoffEvidence:'SYNTHETIC actual prior intervention handoff'};
 const protectedBefore=await f.preserved(),stage=f.stage();await expect(stage.execute(f.owner,f.ref,{...handoff,interventionId:randomUUID(),operationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});
 const stranger=f.families[1]!.family.parent;await expect(f.stage(stranger,f.families[1]!.enrollment.result.id).execute(stranger,f.ref,handoff)).rejects.toMatchObject({code:'FORBIDDEN'});
 expect((await stage.execute(f.owner,f.ref,handoff)).replayed).toBe(false);const after=(await f.read(f.ref))!;expect(after.safetyOperator!.handoffs).toMatchObject([{interventionId:intervention.id,occurrenceId:original.id,enrollmentId:family.enrollment.result.id}]);
 expect((await stage.execute(f.owner,f.ref,handoff)).replayed).toBe(true);
 await expect(stage.execute(f.owner,f.ref,{action:'assess_safety',operationId:randomUUID(),expectedRevision:after.revision,occurrenceId:original.id,expectedOccurrenceRevision:original.revision,enrollmentId:family.enrollment.result.id,decision:'ready',casting:'SYNTHETIC',waterEdge:'SYNTHETIC',instructions:'SYNTHETIC',restrictions:'SYNTHETIC'})).rejects.toMatchObject({code:'CONFLICT'});
 // Only native plan/revision history gains the historical handoff. Purchased
 // scope, payments, seats, root credits and travel archives remain exact.
 const protectedAfter=await f.preserved();for(const key of Object.keys(protectedBefore).filter(k=>!['ls_fishing_stage.plans','ls_fishing_stage.revisions'].includes(k)))expect(protectedAfter[key]).toBe(protectedBefore[key]);
 expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_academy_calendar.resources WHERE workspace_id=$1 AND active',[f.workspaceId])).rows[0].count).toBe(0);
});

test('missing or silently deactivated shared reservation cannot permit an actual clinical booking',async()=>{
 const f=await fixture(),saved=await f.fixtureBind(),booking=await f.clinical();
 await f.pool.query("UPDATE ls_academy_calendar.resources SET active=false WHERE workspace_id=$1 AND event_id=$2 AND kind='instructor'",[f.workspaceId,saved.eventId]);
 const before=await f.snapshot();await expect(f.calendar.create(f.owner,randomUUID(),booking(f.wall(f.sunday,10)))).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await f.snapshot()).toEqual(before);
 await f.pool.query("DELETE FROM ls_academy_calendar.resources WHERE workspace_id=$1 AND event_id=$2 AND kind='instructor'",[f.workspaceId,saved.eventId]);
 await expect(f.calendar.create(f.owner,randomUUID(),booking(f.wall(f.sunday,10)))).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect((await f.pool.query("SELECT count(*)::int AS count FROM ls_calendar.appointments WHERE workspace_id=$1",[f.workspaceId])).rows[0].count).toBe(0);
});

test('actual publication service verifies current all-group paid originals and readable activity source, books once and reconciles exact committed-loss retry',async()=>{
 const f=await fixture(true),before=await f.preserved(),command=f.publishCommand(),result=await f.service().execute(f.owner,command);expect(result.receipt).toMatchObject({state:'published',replayed:false,financialEffect:'none',activityFulfillment:'not_inferred'});
 expect(await publicationStats(f)).toEqual({publications:1,commands:1,resources:2,attendance:0});expect(await f.service().execute(f.owner,command)).toEqual({receipt:{...result.receipt,replayed:true}});expect(await f.preserved()).toEqual(before);
 await expect(f.service().execute(f.owner,{...command,sourceReviewId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});expect(await publicationStats(f)).toEqual({publications:1,commands:1,resources:2,attendance:0});
 const latest=await f.db.transaction(tx=>new AcademyGroupPublicationStore(tx,f.ring).publication(f.workspaceId,command.eventId));expect(latest?.record.members).toHaveLength(2);expect(latest?.record.originals).toHaveLength(2);
});

test('missing merchant, omitted paid child, omitted active group or changed original denies publication without booking or purchase effects',async()=>{
 const f=await fixture(true),command=f.publishCommand(),before=await f.snapshot(),paidBefore=await f.preserved();await expect(f.notAdmitted().execute(f.owner,command)).rejects.toMatchObject({code:'CONFLICT'});expect(await f.snapshot()).toEqual(before);
 const omitted=await f.fixtureReview({...f.review,id:randomUUID(),members:f.review.members.slice(0,1)});await expect(f.service().execute(f.owner,{...command,sourceReviewId:omitted.id})).rejects.toMatchObject({code:'CONFLICT'});expect(await f.preserved()).toEqual(paidBefore);
 await f.group();const afterNewGroup=await f.snapshot();await expect(f.service().execute(f.owner,command)).rejects.toMatchObject({code:'CONFLICT'});expect(await f.snapshot()).toEqual(afterNewGroup);expect(await publicationStats(f)).toEqual({publications:0,commands:0,resources:0,attendance:0});
 const g=await fixture(true);await g.schedule(g.ref,8,10);const afterEdit=await g.snapshot();await expect(g.service().execute(g.owner,g.publishCommand())).rejects.toMatchObject({code:'CONFLICT'});expect(await g.snapshot()).toEqual(afterEdit);
});

test('actual publication command-insert failure rolls back displaced bookings, shared reservations, publication history and receipt',async()=>{
 const f=await fixture(true),command=f.publishCommand(),before=await f.snapshot(),paid=await f.preserved();let inserted=false;
 const failing=new AcademyGroupPublicationService({transaction:work=>f.db.transaction(tx=>{const query:SqlSession['query']=async<T extends object>(sql:string,values?:readonly unknown[])=>{const rows=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_academy_calendar.publication_commands')){inserted=true;throw Error('SYNTHETIC_AFTER_ACTUAL_PUBLICATION_COMMAND');}return rows;};return work({query});})},f.config,f.merchant);
 await expect(failing.execute(f.owner,command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(inserted).toBe(true);expect(await f.snapshot()).toEqual(before);expect(await f.preserved()).toEqual(paid);expect(await publicationStats(f)).toEqual({publications:0,commands:0,resources:0,attendance:0});expect((await f.service().execute(f.owner,command)).receipt.state).toBe('published');
});

test('concurrent actual shared publication versus clinical booking has exactly one winner under the existing workspace lock',async()=>{
 const f=await fixture(true),booking=await f.clinical(),results=await Promise.allSettled([f.service().execute(f.owner,f.publishCommand()),f.calendar.create(f.owner,randomUUID(),booking(f.wall(f.sunday,10)))]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'CONFLICT'}});const stats=await publicationStats(f);expect(stats.publications).toBe(results[0]!.status==='fulfilled'?1:0);expect((await f.pool.query("SELECT count(*)::int AS count FROM ls_calendar.appointments WHERE workspace_id=$1 AND status='scheduled'",[f.workspaceId])).rows[0].count).toBe(results[0]!.status==='fulfilled'?0:1);
});

test('actual publication and cached replies require current guardian, source review and owner session; cancellation remains possible after source revocation',async()=>{
 const f=await fixture(true),command=f.publishCommand(),result=await f.service().execute(f.owner,command);await f.pool.query('INSERT INTO ls_academy_calendar.source_revocations(workspace_id,id,review_id,revoked_by,revoked_at) VALUES($1,$2,$3,$4,clock_timestamp())',[f.workspaceId,randomUUID(),f.review.id,f.owner.id]);
 await expect(f.service().execute(f.owner,command)).rejects.toMatchObject({code:'CONFLICT'});const cancelled=await f.service().execute(f.owner,{version:academyGroupPublicationVersion,action:'cancel',eventId:command.eventId,operationId:randomUUID(),expectedPublicationRevision:result.receipt.publicationRevision,reason:'SYNTHETIC close revoked approval without inventing refund'});expect(cancelled.receipt.state).toBe('cancelled');expect((await publicationStats(f)).resources).toBe(0);
 const g=await fixture(true),other=g.publishCommand();await g.service().execute(g.owner,other);await g.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[g.workspaceId,g.families[0]!.family.learnerId]);await expect(g.service().execute(g.owner,other)).rejects.toMatchObject({code:'FORBIDDEN'});
 await g.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2',[g.workspaceId,g.owner.id]);await expect(g.service().execute(g.owner,other)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});

test('physical attendance and completion preserve original module outcomes, paid scope and money; exact retry records each child once',async()=>{
 const f=await fixture(true),command=f.publishCommand(),publication=(await f.service().execute(f.owner,command)).receipt,before=await f.preserved(),instant=new Date(Date.parse(f.review.trip.endsAt)+1000);
 // Explicit synthetic clock and session lifetime only; no application clock
 // override, real event completion or provider behavior is inferred.
 await f.pool.query('UPDATE ls_identity.sessions SET expires_at=$2 WHERE workspace_id=$1',[f.workspaceId,new Date(instant.valueOf()+86400000)]);const service=f.service({now:()=>instant});
 for(const member of f.review.members){const attendance={version:academyGroupPublicationVersion,action:'attendance' as const,eventId:command.eventId,operationId:randomUUID(),expectedPublicationRevision:publication.publicationRevision,learnerId:member.learnerId,expectedAttendanceRevision:0,state:'present' as const,reason:'SYNTHETIC physical participation only'},result=await service.execute(f.owner,attendance);expect(result.receipt).toMatchObject({state:'attendance_recorded',activityFulfillment:'not_inferred',financialEffect:'none'});expect((await service.execute(f.owner,attendance)).receipt.replayed).toBe(true);}
 const complete={version:academyGroupPublicationVersion,action:'complete' as const,eventId:command.eventId,operationId:randomUUID(),expectedPublicationRevision:publication.publicationRevision,reason:'SYNTHETIC completed physical trip'},result=await service.execute(f.owner,complete);expect(result.receipt.state).toBe('completed');expect((await service.execute(f.owner,complete)).receipt.replayed).toBe(true);expect(await publicationStats(f)).toEqual({publications:2,commands:4,resources:0,attendance:2});expect(await f.preserved()).toEqual(before);
 expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_academy_calendar.activity_evidence WHERE workspace_id=$1',[f.workspaceId])).rows[0].count).toBe(0);for(const ref of [f.ref,f.second])expect((await f.read(ref))!.occurrences[0]!.state).toBe('published');
});

test('later active groups and newly paid children cannot invalidate or inherit a saved trip attendance and completion',async()=>{
 const f=await fixture(true),command=f.publishCommand(),pub=(await f.service().execute(f.owner,command)).receipt;await f.group();const family=await f.family(),purchase=await f.prepare(family,'prepay',f.ref.stageId);await f.settle(purchase);const enrollment=await f.enroll(purchase);
 expect((await f.service().execute(f.owner,command)).receipt.replayed).toBe(true);const instant=new Date(Date.parse(f.review.trip.endsAt)+1000);await f.pool.query('UPDATE ls_identity.sessions SET expires_at=$2 WHERE workspace_id=$1',[f.workspaceId,new Date(instant.valueOf()+86400000)]);const service=f.service({now:()=>instant});
 const attendance={version:academyGroupPublicationVersion,action:'attendance' as const,eventId:command.eventId,operationId:randomUUID(),expectedPublicationRevision:pub.publicationRevision,learnerId:family.learnerId,expectedAttendanceRevision:0,state:'present' as const,reason:'SYNTHETIC new child cannot inherit old approved trip'};await expect(service.execute(f.owner,attendance)).rejects.toMatchObject({code:'NOT_FOUND'});
 for(const member of f.review.members){const saved={...attendance,operationId:randomUUID(),learnerId:member.learnerId};expect((await service.execute(f.owner,saved)).receipt.replayed).toBe(false);expect((await service.execute(f.owner,saved)).receipt.replayed).toBe(true);}
 expect((await service.execute(f.owner,{version:academyGroupPublicationVersion,action:'complete',eventId:command.eventId,operationId:randomUUID(),expectedPublicationRevision:pub.publicationRevision,reason:'SYNTHETIC original saved roster completes'})).receipt.state).toBe('completed');expect((await publicationStats(f)).attendance).toBe(2);expect(await f.program.readEnrollment(f.owner,enrollment.result.id)).toMatchObject({learnerId:family.learnerId});
});

test('an unresolved member cannot retain another child credit or a different original of its own child',async()=>{
 const f=await fixture(true),foreign=await f.fixtureCredit(1),wrongOriginal=await f.fixtureCredit(0,2),before=await f.preserved();
 for(const credit of [foreign,wrongOriginal]){const review=await f.fixtureReview({...f.review,id:randomUUID(),members:f.review.members.map((m,i)=>i===0?{...m,participation:{kind:'review_required',reason:'SYNTHETIC unresolved local obligation',retainedCreditId:credit.id}}:m)});await expect(f.service().execute(f.owner,{...f.publishCommand(),sourceReviewId:review.id})).rejects.toMatchObject({code:'CONFLICT'});}
 expect(await f.preserved()).toEqual(before);expect(await publicationStats(f)).toEqual({publications:0,commands:0,resources:0,attendance:0});
});
