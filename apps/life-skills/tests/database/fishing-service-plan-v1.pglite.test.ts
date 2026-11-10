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
