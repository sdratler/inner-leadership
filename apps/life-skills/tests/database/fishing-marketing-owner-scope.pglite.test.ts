import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {initializeProgramSchema,nativeProgramFixture,programKey,programClock,programRing} from '../fixtures/fishing-native-program-v3.ts';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {localMarketingFixture} from '../fixtures/fishing-marketing-local.ts';
import {FishingMarketingStore} from '../../src/features/fishing-marketing/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const noNetwork=vi.fn(async()=>{throw Error('MARKETING_OWNER_SCOPE_NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',noNetwork);engine=new PGlite();await initializeProgramSchema(engine);await engine.exec(await readFile('migrations/0147_ls_fishing_marketing_snapshot.sql','utf8'));},20000);
afterEach(()=>expect(noNetwork).not.toHaveBeenCalled());afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
async function setup(){const f=await nativeProgramFixture(engine),store=new FishingMarketingStore(f.db,f.workspace,programRing,programKey,f.owner.id,programClock),snapshot=localMarketingFixture();await store.save(snapshot);return {...f,store,snapshot};}
async function markDemo(f:Awaited<ReturnType<typeof setup>>){
 await engine.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,'ls-owner-20261110',$2)",[f.workspace,f.owner.id]);
 await engine.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,'ls-owner-20261110','SYNTHETIC-owner')",[f.workspace,f.owner.id]);
}
it('actual native owner read returns the encrypted Fishing projection, then denies a committed demo marker',async()=>{
 const f=await setup();expect((await f.store.read(f.owner))?.snapshot).toEqual(f.snapshot);
 await markDemo(f);await expect(f.store.read(f.owner)).rejects.toThrow('NOT_FOUND');
});
it('actual native role replacement cannot retain access to the private snapshot',async()=>{
 const f=await setup();await engine.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspace,f.owner.id]);
 await expect(f.store.read(f.owner)).rejects.toThrow('NOT_FOUND');
});
it('the dedicated bridge cannot update or replay a projection for a marked demo owner',async()=>{
 const f=await setup();const before=(await engine.query('SELECT payload_digest,payload_ciphertext FROM ls_service_interest.fishing_marketing_snapshot WHERE workspace_id=$1',[f.workspace])).rows;
 await markDemo(f);await expect(f.store.save(f.snapshot)).rejects.toThrow('UNAVAILABLE');
 expect((await engine.query('SELECT payload_digest,payload_ciphertext FROM ls_service_interest.fishing_marketing_snapshot WHERE workspace_id=$1',[f.workspace])).rows).toEqual(before);
});
