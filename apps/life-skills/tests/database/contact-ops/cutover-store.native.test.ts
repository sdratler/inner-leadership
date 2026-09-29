import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {projectIntakeToLegacyIfCurrent} from "../../../src/features/contact-ops/server/authoritative-prospect-send.ts";
const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
async function setup(){const f=await fixture();fixtures.push(f);return {f,store:new ContactCutoverStore(poolStore(f.pool),f.keyring,"synthetic-authority-integrity-key-20260928")};}
const proof=(epoch:number,patch:Partial<CutoverEvidence>={}):CutoverEvidence=>({batchId:"synthetic-cutover-batch",sourceFileId:"synthetic-workbook",sourceRevision:"synthetic-frozen-revision",expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,
 backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,
 inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true,...patch});
// These are isolated synthetic proof fixtures, NOT live receiver/backup/browser proof.

test("native cutover persists encrypted exact-epoch transitions and immutable idempotent results",async()=>{
 const {f,store}=await setup(),a=f.practitioner.actor;
 let invoked=false;
 for(const intent of ["read","write"] as const)await expect(store.withDestination(a,{destination:"sheet",intent,expectedEpoch:0},async()=>{invoked=true;return true;})).rejects.toThrow("CONFLICT");
 expect(invoked).toBe(false);
 expect(await store.read(a)).toMatchObject({phase:"sheet_active",epoch:0});
 await expect(store.advance(a,{action:"prepare",proof:proof(0,{allRowsAccounted:false}),operationId:"invalid-prepare"})).rejects.toThrow("CONFLICT");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.cutover WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 const input={action:"prepare" as const,proof:proof(0),operationId:"prepare-synthetic"};
 expect(await store.advance(a,input)).toMatchObject({state:{phase:"shadow_ready",epoch:1},replayed:false});
 expect(await store.advance(a,input)).toMatchObject({state:{phase:"shadow_ready",epoch:1},replayed:true});
 await expect(store.advance(a,{...input,proof:proof(0,{sourceRevision:"different"})})).rejects.toThrow("CONFLICT");
 await store.advance(a,{action:"freeze",proof:proof(1),operationId:"freeze-synthetic"});
 expect(await store.advance(a,input)).toMatchObject({state:{phase:"shadow_ready",epoch:1},replayed:true});
 expect(await store.read(a)).toMatchObject({phase:"frozen",epoch:2});
 const rows=(await f.pool.query("SELECT state_ciphertext FROM ls_contact_ops.cutover WHERE workspace_id=$1",[f.workspaceId])).rows;
 expect(rows[0].state_ciphertext).not.toContain("synthetic-workbook");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.cutover_history WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(2);
 for(const command of ["UPDATE ls_contact_ops.cutover_history SET action='prepare' WHERE workspace_id=$1","DELETE FROM ls_contact_ops.cutover_history WHERE workspace_id=$1"])
  await expect(f.pool.query(command,[f.workspaceId])).rejects.toThrow("CONTACT_CUTOVER_HISTORY_APPEND_ONLY");
 await expect(f.pool.query("TRUNCATE ls_contact_ops.cutover_history")).rejects.toThrow("CONTACT_CUTOVER_HISTORY_APPEND_ONLY");
});

test("native cutover serializes competing transitions instead of admitting two epochs",async()=>{
 const {f,store}=await setup(),a=f.practitioner.actor;
 const outcomes=await Promise.allSettled(["first","second"].map(operationId=>store.advance(a,{action:"prepare",proof:proof(0),operationId})));
 expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(outcomes.filter(r=>r.status==="rejected")).toHaveLength(1);
 expect(await store.read(a)).toMatchObject({phase:"shadow_ready",epoch:1});
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.cutover_history WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(1);
});

test("public intake Sheet projection holds the authority fence through its external write",async()=>{
 const {f,store}=await setup(),a=f.practitioner.actor;
 let entered!:()=>void,released!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const finish=new Promise<void>(resolve=>{released=resolve;});
 const order:string[]=[];
 const runtime={store:poolStore(f.pool),config:{workspaceId:f.workspaceId,keyring:f.keyring}} as Parameters<typeof projectIntakeToLegacyIfCurrent>[0];
 const update=vi.fn(async()=>{order.push("sheet-start");entered();await finish;order.push("sheet-end");});
 const projection=projectIntakeToLegacyIfCurrent(runtime,"LS-LEAD-synthetic",{formSubmitted:"synthetic"},{update});
 await started;
 let advanced=false;
 const transition=store.advance(a,{action:"prepare",proof:proof(0),operationId:"after-intake"}).then(result=>{
  advanced=true;order.push("transition");return result;
 });
 try{
  await new Promise(resolve=>setTimeout(resolve,100));
  expect(advanced).toBe(false);
 }finally{released();}
 expect(await projection).toBe(false);
 expect(await transition).toMatchObject({state:{phase:"shadow_ready",epoch:1}});
 expect(order).toEqual(["sheet-start","sheet-end","transition"]);
 await store.advance(a,{action:"freeze",proof:proof(1),operationId:"freeze-after-intake"});
 const staleUpdate=vi.fn();
 expect(await projectIntakeToLegacyIfCurrent(runtime,"LS-LEAD-synthetic",{formSubmitted:"synthetic"},
  {update:staleUpdate})).toBe(true);
 expect(staleUpdate).not.toHaveBeenCalled();
});

test("native cutover fences stale/legacy writes, counts only committed native writes and requires reconciled rollback",async()=>{
 const {f,store}=await setup(),a=f.practitioner.actor;
 await store.advance(a,{action:"prepare",proof:proof(0),operationId:"prepare"});
 await store.advance(a,{action:"freeze",proof:proof(1),operationId:"freeze"});
 let invoked=false;
 const work=async()=>{invoked=true;return true;};
 for(const destination of ["sheet","native"] as const)await expect(store.withDestination(a,{destination,intent:"write",expectedEpoch:2},work)).rejects.toThrow("CONFLICT");
 expect(invoked).toBe(false);
 await expect(store.advance(a,{action:"switch_native",proof:proof(2,{inboundDurable:false}),operationId:"unsafe"})).rejects.toThrow("CONFLICT");
 await store.advance(a,{action:"switch_native",proof:proof(2),operationId:"activate"});
 await expect(store.withDestination(a,{destination:"sheet",intent:"write",expectedEpoch:3},work)).rejects.toThrow("CONFLICT");
 await expect(store.withDestination(a,{destination:"native",intent:"write",expectedEpoch:2},work)).rejects.toThrow("CONFLICT");
 const countBefore=(await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.people WHERE workspace_id=$1",[f.workspaceId])).rows[0].n;
 await expect(store.withDestination(a,{destination:"native",intent:"write",expectedEpoch:3},async tx=>{
  await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic-rolled-back',clock_timestamp())",[randomUUID(),f.workspaceId]);
  throw new Error("Synthetic required save failure");
 })).rejects.toThrow("Synthetic required save failure");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.people WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(countBefore);
 expect((await store.read(a)).nativeWritesSinceSwitch).toBe(0);
 await store.withDestination(a,{destination:"native",intent:"read",expectedEpoch:3},async tx=>(await tx.query("SELECT 1 AS n"))[0]);
 // Prove the actual PostgreSQL boundary, not a mocked intent check.
 await expect(store.withDestination(a,{destination:"native",intent:"read",expectedEpoch:3},async tx=>tx.query(
  "INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic-illegal-read-write',clock_timestamp())",[randomUUID(),f.workspaceId]
 ))).rejects.toMatchObject({cause:{code:"25006"}});
 await expect(store.withDestination(a,{destination:"native",intent:"read",expectedEpoch:3},async tx=>tx.query("SET TRANSACTION READ WRITE"))).rejects.toMatchObject({cause:{code:"25001"}});
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.people WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(countBefore);
 expect((await store.read(a)).nativeWritesSinceSwitch).toBe(0);
 const staleRollback=proof(3);
 await Promise.all([1,2].map(()=>store.withDestination(a,{destination:"native",intent:"write",expectedEpoch:3},async tx=>tx.query("SELECT 1 AS n"))));
 expect((await store.read(a)).nativeWritesSinceSwitch).toBe(2);
 await expect(store.advance(a,{action:"prepare_rollback",proof:staleRollback,operationId:"stale-rollback"})).rejects.toThrow("CONFLICT");
 expect(await store.read(a)).toMatchObject({phase:"native_active",epoch:3,nativeWritesSinceSwitch:2});
 await store.advance(a,{action:"prepare_rollback",proof:proof(3,{observedNativeWritesSinceSwitch:2}),operationId:"rollback"});
 await expect(store.withDestination(a,{destination:"native",intent:"write",expectedEpoch:4},work)).rejects.toThrow("CONFLICT");
 await expect(store.advance(a,{action:"finish_rollback",proof:proof(4),operationId:"stale-finish-rollback"})).rejects.toThrow("CONFLICT");
 await expect(store.advance(a,{action:"finish_rollback",proof:proof(4,{observedNativeWritesSinceSwitch:2,deltaDrained:false}),operationId:"unsafe-rollback"})).rejects.toThrow("CONFLICT");
 await store.advance(a,{action:"finish_rollback",proof:proof(4,{observedNativeWritesSinceSwitch:2}),operationId:"finish-rollback"});
 expect(await store.read(a)).toMatchObject({phase:"sheet_active",epoch:5,nativeWritesSinceSwitch:0,batchId:null});
});

test("native cutover denies parent/revoked/cross-workspace actors and corrupted persisted authority",async()=>{
 const {f,store}=await setup(),a=f.practitioner.actor;
 await expect(store.read(f.parent.actor)).rejects.toThrow("FORBIDDEN");
 await expect(store.advance(f.parent.actor,{action:"prepare",proof:proof(0),operationId:"parent"})).rejects.toThrow("FORBIDDEN");
 await expect(store.read({...a,workspaceId:randomUUID() as typeof a.workspaceId})).rejects.toThrow("UNAUTHENTICATED");
 await store.advance(a,{action:"prepare",proof:proof(0),operationId:"prepare"});
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[a.sessionDigest]);
 await expect(store.read(a)).rejects.toThrow("UNAUTHENTICATED");
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=NULL WHERE token_digest=$1",[a.sessionDigest]);
 await f.pool.query("UPDATE ls_contact_ops.cutover SET state_ciphertext='invalid-encrypted-state' WHERE workspace_id=$1",[f.workspaceId]);
 await expect(store.read(a)).rejects.toThrow("UNAVAILABLE");
 await expect(store.withDestination(a,{destination:"native",intent:"read",expectedEpoch:1},async()=>true)).rejects.toThrow("UNAVAILABLE");
});
