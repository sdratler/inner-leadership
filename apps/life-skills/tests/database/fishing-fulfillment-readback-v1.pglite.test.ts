import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,nativeProgramFixture,programRing,programKey,programClock} from '../fixtures/fishing-native-program-v3.ts';
import {FishingFulfillmentNativeV1} from '../../src/features/fishing-billing/fulfillment-native-v1.ts';
import {FULFILLMENT_V1,type FulfillmentCommandV1} from '../../src/features/fishing-billing/fulfillment-contract-v1.ts';
import {readDepartureInTransactionV1 as readDeparture,readFulfillmentInTransactionV1 as read,fulfillmentCurrentSelectV1,decodeFulfillmentRowV1,fulfillmentAadV1,type FulfillmentRowV1} from '../../src/features/fishing-billing/fulfillment-readback-v1.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import type {SqlSession} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_fulfillment_v1.sql','utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native owner writer, SQL, immutable records and crypto. Synthetic
// DATA proof only: no genuine guest/legal/global-capacity/paid admission and
// no ordinary PostgreSQL concurrency, provider, communication or live proof.
async function departure(){
 const f=await nativeProgramFixture(engine);await f.source().record(f.owner,f.group());
 const store=new FishingFulfillmentNativeV1(f.workspace,f.source(),f.billing(),programRing,programKey,programClock);
 const command:Extract<FulfillmentCommandV1,{action:'record_departure'}>={version:FULFILLMENT_V1,action:'record_departure',id:randomUUID(),groupId:f.groupId,
  operationId:randomUUID(),expectedRevision:0,fields:{state:'scheduled',tripKind:'keys',startsAt:'2035-02-18T13:00:00.000Z',endsAt:'2035-02-18T23:00:00.000Z',timeZone:'America/New_York',fullDay:true,childCapacity:2,
   venueSource:{id:'SYNTHETIC-PLANNING-NOT-VENUE-APPROVAL',sha256:'a'.repeat(64)},capacitySource:{id:'SYNTHETIC-PLANNING-NOT-SAFETY-APPROVAL',sha256:'b'.repeat(64)},
   planningContext:{location:'SYNTHETIC Florida meeting place',details:'SYNTHETIC planning only, not operational permission.'}}};
 const saved=await store.recordDeparture(f.owner,command);return {...f,store,command,saved};
}
async function sourceRow(f:Awaited<ReturnType<typeof departure>>){
 return f.db.transaction(async tx=>(await tx.query<FulfillmentRowV1>(fulfillmentCurrentSelectV1+" WHERE h.workspace_id=$1 AND h.kind='departure' AND h.entity_id=$2",[f.workspace,f.command.id]))[0]!);
}
it('fulfillment-readback-v1 reads only the selected actual departure in the same actor-free transaction without enumerating other plans or groups',async()=>{
 const f=await departure(),trace:{sql:string;values:readonly unknown[]}[]=[];
 const actual=await f.db.transaction(tx=>readDeparture({workspaceId:f.workspace,tx:{query:<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  trace.push({sql,values});return tx.query<T>(sql,values);}}},f.workspace,f.groupId,f.command.id,programRing,programKey));
 expect(actual).toEqual({record:f.saved.record,digest:f.saved.digest});expect(trace).toHaveLength(1);
 expect(trace[0]!.values).toEqual([f.workspace,'departure',f.command.id]);expect(trace[0]!.sql.endsWith('LIMIT 2 FOR SHARE OF h')).toBe(true);
 expect((await engine.query('SELECT line_id FROM ls_fishing_billing.obligations WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('fulfillment-readback-v1 denies wrong workspace malformed scope and short keys before SQL with no cross-workspace fallback',async()=>{
 const f=await departure(),other=await nativeProgramFixture(engine),query=vi.fn(async()=>[]),c={workspaceId:other.workspace,tx:{query} as SqlSession};
 await expect(readDeparture(c,f.workspace,f.groupId,f.command.id,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(readDeparture(c,other.workspace,'bad',f.command.id,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(read(c,other.workspace,'departure','bad',programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(read(c,other.workspace,'departure',f.command.id,programRing,'short')).rejects.toThrow('UNAVAILABLE');expect(query).not.toHaveBeenCalled();
 expect(await other.db.transaction(tx=>readDeparture({workspaceId:other.workspace,tx},other.workspace,f.groupId,f.command.id,programRing,programKey))).toBeNull();
});
it('fulfillment-readback-v1 authenticates every origin/index scope and both keys instead of trusting decrypted planning JSON',async()=>{
 const f=await departure(),row=await sourceRow(f);
 const changes:Partial<FulfillmentRowV1>[]=[{workspaceId:randomUUID()},{kind:'plan'},{recordKind:'plan'},{id:randomUUID()},{recordId:randomUUID()},
  {revision:2},{recordRevision:2},{groupId:randomUUID()},{quoteId:randomUUID()},{operationId:randomUUID()},{actorId:randomUUID()},
  {recordedAt:new Date('2035-01-03T15:00:00Z')},{requestDigest:'a'.repeat(64)},{headDigest:'b'.repeat(64)},{digest:'c'.repeat(64)},{previousDigest:'d'.repeat(64)},{ciphertext:'CORRUPT'}];
 expect(decodeFulfillmentRowV1(row,f.workspace,programRing,programKey).record).toEqual(f.saved.record);
 for(const change of changes)expect(()=>decodeFulfillmentRowV1({...row,...change},f.workspace,programRing,programKey)).toThrow('UNAVAILABLE');
 expect(()=>decodeFulfillmentRowV1(row,f.workspace,programRing,'WRONG-INTEGRITY-KEY-OF-SUFFICIENT-LENGTH')).toThrow('UNAVAILABLE');
 expect(()=>decodeFulfillmentRowV1(row,f.workspace,{activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,9)}},programKey)).toThrow('UNAVAILABLE');
});
it('fulfillment-readback-v1 denies reencrypted changed capacity without the immutable keyed source fingerprint',async()=>{
 const f=await departure(),row=await sourceRow(f),aad=fulfillmentAadV1(f.workspace,'departure',f.command.id,1);
 const record=JSON.parse(unseal(row.ciphertext,aad,programRing));record.command.fields.childCapacity=10;
 expect(()=>decodeFulfillmentRowV1({...row,ciphertext:seal(JSON.stringify(record),aad,programRing)},f.workspace,programRing,programKey)).toThrow('UNAVAILABLE');
 expect(decodeFulfillmentRowV1(await sourceRow(f),f.workspace,programRing,programKey).record).toEqual(f.saved.record);
});
it('fulfillment-readback-v1 correlates exact entity kind id and group and fails on duplicate rows',async()=>{
 const f=await departure(),row=await sourceRow(f),c={workspaceId:f.workspace,tx:{query:async<T extends object>()=>[row] as unknown as T[]} as SqlSession};
 await expect(read(c,f.workspace,'plan',f.command.id,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(read(c,f.workspace,'departure',randomUUID(),programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(readDeparture(c,f.workspace,randomUUID(),f.command.id,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 const duplicates={workspaceId:f.workspace,tx:{query:async<T extends object>()=>[row,row] as unknown as T[]} as SqlSession};
 await expect(readDeparture(duplicates,f.workspace,f.groupId,f.command.id,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
});
it('fulfillment-readback-v1 reloads a cancelled current departure and preserves original history without inferring an entitlement',async()=>{
 const f=await departure(),original=await sourceRow(f);
 await f.store.recordDeparture(f.owner,{...f.command,operationId:randomUUID(),expectedRevision:1,fields:{...f.command.fields,state:'cancelled'}});
 const current=await f.db.transaction(tx=>readDeparture({workspaceId:f.workspace,tx},f.workspace,f.groupId.toUpperCase(),f.command.id.toUpperCase(),programRing,programKey));
 expect(current!.record).toMatchObject({revision:2,previousDigest:original.digest,command:{fields:{state:'cancelled'}}});
 expect(decodeFulfillmentRowV1(original,f.workspace,programRing,programKey).record).toEqual(f.saved.record);
 expect((await engine.query('SELECT line_id FROM ls_fishing_billing.obligations WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('fulfillment-readback-v1 cannot reuse the actual owner composition transaction after callback closure',async()=>{
 const f=await departure();let borrowed:SqlSession|undefined;
 await f.source().withOwnerTransaction(f.owner,async c=>{borrowed=c.tx;expect(await readDeparture(c,f.workspace,f.groupId,f.command.id,programRing,programKey)).not.toBeNull();});
 if(!borrowed)throw Error('EXPECTED_ACTUAL_TX');
 await expect(readDeparture({workspaceId:f.workspace,tx:borrowed},f.workspace,f.groupId,f.command.id,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
});
