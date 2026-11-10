import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,nativeProgramFixture,programNow,programRing,programKey,programClock} from '../fixtures/fishing-native-program-v3.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import {AppError} from '../../src/lib/errors.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual stored native Florida source and existing admitted inquiry/family/
// guest-owner classes. Disposable synthetic data, no injected lesson resolver.
// PGlite serializes transactions; this is not PostgreSQL competition/live proof.
async function scheduled(){
 const f=await nativeProgramFixture(engine),first=randomUUID(),second=randomUUID(),later=randomUUID();
 await f.source().record(f.owner,f.group());
 await f.source().record(f.owner,f.lesson(first,1,'2035-01-31T21:30:00Z'));
 await f.source().record(f.owner,f.lesson(second,2,'2035-02-07T21:30:00Z'));
 await f.source().record(f.owner,f.lesson(later,3,'2035-02-15T21:00:00Z'));
 await f.source().record(f.owner,f.progression(0,'2035-01-31T00:00:00Z'));
 await f.source().record(f.owner,f.progression(1,'2035-02-15T00:00:00Z','verified_catchup'));
 return {...f,first,second,later};
}
it('real-program-source creates and issues staggered sibling offers through actual SQL source and native family mapping',async()=>{
 const f=await scheduled(),command=f.offer([f.first,f.later]),created=await f.billing().createAnchoredOffer(f.owner,command);
 expect(created.quote.lines.map(l=>l.period.startsAt)).toEqual(['2035-01-31T21:30:00.000Z','2035-02-15T21:00:00.000Z']);
 expect(created.quote.lines.map(l=>l.period.endsAt)).toEqual(['2035-02-28T21:30:00.000Z','2035-03-15T20:00:00.000Z']);
 expect(created.periods.every(p=>p.lesson.source.id.startsWith('program-source-v3/'))).toBe(true);
 const issued=await f.billing().issueAnchoredOffer(f.owner,{operationId:randomUUID(),quoteId:command.id,expectedVersion:1});
 expect(issued.quote.state).toBe('issued');expect((await f.billing().readAnchoredOffer(f.owner,command.id)).periods).toEqual(created.periods);
 const reloaded=await f.source().readGroup(f.owner,f.groupId);expect(reloaded.classification).toBe('scheduling_facts_only');
 expect(reloaded.lessons).toHaveLength(3);expect(reloaded.progressions).toHaveLength(2);
 await expect(f.source().readGroup(f.parent,f.groupId)).rejects.toThrow('FORBIDDEN');
 expect((await engine.query('SELECT * FROM ls_fishing_billing.obligations WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
 expect(f.family).toMatchObject({guardianVerified:false,financialAcceptance:false,outboundEligible:false});
});
it('real-program-source requires actual group/child source and verified catch-up instead of legacy/preparation eligibility',async()=>{
 const f=await nativeProgramFixture(engine),lesson=randomUUID(),command=f.offer([lesson,lesson]);
 await expect(f.billing().createAnchoredOffer(f.owner,command)).rejects.toThrow('UNAVAILABLE');
 await f.source().record(f.owner,f.group());await f.source().record(f.owner,f.lesson(lesson,3,'2035-02-15T21:00:00Z'));
 for(const n of [0,1])await f.source().record(f.owner,f.progression(n,'2035-02-15T00:00:00Z'));
 await expect(f.billing().createAnchoredOffer(f.owner,command)).rejects.toThrow('UNAVAILABLE');
 for(const n of [0,1])await f.source().record(f.owner,f.progression(n,'2035-02-15T00:00:00Z','verified_catchup',1));
 expect((await f.billing().createAnchoredOffer(f.owner,command)).quote.lines).toHaveLength(2);
});
it('real-program-source refuses the caller chosen later lesson and stale source revisions',async()=>{
 const f=await scheduled(),later=f.offer([f.second,f.later]);
 await expect(f.billing().createAnchoredOffer(f.owner,later)).rejects.toThrow('UNAVAILABLE');
 const command=f.offer([f.first,f.later]);command.children[0]!.expectedLessonRevision=2;
 await expect(f.billing().createAnchoredOffer(f.owner,command)).rejects.toThrow('UNAVAILABLE');
 expect((await engine.query('SELECT id FROM ls_fishing_billing.quotes WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('real-program-source preserves immutable history, CAS and original replay after a later revision',async()=>{
 const f=await nativeProgramFixture(engine),command=f.group(),created=await f.source().record(f.owner,command);
 const edited={...command,operationId:randomUUID(),expectedRevision:1,fields:{...command.fields as object,location:'SYNTHETIC corrected location'}};
 const next=await f.source().record(f.owner,edited);expect(next.record.revision).toBe(2);
 expect(await f.source().record(f.owner,command)).toEqual({...created,replayed:true});
 await expect(f.source().record(f.owner,{...edited,operationId:randomUUID()})).rejects.toThrow('CONFLICT');
 expect((await f.source().read(f.owner,f.groupId,'group',f.groupId)).record.revision).toBe(2);
 await expect(engine.query('UPDATE ls_fishing_billing.program_source_versions SET payload_ciphertext=$2 WHERE workspace_id=$1',[f.workspace,'SYNTHETIC'])).rejects.toThrow('FISHING_PROGRAM_SOURCE_IMMUTABLE');
 await expect(engine.query('DELETE FROM ls_fishing_billing.program_source_heads WHERE workspace_id=$1',[f.workspace])).rejects.toThrow('FISHING_PROGRAM_SOURCE_IMMUTABLE');
 await expect(engine.query('UPDATE ls_fishing_billing.program_source_heads SET revision=1 WHERE workspace_id=$1',[f.workspace])).rejects.toThrow('FISHING_PROGRAM_SOURCE_HEAD_CONFLICT');
 await expect(engine.exec('TRUNCATE ls_fishing_billing.program_source_heads,ls_fishing_billing.program_source_versions')).rejects.toThrow('FISHING_PROGRAM_SOURCE_IMMUTABLE');
 await expect(engine.exec('TRUNCATE ls_fishing_billing.program_source_heads')).rejects.toThrow('FISHING_PROGRAM_SOURCE_IMMUTABLE');
});
it('real-program-source denies overlapping lessons and missing progression evidence',async()=>{
 const f=await scheduled();await expect(f.source().record(f.owner,f.lesson(randomUUID(),4,'2035-01-31T22:00:00Z'))).rejects.toThrow('CONFLICT');
 const progression=f.progression(0,'2035-01-31T00:00:00Z','verified_catchup',1);
 await expect(f.source().record(f.owner,{...progression,fields:{...progression.fields as object,evidence:null}})).rejects.toThrow();
});
it('real-program-source rechecks native mapping and denies parent, foreign family and withdrawn membership',async()=>{
 const f=await scheduled();await expect(f.source().record(f.parent,f.group())).rejects.toThrow('FORBIDDEN');
 const wrong=f.progression(0,'2035-01-31T00:00:00Z','needs_foundation',1);
 await expect(f.source().record(f.owner,{...wrong,fields:{...wrong.fields as object,familyId:randomUUID()}})).rejects.toThrow('FORBIDDEN');
 await engine.query('DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3',[f.workspace,f.family.command.selection.familyId,f.family.command.selection.children[0]!.nativeChildId]);
 await expect(f.billing().createAnchoredOffer(f.owner,f.offer([f.first,f.later]))).rejects.toThrow('UNAVAILABLE');
});
it('real-program-source cancellation blocks new issuance without rewriting an original draft or recorded source',async()=>{
 const f=await scheduled(),command=f.offer([f.first,f.later]),created=await f.billing().createAnchoredOffer(f.owner,command);
 await f.source().record(f.owner,f.lesson(f.first,1,'2035-01-31T21:30:00Z',1,'cancelled'));
 await expect(f.billing().issueAnchoredOffer(f.owner,{operationId:randomUUID(),quoteId:command.id,expectedVersion:1})).rejects.toThrow('UNAVAILABLE');
 const read=await f.billing().readAnchoredOffer(f.owner,command.id);expect(read.quote).toEqual(created.quote);expect(read.periods).toEqual(created.periods);
});
it('real-program-source preserves uncertain committed recording and rolls back terminal session revocation',async()=>{
 const f=await nativeProgramFixture(engine),command=f.group();let lost=true;
 const uncertain:IdentityStore={transaction:async work=>{const value=await f.db.transaction(work);if(lost){lost=false;throw new AppError('CONFLICT');}return value;}};
 await expect(f.source(uncertain).record(f.owner,command)).rejects.toThrow('UNAVAILABLE');expect((await f.source().record(f.owner,command)).replayed).toBe(true);
 const lesson=f.lesson(randomUUID(),1,'2035-01-31T21:30:00Z');
 const revoked:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,v);if(sql.startsWith('INSERT INTO ls_fishing_billing.program_source_versions'))await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,programNow]);return rows;
 }}))};
 await expect(f.source(revoked).record(f.owner,lesson)).rejects.toThrow('UNAUTHENTICATED');
 expect((await engine.query('SELECT operation_id FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,lesson.operationId])).rows).toHaveLength(0);
});
it('real-program-source enforces the configured owner even for a current practitioner session',async()=>{
 const f=await nativeProgramFixture(engine);
 const wrong=new FishingProgramSourceNativeV3(f.db,f.workspace,programRing,programKey,f.parent.id,programClock);
 await expect(wrong.record(f.owner,f.group())).rejects.toThrow('FORBIDDEN');
 expect((await engine.query('SELECT operation_id FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('real-program-source denies an actual demo account for read, write and native period resolution',async()=>{
 const f=await scheduled(),before=(await engine.query('SELECT operation_id FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1',[f.workspace])).rows;
 await engine.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)',[f.workspace,'ls-owner-20350102',f.owner.id]);
 await engine.query('INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[f.workspace,f.owner.id,'ls-owner-20350102','SYNTHETIC-program-owner']);
 await expect(f.source().record(f.owner,f.group())).rejects.toThrow('FORBIDDEN');
 await expect(f.source().readGroup(f.owner,f.groupId)).rejects.toThrow('FORBIDDEN');
 await expect(f.billing().createAnchoredOffer(f.owner,f.offer([f.first,f.later]))).rejects.toThrow('UNAVAILABLE');
 expect((await engine.query('SELECT operation_id FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1',[f.workspace])).rows).toEqual(before);
});
it('real-program-source authenticates even a cancelled lesson before selecting the first eligible lesson',async()=>{
 const f=await scheduled();await f.source().record(f.owner,f.lesson(f.second,2,'2035-02-07T21:30:00Z',1,'cancelled'));
 const command=f.offer([f.first,f.later]);
 await expect(f.db.transaction(tx=>f.source().firstEligibleLessons({workspaceId:f.workspace,actor:f.owner,now:new Date(programNow),tx:{query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,v);return sql.includes("h.kind='lesson'")?rows.map(row=>(row as {id?:string}).id===f.second?{...row,ciphertext:'SYNTHETIC CORRUPTION'}:row):rows;
 }}},{quoteId:command.id,familyId:command.familyId,children:command.children}))).rejects.toThrow('UNAVAILABLE');
});
