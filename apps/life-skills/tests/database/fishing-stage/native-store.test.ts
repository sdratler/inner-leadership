import {afterEach,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {randomUUID} from "node:crypto";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import type {FishingStageNativeHooks} from "../../../src/features/fishing/native-stage-ports.ts";
import {nativeFixture,type NativeFixture} from "./fixture.ts";
const opened:NativeFixture[]=[];
async function fixture(){const f=await nativeFixture();opened.push(f);return f;}
afterEach(async()=>{for(const f of opened.splice(0))await f.close();});
async function planned(){const f=await fixture();await f.createPlan();await f.schedule();return f;}
async function replacement(f:NativeFixture,capacity=4){const ref={cohortId:randomUUID(),stageId:randomUUID(),stage:1 as const};await f.cohort(ref);await f.createPlan(ref);const v=await f.schedule(ref,96,capacity);return v.occurrences[0]!;}
async function confirm(f:NativeFixture,noticeId:string,target:Awaited<ReturnType<typeof replacement>>,ref=f.ref){const current=(await f.service().read(f.instructor,ref))!;
 return {action:"confirm_makeup" as const,operationId:randomUUID(),expectedRevision:current.revision,noticeId,replacementOccurrenceId:target.id,expectedReplacementRevision:target.revision,reason:"Synthetic suitability decision"};}

it("persists twelve canonical rows and encrypted records, then reads and replays through a new native service",async()=>{
 const f=await fixture(),command=f.create(),a=await f.service().execute(f.instructor,f.ref,command);
 expect(await f.service().execute(f.instructor,f.ref,command)).toEqual({...a,replayed:true});
 const view=(await f.service().read(f.instructor,f.ref))!;expect(view.occurrences).toHaveLength(12);expect(new Set(view.occurrences.map(o=>o.id)).size).toBe(12);expect(view.occurrences.every(o=>o.time.kind==="undated")).toBe(true);
 expect(await f.counts()).toEqual({occurrences:12,revisions:1,operations:1,links:0,resources:0,seats:0});
 const sealed=(await f.pool.query("SELECT payload_ciphertext FROM ls_fishing_stage.plans WHERE workspace_id=$1",[f.workspaceId])).rows;
 expect(JSON.stringify(sealed)).not.toMatch(/Synthetic instructor|childCapacity|logisticalNote/);
 const clinical=(await f.pool.query("SELECT count(*)::integer AS total FROM ls_cases.cases WHERE workspace_id=$1",[f.workspaceId])).rows[0];expect(clinical.total).toBe(0);
});
it("rejects changed actor-global operation data and changed selected sibling without adding a receipt",async()=>{
 const f=await fixture(),command=f.create();await f.service().execute(f.instructor,f.ref,command);
 await expect(f.service().execute(f.instructor,f.ref,{...command,childCapacity:3})).rejects.toMatchObject({code:"CONFLICT"});
 // Capacity rows are explicit fixture evidence; unknown occupancy is never zero.
 for(const row of (await f.pool.query("SELECT id FROM ls_fishing_stage.occurrences WHERE workspace_id=$1",[f.workspaceId])).rows)await f.pool.query("INSERT INTO ls_fishing_stage.fixture_capacity(workspace_id,occurrence_id,included_places,suitable) VALUES($1,$2,0,true)",[f.workspaceId,row.id]);
 await f.schedule();const reported=await f.report(),before=await f.counts();
 await expect(f.service(f.parent,f.siblingEnrollment.id).execute(f.parent,f.ref,reported.command)).rejects.toMatchObject({code:"CONFLICT"});expect(await f.counts()).toEqual(before);
});
it("uses two simultaneous PostgreSQL connections for one expected-version winner",async()=>{
 const f=await planned(),current=(await f.service().read(f.instructor,f.ref))!,o=current.occurrences[0]!;
 let entered=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),pids=new Set<number>();
 const concurrent:IdentityStore={transaction:work=>f.db.transaction(async tx=>{pids.add((await tx.query<{pid:number}>("SELECT pg_backend_pid() AS pid"))[0]!.pid);if(++entered===2)release();await barrier;return work(tx);})};
 const base={action:"cancel",expectedRevision:current.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic cancellation"};
 const results=await Promise.allSettled([f.service(f.instructor,null,concurrent).execute(f.instructor,f.ref,{...base,operationId:randomUUID()}),f.service(f.instructor,null,concurrent).execute(f.instructor,f.ref,{...base,operationId:randomUUID()})]);
 expect(pids.size).toBe(2);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect((await f.service().read(f.instructor,f.ref))!.revision).toBe(current.revision+1);
});
it("reloads real sessions before hooks and denies a revoked actor even if a hook would claim authority",async()=>{
 const f=await planned(),resolveContext=vi.fn(f.hooks.resolveContext);
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.parent.sessionDigest]);
 await expect(f.service(f.parent,f.enrolled.id,f.db,{...f.hooks,resolveContext}).read(f.parent,f.ref)).rejects.toMatchObject({code:"UNAUTHENTICATED"});expect(resolveContext).not.toHaveBeenCalled();
});
it("requires the selected enrollment, current guardian and separately enabled matching child",async()=>{
 const f=await planned();
 expect(await f.service(f.parent,null).read(f.parent,f.ref)).toBeNull();
 expect(await f.service(f.otherParent,f.enrolled.id).read(f.otherParent,f.ref)).toBeNull();
 expect(await f.service(f.child,f.siblingEnrollment.id).read(f.child,f.ref)).toBeNull();
 expect((await f.service(f.child,f.enrolled.id).read(f.child,f.ref))!.role).toBe("child");
 await f.pool.query("UPDATE ls_fishing_stage.fixture_enrollments SET child_enabled=false WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.enrolled.id]);
 expect(await f.service(f.child,f.enrolled.id).read(f.child,f.ref)).toBeNull();
 await f.pool.query("UPDATE ls_fishing_stage.fixture_guardians SET active=false WHERE workspace_id=$1 AND account_id=$2",[f.workspaceId,f.parent.id]);
 expect(await f.service(f.parent,f.enrolled.id).read(f.parent,f.ref)).toBeNull();
});
it("rejects hook actor overrides, foreign scopes and silently substituted selected children",async()=>{
 const f=await planned();
 for(const mutate of ["actor","workspace","selection"] as const){
  const hooks:FishingStageNativeHooks={...f.hooks,resolveContext:async(...args)=>{const facts=(await f.hooks.resolveContext(...args))!;
   if(mutate==="actor")return {...facts,actor:f.instructor};
   if(mutate==="workspace")return {...facts,scope:{...facts.scope,workspaceId:randomUUID()}};
   return {...facts,enrollment:f.siblingEnrollment};}};
  await expect(f.service(f.parent,f.enrolled.id,f.db,hooks).read(f.parent,f.ref)).rejects.toThrow();
 }
});
it("denies a stale native context changed by hook SQL before commit and rolls its effects back",async()=>{
 const f=await fixture();await f.createPlan();const before=await f.counts();
 const hooks:FishingStageNativeHooks={...f.hooks,reconcileResources:async(tx,c,a,b)=>{await f.hooks.reconcileResources(tx,c,a,b);await tx.query("UPDATE ls_fishing_stage.fixture_contexts SET child_capacity=3 WHERE workspace_id=$1 AND stage_id=$2",[f.workspaceId,f.ref.stageId]);}};
 await expect(f.service(f.instructor,null,f.db,hooks).execute(f.instructor,f.ref,{action:"publish",operationId:randomUUID(),expectedRevision:1})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(await f.counts()).toEqual(before);expect((await f.pool.query("SELECT child_capacity FROM ls_fishing_stage.fixture_contexts WHERE workspace_id=$1",[f.workspaceId])).rows[0].child_capacity).toBe(4);
});
it("validates all twelve native ordinal bindings against decrypted state",async()=>{
 const f=await planned(),id=(await f.service().read(f.instructor,f.ref))!.occurrences[0]!.id;
 await f.pool.query("UPDATE ls_fishing_stage.occurrences SET id=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,id,randomUUID()]);
 await expect(f.service().read(f.instructor,f.ref)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
it.each(["plan","revision","operation"] as const)("rejects %s ciphertext tampering before exposing or replaying data",async kind=>{
 const f=await fixture(),command=f.create();await f.service().execute(f.instructor,f.ref,command);
 if(kind==="plan")await f.pool.query("UPDATE ls_fishing_stage.plans SET payload_ciphertext='tampered' WHERE workspace_id=$1",[f.workspaceId]);
 else if(kind==="revision")await f.pool.query("UPDATE ls_fishing_stage.revisions SET payload_ciphertext='tampered' WHERE workspace_id=$1",[f.workspaceId]);
 else await f.pool.query("UPDATE ls_fishing_stage.operations SET receipt_ciphertext='tampered' WHERE workspace_id=$1",[f.workspaceId]);
 await expect(f.service().execute(f.instructor,f.ref,command)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
it("rolls back resource SQL and all plan/revision/receipt writes when a hook or final INSERT fails",async()=>{
 const f=await planned(),current=(await f.service().read(f.instructor,f.ref))!,o=current.occurrences[0]!,before=await f.counts();
 const command={action:"cancel",operationId:randomUUID(),expectedRevision:current.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic rollback"};
 f.fault.resources=true;await expect(f.service().execute(f.instructor,f.ref,command)).rejects.toMatchObject({code:"UNAVAILABLE"});f.fault.resources=false;expect(await f.counts()).toEqual(before);
 const failing:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async(statement,values)=>{if(statement.startsWith("INSERT INTO ls_fishing_stage.operations"))throw Error("synthetic receipt failure");return tx.query(statement,values);}}))};
 await expect(f.service(f.instructor,null,failing).execute(f.instructor,f.ref,command)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(await f.counts()).toEqual(before);expect((await f.service().read(f.instructor,f.ref))!.revision).toBe(current.revision);
 await f.service().execute(f.instructor,f.ref,command);expect((await f.service().read(f.instructor,f.ref))!.revision).toBe(current.revision+1);
});
it("refuses unknown shared occupancy and revoked approved templates",async()=>{
 const f=await fixture();await f.createPlan();await f.pool.query("DELETE FROM ls_fishing_stage.fixture_capacity WHERE workspace_id=$1",[f.workspaceId]);
 await expect(f.service().execute(f.instructor,f.ref,{action:"publish",operationId:randomUUID(),expectedRevision:1})).rejects.toMatchObject({code:"UNAVAILABLE"});
 await f.pool.query("UPDATE ls_fishing_stage.fixture_templates SET active=false WHERE workspace_id=$1",[f.workspaceId]);await expect(f.service().read(f.instructor,f.ref)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("loads the replacement from canonical native headers and rolls back shared seats and owned links on failure",async()=>{
 const f=await planned(),reported=await f.report(),target=await replacement(f),command=await confirm(f,reported.notice.id,target),before=await f.counts();
 const failing:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async(statement,values)=>{if(statement.startsWith("INSERT INTO ls_fishing_stage.operations"))throw Error("synthetic receipt failure");return tx.query(statement,values);}}))};
 await expect(f.service(f.instructor,null,failing).execute(f.instructor,f.ref,command)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(await f.counts()).toEqual(before);
 const saved=await f.service().execute(f.instructor,f.ref,command);expect(await f.service().execute(f.instructor,f.ref,command)).toEqual({...saved,replayed:true});
 expect(await f.counts()).toMatchObject({links:1,seats:1});expect((await f.service(f.parent,f.enrolled.id).read(f.parent,f.ref))!.notices[0]!.replacementOccurrenceId).toBe(target.id);
});
it("enforces learner/target uniqueness even with two enrollment IDs and a permissive synthetic seat hook",async()=>{
 const f=await planned(),first=await f.report(),target=await replacement(f);await f.service().execute(f.instructor,f.ref,await confirm(f,first.notice.id,target));
 const duplicateEnrollment=await f.enrollment(f.child),second=await f.report(duplicateEnrollment),before=await f.counts();
 await expect(f.service().execute(f.instructor,f.ref,await confirm(f,second.notice.id,target))).rejects.toMatchObject({code:"CONFLICT"});expect(await f.counts()).toEqual(before);
 // Independently exercise the actual DB unique constraint, not just the SELECT.
 await expect(f.pool.query("INSERT INTO ls_fishing_stage.makeup_links(workspace_id,source_stage_id,entitlement_id,enrollment_id,learner_id,occurrence_id,reservation_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[f.workspaceId,f.ref.stageId,randomUUID(),duplicateEnrollment.id,f.child.personId,target.id,randomUUID()])).rejects.toMatchObject({code:"23505"});
 const linked=(await f.pool.query("SELECT entitlement_id FROM ls_fishing_stage.makeup_links WHERE workspace_id=$1",[f.workspaceId])).rows[0];
 const otherTarget=(await f.service().read(f.instructor,f.ref))!.occurrences[1]!.id;
 await expect(f.pool.query("INSERT INTO ls_fishing_stage.makeup_links(workspace_id,source_stage_id,entitlement_id,enrollment_id,learner_id,occurrence_id,reservation_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[f.workspaceId,f.ref.stageId,linked.entitlement_id,f.siblingEnrollment.id,f.sibling.personId,otherTarget,randomUUID()])).rejects.toMatchObject({code:"23505"});
 expect(await f.counts()).toMatchObject({links:1,seats:1});
});
it("has one last-seat winner across two connections and different source-stage revisions using synthetic SQL seat ports",async()=>{
 const f=await planned(),first=await f.report();
 const other={cohortId:randomUUID(),stageId:randomUUID(),stage:1 as const};await f.cohort(other);await f.createPlan(other);await f.schedule(other,60);
 const otherEnrollment=await f.enrollment(f.sibling,other),second=await f.report(otherEnrollment),target=await replacement(f,1);
 const commands=[await confirm(f,first.notice.id,target),await confirm(f,second.notice.id,target,other)];
 let entered=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),pids=new Set<number>();
 const concurrent:IdentityStore={transaction:work=>f.db.transaction(async tx=>{pids.add((await tx.query<{pid:number}>("SELECT pg_backend_pid() AS pid"))[0]!.pid);if(++entered===2)release();await barrier;return work(tx);})};
 const results=await Promise.allSettled([f.service(f.instructor,null,concurrent).execute(f.instructor,f.ref,commands[0]),f.service(f.instructor,null,concurrent).execute(f.instructor,other,commands[1])]);
 expect(pids.size).toBe(2);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(await f.counts()).toMatchObject({links:1,seats:1});
});
it("rejects stale or full replacement targets without consuming the entitlement",async()=>{
 const f=await planned(),reported=await f.report(),target=await replacement(f,1),command=await confirm(f,reported.notice.id,target);
 await expect(f.service().execute(f.instructor,f.ref,{...command,expectedReplacementRevision:target.revision-1})).rejects.toMatchObject({code:"CONFLICT"});
 await f.pool.query("UPDATE ls_fishing_stage.fixture_capacity SET included_places=1 WHERE workspace_id=$1 AND occurrence_id=$2",[f.workspaceId,target.id]);
 await expect(f.service().execute(f.instructor,f.ref,command)).rejects.toMatchObject({code:"CONFLICT"});expect(await f.counts()).toMatchObject({links:0,seats:0});
});
