import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,nativeProgramFixture,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {readProgramSourceInTransactionV3 as read,readProgramLessonsInTransactionV3 as lessons,programSourceSelectV3,programSourceAadV3,decodeProgramSourceRowV3,type ProgramSourceRowV3} from '../../src/features/fishing-billing/program-source-readback-v3.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import type {SqlSession} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Real SQL, native owner source writers, AEAD and keyed provenance, disposable
// synthetic data only. This DATA layer grants no guest/family/legal admission.
// Existing owner tests cover genuine entry guards; PGlite is not PG competition.
async function scheduled(){
 const f=await nativeProgramFixture(engine),id=randomUUID();await f.source().record(f.owner,f.group());
 await f.source().record(f.owner,f.lesson(id,1,'2035-01-31T21:30:00Z'));
 await f.source().record(f.owner,f.progression(0,'2035-01-31T00:00:00Z'));
 await f.source().record(f.owner,f.progression(1,'2035-01-31T00:00:00Z'));
 return {...f,id};
}
async function sourceRow(f:Awaited<ReturnType<typeof scheduled>>){
 return f.db.transaction(async tx=>(await tx.query<ProgramSourceRowV3>(programSourceSelectV3+" WHERE h.workspace_id=$1 AND h.group_id=$2 AND h.kind='group' AND h.source_id=$2",[f.workspace,f.groupId]))[0]!);
}
it('programme-readback-v3 reads actual keyed sources in one actor-free transaction without enumerating other child progressions',async()=>{
 const f=await scheduled(),selected=f.family.command.selection.children[0]!.nativeChildId,trace:{sql:string;values:readonly unknown[]}[]=[];
 const result=await f.db.transaction(async tx=>{
  const bound:SqlSession={query:<T extends object>(sql:string,values:readonly unknown[]=[])=>{trace.push({sql,values});return tx.query<T>(sql,values);}};
  const c={workspaceId:f.workspace,tx:bound};
  return {group:await read(c,f.workspace,f.groupId,'group',f.groupId,programRing,programKey),
   lessons:await lessons(c,f.workspace,f.groupId,programRing,programKey),
   child:await read(c,f.workspace,f.groupId,'progression',selected,programRing,programKey)};
 });
 expect(result.group).toEqual(await f.source().read(f.owner,f.groupId,'group',f.groupId));
 expect(result.child).toEqual(await f.source().read(f.owner,f.groupId,'progression',selected));
 expect(result.lessons.map(s=>s.record.command.id)).toEqual([f.id]);
 expect(trace).toHaveLength(3);expect(trace.every(q=>q.sql.startsWith('SELECT ')&&q.sql.endsWith('FOR SHARE OF h'))).toBe(true);
 expect(trace[2]!.values).toEqual([f.workspace,f.groupId,'progression',selected]);
 expect(trace.some(q=>q.sql.includes("h.kind='progression'"))).toBe(false);
 expect((await engine.query('SELECT line_id FROM ls_fishing_billing.obligations WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('programme-readback-v3 denies mismatched workspace or malformed scope before lookup and never falls back across workspaces',async()=>{
 const f=await scheduled(),other=await nativeProgramFixture(engine),query=vi.fn(async()=>[]),c={workspaceId:other.workspace,tx:{query} as SqlSession};
 await expect(read(c,f.workspace,f.groupId,'group',f.groupId,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(read(c,other.workspace,'bad','group',f.groupId,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(read(c,other.workspace,f.groupId,'group','bad',programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(lessons(c,other.workspace,f.groupId,programRing,'short')).rejects.toThrow('UNAVAILABLE');expect(query).not.toHaveBeenCalled();
 expect(await other.db.transaction(tx=>read({workspaceId:other.workspace,tx},other.workspace,f.groupId,'group',f.groupId,programRing,programKey))).toBeNull();
 expect(await other.db.transaction(tx=>lessons({workspaceId:other.workspace,tx},other.workspace,f.groupId,programRing,programKey))).toEqual([]);
});
it('programme-readback-v3 rejects corruption of every authenticated origin/index field and wrong crypto/integrity keys',async()=>{
 const f=await scheduled(),row=await sourceRow(f);
 const changes:Partial<ProgramSourceRowV3>[]=[{recordWorkspace:randomUUID()},{groupId:randomUUID()},{recordGroup:randomUUID()},{kind:'lesson'},{recordKind:'lesson'},
  {id:randomUUID()},{recordId:randomUUID()},{revision:2},{recordRevision:2},{operationId:randomUUID()},{recordedBy:randomUUID()},
  {recordedAt:new Date('2035-01-03T15:00:00Z')},{requestDigest:'a'.repeat(64)},{headDigest:'b'.repeat(64)},{digest:'c'.repeat(64)},{previousDigest:'d'.repeat(64)},{ciphertext:'CORRUPT'}];
 expect(decodeProgramSourceRowV3(row,f.workspace,programRing,programKey).record.command.id).toBe(f.groupId);
 for(const change of changes)expect(()=>decodeProgramSourceRowV3({...row,...change},f.workspace,programRing,programKey)).toThrow('UNAVAILABLE');
 expect(()=>decodeProgramSourceRowV3(row,f.workspace,programRing,'WRONG-INTEGRITY-KEY-OF-SUFFICIENT-LENGTH')).toThrow('UNAVAILABLE');
 expect(()=>decodeProgramSourceRowV3(row,f.workspace,{activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,9)}},programKey)).toThrow('UNAVAILABLE');
});
it('programme-readback-v3 rejects validly reencrypted changed source bytes without their original keyed fingerprint',async()=>{
 const f=await scheduled(),row=await sourceRow(f),aad=programSourceAadV3(f.workspace,f.groupId,'group',f.groupId,row.revision);
 const record=JSON.parse(unseal(row.ciphertext,aad,programRing));record.command.fields.location='CHANGED SYNTHETIC LOCATION';
 expect(()=>decodeProgramSourceRowV3({...row,ciphertext:seal(JSON.stringify(record),aad,programRing)},f.workspace,programRing,programKey)).toThrow('UNAVAILABLE');
 expect(decodeProgramSourceRowV3(await sourceRow(f),f.workspace,programRing,programKey).record).not.toEqual(record);
});
it('programme-readback-v3 binds returned rows to the requested group kind and exact child instead of accepting another valid record',async()=>{
 const f=await scheduled(),row=await sourceRow(f),c={workspaceId:f.workspace,tx:{query:async<T extends object>()=>[row] as unknown as T[]} as SqlSession};
 await expect(read(c,f.workspace,f.groupId,'lesson',f.id,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(read(c,f.workspace,f.groupId,'group',randomUUID(),programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(read(c,f.workspace,randomUUID(),'group',f.groupId,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await expect(lessons(c,f.workspace,f.groupId,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
});
it('programme-readback-v3 fails closed on duplicate or truncated rows and authenticates a cancelled lesson before filtering',async()=>{
 const f=await scheduled(),row=await sourceRow(f);
 const duplicated={workspaceId:f.workspace,tx:{query:async<T extends object>()=>[row,row] as unknown as T[]} as SqlSession};
 await expect(read(duplicated,f.workspace,f.groupId,'group',f.groupId,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 const truncated={workspaceId:f.workspace,tx:{query:async<T extends object>()=>Array.from({length:1001},()=>row) as unknown as T[]} as SqlSession};
 await expect(lessons(truncated,f.workspace,f.groupId,programRing,programKey)).rejects.toThrow('UNAVAILABLE');
 await f.source().record(f.owner,f.lesson(f.id,1,'2035-01-31T21:30:00Z',1,'cancelled'));
 const actual=await f.db.transaction(tx=>lessons({workspaceId:f.workspace,tx},f.workspace,f.groupId,programRing,programKey));
 expect(actual).toHaveLength(1);expect(actual[0]!.record.command).toMatchObject({kind:'lesson',fields:{state:'cancelled'}});
 await expect(f.db.transaction(tx=>lessons({workspaceId:f.workspace,tx:{query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>
  (await tx.query<T>(sql,v)).map(r=>({...r,ciphertext:'CORRUPT CANCELLED LESSON'}))}},f.workspace,f.groupId,programRing,programKey))).rejects.toThrow('UNAVAILABLE');
});
it('programme-readback-v3 reloads the exact current native revision while preserving the original immutable source',async()=>{
 const f=await scheduled(),original=await sourceRow(f),command=f.group();
 await f.source().record(f.owner,{...command,expectedRevision:1,fields:{...command.fields as object,location:'SYNTHETIC revised planning site'}});
 const current=await f.db.transaction(tx=>read({workspaceId:f.workspace,tx},f.workspace,f.groupId.toUpperCase(),'group',f.groupId.toUpperCase(),programRing,programKey));
 expect(current!.record.revision).toBe(2);expect(current!.record.previousDigest).toBe(original.digest);
 expect(decodeProgramSourceRowV3(original,f.workspace,programRing,programKey).record.revision).toBe(1);
 expect(current!.record.command).toMatchObject({kind:'group',fields:{location:'SYNTHETIC revised planning site'}});
});
