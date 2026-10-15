import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import {actor,Fixture,id,ref,template} from "./fixture.ts";
import {asId} from "../../../src/lib/ids.ts";
const service=(f:Fixture)=>new FishingStageService(f,{now:()=>f.now});
const create={operationId:id(100),expectedRevision:0,action:"create",templateVersion:"synthetic-stage-v1",childCapacity:4};
async function plan(){const f=new Fixture();await service(f).execute(actor(),ref,create);return f;}
async function scheduled(){const f=await plan();await revise(f,"2026-03-08T15:00:00Z");await service(f).execute(actor(),ref,{operationId:id(102),expectedRevision:f.state!.revision,action:"publish"});return f;}
async function revise(f:Fixture,startsAt:string,operation=101){const o=f.state!.occurrences[0]!;return service(f).execute(actor(),ref,{operationId:id(operation),expectedRevision:f.state!.revision,action:"revise",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic operator schedule",
 details:{time:{kind:"scheduled",timeZone:"America/New_York",startsAt,endsAt:new Date(Date.parse(startsAt)+3_600_000).toISOString()},location:"Synthetic site",directions:"Synthetic directions",equipment:"Practice equipment",logisticalNote:"Synthetic logistics",childCapacity:4}});}
function notice(f:Fixture,operation=200,reason="ordinary_absence"){const o=f.state!.occurrences[0]!;return {operationId:id(operation),expectedRevision:f.state!.revision,action:"notice",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason};}
function target(f:Fixture){f.target={...structuredClone(f.state!.occurrences[0]!),id:id(600),cohortId:id(601),stageId:id(602),childCapacity:1,revision:1,state:"published",time:{kind:"scheduled",timeZone:"America/New_York",startsAt:"2026-03-12T15:00:00Z",endsAt:"2026-03-12T16:00:00Z"}};}
function confirm(f:Fixture,operation=300){return {operationId:id(operation),expectedRevision:f.state!.revision,action:"confirm_makeup",noticeId:f.state!.makeups[0]!.notice.id,replacementOccurrenceId:f.target!.id,expectedReplacementRevision:f.target!.revision,reason:"Synthetic instructor fit decision"};}

describe("fishing stage — synthetic transaction port, no native activation",()=>{
 it("creates exactly twelve undated canonical items and replays without duplicating",async()=>{
  const f=await plan(),ids=f.state!.occurrences.map(o=>o.id);expect(new Set(ids).size).toBe(12);expect(f.state!.occurrences.every(o=>o.time.kind==="undated"&&!o.optional&&o.state==="draft")).toBe(true);
  expect(f.resourceRows.size).toBe(0);expect(await service(f).execute(actor(),ref,create)).toMatchObject({stageRevision:1,replayed:true});expect(f.state!.occurrences.map(o=>o.id)).toEqual(ids);
  await expect(service(f).execute(actor(),ref,{...create,childCapacity:3})).rejects.toThrow("CONFLICT");
 });
 it("preserves all 48 stable module identifiers across four independent stage templates",async()=>{
  const all:string[]=[];for(const stage of [1,2,3,4] as const){const f=new Fixture();f.template=template(stage);await service(f).execute(actor(),{...ref,stage},create);all.push(...f.state!.occurrences.map(o=>o.moduleId));}expect(new Set(all).size).toBe(48);expect(all[0]).toBe("RM-101");expect(all.at(-1)).toBe("RM-412");
 });
 it("requires approved source-bound twelve-item template and actual safe capacity",async()=>{
  const f=new Fixture();f.template.modules=[...f.template.modules.slice(1)];await expect(service(f).execute(actor(),ref,create)).rejects.toThrow("APPROVAL_REQUIRED");expect(f.state).toBeNull();
  f.template=template();f.approvedCapacity=3;await expect(service(f).execute(actor(),ref,create)).rejects.toThrow("CAPACITY");
 });
 it("does not turn undated publication into bookings; family sees the full twelve-session plan",async()=>{
  const f=await plan();expect((await service(f).read(actor("parent"),ref))!.occurrences).toHaveLength(0);
  await service(f).execute(actor(),ref,{operationId:id(104),expectedRevision:1,action:"publish"});const read=(await service(f).read(actor("parent"),ref))!;
  expect(read.occurrences).toHaveLength(12);expect(read.nextOccurrenceId).toBeNull();expect(f.resourceRows.size).toBe(0);expect(read.lessonReferences).toHaveLength(1);
 });
 it("can publish the remaining draft plan while retaining a cancelled obligation",async()=>{
  const f=await plan(),o=f.state!.occurrences[0]!;
  await service(f).execute(actor(),ref,{operationId:id(105),expectedRevision:1,action:"cancel",occurrenceId:o.id,expectedOccurrenceRevision:1,reason:"Synthetic unavailable session"});
  await service(f).execute(actor(),ref,{operationId:id(106),expectedRevision:2,action:"publish"});
  const read=(await service(f).read(actor("parent"),ref))!;
  expect(read.occurrences).toHaveLength(12);expect(read.occurrences.filter(item=>item.state==="published")).toHaveLength(11);
  expect(read.occurrences[0]).toMatchObject({id:o.id,state:"cancelled",revision:2});
  expect(f.state!.attendance).toEqual([]);expect(f.resourceRows.size).toBe(0);
 });
 it("one revision appears in instructor, guardian and independently enabled child views",async()=>{
  const f=await scheduled(),first=f.state!.occurrences[0]!.id;await revise(f,"2026-03-09T17:00:00Z",105);
  for(const role of ["practitioner","parent","child"] as const){const v=(await service(f).read(actor(role),ref))!;expect(v.occurrences[0]).toMatchObject({id:first,revision:4,time:{startsAt:"2026-03-09T17:00:00.000Z"}});}
  expect(f.state!.history.filter(h=>h.id===first).map(h=>h.revision)).toEqual([1,2,3]);expect(f.resourceRows.size).toBe(1);
 });
 it("fresh revoked/expired sessions, removed guardian binding, child disablement and adult clients cannot read",async()=>{
  const f=await scheduled();f.revoked=true;expect(await service(f).read(actor("parent"),ref)).toBeNull();f.revoked=false;
  f.guardianCurrent=false;expect(await service(f).read(actor("parent"),ref)).toBeNull();f.guardianCurrent=true;
  f.childEnabled=false;expect(await service(f).read(actor("child"),ref)).toBeNull();f.childEnabled=true;
  expect(await service(f).read({...actor("parent"),expiresAt:0},ref)).toBeNull();expect(await service(f).read(actor("adult_client"),ref)).toBeNull();
 });
 it("purchase/paid guesses and another household/child do not grant access",async()=>{
  const f=await scheduled();f.enrollment={...f.enrollment,state:"pending_review"};expect(await service(f).read(actor("parent"),ref)).toBeNull();
  f.enrollment={...f.enrollment,state:"confirmed",authorizedAccountIds:[]};expect(await service(f).read(actor("parent"),ref)).toBeNull();
  f.enrollment={...f.enrollment,authorizedAccountIds:[actor("child").id],learnerId:asId(id(999),"person")};expect(await service(f).read(actor("child"),ref)).toBeNull();
  await expect(service(f).execute(actor(),ref,{...create,paid:true})).rejects.toThrow();
 });
 it("does not trust a current context with a different workspace, stage or session digest",async()=>{
  const f=await scheduled();for(const change of [(c:NonNullable<Fixture["contextMutator"]> extends (c:infer C)=>void?C:never)=>{c.actor.sessionDigest="different";},c=>{c.scope.workspaceId=id(999);},c=>{c.scope={...c.scope,stageId:id(999)};}] as NonNullable<Fixture["contextMutator"]>[]){f.contextMutator=change;expect(await service(f).read(actor("parent"),ref)).toBeNull();}
 });
 it("rejects non-finite session expiry and missing explicit enrollment evidence",async()=>{
  const f=await scheduled();
  f.contextMutator=c=>{c.actor.expiresAt=Number.NaN;};
  expect(await service(f).read(actor("parent"),ref)).toBeNull();
  f.contextMutator=null;
  f.enrollment={...f.enrollment,evidence:{...f.enrollment.evidence,ownerActionId:" "}};
  expect(await service(f).read(actor("parent"),ref)).toBeNull();
 });
 it("requires a substantive reason before changing a published session",async()=>{
  const f=await scheduled(),o=f.state!.occurrences[0]!;
  await expect(service(f).execute(actor(),ref,{operationId:id(108),expectedRevision:f.state!.revision,action:"cancel",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:" \t "})).rejects.toThrow();
  expect(f.state!.occurrences[0]!.state).toBe("published");
 });
 it("denies family mutations and stale stage/occurrence versions",async()=>{
  const f=await scheduled();await expect(service(f).execute(actor("parent"),ref,{operationId:id(105),expectedRevision:f.state!.revision,action:"publish"})).rejects.toThrow("FORBIDDEN");
  await expect(service(f).execute(actor(),ref,{operationId:id(106),expectedRevision:1,action:"cancel",occurrenceId:f.state!.occurrences[0]!.id,expectedOccurrenceRevision:1,reason:"Synthetic"})).rejects.toThrow("CONFLICT");
  await expect(service(f).execute(actor(),ref,{operationId:id(107),expectedRevision:f.state!.revision,action:"cancel",occurrenceId:f.state!.occurrences[0]!.id,expectedOccurrenceRevision:1,reason:"Synthetic"})).rejects.toThrow("CONFLICT");
 });
 it("serializes competing writers, with one expected-version winner",async()=>{
  const f=await scheduled(),o=f.state!.occurrences[0]!,base={expectedRevision:f.state!.revision,action:"cancel",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic"};
  const results=await Promise.allSettled([service(f).execute(actor(),ref,{...base,operationId:id(110)}),service(f).execute(actor(),ref,{...base,operationId:id(111)})]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(f.state!.occurrences[0]!.state).toBe("cancelled");
 });
 it("preserves state and operation receipts on resource conflict or commit failure",async()=>{
  const f=await scheduled(),before=structuredClone(f.state);f.failResources=true;await expect(revise(f,"2026-03-10T15:00:00Z",112)).rejects.toThrow("RESOURCE_CONFLICT");expect(f.state).toEqual(before);
  f.failResources=false;f.failCommit=true;await expect(revise(f,"2026-03-10T15:00:00Z",112)).rejects.toThrow("STORAGE_FAILURE");expect(f.state).toEqual(before);expect(f.resourceRows.values().next().value?.time).toEqual(before!.occurrences[0]!.time);
 });
 it("cannot reduce capacity below already reserved/confirmed child seats",async()=>{
  const f=await scheduled();f.occupied.set(f.state!.occurrences[0]!.id,5);await expect(revise(f,"2026-03-10T15:00:00Z",113)).rejects.toThrow("CAPACITY");
 });
 it("keeps protected notice time/original revision immutable across moves and retries",async()=>{
  const f=await scheduled(),command=notice(f);await service(f).execute(actor("parent"),ref,command);const original=structuredClone(f.state!.makeups[0]!.notice);
  expect(original.state).toBe("protected");f.now=new Date("2026-03-07T16:00:00Z");expect(await service(f).execute(actor("parent"),ref,command)).toMatchObject({replayed:true});
  await revise(f,"2026-03-08T16:00:00Z",201);expect(f.state!.makeups[0]!.notice).toEqual(original);expect((await service(f).read(actor("parent"),ref))!.notices[0]!.scheduleChangedSinceNotice).toBe(true);
  await expect(service(f).execute(actor("parent"),ref,notice(f,202))).rejects.toThrow("CONFLICT");
 });
 it("binds a guardian retry to the selected child's enrollment, even for siblings",async()=>{
  const f=await scheduled(),command=notice(f),firstEnrollment=f.enrollment.id;
  await service(f).execute(actor("parent"),ref,command);
  f.enrollment={...f.enrollment,id:id(31),learnerId:asId(id(32),"person")};
  await expect(service(f).execute(actor("parent"),ref,command)).rejects.toThrow("CONFLICT");
  expect(f.state!.makeups).toHaveLength(1);expect(f.state!.makeups[0]!.notice.enrollmentId).toBe(firstEnrollment);
  expect((await service(f).read(actor("parent"),ref))!.notices).toEqual([]);
  f.revoked=true;
  await expect(service(f).execute(actor("parent"),ref,command)).rejects.toThrow("FORBIDDEN");
 });
 it("unavoidable late absence requires operator review, avoidable late absence is best effort",async()=>{
  for(const [reason,state] of [["unavoidable","operator_review"],["ordinary_absence","best_effort"]]){const f=await scheduled();f.now=new Date("2026-03-07T15:00:00.001Z");await service(f).execute(actor("parent"),ref,notice(f,200,reason));expect(f.state!.makeups[0]!.notice).toMatchObject({state,entitlementId:null,specificTripGuaranteed:false});}
 });
 it("notice input cannot invent receipt time, policy, medical narrative or child identity",async()=>{
  const f=await scheduled();for(const field of ["receivedAt","policyVersion","medicalNote","learnerId"]){await expect(service(f).execute(actor("parent"),ref,{...notice(f),[field]:"untrusted"})).rejects.toThrow();}expect(f.state!.makeups).toHaveLength(0);
 });
 it("keeps cancellation undelivered without attendance or blame and preserves old notices",async()=>{
  const f=await scheduled();f.now=new Date("2026-03-08T14:00:00Z");await service(f).execute(actor("parent"),ref,notice(f));const old=structuredClone(f.state!.makeups[0]);const o=f.state!.occurrences[0]!;
  await service(f).execute(actor(),ref,{operationId:id(210),expectedRevision:f.state!.revision,action:"cancel",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic weather cancellation"});expect(f.state!.attendance).toEqual([]);expect(f.state!.makeups[0]).toEqual(old);expect((await service(f).read(actor("parent"),ref))!.notices[0]!.state).toBe("operator_undelivered");
 });
 it("a fresh notice on an operator-cancelled dated event preserves its undelivered entitlement",async()=>{
  const f=await scheduled(),o=f.state!.occurrences[0]!;await service(f).execute(actor(),ref,{operationId:id(211),expectedRevision:f.state!.revision,action:"cancel",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic"});await service(f).execute(actor("parent"),ref,notice(f));expect(f.state!.makeups[0]!.notice).toMatchObject({reason:"operator_cancelled",state:"operator_undelivered"});expect(f.state!.makeups[0]!.notice.entitlementId).toBeTruthy();
 });
 it("makeup requests reserve nothing; only an explicit instructor decision reserves one place",async()=>{
  const f=await scheduled();await service(f).execute(actor("parent"),ref,notice(f));const n=f.state!.makeups[0]!.notice;
  await service(f).execute(actor("parent"),ref,{operationId:id(220),expectedRevision:f.state!.revision,action:"request_makeup",noticeId:n.id});expect(f.reservations.size).toBe(0);target(f);const command=confirm(f);
  await service(f).execute(actor(),ref,command);expect(f.reservations.size).toBe(1);expect(f.state!.makeups[0]!.notice.entitlementId).toBe(n.entitlementId);expect(await service(f).execute(actor(),ref,command)).toMatchObject({replayed:true});expect(f.reservations.size).toBe(1);
  await expect(service(f).execute(actor(),ref,confirm(f,301))).rejects.toThrow("CONFLICT");
 });
 it("full or changed replacement target cannot consume a credit or reserve twice",async()=>{
  const f=await scheduled();await service(f).execute(actor("parent"),ref,notice(f));target(f);f.targetOccupied=1;await expect(service(f).execute(actor(),ref,confirm(f))).rejects.toThrow("CAPACITY");expect(f.state!.makeups[0]!.notice.replacementReservationId).toBeNull();expect(f.reservations.size).toBe(0);
  f.targetOccupied=0;f.targetRevisionDrift=true;await expect(service(f).execute(actor(),ref,confirm(f))).rejects.toThrow("TARGET_CONFLICT");expect(f.reservations.size).toBe(0);
 });
 it("cannot substitute an optional paid excursion, unsuitable session or other workspace",async()=>{
  const f=await scheduled();await service(f).execute(actor("parent"),ref,notice(f));target(f);f.target={...f.target!,optional:true};await expect(service(f).execute(actor(),ref,confirm(f))).rejects.toThrow("INVALID_STATE");
  target(f);f.targetSuitable=false;await expect(service(f).execute(actor(),ref,confirm(f))).rejects.toThrow("APPROVAL_REQUIRED");f.targetSuitable=true;f.target={...f.target!,workspaceId:asId(id(999),"workspace")};await expect(service(f).execute(actor(),ref,confirm(f))).rejects.toThrow("INVALID_STATE");
 });
 it("binds a replacement to the requested target and a valid real scheduled instant",async()=>{
  const f=await scheduled();await service(f).execute(actor("parent"),ref,notice(f));target(f);
  await expect(service(f).execute(actor(),ref,{...confirm(f),replacementOccurrenceId:id(999)})).rejects.toThrow("INVALID_STATE");
  f.target={...f.target!,time:{kind:"scheduled",timeZone:"America/New_York",startsAt:"not-an-instant",endsAt:"2026-03-12T16:00:00Z"}};
  await expect(service(f).execute(actor(),ref,confirm(f))).rejects.toThrow();
  expect(f.reservations.size).toBe(0);
  expect(f.state!.makeups[0]!.notice.replacementOccurrenceId).toBeNull();
 });
 it("rolls back a replacement reservation when receipt/state commit fails",async()=>{
  const f=await scheduled();await service(f).execute(actor("parent"),ref,notice(f));target(f);f.failCommit=true;await expect(service(f).execute(actor(),ref,confirm(f))).rejects.toThrow("STORAGE_FAILURE");expect(f.reservations.size).toBe(0);expect(f.targetOccupied).toBe(0);expect(f.state!.makeups[0]!.notice.replacementOccurrenceId).toBeNull();
 });
 it("no elapsed date, cancellation or completion automatically marks a learner present",async()=>{
  const f=await scheduled(),o=f.state!.occurrences[0]!;const command={operationId:id(230),expectedRevision:f.state!.revision,action:"complete",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic actual delivery"};
  await expect(service(f).execute(actor(),ref,command)).rejects.toThrow("INVALID_STATE");f.now=new Date("2026-03-08T17:00:00Z");await service(f).execute(actor(),ref,command);expect(f.state!.attendance).toEqual([]);
  await service(f).execute(actor(),ref,{operationId:id(231),expectedRevision:f.state!.revision,action:"attendance",occurrenceId:o.id,expectedOccurrenceRevision:f.state!.occurrences[0]!.revision,enrollmentId:f.enrollment.id,state:"present",reason:"Synthetic observation"});
  await service(f).execute(actor(),ref,{operationId:id(232),expectedRevision:f.state!.revision,action:"attendance",occurrenceId:o.id,expectedOccurrenceRevision:f.state!.occurrences[0]!.revision,enrollmentId:f.enrollment.id,state:"late",reason:"Synthetic factual correction"});expect(f.state!.attendance.map(a=>a.state)).toEqual(["present","late"]);
 });
 it("reopens canonical state and projects no private teacher/billing/other-family material",async()=>{
  const f=await scheduled();Object.assign(f.state!,{privateTeacherNote:"SECRET TEACHER",providerAccountId:"SECRET PROVIDER",otherFamilyRoster:["SECRET FAMILY"]});Object.assign(f.state!.occurrences[0]!,{teacherKey:"SECRET KEY"});
  const reopened=f.reopen(),parent=(await service(reopened).read(actor("parent"),ref))!,child=(await service(reopened).read(actor("child"),ref))!;
  expect(parent.occurrences).toHaveLength(12);expect(JSON.stringify(parent)+JSON.stringify(child)).not.toMatch(/SECRET|providerAccountId|privateTeacher|teacherKey|otherFamilyRoster/);expect(child.notices).toEqual([]);expect(child.occurrences[0]!.allowedActions).toEqual(["read"]);
 });
});
