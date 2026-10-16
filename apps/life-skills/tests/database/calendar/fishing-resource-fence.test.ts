import {randomUUID} from "node:crypto";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {assertNoFishingInstructorConflict} from "../../../src/features/calendar/fishing-resource-fence.ts";
import {programFixture,type ProgramFixture} from "../fishing/native-program-fixture.ts";
const fixtures:ProgramFixture[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function fixture(){const f=await programFixture();fixtures.push(f);return f;}
test("undated and scheduled drafts make no active booking; publication reserves instructor/venue once, never per child",async()=>{
 const f=await fixture(),plan=await f.createPlan();expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active",[f.workspaceId])).rows[0].n).toBe(0);
 await f.revise(plan.occurrences[0]!.id);expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active",[f.workspaceId])).rows[0].n).toBe(0);await f.publish();
 const rows=(await f.pool.query("SELECT kind,resource_id AS id FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active ORDER BY kind",[f.workspaceId])).rows;expect(rows).toEqual([{kind:"instructor",id:f.owner.id},{kind:"venue",id:f.venueCommand.id}]);
 const view=(await f.stage().read(f.owner,f.ref))!,operationId=randomUUID();await f.stage(f.owner,null,{operationId,resources:[],makeupFitDecisionId:null}).execute(f.owner,f.ref,{action:"cancel",operationId,expectedRevision:view.revision,occurrenceId:view.occurrences[0]!.id,expectedOccurrenceRevision:view.occurrences[0]!.revision,reason:"Synthetic operator cancellation"});
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active",[f.workspaceId])).rows[0].n).toBe(0);expect((await f.stage().read(f.owner,f.ref))!.occurrences[0]!.state).toBe("cancelled");
});
test("published fishing blocks ordinary clinical bookings and blocked-time writes without creating a fishing clinical case",async()=>{
 const f=await fixture(),plan=await f.createPlan();await f.revise(plan.occurrences[0]!.id);await f.publish();const booking=await f.clinical();await expect(f.calendar.create(f.owner,randomUUID(),booking(f.at(48)))).rejects.toMatchObject({code:"CONFLICT"});await expect(f.calendar.addAvailability(f.owner,randomUUID(),{startsAt:f.at(48),endsAt:f.at(49),kind:"blocked"})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_calendar.appointments WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_cases.cases WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(1);
});
test.each(["instructor","venue"] as const)("selected %s resource cannot bypass its typed foreign key with NULL; both published rows remain exact",async kind=>{
 const f=await fixture(),plan=await f.createPlan();await f.revise(plan.occurrences[0]!.id);await f.publish();
 const read=async()=>(await f.pool.query<{row:{kind:string;resource_id:string;instructor_id:string|null;venue_id:string|null}}>("SELECT to_jsonb(r) AS row FROM ls_fishing_stage.resource_reservations r WHERE workspace_id=$1 ORDER BY occurrence_id,kind",[f.workspaceId])).rows;
 const before=await read();expect(before).toHaveLength(2);const selected=before.find(value=>value.row.kind===kind)!.row;
 expect(selected[kind==="instructor"?"instructor_id":"venue_id"]).toBe(selected.resource_id);expect(selected[kind==="instructor"?"venue_id":"instructor_id"]).toBeNull();
 const update=kind==="instructor"?"UPDATE ls_fishing_stage.resource_reservations SET instructor_id=NULL WHERE workspace_id=$1 AND kind='instructor'":"UPDATE ls_fishing_stage.resource_reservations SET venue_id=NULL WHERE workspace_id=$1 AND kind='venue'";
 await expect(f.pool.query(update,[f.workspaceId])).rejects.toMatchObject({code:"23514"});expect(await read()).toEqual(before);
});
test("a clinical booking can occupy an unreserved draft but publication then fails atomically",async()=>{
 const f=await fixture(),plan=await f.createPlan();await f.revise(plan.occurrences[0]!.id);const booking=await f.clinical();await f.calendar.create(f.owner,randomUUID(),booking(f.at(48)));const before=(await f.stage().read(f.owner,f.ref))!;await expect(f.publish()).rejects.toMatchObject({code:"CONFLICT"});
 expect((await f.stage().read(f.owner,f.ref))!.revision).toBe(before.revision);expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active",[f.workspaceId])).rows[0].n).toBe(0);
});
test("two real native transactions racing clinical booking versus fishing publication leave one winner",async()=>{
 const f=await fixture(),plan=await f.createPlan();await f.revise(plan.occurrences[0]!.id);const booking=await f.clinical(),result=await Promise.allSettled([f.publish(),f.calendar.create(f.owner,randomUUID(),booking(f.at(48)))]);expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(result.filter(r=>r.status==="rejected")).toHaveLength(1);
 const counts=(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_calendar.appointments WHERE workspace_id=$1 AND status='scheduled') AS clinical,(SELECT count(*)::integer FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active AND kind='instructor') AS fishing",[f.workspaceId])).rows[0];expect(counts.clinical+counts.fishing).toBe(1);
});
test("missing native venue and mismatched actual Stage receipt cannot commit resource effects",async()=>{
 const f=await fixture(),plan=await f.createPlan();await expect(f.revise(plan.occurrences[0]!.id,f.at(48),f.at(49),randomUUID())).rejects.toThrow();expect((await f.stage().read(f.owner,f.ref))!.revision).toBe(plan.revision);
 const current=(await f.stage().read(f.owner,f.ref))!,o=current.occurrences[0]!,wrongOperation=(await f.pool.query("SELECT operation_id AS id FROM ls_fishing_stage.operations WHERE workspace_id=$1 AND stage_id=$2 AND stage_revision=1",[f.workspaceId,f.ref.stageId])).rows[0].id as string,actualOperation=randomUUID();await expect(f.stage(f.owner,null,{operationId:wrongOperation,resources:[{occurrenceId:o.id,expectedRevision:o.revision,venueId:f.venueCommand.id}],makeupFitDecisionId:null}).execute(f.owner,f.ref,{action:"revise",operationId:actualOperation,expectedRevision:current.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,details:{time:{kind:"scheduled",startsAt:f.at(48),endsAt:f.at(49),timeZone:"America/New_York"},location:f.venueCommand.label,directions:"",equipment:"",logisticalNote:"",childCapacity:2},reason:"Synthetic mismatched receipt"})).rejects.toThrow();
 expect((await f.stage().read(f.owner,f.ref))!.revision).toBe(plan.revision);expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test("native present-catalog read plus isolated driver/absence fault controls preserve the compatibility boundary",async()=>{
 const f=await fixture();await expect(assertNoFishingInstructorConflict({query:async()=>{throw Error("PRIVATE_DRIVER_CANARY");}},f.workspaceId,f.owner.id,f.at(48),f.at(49))).rejects.toMatchObject({code:"UNAVAILABLE"});
 const absent={query:async<T extends object>()=>[{relation:null}] as unknown as T[]};await assertNoFishingInstructorConflict(absent,f.workspaceId,f.owner.id,f.at(48),f.at(49));
 const missing={query:async<T extends object>()=>[] as T[]};await expect(assertNoFishingInstructorConflict(missing,f.workspaceId,f.owner.id,f.at(48),f.at(49))).rejects.toMatchObject({code:"UNAVAILABLE"});
 await f.db.transaction(async tx=>{await assertNoFishingInstructorConflict(tx,f.workspaceId,f.owner.id,f.at(48),f.at(49));});
});
