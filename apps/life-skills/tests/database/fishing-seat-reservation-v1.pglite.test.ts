import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {digest} from '../../src/features/contact-ops/server/digests.ts';
import {AppError} from '../../src/lib/errors.ts';
import {fishingSeatScopeV1,FishingSeatReservationNativeV1,type FishingSeatReservationAuthorityV1} from '../../src/features/fishing-billing/fishing-seat-reservation-native-v1.ts';
import type {ServiceOfferBindingV4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {verifyServiceOfferBindingV4} from '../../src/features/fishing-billing/guest-service-material-v4.ts';
import type {SeatResourceAdmissionV1} from '../../src/features/fishing-billing/fishing-seat-reservation-contract-v1.ts';
import type {BillingLedgerContext} from '../../src/features/fishing-billing/native.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing-seat-reservation-v1.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native family/source/V4 issuer + real in-memory SQL/crypto/locks.
// Capacity/current-target ports are SYNTHETIC and not operating/financial
// approval. Second-family material below is a pure scope fixture, not a real
// issued second quote/family. Serial PGlite does not prove PG competition.
async function setup(){
 const f=await serviceGuestFixtureV4(engine),pool=randomUUID(),outsideChild=randomUUID(),state={capacity:2,deny:false,denyAtTerminal:false,terminal:false,
  omit:false,changedPool:false,source:'a'.repeat(64),outside:false,now:'2035-01-02T15:02:00.000Z'};
 const admissions=(rs:Parameters<FishingSeatReservationAuthorityV1['resources']>[2]):SeatResourceAdmissionV1[]=>rs.map(resource=>({resource:{...resource},pools:[{id:state.changedPool?randomUUID():pool,capacity:state.capacity,
  source:{id:'SYNTHETIC-NOT-OPERATING-ADMISSION',sha256:state.source},outsideOccupants:state.outside?[{childId:outsideChild,startsAt:'2035-01-01T00:00:00.000Z',endsAt:'2035-04-01T00:00:00.000Z'}]:[]}]}));
 const authority:FishingSeatReservationAuthorityV1={target:async()=>{if(state.deny)throw new AppError('FORBIDDEN');},
  access:async(_c,_o,mode)=>{if(mode==='current'&&state.denyAtTerminal)throw new AppError('FORBIDDEN');},
  resources:async(_c,_o,rs)=>state.omit?admissions(rs).slice(1):admissions(rs)};
 const store=new FishingSeatReservationNativeV1(f.workspace,programRing,programKey,{now:()=>new Date(state.now)},authority);
 const tx=<T>(work:(c:BillingLedgerContext)=>Promise<T>)=>f.db.transaction(t=>work({tx:t,workspaceId:f.workspace,now:new Date(state.now)}));
 const reserve=(offer=f.quote.offer)=>tx(c=>store.reserveInTransaction(c,offer));
 return {...f,state,pool,authority,store,tx,reserve};
}
async function counts(w:string){return (await engine.query(`SELECT 'reservations' AS kind,count(*)::int AS count FROM ls_fishing_billing.seat_reservations WHERE workspace_id=$1
 UNION ALL SELECT 'claims',count(*)::int FROM ls_fishing_billing.seat_reservation_claims WHERE workspace_id=$1 ORDER BY kind`,[w])).rows;}
function otherFamily(original:ServiceOfferBindingV4){
 const o=structuredClone(original),m=o.material,f=m.financial,s=m.schedule.snapshot;
 f.quoteId=randomUUID();f.familyId=randomUUID();s.quoteId=f.quoteId;s.familyId=f.familyId;
 for(const line of f.lines){const old=line.id,child=s.children.find(c=>c.lineId===old)!;line.id=randomUUID();line.childId=randomUUID();child.lineId=line.id;child.childId=line.childId;
  child.firstEligibleLesson.familyId=f.familyId;child.firstEligibleLesson.childId=line.childId;}
 o.sha256=digest({domain:'service-issued-material/v4',material:m});return verifyServiceOfferBindingV4(o);
}
it('saves the complete sibling/global membership once, preserving distinct periods and no send clock or paid claim',async()=>{
 const f=await setup(),r=await f.reserve(),again=await f.reserve();
 expect(r.record.scope.children).toHaveLength(2);expect(new Set(r.record.scope.children.map(c=>c.period.startsAt)).size).toBe(2);
 expect(r.record.classification).toBe('native_provisional_membership_not_paid_or_operating_authority');expect(r.replayed).toBe(false);expect(again.replayed).toBe(true);expect(again.reference).toEqual(r.reference);
 expect(r.record.claims).toHaveLength(12);expect(await counts(f.workspace)).toEqual([{kind:'claims',count:12},{kind:'reservations',count:1}]);
 expect(JSON.stringify(r.record)).not.toMatch(/holdExpiresAt|paidAt|sentAt|paymentDeadline/);
});
it('rejects the whole second sibling family across shared global resources, with no partial reservation',async()=>{
 const f=await setup();await f.reserve();const before=await counts(f.workspace);
 await expect(f.reserve(otherFamily(f.quote.offer))).rejects.toThrow('CONFLICT');expect(await counts(f.workspace)).toEqual(before);
});
it('counts two separately bound family memberships together rather than treating each quote as its own pool',async()=>{
 const f=await setup();f.state.capacity=4;await f.reserve();const other=otherFamily(f.quote.offer);
 // RAW synthetic quote row solely for the native FK; not real second-family
 // origin/admission. The resource/permission ports remain synthetic above.
 await engine.query('INSERT INTO ls_fishing_billing.quotes(workspace_id,id,family_id,definition_id,revision,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,2,$5,$6)',
  [f.workspace,other.material.financial.quoteId,other.material.financial.familyId,f.quote.definition.id,'SYNTHETIC-NOT-ORIGIN-EVIDENCE',f.quote.createdAt]);
 await f.reserve(other);expect(await counts(f.workspace)).toEqual([{kind:'claims',count:24},{kind:'reservations',count:2}]);
 await expect(f.reserve(otherFamily(f.quote.offer))).rejects.toThrow('CONFLICT');
});
it('counts nonpaying founder/supervision occupants and does not treat the target10 or paid8 thresholds as capacity',async()=>{
 const f=await setup();f.state.outside=true;await expect(f.reserve()).rejects.toThrow('CONFLICT');
 expect(await counts(f.workspace)).toEqual([{kind:'claims',count:0},{kind:'reservations',count:0}]);
 f.state.capacity=3;expect((await f.reserve()).record.scope.children).toHaveLength(2);
});
it('rolls back every membership when terminal access is denied after the inserts',async()=>{
 const f=await setup();f.state.denyAtTerminal=true;await expect(f.reserve()).rejects.toThrow('FORBIDDEN');
 expect(await counts(f.workspace)).toEqual([{kind:'claims',count:0},{kind:'reservations',count:0}]);
});
it('denies missing resources and changing global pool mappings instead of assuming extra capacity',async()=>{
 const f=await setup();f.state.omit=true;await expect(f.reserve()).rejects.toThrow('UNAVAILABLE');f.state.omit=false;f.state.changedPool=true;
 await expect(f.reserve()).rejects.toThrow();expect(await counts(f.workspace)).toEqual([{kind:'claims',count:0},{kind:'reservations',count:0}]);
});
it('validates the actual immutable receipt/membership and never creates a missing receipt on history/replay',async()=>{
 const f=await setup(),r=await f.reserve(),before=await counts(f.workspace);
 await expect(f.tx(c=>f.store.validateInTransaction(c,f.quote.offer,{...r.reference,sha256:'f'.repeat(64)},'current'))).rejects.toThrow('FORBIDDEN');
 const other=otherFamily(f.quote.offer);await expect(f.tx(c=>f.store.validateInTransaction(c,other,r.reference,'history'))).rejects.toThrow('FORBIDDEN');
 expect(await counts(f.workspace)).toEqual(before);
 expect((await f.tx(c=>f.store.validateInTransaction(c,f.quote.offer,r.reference,'current'))).record).toEqual(r.record);
});
it('history remains readable after activities pass without silently reallocating seats or requiring future lessons',async()=>{
 const f=await setup(),r=await f.reserve(),before=await counts(f.workspace);f.state.now='2036-01-01T00:00:00.000Z';
 f.state.omit=true;expect((await f.tx(c=>f.store.validateInTransaction(c,f.quote.offer,r.reference,'history'))).record).toEqual(r.record);
 expect(await counts(f.workspace)).toEqual(before);f.state.deny=true;await expect(f.tx(c=>f.store.validateInTransaction(c,f.quote.offer,r.reference,'history'))).rejects.toThrow('FORBIDDEN');
});
it('detects current capacity/source changes and preserves the original blocking membership',async()=>{
 const f=await setup(),r=await f.reserve(),before=await counts(f.workspace);f.state.capacity=1;
 await expect(f.tx(c=>f.store.validateInTransaction(c,f.quote.offer,r.reference,'current'))).rejects.toThrow('CONFLICT');
 f.state.capacity=2;f.state.source='b'.repeat(64);await expect(f.reserve()).rejects.toThrow('CONFLICT');expect(await counts(f.workspace)).toEqual(before);
});
it('protects immutable membership and lock rows against update/delete/truncate',async()=>{
 const f=await setup();await f.reserve();
 for(const sql of ['DELETE FROM ls_fishing_billing.seat_reservations WHERE workspace_id=$1','DELETE FROM ls_fishing_billing.seat_reservation_claims WHERE workspace_id=$1','DELETE FROM ls_fishing_billing.seat_reservation_locks WHERE workspace_id=$1'])
  await expect(engine.query(sql,[f.workspace])).rejects.toThrow('FISHING_SEAT_RESERVATION_IMMUTABLE');
 await expect(engine.exec('TRUNCATE ls_fishing_billing.seat_reservation_claims')).rejects.toThrow('FISHING_SEAT_RESERVATION_IMMUTABLE');
});
it('rejects a cross-workspace context and a modified material hash before claiming a reservation',async()=>{
 const f=await setup();await expect(f.tx(c=>f.store.reserveInTransaction({...c,workspaceId:randomUUID() as typeof c.workspaceId},f.quote.offer))).rejects.toThrow('FORBIDDEN');
 await expect(f.reserve({...f.quote.offer,sha256:'f'.repeat(64)})).rejects.toThrow();expect(await counts(f.workspace)).toEqual([{kind:'claims',count:0},{kind:'reservations',count:0}]);
 expect(fishingSeatScopeV1(f.quote.offer).children).toHaveLength(2);
});
