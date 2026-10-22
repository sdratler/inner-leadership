import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {groupTravelFixture} from './academy-group-calendar-travel-fixture.ts';
import {AcademyGroupPublicationService} from '../../../src/features/fishing/academy-group-calendar-publication-service.ts';
import {AcademyTravelCreditService} from '../../../src/features/fishing/academy-travel-credit-service.ts';
import {AcademySessionCreditStore} from '../../../src/features/fishing-stage/academy-session-credit-store.ts';
import {AcademyTravelCreditStore} from '../../../src/features/fishing/academy-travel-credit-store.ts';
import {travelDigest} from '../../../src/features/fishing/academy-travel-credit-source.ts';
import {academyGroupPublicationVersion} from '../../../src/features/fishing/academy-group-calendar-publication-contract.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';

const live:Awaited<ReturnType<typeof groupTravelFixture>>[]=[];afterEach(async()=>{for(const f of live.splice(0))await f.close();});async function fixture(){const f=await groupTravelFixture();live.push(f);return f;}
const roots=(f:Awaited<ReturnType<typeof fixture>>)=>f.db.transaction(tx=>new AcademySessionCreditStore(tx,f.ring).selected(f.workspaceId,f.enrollmentId,f.learnerId));

test('shared trip change authenticates physical history without a fake Stage revision and issues exactly one original4-lesson root',async()=>{
 const f=await fixture(),before=await f.current(),protectedBefore=await f.protectedSnapshot(),command=await f.sharedChangeCommand(),changed=await f.service().recordChange(f.owner,command);expect(changed.receipt.stageRevision).toBe(before.revision);expect(await f.current()).toEqual(before);
 expect(changed.current.physical?.eventId).toBe(f.eventId);expect(changed.current.current.time.startsAt).toBe(f.trip.startsAt);expect(changed.current.change?.before.stageRevision).toBe(changed.current.change?.changed.stageRevision);
 expect((await f.service().recordChange(f.owner,command)).receipt.replayed).toBe(true);const declaration=await f.declarationCommand(true),result=await f.service().declare(f.parent,declaration);expect(result.receipt.outcome).toBe('issued');expect((await f.service().declare(f.parent,declaration)).receipt).toEqual({...result.receipt,replayed:true});const saved=await roots(f);expect(saved).toHaveLength(1);expect(saved[0]!.anchor.occurrenceId).toBe(f.originalOccurrenceId);expect(saved[0]!.purchaseId).toBe(f.purchaseId);expect(saved[0]!.state).toBe('outstanding');
 expect(await f.protectedSnapshot()).toEqual(protectedBefore);const payment=(await f.paymentStore.readPayment(f.owner,f.purchaseId))!;expect(payment.originalTotalCents).toBe(65000);expect(payment.dues).toHaveLength(1);expect((await f.current()).occurrences.map(o=>o.id)).toEqual(before.occurrences.map(o=>o.id));expect((await f.current()).occurrences[0]!.state).toBe('published');
});

test('later shorter journey and changed answer retain the exact sealed root credit and its original notice',async()=>{
 const f=await fixture();await f.service().recordChange(f.owner,await f.sharedChangeCommand(90));const issued=await f.declare(true),credit=(await roots(f))[0]!,plan=await f.current(),notice=plan.notices.find(n=>n.occurrenceId===f.originalOccurrenceId)!;
 const before=(await f.pool.query('SELECT to_jsonb(c) AS row FROM ls_fishing_stage.academy_session_credits c WHERE workspace_id=$1 AND id=$2',[f.workspaceId,credit.id])).rows;
 await f.service().recordChange(f.owner,await f.sharedChangeCommand(20));const result=await f.declare(false);expect(result.receipt.outcome).toBe('retained');expect(result.receipt.creditId).toBe(issued.receipt.creditId);expect(await roots(f)).toEqual([credit]);expect((await f.pool.query('SELECT to_jsonb(c) AS row FROM ls_fishing_stage.academy_session_credits c WHERE workspace_id=$1 AND id=$2',[f.workspaceId,credit.id])).rows).toEqual(before);expect((await f.current()).notices.find(n=>n.id===notice.id)).toEqual(notice);
});

test('current guardian declaration and retained root can be adopted as a local alternative without changing paid originals or resources twice',async()=>{
 const f=await fixture();await f.service().recordChange(f.owner,await f.sharedChangeCommand());const result=await f.declare(true),declaration=await f.latestDeclaration(),before=await f.protectedSnapshot(),credit=(await roots(f))[0]!;
 const review=await f.review({kind:'local_alternative',guardianDeclarationId:declaration.id,guardianDeclarationSha256:travelDigest(declaration),retainedCreditId:result.receipt.creditId}),command={version:academyGroupPublicationVersion,action:'publish',operationId:randomUUID(),eventId:f.eventId,expectedDraftRevision:review.eventRevision,expectedPublicationRevision:f.published.publicationRevision,sourceReviewId:review.id};
 const adopted=await f.publication().execute(f.owner,command);expect(adopted.receipt.publicationRevision).toBe(2);expect((await f.publication().execute(f.owner,command)).receipt.replayed).toBe(true);expect(await roots(f)).toEqual([credit]);expect(await f.protectedSnapshot()).toEqual(before);expect((await f.service().context(f.parent,f.selection)).credit).toEqual({id:credit.id,state:'outstanding'});
 expect((await f.pool.query('SELECT kind,count(*)::int AS count FROM ls_academy_calendar.resources WHERE workspace_id=$1 AND active GROUP BY kind ORDER BY kind',[f.workspaceId])).rows).toEqual([{kind:'instructor',count:1},{kind:'venue',count:1}]);
 const instant=new Date(Date.parse(f.trip.endsAt)+1000);await f.pool.query('UPDATE ls_identity.sessions SET expires_at=$2 WHERE workspace_id=$1',[f.workspaceId,new Date(instant.valueOf()+86400000)]);const service=new AcademyGroupPublicationService(f.db,f.config,f.merchant,{now:()=>instant});
 const attendance={version:academyGroupPublicationVersion,action:'attendance' as const,eventId:f.eventId,operationId:randomUUID(),expectedPublicationRevision:adopted.receipt.publicationRevision,learnerId:f.second.learnerId,expectedAttendanceRevision:0,state:'present' as const,reason:'SYNTHETIC actual traveler only'},attended=await service.execute(f.owner,attendance);
 await expect(service.execute(f.owner,{...attendance,operationId:randomUUID(),learnerId:f.learnerId})).rejects.toMatchObject({code:'NOT_FOUND'});
 const complete={version:academyGroupPublicationVersion,action:'complete' as const,eventId:f.eventId,operationId:randomUUID(),expectedPublicationRevision:adopted.receipt.publicationRevision,reason:'SYNTHETIC shared trip completed with separate local obligation'},completed=await service.execute(f.owner,complete);expect(completed.receipt.state).toBe('completed');expect((await service.execute(f.owner,complete)).receipt).toEqual({...completed.receipt,replayed:true});expect((await service.execute(f.owner,attendance)).receipt).toEqual({...attended.receipt,replayed:true});
 expect(await roots(f)).toEqual([credit]);expect(await f.protectedSnapshot()).toEqual(before);expect((await f.current()).occurrences[0]!.state).toBe('published');expect((await f.pool.query('SELECT count(*)::int AS count FROM ls_academy_calendar.activity_evidence WHERE workspace_id=$1',[f.workspaceId])).rows[0].count).toBe(0);
 await expect(service.execute(f.owner,{...command,operationId:randomUUID(),expectedPublicationRevision:completed.receipt.publicationRevision})).rejects.toMatchObject({code:'CONFLICT'});
});

test('stale physical selectors, forged owner, foreign guardian and old Stage-only change cannot mutate shared-trip responses',async()=>{
 const f=await fixture(),command=await f.sharedChangeCommand(),before=await f.protectedSnapshot();await expect(f.service().recordChange(f.owner,{...command,physical:{...command.physical,tripSha256:'a'.repeat(64)}})).rejects.toMatchObject({code:'CONFLICT'});
 await expect(f.service().recordChange({...f.parent,role:'practitioner'},command)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(f.service().recordChange(f.owner,{operationId:randomUUID(),selection:f.selection,beforeStageRevision:command.expectedStageRevision-1,changedStageRevision:command.expectedStageRevision,expectedStageRevision:command.expectedStageRevision,revisedOneWayMinutes:90,estimateReference:'SYNTHETIC stale physical bypass'})).rejects.toMatchObject({code:'CONFLICT'});
 await f.service().recordChange(f.owner,command);const declaration=await f.declarationCommand(true);await expect(f.service().declare(f.second.parent,declaration)).rejects.toMatchObject({code:'FORBIDDEN'});expect(await roots(f)).toEqual([]);expect(await f.protectedSnapshot()).toEqual(before);
});

test('within-limit response creates no credit and does not forfeit the independently purchased four originals',async()=>{
 const f=await fixture(),before=await f.protectedSnapshot();await f.service().recordChange(f.owner,await f.sharedChangeCommand(20));const result=await f.declare(true);expect(result.receipt.outcome).toBe('no_credit');expect(result.receipt.creditId).toBeNull();expect(await roots(f)).toEqual([]);expect(await f.protectedSnapshot()).toEqual(before);const obligation=await f.db.transaction(tx=>f.program.readSessionCreditObligationInTransaction(tx,f.owner,f.selection));expect(obligation.purchaseScope.purchasedLessons).toBe(4);expect(obligation.delivery.state).toBe('undelivered');
});

test('shared travel journal failure rolls back actual change and journal; exact retry then records once',async()=>{
 const f=await fixture(),command=await f.sharedChangeCommand();let inserted=false;
 const failing=new AcademyTravelCreditService({transaction:work=>f.db.transaction(tx=>{const query:SqlSession['query']=async<T extends object>(sql:string,values?:readonly unknown[])=>{const rows=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_fishing_stage.academy_travel_commands')){inserted=true;throw Error('SYNTHETIC_AFTER_ACTUAL_SHARED_TRAVEL_INSERT');}return rows;};return work({query});})},f.config,f.merchant);
 await expect(failing.recordChange(f.owner,command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(inserted).toBe(true);expect(await f.db.transaction(tx=>new AcademyTravelCreditStore(tx,f.ring).changes(f.workspaceId,f.enrollmentId,f.originalOccurrenceId))).toEqual([]);expect((await f.service().recordChange(f.owner,command)).receipt.replayed).toBe(false);expect((await f.service().recordChange(f.owner,command)).receipt.replayed).toBe(true);
});
