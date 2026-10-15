import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {canonicalTime,floridaWallTimeCandidates,resolveFloridaWallTime,noticeState} from "../../../src/features/fishing-stage/time.ts";
import {assertCompleteLessonAnswers,stageLessonReference} from "../../../src/features/fishing-stage/classroom.ts";
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import {Fixture,actor,id,ref} from "./fixture.ts";

describe("Florida instants and existing Resources boundary",()=>{
 it("rejects the spring gap and requires a deliberate choice for the fall overlap",()=>{
  expect(floridaWallTimeCandidates("2026-03-08T02:30")).toEqual([]);expect(()=>resolveFloridaWallTime("2026-03-08T02:30")).toThrow("NONEXISTENT");
  expect(floridaWallTimeCandidates("2026-11-01T01:30")).toEqual(["2026-11-01T05:30:00.000Z","2026-11-01T06:30:00.000Z"]);
  expect(()=>resolveFloridaWallTime("2026-11-01T01:30")).toThrow("CHOICE_REQUIRED");expect(resolveFloridaWallTime("2026-11-01T01:30","2026-11-01T01:30:00-05:00")).toBe("2026-11-01T06:30:00.000Z");
  expect(()=>resolveFloridaWallTime("2026-11-01T01:30","2026-11-01T01:30:00")).toThrow("INVALID");expect(()=>resolveFloridaWallTime("2026-11-01T01:30","2026-11-01T07:30:00Z")).toThrow("MISMATCH");
 });
 it("validates real civil dates and uses Florida independently of host/Israel timezone",()=>{
  expect(()=>resolveFloridaWallTime("2026-02-30T12:00")).toThrow("INVALID");expect(resolveFloridaWallTime("2026-07-01T12:00")).toBe("2026-07-01T16:00:00.000Z");
  expect(resolveFloridaWallTime("2026-01-01T12:00")).toBe("2026-01-01T17:00:00.000Z");
  expect(()=>canonicalTime({kind:"scheduled",timeZone:"Asia/Jerusalem",startsAt:"2026-07-01T16:00:00Z",endsAt:"2026-07-01T17:00:00Z"})).toThrow();
  expect(()=>canonicalTime({kind:"scheduled",timeZone:"America/New_York",startsAt:"2026-07-01T16:00:00Z",endsAt:"2026-07-01T15:00:00Z"})).toThrow();
 });
 it("compares 24 elapsed hours, including the exact boundary and both DST changes",()=>{
  expect(noticeState("2026-03-07T15:00:00Z","2026-03-08T15:00:00Z","ordinary_absence")).toBe("protected");
  expect(noticeState("2026-03-07T15:00:00.001Z","2026-03-08T15:00:00Z","ordinary_absence")).toBe("best_effort");
  expect(noticeState("2026-03-07T12:00:00-05:00","2026-03-08T12:00:00-04:00","ordinary_absence")).toBe("best_effort");
  expect(noticeState("2026-10-31T12:00:00-04:00","2026-11-01T12:00:00-05:00","ordinary_absence")).toBe("protected");
  expect(noticeState("2026-03-08T14:59:00Z","2026-03-08T15:00:00Z","unavoidable")).toBe("operator_review");
 });
 it("requires all actual approved questions for final submit; no partial/extra/blank/duplicate answer",()=>{
  const lesson={status:"approved" as const,questions:[{id:"Q01-1",prompt:"Synthetic 1"},{id:"Q01-2",prompt:"Synthetic 2"}]};
  const answers=[{questionId:"Q01-1",value:"Synthetic answer 1"},{questionId:"Q01-2",value:"Synthetic answer 2"}];expect(()=>assertCompleteLessonAnswers(lesson,answers)).not.toThrow();
  for(const invalid of [answers.slice(0,1),[answers[0]!,answers[0]!],[answers[0]!,{questionId:"Q02-1",value:"Wrong version question"}],[answers[0]!,{questionId:"Q01-2",value:"  "}]])expect(()=>assertCompleteLessonAnswers(lesson,invalid)).toThrow("COMPLETE_ANSWERS_REQUIRED");
  expect(()=>assertCompleteLessonAnswers({...lesson,status:"prepared"},answers)).toThrow();
 });
 it("links only a bound approved module/version through existing Resources references",async()=>{
  const f=new Fixture(),app=new FishingStageService(f,{now:()=>f.now});await app.execute(actor(),ref,{action:"create",operationId:id(100),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});
  await app.execute(actor(),ref,{action:"publish",operationId:id(101),expectedRevision:1});const view=(await app.read(actor("parent"),ref))!;
  expect(stageLessonReference(view,view.occurrences[0]!.id,id(3))).toEqual({learnerId:id(3),moduleId:"RM-101",version:"synthetic-module-v1"});
  expect(stageLessonReference(view,view.occurrences[1]!.id,id(3))).toBeNull();expect(stageLessonReference(view,id(999),id(3))).toBeNull();
 });
});
