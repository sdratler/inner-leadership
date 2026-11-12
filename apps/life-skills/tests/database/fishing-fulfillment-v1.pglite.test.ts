import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,nativeProgramFixture,programNow,programRing,programKey,programClock} from '../fixtures/fishing-native-program-v3.ts';
import {FishingFulfillmentNativeV1} from '../../src/features/fishing-billing/fulfillment-native-v1.ts';
import {FULFILLMENT_V1,type FulfillmentCommandV1} from '../../src/features/fishing-billing/fulfillment-contract-v1.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {AppError} from '../../src/lib/errors.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_fulfillment_v1.sql','utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();vi.restoreAllMocks();});
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native inquiry/family/lesson/quote/departure SQL, disposable synthetic
// data only. PGlite serial execution does not prove PostgreSQL competition,
// real operational approval, reserved seats, payment or guardian acceptance.
type Departure=Extract<FulfillmentCommandV1,{action:'record_departure'}>;
type Plan=Extract<FulfillmentCommandV1,{action:'prepare_plan'}>;
async function calendar(){
 const f=await nativeProgramFixture(engine);await f.source().record(f.owner,f.group());
 const store=()=>new FishingFulfillmentNativeV1(f.workspace,f.source(),f.billing(),programRing,programKey,programClock);
 const departure=(date:string,tripKind:'keys'|'local',childCapacity=2):Departure=>({version:FULFILLMENT_V1,action:'record_departure',id:randomUUID(),groupId:f.groupId,
  operationId:randomUUID(),expectedRevision:0,fields:{state:'scheduled',tripKind,startsAt:date+'T13:00:00.000Z',endsAt:date+'T23:00:00.000Z',timeZone:'America/New_York',fullDay:true,childCapacity,
   venueSource:{id:'SYNTHETIC-PLANNING-NOT-VENUE-APPROVAL',sha256:'a'.repeat(64)},capacitySource:{id:'SYNTHETIC-PLANNING-NOT-SAFETY-APPROVAL',sha256:'b'.repeat(64)},
   planningContext:{location:'SYNTHETIC owner-entered Florida meeting place',details:'SYNTHETIC prospective plan; legal, staffing, vehicle and operating approval remain separate.'}}});
 return {...f,store,departure};
}
async function planned(capacity=2){
 const f=await calendar(),first=randomUUID(),second=randomUUID(),later=randomUUID();
 await f.source().record(f.owner,f.lesson(first,1,'2035-01-31T21:30:00Z'));
 await f.source().record(f.owner,f.lesson(second,2,'2035-02-07T21:30:00Z'));
 await f.source().record(f.owner,f.lesson(later,3,'2035-02-15T21:00:00Z'));
 await f.source().record(f.owner,f.progression(0,'2035-01-31T00:00:00Z'));
 await f.source().record(f.owner,f.progression(1,'2035-02-15T00:00:00Z','verified_catchup'));
 const offer=f.offer([first,later]),created=await f.billing().createAnchoredOffer(f.owner,offer);
 const keys=f.departure('2035-02-18','keys',capacity),local=f.departure('2035-02-25','local',capacity);
 await f.store().recordDeparture(f.owner,keys);await f.store().recordDeparture(f.owner,local);
 const command:Plan={version:FULFILLMENT_V1,action:'prepare_plan',quoteId:offer.id,operationId:randomUUID(),expectedRevision:0,expectedQuoteRevision:1,
  children:created.quote.lines.map(line=>({lineId:line.id,keys:{id:keys.id,expectedRevision:1},local:{id:local.id,expectedRevision:1}}))};
 return {...f,first,offer,created,keys,local,command};
}
async function plans(workspace:string){return (await engine.query('SELECT revision FROM ls_fishing_billing.fulfillment_heads WHERE workspace_id=$1 AND kind=\'plan\'',[workspace])).rows;}
it('stores actual per-child rolling-period Keys/local plans and reloads their exact native source without granting money or seats',async()=>{
 const f=await planned(),saved=await f.store().preparePlan(f.owner,f.command);expect(saved.record.kind).toBe('plan');
 if(saved.record.kind!=='plan')throw Error('EXPECTED_PLAN');
 expect(saved.record.snapshot.classification).toBe('prospective_plan_not_reserved_or_paid');
 expect(saved.record.snapshot.children.map(child=>child.period.endsAt)).toEqual(['2035-02-28T21:30:00.000Z','2035-03-15T20:00:00.000Z']);
 expect(saved.record.snapshot.children.map(child=>child.firstEligibleLesson.startsAt)).toEqual(['2035-01-31T21:30:00Z','2035-02-15T21:00:00Z']);
 expect(saved.record.snapshot.children.every(child=>child.keys.id===f.keys.id&&child.local.id===f.local.id)).toBe(true);
 expect(await f.store().readPlan(f.owner,f.offer.id)).toEqual({version:FULFILLMENT_V1,classification:'historical_plan_not_eligibility',plan:{record:saved.record,digest:saved.digest},departureSourceState:'unchanged',changedDepartureIds:[]});
 const calendar=await f.store().readDepartures(f.owner,f.groupId);expect(calendar.classification).toBe('owner_entered_planning_not_operating_authority');expect(calendar.departures).toHaveLength(2);
 expect((await f.billing().readAnchoredOffer(f.owner,f.offer.id)).quote).toEqual(f.created.quote);
 expect((await engine.query('SELECT * FROM ls_fishing_billing.obligations WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
 expect(f.family).toMatchObject({guardianVerified:false,financialAcceptance:false,outboundEligible:false});
});
it('rejects the whole sibling plan when one shared departure has too few declared child places',async()=>{
 const f=await planned(1);await expect(f.store().preparePlan(f.owner,f.command)).rejects.toThrow('CONFLICT');expect(await plans(f.workspace)).toEqual([]);
 expect((await engine.query("SELECT * FROM ls_fishing_billing.fulfillment_versions WHERE workspace_id=$1 AND kind='plan'",[f.workspace])).rows).toHaveLength(0);
});
it('requires every quoted child, both correct trip kinds, current revisions and the whole trip inside that child period',async()=>{
 const f=await planned();
 await expect(f.store().preparePlan(f.owner,{...f.command,children:f.command.children.slice(1)})).rejects.toThrow('CONFLICT');
 await expect(f.store().preparePlan(f.owner,{...f.command,children:f.command.children.map(c=>({...c,keys:c.local}))})).rejects.toThrow('CONFLICT');
 await expect(f.store().preparePlan(f.owner,{...f.command,children:f.command.children.map(c=>({...c,keys:{...c.keys,expectedRevision:2}}))})).rejects.toThrow('CONFLICT');
 const outside=f.departure('2035-03-04','keys');await f.store().recordDeparture(f.owner,outside);
 await expect(f.store().preparePlan(f.owner,{...f.command,children:f.command.children.map(c=>({...c,keys:{id:outside.id,expectedRevision:1}}))})).rejects.toThrow('CONFLICT');
 // The public schema requires actual native periods, never caller overrides.
 await expect(f.store().preparePlan(f.owner,{...f.command,periodEndsAt:'2035-02-25T14:00:00Z'})).rejects.toThrow();
 expect(await plans(f.workspace)).toEqual([]);
});
it('requires the whole departure to finish within the actual native child period',async()=>{
 const f=await calendar(),lesson=randomUUID();await f.source().record(f.owner,f.lesson(lesson,1,'2035-01-04T21:30:00Z'));
 for(const index of [0,1])await f.source().record(f.owner,f.progression(index,'2035-01-04T00:00:00Z'));
 const offer=f.offer([lesson,lesson]),created=await f.billing().createAnchoredOffer(f.owner,offer);
 const keys=f.departure('2035-02-04','keys'),local=f.departure('2035-01-28','local');
 await f.store().recordDeparture(f.owner,keys);await f.store().recordDeparture(f.owner,local);
 expect(created.quote.lines.every(line=>line.period.endsAt==='2035-02-04T21:30:00.000Z')).toBe(true);
 await expect(f.store().preparePlan(f.owner,{version:FULFILLMENT_V1,action:'prepare_plan',quoteId:offer.id,operationId:randomUUID(),expectedRevision:0,expectedQuoteRevision:1,
  children:created.quote.lines.map(line=>({lineId:line.id,keys:{id:keys.id,expectedRevision:1},local:{id:local.id,expectedRevision:1}}))})).rejects.toThrow('CONFLICT');
 expect(await plans(f.workspace)).toEqual([]);
});
it('allows at most four ordinary Sundays, prevents two trips on one Sunday and never invents a fifth outing',async()=>{
 const f=await calendar();for(const date of ['2035-04-01','2035-04-08','2035-04-15','2035-04-22'])await f.store().recordDeparture(f.owner,f.departure(date,'keys'));
 await expect(f.store().recordDeparture(f.owner,f.departure('2035-04-29','local'))).rejects.toThrow('CONFLICT');
 await expect(f.store().recordDeparture(f.owner,f.departure('2035-04-08','local'))).rejects.toThrow('CONFLICT');
 await expect(f.store().recordDeparture(f.owner,f.departure('2035-04-09','local'))).rejects.toThrow();
 expect((await f.store().readDepartures(f.owner,f.groupId)).departures).toHaveLength(4);
});
it('preserves original operation replay and immutable plan after revision, quote issue and departure cancellation',async()=>{
 const f=await planned(),saved=await f.store().preparePlan(f.owner,f.command);
 const revised={...f.command,operationId:randomUUID(),expectedRevision:1};await f.store().preparePlan(f.owner,revised);
 await f.billing().issueAnchoredOffer(f.owner,{operationId:randomUUID(),quoteId:f.offer.id,expectedVersion:1});
 await f.store().recordDeparture(f.owner,{...f.keys,operationId:randomUUID(),expectedRevision:1,fields:{...f.keys.fields,state:'cancelled'}});
 expect(await f.store().preparePlan(f.owner,f.command)).toEqual({...saved,replayed:true});
 const reloaded=await f.store().readPlan(f.owner,f.offer.id);expect(reloaded.departureSourceState).toBe('changed');expect(reloaded.changedDepartureIds).toEqual([f.keys.id]);
 expect(reloaded.plan.record.kind==='plan'&&reloaded.plan.record.snapshot.children[0]!.keys.fields.state).toBe('scheduled');
 await expect(f.store().preparePlan(f.owner,{...revised,operationId:randomUUID(),expectedRevision:2,expectedQuoteRevision:2})).rejects.toThrow('CONFLICT');
 expect(await plans(f.workspace)).toEqual([{revision:2}]);
});
it('rechecks actual first-lesson/progression source for new plans and retains historical plan data',async()=>{
 const f=await planned();await f.store().preparePlan(f.owner,f.command);
 await f.source().record(f.owner,f.lesson(f.first,1,'2035-01-31T21:30:00Z',1,'cancelled'));
 await expect(f.store().preparePlan(f.owner,{...f.command,operationId:randomUUID(),expectedRevision:1})).rejects.toThrow('CONFLICT');
 expect((await f.store().readPlan(f.owner,f.offer.id)).plan.record.revision).toBe(1);
});
it('requires the actual configured native owner and refuses demo or cross-workspace planning',async()=>{
 const f=await planned();await expect(f.store().recordDeparture(f.parent,f.departure('2035-03-04','keys'))).rejects.toThrow('FORBIDDEN');
 await expect(f.store().preparePlan(f.parent,f.command)).rejects.toThrow('UNAVAILABLE');
 const foreign=await calendar();await expect(foreign.store().readDepartures(foreign.owner,f.groupId)).rejects.toThrow('NOT_FOUND');
 await engine.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)',[f.workspace,'ls-owner-20350102',f.owner.id]);
 await engine.query('INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[f.workspace,f.owner.id,'ls-owner-20350102','SYNTHETIC-fulfillment']);
 await expect(f.store().preparePlan(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');expect(await plans(f.workspace)).toEqual([]);
});
it('recovers the same operation after unknown committed departure and plan outcomes without duplicate versions',async()=>{
 const f=await planned(),departure=f.departure('2035-03-04','keys');let lost=true;
 const original=f.db.transaction.bind(f.db);
 vi.spyOn(f.db,'transaction').mockImplementation(async work=>{const result=await original(work);if(lost){lost=false;throw new AppError('CONFLICT');}return result;});
 await expect(f.store().recordDeparture(f.owner,departure)).rejects.toThrow('UNAVAILABLE');expect((await f.store().recordDeparture(f.owner,departure)).replayed).toBe(true);
 lost=true;await expect(f.store().preparePlan(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');expect((await f.store().preparePlan(f.owner,f.command)).replayed).toBe(true);
 expect((await engine.query('SELECT operation_id FROM ls_fishing_billing.fulfillment_versions WHERE workspace_id=$1 AND operation_id=ANY($2::uuid[])',[f.workspace,[departure.operationId,f.command.operationId]])).rows).toHaveLength(2);
});
it('enforces encrypted history, monotonic heads, original actor/operation binding and integrity on native reload',async()=>{
 const f=await planned();await f.store().preparePlan(f.owner,f.command);
 await expect(f.store().preparePlan(f.owner,{...f.command,expectedRevision:1})).rejects.toThrow('CONFLICT');
 await expect(engine.query('UPDATE ls_fishing_billing.fulfillment_versions SET payload_ciphertext=$2 WHERE workspace_id=$1',[f.workspace,'CORRUPTION'])).rejects.toThrow('FISHING_FULFILLMENT_IMMUTABLE');
 await expect(engine.query('DELETE FROM ls_fishing_billing.fulfillment_heads WHERE workspace_id=$1',[f.workspace])).rejects.toThrow('FISHING_FULFILLMENT_IMMUTABLE');
 await expect(engine.query('UPDATE ls_fishing_billing.fulfillment_heads SET revision=1 WHERE workspace_id=$1',[f.workspace])).rejects.toThrow('FISHING_FULFILLMENT_HEAD_CONFLICT');
 await expect(engine.exec('TRUNCATE ls_fishing_billing.fulfillment_heads,ls_fishing_billing.fulfillment_versions')).rejects.toThrow('FISHING_FULFILLMENT_IMMUTABLE');
 const original=f.db.transaction.bind(f.db);
 vi.spyOn(f.db,'transaction').mockImplementation(work=>original(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,v);return sql.includes('FROM ls_fishing_billing.fulfillment_heads h')?rows.map(row=>({...row,ciphertext:'CORRUPTION'})):rows;
 }})));
 await expect(f.store().readPlan(f.owner,f.offer.id)).rejects.toThrow('UNAVAILABLE');
});
it('closes retained transaction callbacks and rolls back any attempt to change the original financial quote',async()=>{
 const f=await planned();let retained:SqlSession|undefined;
 await f.billing().withAnchoredPlanning(f.owner,f.offer.id,async(c,data)=>{retained=c.tx;expect(Object.isFrozen(data.quote.lines)).toBe(true);return data.classification;});
 await expect(async()=>retained!.query('SELECT 1')).rejects.toThrow('UNAVAILABLE');
 await f.source().withOwnerTransaction(f.owner,async c=>{retained=c.tx;});await expect(async()=>retained!.query('SELECT 1')).rejects.toThrow('UNAVAILABLE');
 await expect(f.billing().withAnchoredPlanning(f.owner,f.offer.id,async c=>{await c.tx.query('UPDATE ls_fishing_billing.quotes SET revision=revision+1 WHERE workspace_id=$1 AND id=$2',[f.workspace,f.offer.id]);})).rejects.toThrow('UNAVAILABLE');
 expect((await f.billing().readAnchoredOffer(f.owner,f.offer.id)).quote).toEqual(f.created.quote);
});
it('rolls back a whole new plan when the actual owner session is revoked before commit',async()=>{
 const f=await planned(),original=f.db.transaction.bind(f.db);
 const revoked:IdentityStore={transaction:work=>original(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,v);if(sql.startsWith('INSERT INTO ls_fishing_billing.fulfillment_versions'))await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,programNow]);return rows;
 }}))};
 vi.spyOn(f.db,'transaction').mockImplementation(revoked.transaction);
 await expect(f.store().preparePlan(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');expect(await plans(f.workspace)).toEqual([]);
 expect((await engine.query<{revoked_at:Date|null}>('SELECT revoked_at FROM ls_identity.sessions WHERE token_digest=$1',[f.owner.sessionDigest])).rows[0]!.revoked_at).toBe(null);
});
