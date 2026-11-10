import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,nativeProgramFixture,programNow} from '../fixtures/fishing-native-program-v3.ts';
import {PROGRAM_SOURCE_V3} from '../../src/features/fishing-billing/program-source-contract-v3.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import {AppError} from '../../src/lib/errors.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Real native SQL transaction rejection vs post-COMMIT driver failure; serial
// disposable PGlite only, not provider/production/PostgreSQL competition proof.
it('returns correlated known rejection only after the actual stale-CAS or overlap callback rolls back',async()=>{
 const f=await nativeProgramFixture(engine),group=f.group();await f.source().record(f.owner,group);
 const stale={...group,operationId:randomUUID()};
 expect(await f.source().recordOutcome(f.owner,stale)).toEqual({version:PROGRAM_SOURCE_V3,workspaceId:f.workspace,actorId:f.owner.id,command:stale,state:'rejected',code:'CONFLICT'});
 const first=f.lesson(randomUUID(),1,'2035-01-31T21:00:00Z');await f.source().record(f.owner,first);
 const overlap=f.lesson(randomUUID(),2,'2035-01-31T21:30:00Z');
 expect(await f.source().recordOutcome(f.owner,overlap)).toMatchObject({command:overlap,state:'rejected',code:'CONFLICT'});
 expect((await engine.query('SELECT operation_id FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1 AND operation_id=ANY($2::uuid[])',[f.workspace,[stale.operationId,overlap.operationId]])).rows).toHaveLength(0);
 // The longstanding record method still throws its original known rejection.
 await expect(f.source().record(f.owner,stale)).rejects.toThrow('CONFLICT');
});
it('returns known rejection for actual owner/session denial and rolls back a write revoked before commit',async()=>{
 const f=await nativeProgramFixture(engine),group=f.group();
 expect(await f.source().recordOutcome(f.parent,group)).toMatchObject({actorId:f.parent.id,command:group,state:'rejected',code:'FORBIDDEN'});
 const revoked:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,v);if(sql.startsWith('INSERT INTO ls_fishing_billing.program_source_versions'))await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,programNow]);return rows;
 }}))};
 expect(await f.source(revoked).recordOutcome(f.owner,group)).toMatchObject({state:'rejected',code:'UNAUTHENTICATED',command:group});
 expect((await engine.query('SELECT * FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
 expect((await f.source().recordOutcome(f.owner,group)).state).toBe('recorded');
});
it('does not classify post-COMMIT typed or ordinary driver errors as known rejections and recovers the same operation',async()=>{
 const f=await nativeProgramFixture(engine);await f.source().record(f.owner,f.group());
 for(const [index,error] of [new AppError('CONFLICT'),new AppError('FORBIDDEN'),new Error('CONFLICT'),{code:'CONFLICT'}].entries()){
  const command=f.lesson(randomUUID(),index+1,`2035-02-0${index+1}T21:00:00Z`);
  const uncertain:IdentityStore={transaction:async work=>{await f.db.transaction(work);throw error;}};
  await expect(f.source(uncertain).recordOutcome(f.owner,command)).rejects.toThrow('UNAVAILABLE');
  const recovered=await f.source().recordOutcome(f.owner,command);expect(recovered).toMatchObject({state:'recorded',command,receipt:{replayed:true,record:{command}}});
  expect((await engine.query('SELECT * FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,command.operationId])).rows).toHaveLength(1);
 }
});
it('treats adapter replacement errors and untyped callback failure as unknown rather than guessing from an error code',async()=>{
 const f=await nativeProgramFixture(engine),group=f.group();await f.source().record(f.owner,group);
 const stale={...group,operationId:randomUUID()};
 const replaced:IdentityStore={transaction:async work=>{try{return await f.db.transaction(work);}catch{throw new AppError('CONFLICT');}}};
 await expect(f.source(replaced).recordOutcome(f.owner,stale)).rejects.toThrow('UNAVAILABLE');
 const bad:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  if(sql.startsWith('INSERT INTO ls_fishing_billing.program_source_versions'))throw {code:'CONFLICT'};return tx.query<T>(sql,v);
 }}))};
 const lesson=f.lesson(randomUUID(),1,'2035-02-01T21:00:00Z');await expect(f.source(bad).recordOutcome(f.owner,lesson)).rejects.toThrow('UNAVAILABLE');
 expect((await engine.query('SELECT * FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,lesson.operationId])).rows).toHaveLength(0);
});
