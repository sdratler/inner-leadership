import {describe,expect,it} from "vitest";
import {assessAcademyFoundationPreparationDuration,assessAcademySessionDuration} from "../../../src/features/fishing-stage/academy-session-policy-preflight.ts";
import {academyFoundationPreparationPolicyVersion,academyPolicyPreflightVersion,type AcademyFoundationPreparationDurationInput} from "../../../src/features/fishing/academy-policy-preflight-contract.ts";

function input():AcademyFoundationPreparationDurationInput{return {version:academyFoundationPreparationPolicyVersion,sessionKind:"foundation_preparation",stage:1,originalOrdinal:1,
 time:{kind:"scheduled",startsAt:"2026-12-06T09:00:00-05:00",endsAt:"2026-12-06T11:00:00-05:00",timeZone:"America/New_York"}};}
function assess(value:unknown){return assessAcademyFoundationPreparationDuration(value as AcademyFoundationPreparationDurationInput);}
function noEffects(result:ReturnType<typeof assess>){expect(result).toMatchObject({mayBook:false,mayIssueCredit:false,mayMarkDelivered:false});expect(Object.isFrozen(result)).toBe(true);}

describe("Foundation preparation duration, advisory only",()=>{
 it.each([1,2] as const)("classifies only stage1 original meeting%s as two-hour preparation",originalOrdinal=>{
  const value=input();Object.freeze(value.time);Object.freeze(value);const before=structuredClone(value);
  const result=assess({...value,originalOrdinal});expect(result).toEqual({version:academyFoundationPreparationPolicyVersion,status:"foundation_preparation_duration_matches",reason:"foundation_preparation_120_minutes",elapsedMinutes:120,mayBook:false,mayIssueCredit:false,mayMarkDelivered:false});expect(value).toEqual(before);noEffects(result);
 });
 it.each([3,12,0,1.5,"1",null])("does not apply preparation duration to original ordinal %s",originalOrdinal=>{const result=assess({...input(),originalOrdinal});expect(result.reason).toBe("invalid_input");noEffects(result);});
 it.each([2,4,"1",undefined])("does not infer Foundation from stage %s",stage=>{const result=assess({...input(),stage});expect(result.reason).toBe("invalid_input");noEffects(result);});
 it.each(["ordinary","keys","offshore","unclassified"])("cannot relabel %s as preparation",sessionKind=>{const result=assess({...input(),sessionKind});expect(result.reason).toBe("invalid_input");noEffects(result);});
 it("rejects stale or missing context and wrong timezone without echoing inputs",()=>{
  for(const value of[{...input(),version:academyPolicyPreflightVersion},{...input(),originalOrdinal:undefined},{...input(),time:{...input().time,timeZone:"UTC"}},null]){
   const result=assess(value);expect(result).toMatchObject({status:"duration_review_required",reason:"invalid_input",elapsedMinutes:null});noEffects(result);
  }
 });
 it.each([["2026-12-06T10:59:00-05:00",119],["2026-12-06T11:00:00.001-05:00",120+1/60000],["2026-12-06T12:00:00-05:00",180]] as const)("does not round or accept end %s",(endsAt,elapsed)=>{
  const result=assess({...input(),time:{...input().time,endsAt}});expect(result).toMatchObject({status:"duration_review_required",reason:"foundation_preparation_duration_mismatch"});expect(result.elapsedMinutes).toBeCloseTo(elapsed,8);noEffects(result);
 });
 it.each(["2026-12-06T11:00:00","2026-02-30T11:00:00-05:00","2026-12-06T09:00:00-05:00","2026-12-06T08:00:00-05:00"])("rejects invalid or non-forward end %s",endsAt=>{const result=assess({...input(),time:{...input().time,endsAt}});expect(result.reason).toBe("invalid_input");noEffects(result);});
 it("keeps undated preparation unready",()=>{const result=assess({...input(),time:{kind:"undated",timeZone:"America/New_York"}});expect(result).toMatchObject({status:"undated",reason:"undated",elapsedMinutes:null});noEffects(result);});
 it("uses actual instants across fallback rather than two wall-clock labels",()=>{
  const result=assess({...input(),time:{kind:"scheduled",startsAt:"2026-11-01T00:30:00-04:00",endsAt:"2026-11-01T01:30:00-05:00",timeZone:"America/New_York"}});expect(result).toMatchObject({status:"foundation_preparation_duration_matches",elapsedMinutes:120});noEffects(result);
 });
 it("does not invoke accessors or accept inherited context",()=>{
  let called=0;const getter={...input()};Object.defineProperty(getter,"stage",{get(){called++;return 1;}});
  for(const value of[getter,Object.create(input()),{...input(),time:Object.create(input().time)}]){const result=assess(value);expect(result.reason).toBe("invalid_input");noEffects(result);}expect(called).toBe(0);
 });
 it("retains ordinary180 and exception handling instead of making the old native seam accept preparation",()=>{
  const value=input();const ordinary={version:academyPolicyPreflightVersion,sessionKind:"ordinary" as const,time:value.time};
  expect(assessAcademySessionDuration(ordinary)).toMatchObject({status:"duration_review_required",reason:"ordinary_duration_mismatch",elapsedMinutes:120,mayBook:false});
  expect(assessAcademySessionDuration({...ordinary,time:{...ordinary.time,kind:"scheduled",startsAt:"2026-12-06T09:00:00-05:00",endsAt:"2026-12-06T12:00:00-05:00"}})).toMatchObject({status:"ordinary_duration_matches",elapsedMinutes:180});
  expect(assessAcademySessionDuration({...ordinary,sessionKind:"keys"})).toMatchObject({status:"exception_review_required",mayBook:false});
 });
});
