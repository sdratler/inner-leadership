import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {academyTestDatabase,academyWorkspace} from './academy-free-registration-fixture.ts';
import {poolStore} from './calendar/fixture.ts';
import {FishingMarketingStore} from '../../src/features/fishing-marketing/store.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let database:Awaited<ReturnType<typeof academyTestDatabase>>;
const noNetwork=vi.fn(async()=>{throw Error('MARKETING_OWNER_PG_NO_EXTERNAL_NETWORK');});
beforeAll(async()=>{vi.stubGlobal('fetch',noNetwork);database=await academyTestDatabase();},60000);
afterEach(()=>expect(noNetwork).not.toHaveBeenCalled());afterAll(async()=>{try{await database?.close();}finally{vi.unstubAllGlobals();}});

/** Existing nonce PostgreSQL + production poolStore, not a simulated transaction.
 * The independent pool query commits its permission change while the real
 * READ ONLY snapshot read is still inside its READ COMMITTED transaction. */
it.each(['session_revoked','role_changed','empty_snapshot_revoked'] as const)('withholds private Marketing data after actual committed %s barrier',async change=>{
 const f=await academyWorkspace(database.pool),actor=await f.runtime.sessions.actor(f.owner.token),base=poolStore(database.pool);
 const now=new Date(Date.now()-1000).toISOString(),snapshot={schemaVersion:1,program:'fishing',channel:'facebook_group_manual',mode:'assisted',generatedAt:now,
  schedule:{timezone:'America/New_York',dailyCap:5,cooldownDays:30,enabled:false,funnelReady:false,day:now.slice(0,10),window:'waiting',nextDue:now,lastRun:null},
  assets:[],targets:[],items:[],itemsTruncated:false,history:[],historyAvailable:false,historyTruncated:false,excludedHistory:0};
 if(change!=='empty_snapshot_revoked')await new FishingMarketingStore(base,f.workspace,f.ring,f.digestKey,actor.id).save(snapshot);
 let committed=false,readOnly=false;
 const store:IdentityStore={transaction:work=>base.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql==='SET TRANSACTION READ ONLY')readOnly=true;
  const rows=await tx.query<T>(sql,values);
  if(sql.includes('FROM ls_service_interest.fishing_marketing_snapshot')&&!committed){
   if(change==='role_changed')await database.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspace,actor.id]);
   else await database.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2 AND token_digest=$3',[f.workspace,actor.id,actor.sessionDigest]);
   committed=true;
  }
  return rows;
 }} satisfies SqlSession))};
 const marketing=new FishingMarketingStore(store,f.workspace,f.ring,f.digestKey,actor.id);
 await expect(marketing.read(actor)).rejects.toMatchObject({code:change==='role_changed'?'NOT_FOUND':'UNAUTHENTICATED'});
 expect(committed).toBe(true);expect(readOnly).toBe(true);
});

it('denies a valid demo-origin owner before querying the private snapshot',async()=>{
 const f=await academyWorkspace(database.pool),demo=await f.account('practitioner',{batchId:'ls-owner-20261110',createdBy:f.owner.actor.id});
 const actor=await f.runtime.sessions.actor(demo.token),base=poolStore(database.pool);let privateReads=0,nativeOwnerChecks=0;
 const store:IdentityStore={transaction:work=>base.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql.includes('FROM ls_service_interest.fishing_marketing_snapshot'))privateReads++;
  if(sql.includes('FROM ls_identity.accounts a')&&sql.includes('ls_demo.accounts'))nativeOwnerChecks++;
  return tx.query<T>(sql,values);
 }} satisfies SqlSession))};
 await expect(new FishingMarketingStore(store,f.workspace,f.ring,f.digestKey,actor.id).read(actor)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(privateReads).toBe(0);
 expect(nativeOwnerChecks).toBeGreaterThan(0);
});

it('preserves the registered prohibition on relabelling an ordinary account as demo',async()=>{
 const f=await academyWorkspace(database.pool),batch='ls-owner-20261110';
 await database.pool.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)',[f.workspace,batch,f.owner.actor.id]);
 await expect(database.pool.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,'SYNTHETIC-invalid-relabel')",[f.workspace,f.owner.actor.id,batch])).rejects.toMatchObject({code:'23514',message:'LS_DEMO_ACCOUNT_ORIGIN_MISMATCH'});
 await expect(database.pool.query('UPDATE ls_identity.accounts SET demo_batch_id=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,f.owner.actor.id,batch])).rejects.toMatchObject({code:'23514',message:'LS_DEMO_ORIGIN_IMMUTABLE'});
 expect((await database.pool.query('SELECT demo_batch_id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2',[f.workspace,f.owner.actor.id])).rows).toEqual([{demo_batch_id:null}]);
 expect((await database.pool.query('SELECT account_id FROM ls_demo.accounts WHERE workspace_id=$1 AND account_id=$2',[f.workspace,f.owner.actor.id])).rowCount).toBe(0);
});
