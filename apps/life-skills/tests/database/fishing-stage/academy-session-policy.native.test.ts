/** Authored native cases only. Each fixture refuses execution without a new
 * Root-reviewed CAL1136 admission plus exact source/schema/disposable DB pins. */
import {afterEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {randomUUID} from "node:crypto";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import type {AcademySessionPolicyNativeAuthority} from "../../../src/features/fishing/academy-session-policy-native-contract.ts";
import {AcademySessionPolicyNativeService} from "../../../src/features/fishing-stage/academy-session-policy-native.ts";
import {academySessionPolicyFixture,type AcademySessionPolicyFixture} from "./academy-session-policy-fixture.ts";

const opened:AcademySessionPolicyFixture[]=[];
async function fixture(options:Parameters<typeof academySessionPolicyFixture>[0]={}){const f=await academySessionPolicyFixture(options);opened.push(f);return f;}
afterEach(async()=>{for(const f of opened.splice(0))await f.close();});

it("persists one original 30-to-45-minute credit and sealed evidence; replay and new service preserve it",async()=>{
 const f=await fixture(),before=await f.protectedDigest(),command=f.command(),first=await f.service().execute(command);
 expect(first).toMatchObject({outcome:"issued",reason:"academy_change_exceeds_limit",replayed:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false});
 expect(first.credit).toMatchObject({anchor:f.initial.anchor,state:"outstanding",replacementReservationId:null});
 expect(await f.counts()).toEqual({evidence:1,credits:1,events:1});
 expect(await f.service().execute(command)).toEqual({...first,replayed:true});
 const restarted=await f.restart(command);expect(restarted.pid).not.toBe(process.pid);expect(restarted.result).toEqual({...first,replayed:true});
 expect(await f.service().readFamilySummary()).toMatchObject({enrollmentId:f.enrolled.id,learnerId:f.enrolled.learnerId,credits:[first.credit]});
 const retained=await f.service().execute(f.command());expect(retained).toMatchObject({outcome:"retained",reason:"same_outstanding_credit",credit:first.credit});
 expect(await f.counts()).toEqual({evidence:1,credits:1,events:2});expect(await f.protectedDigest()).toBe(before);
 const evidence=(await f.pool.query("SELECT payload_ciphertext FROM ls_fishing_stage.academy_session_policy_evidence WHERE workspace_id=$1",[f.workspaceId])).rows;
 expect(JSON.stringify(evidence)).not.toMatch(/SYNTHETIC_CAL1136_PRIVATE_PARENT|drivePreferenceDigest|purchased_undelivered/);
},45000);

it.each(["outstanding","replacement_reserved"] as const)("reuses the unambiguous legacy %s ID across repeated changes without changing reservation rows",async state=>{
 const f=await fixture({legacy:state}),before=await f.protectedDigest(),legacy=f.initial.legacyCredit!;
 const initial=await f.service().execute(f.command());expect(initial).toMatchObject({outcome:"retained",credit:legacy});
 for(const cannotAttend of [false,null,true]){
  const changed=await f.change(facts=>({...facts,evidenceRevision:facts.evidenceRevision+1,travel:{...facts.travel,change:{...facts.travel.change,kind:"academy_schedule",revisedOneWayMinutes:25,familyCannotAttend:cannotAttend}}}));
  expect(await f.service().execute(f.command(changed))).toMatchObject({outcome:"retained",credit:legacy});
 }
 expect(await f.counts()).toEqual({evidence:4,credits:1,events:4});expect(await f.protectedDigest()).toBe(before);
 expect((await f.service().readFamilySummary()).credits).toEqual([legacy]);
});

it("has one credit across two simultaneous native connections and distinct operation IDs",async()=>{
 const f=await fixture();let entered=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),pids=new Set<number>();
 const database:IdentityStore={transaction:work=>f.db.transaction(async tx=>{
  pids.add((await tx.query<{pid:number}>("SELECT pg_backend_pid() AS pid"))[0]!.pid);if(++entered===2)release();
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("CAL1136_TWO_CONNECTION_BARRIER_TIMEOUT")),5000);
   void barrier.then(()=>{clearTimeout(timer);resolve();},reject);});return work(tx);
 })};
 const results=await Promise.all([f.service(f.parent,f.enrolled.id,database).execute(f.command()),f.service(f.parent,f.enrolled.id,database).execute(f.command())]);
 expect(pids.size).toBe(2);expect(new Set(results.map(r=>r.credit!.id)).size).toBe(1);expect(results.map(r=>r.outcome).sort()).toEqual(["issued","retained"]);
 expect(await f.counts()).toEqual({evidence:1,credits:1,events:2});
});

it("keeps the same original session separate for two children",async()=>{
 const f=await fixture(),a=await f.service().execute(f.command()),b=await f.service(f.parent,f.siblingEnrollment.id).execute(f.command(f.siblingInitial));
 expect(a.credit!.id).not.toBe(b.credit!.id);expect(a.credit!.anchor.occurrenceId).toBe(b.credit!.anchor.occurrenceId);
 expect((await f.service().readFamilySummary()).credits).toEqual([a.credit]);
 expect((await f.service(f.parent,f.siblingEnrollment.id).readFamilySummary()).credits).toEqual([b.credit]);
 expect(await f.counts()).toEqual({evidence:2,credits:2,events:2});
});

it.each([179,181])("denies new issuance for an ordinary %i-minute session",async minutes=>{
 const f=await fixture();const facts=await f.change(value=>{
  if(value.duration.time.kind!=="scheduled")throw Error("SCHEDULED_FIXTURE_REQUIRED");
  return {...value,duration:{...value.duration,time:{...value.duration.time,endsAt:new Date(Date.parse(value.duration.time.startsAt)+minutes*60000).toISOString()}}};
 });
 expect(await f.service().execute(f.command(facts))).toMatchObject({outcome:"facts_required",reason:"invalid_input",credit:null});expect((await f.counts()).credits).toBe(0);
});

it.each(["within_limit","can_attend","missing_attendance","missing_journey","weather","keys","offshore"] as const)("does not issue for %s",async kind=>{
 const f=await fixture();const facts=await f.change(value=>{
  const change={...value.travel.change},sessionKind=kind==="keys"||kind==="offshore"?kind:"ordinary";
  if(kind==="within_limit")change.revisedOneWayMinutes=30;
  if(kind==="can_attend")change.familyCannotAttend=false;
  if(kind==="missing_attendance")change.familyCannotAttend=null;
  if(kind==="missing_journey")change.revisedOneWayMinutes=null;
  if(kind==="weather")change.kind="academy_weather_cancelled";
  return {...value,duration:{...value.duration,sessionKind},travel:{...value.travel,sessionKind,change}};
 });
 const result=await f.service().execute(f.command(facts));expect(["facts_required","no_credit"]).toContain(result.outcome);expect(result.credit).toBeNull();expect((await f.counts()).credits).toBe(0);
});

it("does not invent a maximum for over-60 preference",async()=>{
 const f=await fixture({driveLimit:"over_60"});expect(await f.service().execute(f.command())).toMatchObject({outcome:"facts_required",reason:"drive_limit_requires_facts",credit:null});
});

it.each(["delivered","unpurchased","unknown"] as const)("does not issue when the original obligation is %s",async state=>{
 const f=await fixture(),facts=await f.change(value=>({...value,travel:{...value.travel,obligation:{...value.travel.obligation!,state}}}));
 const result=await f.service().execute(f.command(facts));expect(["no_credit","facts_required"]).toContain(result.outcome);expect(result.credit).toBeNull();expect((await f.counts()).credits).toBe(0);
});

it.each(["inquiryVerified","purchaseVerified","deliveryVerified","sourceVerified"] as const)("denies missing native %s before a cached receipt",async key=>{
 const f=await fixture(),command=f.command();await f.service().execute(command);const before=await f.counts();await f.invalidate(key);
 await expect(f.service().execute(command)).rejects.toMatchObject({code:"FORBIDDEN"});expect(await f.counts()).toEqual(before);
});

it("rejects a revoked session before calling either authority method or returning cached data",async()=>{
 const f=await fixture(),command=f.command();await f.service().execute(command);
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[f.parent.sessionDigest]);
 const authority={resolveCreditFacts:vi.fn(f.authority.resolveCreditFacts),resolveSelectedEnrollment:vi.fn(f.authority.resolveSelectedEnrollment)};
 await expect(f.service(f.parent,f.enrolled.id,f.db,authority).execute(command)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 expect(authority.resolveCreditFacts).not.toHaveBeenCalled();expect(authority.resolveSelectedEnrollment).not.toHaveBeenCalled();
 await expect(f.service().readFamilySummary()).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});

it("denies revoked guardians, unrelated parents, child/operator family reads and changed selection",async()=>{
 const f=await fixture(),command=f.command();await f.service().execute(command);
 for(const actor of [f.otherParent,f.child,f.instructor])await expect(f.service(actor).readFamilySummary()).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(f.service(f.parent,f.siblingEnrollment.id).execute(command)).rejects.toMatchObject({code:"FORBIDDEN"});
 await f.revokeGuardian();await expect(f.service().execute(command)).rejects.toMatchObject({code:"FORBIDDEN"});await expect(f.service().readFamilySummary()).rejects.toMatchObject({code:"FORBIDDEN"});
});

it("does not use another workspace's enrollment or receipt",async()=>{
 const f=await fixture(),other=await fixture(),command=f.command();await f.service().execute(command);
 const before=await f.counts();
 await expect(other.service(other.parent,f.enrolled.id).execute(command)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(other.service(other.parent,f.enrolled.id).readFamilySummary()).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(await f.counts()).toEqual(before);expect(await other.counts()).toEqual({evidence:0,credits:0,events:0});
});

it.each(["workspaceId","learnerId","cohortId","stageId","occurrenceId","ordinal","moduleId","moduleVersion","activityId"] as const)("compares the original anchor field %s",async key=>{
 const f=await fixture();const authority:AcademySessionPolicyNativeAuthority={...f.authority,resolveCreditFacts:async(...args)=>{
  const facts=await f.authority.resolveCreditFacts(...args);if(!facts)throw Error("FIXTURE_AUTHORITY_REQUIRED");
  const altered={...facts.anchor,[key]:key==="ordinal"?2:key==="moduleId"?"RM-102":key==="moduleVersion"||key==="activityId"?"different":randomUUID()};
  return {...facts,travel:{...facts.travel,change:{...facts.travel.change,anchor:altered}}};
 }};
 await expect(f.service(f.parent,f.enrolled.id,f.db,authority).execute(f.command())).rejects.toMatchObject({code:"CONFLICT"});expect(await f.counts()).toEqual({evidence:0,credits:0,events:0});
});

it("rejects a competing legacy ID, different request replay and changed evidence bytes without replacing history",async()=>{
 const f=await fixture(),command=f.command(),first=await f.service().execute(command),before=await f.counts();
 const authority:AcademySessionPolicyNativeAuthority={...f.authority,resolveCreditFacts:async(...args)=>{
  const facts=await f.authority.resolveCreditFacts(...args);if(!facts)throw Error("FIXTURE_AUTHORITY_REQUIRED");return {...facts,legacyCredit:{...first.credit!,id:randomUUID()}};
 }};
 await expect(f.service(f.parent,f.enrolled.id,f.db,authority).execute(f.command())).rejects.toMatchObject({code:"CONFLICT"});
 await expect(f.service().execute({...command,expectedStageRevision:command.expectedStageRevision+1})).rejects.toMatchObject({code:"CONFLICT"});
 const changed=await f.change(facts=>({...facts,travel:{...facts.travel,change:{...facts.travel.change,revisedOneWayMinutes:50}}}));
 await expect(f.service().execute(f.command(changed,command.operationId))).rejects.toMatchObject({code:"CONFLICT"});
 await expect(f.service().execute(f.command(changed))).rejects.toMatchObject({code:"CONFLICT"});expect(await f.counts()).toEqual(before);
});

it("rolls back evidence, credit and receipt together if the event write or final authorization fails",async()=>{
 const f=await fixture(),before=await f.protectedDigest();
 await expect(f.service(f.parent,f.enrolled.id,f.failAfterEvent()).execute(f.command())).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect(await f.counts()).toEqual({evidence:0,credits:0,events:0});
 let calls=0;const authority:AcademySessionPolicyNativeAuthority={...f.authority,resolveSelectedEnrollment:async(tx,c)=>{
  if(++calls===2)await f.revokeGuardian(tx);return f.authority.resolveSelectedEnrollment(tx,c);
 }};
 await expect(f.service(f.parent,f.enrolled.id,f.db,authority).execute(f.command())).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(await f.counts()).toEqual({evidence:0,credits:0,events:0});expect(await f.protectedDigest()).toBe(before);
 expect((await f.service().execute(f.command())).outcome).toBe("issued");
});

it("detects plaintext credit-state tampering against the sealed event",async()=>{
 const f=await fixture();await f.service().execute(f.command());
 await f.pool.query("UPDATE ls_fishing_stage.academy_session_credits SET state='delivered' WHERE workspace_id=$1",[f.workspaceId]);
 await expect(f.service().readFamilySummary()).rejects.toMatchObject({code:"UNAVAILABLE"});
});

it("requires both authority methods rather than discovering a default",async()=>{
 const f=await fixture();
 for(const authority of [{resolveCreditFacts:f.authority.resolveCreditFacts},{resolveSelectedEnrollment:f.authority.resolveSelectedEnrollment}]){
  expect(()=>new AcademySessionPolicyNativeService({database:f.db,keyring:f.keyring,principal:f.parent,selection:{selectedEnrollmentId:f.enrolled.id},clock:f.clock,
   authority:authority as AcademySessionPolicyNativeAuthority})).toThrow("UNAVAILABLE");
 }
});
