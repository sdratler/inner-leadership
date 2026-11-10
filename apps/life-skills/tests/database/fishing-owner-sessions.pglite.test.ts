import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {initializeProgramSchema,nativeProgramFixture,programRing,programClock} from '../fixtures/fishing-native-program-v3.ts';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {opaqueToken,tokenDigest} from '../../src/features/identity/crypto.ts';
import type {IdentityConfig} from '../../src/features/identity/config.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import {configuredFishingOwnerAppScope,FISHING_OWNER_APP_SCOPE_V1} from '../../src/lib/fishing-owner-app-scope.ts';
import {FishingOwnerSessionAdapter} from '../../src/features/integration/fishing-owner-session-adapter.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const noNetwork=vi.fn(async()=>{throw Error('OWNER_SCOPE_NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',noNetwork);engine=new PGlite();await initializeProgramSchema(engine);},20000);
afterEach(()=>{expect(noNetwork).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
async function setup(){
 const f=await nativeProgramFixture(engine),ownerToken=opaqueToken(),parentToken=opaqueToken();
 for(const [token,account] of [[ownerToken,f.owner],[parentToken,f.parent]] as const)await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenDigest(token),f.workspace,account.id,programClock.now(),new Date('2036-01-01T00:00:00Z')]);
 const config:IdentityConfig={enabled:true,origin:'https://synthetic-owner.invalid',workspaceId:f.workspace,csrfKey:Buffer.alloc(32,8),lookupKey:Buffer.alloc(32,9),rateLimitKey:'SYNTHETIC-OWNER-SCOPE-RATE-KEY',keyring:programRing,sessionSeconds:3600};
 const scope=configuredFishingOwnerAppScope(f.workspace,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id,LS_FISHING_OWNER_APP_SCOPE_JSON:JSON.stringify({version:FISHING_OWNER_APP_SCOPE_V1,workspaceId:f.workspace,ownerAccountId:f.owner.id})});
 if(!scope)throw Error('EXPECTED_EXPLICIT_SCOPE');const sessions=(store:IdentityStore=f.db)=>new FishingOwnerSessionAdapter(store,config,programClock,scope);
 return {...f,ownerToken,parentToken,config,scope,sessions};
}
it('admits only the actual configured ordinary owner and denies parent or another practitioner without creating accounts',async()=>{
 const f=await setup(),s=f.sessions();expect((await s.actor(f.ownerToken)).id).toBe(f.owner.id);
 await expect(s.actor(f.parentToken)).rejects.toThrow('FORBIDDEN');
 // The schema permits one practitioner per workspace. Replace that role in
 // this disposable fixture instead of removing its real uniqueness guard.
 await engine.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspace,f.owner.id]);
 await engine.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE workspace_id=$1 AND id=$2",[f.workspace,f.parent.id]);
 await expect(s.actor(f.parentToken)).rejects.toThrow('FORBIDDEN');
 expect((await engine.query('SELECT count(*)::int AS count FROM ls_identity.accounts WHERE workspace_id=$1',[f.workspace])).rows).toEqual([{count:2}]);
});
it('rejects a genuine configured-owner session after its native demo marker is added',async()=>{
 const f=await setup();await engine.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)',[f.workspace,'ls-owner-20260925',f.owner.id]);
 await engine.query('INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[f.workspace,f.owner.id,'ls-owner-20260925','SYNTHETIC-OWNER']);
 await expect(f.sessions().actor(f.ownerToken)).rejects.toThrow('FORBIDDEN');
});
it('rechecks actual session revocation committed after initial token lookup before returning owner scope',async()=>{
 const f=await setup();let transactions=0;
 const store:IdentityStore={transaction:async work=>{const call=++transactions,result=await f.db.transaction(work);if(call===1)await engine.query('UPDATE ls_identity.sessions SET revoked_at=$3 WHERE workspace_id=$1 AND token_digest=$2',[f.workspace,tokenDigest(f.ownerToken),programClock.now()]);return result;}};
 await expect(f.sessions(store).actor(f.ownerToken)).rejects.toThrow('UNAUTHENTICATED');expect(transactions).toBe(2);
});
it('keeps database outages distinct from sign-out or an empty owner workspace',async()=>{
 const f=await setup(),outage=Error('SYNTHETIC_OWNER_SCOPE_DB_OUTAGE');let transactions=0;
 const store:IdentityStore={transaction:async work=>{if(++transactions===2)throw outage;return f.db.transaction(work);}};
 await expect(f.sessions(store).actor(f.ownerToken)).rejects.toBe(outage);
});
it('pins the selected owner binding and rejects a cross-workspace configuration',async()=>{
 const f=await setup(),mutable={...f.scope,binding:{...f.scope.binding}},s=new FishingOwnerSessionAdapter(f.db,f.config,programClock,mutable);
 mutable.binding.accountId=f.parent.id;expect((await s.actor(f.ownerToken)).id).toBe(f.owner.id);await expect(s.actor(f.parentToken)).rejects.toThrow('FORBIDDEN');
 expect(()=>new FishingOwnerSessionAdapter(f.db,f.config,programClock,{...f.scope,binding:{...f.scope.binding,workspaceId:randomUUID()}})).toThrow('UNAVAILABLE');
});
it('resolves only the owner, distinguishing missing sessions and purpose denial',async()=>{
 const f=await setup(),s=f.sessions();expect(await s.resolve(f.ownerToken)).toMatchObject({accountId:f.owner.id,workspaceId:f.workspace,revoked:false});
 expect(await s.resolve(opaqueToken())).toBeNull();await expect(s.resolve(f.parentToken)).rejects.toThrow('FORBIDDEN');
});
it('normalizes resolver database failure as unavailable without treating it as a missing login',async()=>{
 const f=await setup(),store:IdentityStore={transaction:async()=>{throw Error('SYNTHETIC_DRIVER_FAILURE');}};
 await expect(f.sessions(store).resolve(f.ownerToken)).rejects.toThrow('UNAVAILABLE');
});
