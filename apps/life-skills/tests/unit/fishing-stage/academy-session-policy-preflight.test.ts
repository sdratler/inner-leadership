import {describe,it,expect} from "vitest";
import {assessAcademySessionDuration,assessAcademyTravelChange} from "../../../src/features/fishing-stage/academy-session-policy-preflight.ts";
import {academyPolicyPreflightVersion,type AcademySessionDurationInput,type AcademySessionDurationResult,
 type AcademyTravelChangeInput,type AcademyTravelChangeResult,type AcademyOriginalSessionAnchor} from "../../../src/features/fishing/academy-policy-preflight-contract.ts";

const version=academyPolicyPreflightVersion;
function duration(overrides:Partial<AcademySessionDurationInput>={}):AcademySessionDurationInput{
 return {version,sessionKind:"ordinary",time:{kind:"scheduled",startsAt:"2026-12-06T09:00:00-05:00",endsAt:"2026-12-06T12:00:00-05:00",timeZone:"America/New_York"},...overrides};
}
function scheduled(startsAt:string,endsAt:string,timeZone="America/New_York"):AcademySessionDurationInput{
 return duration({time:{kind:"scheduled",startsAt,endsAt,timeZone}});
}
function original(overrides:Partial<AcademyOriginalSessionAnchor>={}):AcademyOriginalSessionAnchor{
 return {workspaceId:"synthetic-workspace",learnerId:"synthetic-child-a",cohortId:"synthetic-cohort",stageId:"synthetic-stage",
  occurrenceId:"synthetic-original-1",ordinal:1,moduleId:"synthetic-module",moduleVersion:"synthetic-v1",activityId:"synthetic-activity",...overrides};
}
function travel(overrides:Partial<AcademyTravelChangeInput>={}):AcademyTravelChangeInput{
 const anchor=overrides.original??original();
 return {version,original:anchor,obligation:{anchor:{...anchor},evidenceId:"synthetic-purchase-proof",state:"purchased_undelivered"},existingCredit:null,sessionKind:"ordinary",
  change:{anchor:{...anchor},kind:"academy_venue",evidenceId:"synthetic-change-proof",weatherQualification:"unknown",recordedDriveLimit:"up_to_30",revisedOneWayMinutes:45,familyCannotAttend:true},...overrides};
}
function changed(overrides:Partial<AcademyTravelChangeInput["change"]>):AcademyTravelChangeInput{
 const input=travel();return {...input,change:{...input.change,...overrides}};
}
function credited(input:AcademyTravelChangeInput,state:NonNullable<AcademyTravelChangeInput["existingCredit"]>["state"]="outstanding"):AcademyTravelChangeInput{
 return {...input,existingCredit:{anchor:{...input.original},creditId:"synthetic-existing-credit",state}};
}
function freeze<T>(value:T):T{
 if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
function checkDuration(input:unknown,status:AcademySessionDurationResult["status"],reason:AcademySessionDurationResult["reason"],elapsedMinutes:number|null){
 const result=assessAcademySessionDuration(input as AcademySessionDurationInput);
 expect(result).toEqual({version,status,reason,elapsedMinutes,mayBook:false});return result;
}
function checkTravel(input:unknown,status:AcademyTravelChangeResult["status"],reason:AcademyTravelChangeResult["reason"]){
 const result=assessAcademyTravelChange(input as AcademyTravelChangeInput);
 expect(result).toEqual({version,status,reason,mayIssueCredit:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false});return result;
}

describe("Academy ordinary duration is actual elapsed time, never booking permission",()=>{
 it("matches exactly 180 minutes and preserves frozen input",()=>{
  const input=freeze(duration()),before=structuredClone(input);
  checkDuration(input,"ordinary_duration_matches","ordinary_180_minutes",180);expect(input).toEqual(before);
 });
 it.each([
  ["legacy one hour","2026-12-06T10:00:00-05:00",60],
  ["one millisecond short","2026-12-06T11:59:59.999-05:00",179.99998333333335],
  ["one millisecond long","2026-12-06T12:00:00.001-05:00",180.00001666666665],
 ] as const)("requires review for %s",(_name,end,elapsed)=>{
  checkDuration(scheduled("2026-12-06T09:00:00-05:00",end),"duration_review_required","ordinary_duration_mismatch",elapsed);
 });
 it.each([
  ["spring offset change","2026-03-08T01:30:00-05:00","2026-03-08T05:30:00-04:00",180],
  ["fall offset change","2026-11-01T00:30:00-04:00","2026-11-01T02:30:00-05:00",180],
  ["spring wall-clock three hours","2026-03-08T01:30:00-05:00","2026-03-08T04:30:00-04:00",120],
  ["fall wall-clock three hours","2026-11-01T00:30:00-04:00","2026-11-01T03:30:00-05:00",240],
 ] as const)("uses actual elapsed time through %s",(_name,start,end,elapsed)=>{
  checkDuration(scheduled(start,end),elapsed===180?"ordinary_duration_matches":"duration_review_required",elapsed===180?"ordinary_180_minutes":"ordinary_duration_mismatch",elapsed);
 });
 it("accepts explicit UTC instants and minute precision without the host timezone",()=>{
  checkDuration(scheduled("2026-12-06T14:00Z","2026-12-06T17:00Z"),"ordinary_duration_matches","ordinary_180_minutes",180);
 });
 it("recognizes a real leap day",()=>{
  checkDuration(scheduled("2028-02-29T09:00:00Z","2028-02-29T12:00:00Z","UTC"),"ordinary_duration_matches","ordinary_180_minutes",180);
 });
 it("leaves an ordinary undated session unbookable",()=>{
  checkDuration(duration({time:{kind:"undated",timeZone:"America/New_York"}}),"undated","undated",null);
 });
 it.each(["keys","offshore","unclassified"] as const)("requires separate %s terms even at 180 minutes",sessionKind=>{
  checkDuration(duration({sessionKind}),"exception_review_required","separate_exception_terms",180);
  checkDuration(duration({sessionKind,time:{kind:"undated",timeZone:"America/New_York"}}),"exception_review_required","separate_exception_terms",null);
 });
 it("does not infer an exception from a venue or week number",()=>{
  const input={...scheduled("2026-12-06T09:00:00Z","2026-12-06T10:00:00Z"),venue:"Keys",ordinal:12};
  checkDuration(input,"duration_review_required","ordinary_duration_mismatch",60);
 });
 it.each([
  ["missing offset","2026-12-06T09:00:00","2026-12-06T12:00:00Z"],
  ["impossible February day","2026-02-30T09:00:00Z","2026-02-30T12:00:00Z"],
  ["non-leap February","2026-02-29T09:00:00Z","2026-02-29T12:00:00Z"],
  ["invalid month","2026-13-01T09:00:00Z","2026-13-01T12:00:00Z"],
  ["hour rollover","2026-12-06T24:00:00Z","2026-12-07T03:00:00Z"],
  ["invalid second","2026-12-06T09:00:60Z","2026-12-06T12:00:00Z"],
  ["invalid offset","2026-12-06T09:00:00+24:00","2026-12-06T12:00:00+24:00"],
  ["unsupported sub-millisecond precision","2026-12-06T09:00:00.0001Z","2026-12-06T12:00:00.0002Z"],
  ["equal endpoints","2026-12-06T09:00:00Z","2026-12-06T09:00:00Z"],
  ["reverse endpoints","2026-12-06T12:00:00Z","2026-12-06T09:00:00Z"],
  ["invalid instant","not-a-time","2026-12-06T12:00:00Z"],
 ] as const)("rejects %s without echoing timestamps",(_name,start,end)=>{
  checkDuration(scheduled(start,end),"duration_review_required","invalid_input",null);
 });
 it.each([
  ["null",null],["array",[]],["missing time",{version,sessionKind:"ordinary"}],
  ["wrong version",{...duration(),version:"old"}],["unknown kind",{...duration(),sessionKind:"venue_inferred"}],
  ["invalid timezone",scheduled("2026-12-06T09:00Z","2026-12-06T12:00Z","Invalid/Zone")],
  ["undated invalid timezone",duration({time:{kind:"undated",timeZone:""}})],
 ] as const)("returns a fixed safe result for %s",(_name,input)=>{checkDuration(input,"duration_review_required","invalid_input",null);});
});

describe("Academy travel changes preserve each purchased original child-session obligation",()=>{
 it.each([
  ["30 to 45","up_to_30",45,"replacement_review_required","academy_change_exceeds_limit"],
  ["30 exact edge","up_to_30",30,"no_new_credit","within_recorded_limit"],
  ["45 exact edge","up_to_45",45,"no_new_credit","within_recorded_limit"],
  ["45 exceeded","up_to_45",45.01,"replacement_review_required","academy_change_exceeds_limit"],
  ["60 exact edge","up_to_60",60,"no_new_credit","within_recorded_limit"],
  ["60 exceeded","up_to_60",60.01,"replacement_review_required","academy_change_exceeds_limit"],
  ["zero travel","up_to_30",0,"no_new_credit","within_recorded_limit"],
 ] as const)("honors the recorded limit at %s",(_name,recordedDriveLimit,revisedOneWayMinutes,status,reason)=>{
  checkTravel(changed({recordedDriveLimit,revisedOneWayMinutes}),status,reason);
 });
 it("handles an Academy schedule change using the same family's limit",()=>{
  checkTravel(changed({kind:"academy_schedule"}),"replacement_review_required","academy_change_exceeds_limit");
 });
 it.each([45,61,240,null])("does not invent an over-60 maximum for revised minutes %s",revisedOneWayMinutes=>{
  checkTravel(changed({recordedDriveLimit:"over_60",revisedOneWayMinutes}),"facts_required","drive_limit_requires_facts");
 });
 it("requires a known revised journey",()=>checkTravel(changed({revisedOneWayMinutes:null}),"facts_required","drive_limit_requires_facts"));
 it("requires a known attendance response",()=>checkTravel(changed({familyCannotAttend:null}),"facts_required","attendance_requires_facts"));
 it("does not create a new credit when the family can attend",()=>checkTravel(changed({familyCannotAttend:false}),"no_new_credit","family_can_attend"));
 it("preserves qualifying weather obligations without requiring drive/attendance facts",()=>{
  checkTravel(changed({kind:"academy_weather_cancelled",weatherQualification:"qualifying",recordedDriveLimit:"over_60",revisedOneWayMinutes:null,familyCannotAttend:null}),"replacement_review_required","qualifying_weather_cancellation");
 });
 it("requires review for unknown weather qualification",()=>checkTravel(changed({kind:"academy_weather_cancelled"}),"facts_required","weather_requires_review"));
 it("does not qualify a known nonqualifying weather event",()=>checkTravel(changed({kind:"academy_weather_cancelled",weatherQualification:"not_qualifying"}),"no_new_credit","no_qualifying_change"));
 it("does not rewrite parent absence policy even when travel exceeds the limit",()=>checkTravel(changed({kind:"parent_absence"}),"no_new_credit","existing_absence_policy"));
 it("does not infer qualification for another kind of change",()=>checkTravel(changed({kind:"other"}),"no_new_credit","no_qualifying_change"));
 it.each(["keys","offshore","unclassified"] as const)("does not apply ordinary travel terms to %s",sessionKind=>{
  checkTravel(travel({sessionKind}),"facts_required","separate_exception_terms");
 });
 it("requires a purchased obligation",()=>checkTravel(travel({obligation:null}),"facts_required","obligation_missing"));
 it.each([
  ["unknown","facts_required","obligation_unknown"],
  ["unpurchased","no_new_credit","obligation_not_purchased"],
  ["delivered","no_new_credit","obligation_delivered"],
 ] as const)("does not grant a new or retained credit for %s obligation",(state,status,reason)=>{
  const input=travel({obligation:{anchor:original(),evidenceId:"synthetic-proof",state}});
  checkTravel(input,status,reason);checkTravel(credited(input,"replacement_reserved"),status,reason);
 });
 it("requires nonempty purchase evidence",()=>checkTravel(travel({obligation:{anchor:original(),evidenceId:" ",state:"purchased_undelivered"}}),"facts_required","obligation_unknown"));
 it("requires nonempty change evidence",()=>checkTravel(changed({evidenceId:""}),"facts_required","change_evidence_missing"));
 it.each(["outstanding","replacement_reserved"] as const)("retains the same %s credit through repeated changes",state=>{
  const input=freeze(credited(travel(),state)),before=structuredClone(input);
  checkTravel(input,"retain_existing_credit","same_outstanding_credit");
  const later={...input,change:{...input.change,evidenceId:"synthetic-later-change",revisedOneWayMinutes:75}};
  checkTravel(later,"retain_existing_credit","same_outstanding_credit");expect(input).toEqual(before);
 });
 it("does not revoke an outstanding obligation merely because a later event fails new-credit criteria",()=>{
  for(const input of [changed({familyCannotAttend:false}),changed({kind:"parent_absence"}),changed({kind:"academy_weather_cancelled",weatherQualification:"unknown"})]){
   checkTravel(credited(input),"retain_existing_credit","same_outstanding_credit");
  }
 });
 it.each([
  ["delivered","no_new_credit","credit_delivered"],
  ["unknown","facts_required","credit_unknown"],
 ] as const)("does not reuse a credit in state %s",(state,status,reason)=>{checkTravel(credited(travel(),state),status,reason);});
 it("requires a nonempty existing credit identity",()=>{
  checkTravel(travel({existingCredit:{anchor:original(),creditId:"",state:"outstanding"}}),"facts_required","credit_unknown");
 });

 const changedAnchors:readonly (readonly [string,AcademyOriginalSessionAnchor])[]=[
  ["workspace",original({workspaceId:"synthetic-other-workspace"})],["learner",original({learnerId:"synthetic-child-b"})],
  ["cohort",original({cohortId:"synthetic-other-cohort"})],["stage",original({stageId:"synthetic-other-stage"})],
  ["original occurrence",original({occurrenceId:"synthetic-original-2"})],["week",original({ordinal:2})],
  ["module",original({moduleId:"synthetic-other-module"})],["module version",original({moduleVersion:"synthetic-v2"})],
  ["learning activity",original({activityId:"synthetic-other-activity"})],
 ];
 it.each(changedAnchors)("rejects a different %s on the change",(_name,anchor)=>{checkTravel(changed({anchor}),"facts_required","original_anchor_mismatch");});
 it.each(changedAnchors)("rejects a different %s on the purchase",(_name,anchor)=>{
  checkTravel(travel({obligation:{anchor,evidenceId:"synthetic-proof",state:"purchased_undelivered"}}),"facts_required","original_anchor_mismatch");
 });
 it.each(changedAnchors)("rejects a different %s on the existing credit",(_name,anchor)=>{
  checkTravel(travel({existingCredit:{anchor,creditId:"synthetic-existing-credit",state:"outstanding"}}),"facts_required","credit_anchor_mismatch");
 });
 it("keeps two children and two original sessions independent without a stage-wide cap",()=>{
  const anchors=[original(),original({learnerId:"synthetic-child-b"}),original({occurrenceId:"synthetic-original-2",ordinal:2,activityId:"synthetic-activity-2"})];
  for(const anchor of anchors){
   const input=freeze(travel({original:anchor})),before=structuredClone(input);
   checkTravel(input,"replacement_review_required","academy_change_exceeds_limit");expect(input).toEqual(before);
  }
 });
 it.each([
  ["null",null],["array",[]],["missing change",{version,original:original()}],["old version",{...travel(),version:"old"}],
  ["unknown session kind",{...travel(),sessionKind:"guessed"}],["missing activity",travel({original:{...original(),activityId:undefined} as unknown as AcademyOriginalSessionAnchor})],
  ["blank identity",travel({original:original({workspaceId:" "})})],
  ["week zero",travel({original:original({ordinal:0})})],["week thirteen",travel({original:original({ordinal:13})})],
  ["fractional week",travel({original:original({ordinal:1.5})})],["infinite week",travel({original:original({ordinal:Infinity})})],
  ["malformed purchase",travel({obligation:{} as NonNullable<AcademyTravelChangeInput["obligation"]>})],
  ["malformed credit",travel({existingCredit:{} as NonNullable<AcademyTravelChangeInput["existingCredit"]>})],
 ] as const)("handles malformed %s with a fixed safe result",(_name,input)=>{checkTravel(input,"facts_required","invalid_input");});
 it.each([-1,NaN,Infinity,-Infinity,"45",undefined])("rejects malformed revised minutes %s",revisedOneWayMinutes=>{
  checkTravel(changed({revisedOneWayMinutes:revisedOneWayMinutes as number}),"facts_required","invalid_input");
 });
 it("does not coerce string attendance, unknown limit or weather flags",()=>{
  checkTravel(changed({familyCannotAttend:"true" as unknown as boolean}),"facts_required","invalid_input");
  checkTravel(changed({recordedDriveLimit:"unlimited" as "over_60"}),"facts_required","invalid_input");
  checkTravel(changed({weatherQualification:"yes" as "qualifying"}),"facts_required","invalid_input");
 });
});

describe("fixed output privacy and input immutability",()=>{
 it("does not invoke accessors on malformed facts",()=>{
  let invoked=false;const value={get version(){invoked=true;throw new Error("synthetic-private-sentinel");}};
  checkDuration(value,"duration_review_required","invalid_input",null);checkTravel(value,"facts_required","invalid_input");expect(invoked).toBe(false);
 });
 it("contains reflective failures without returning exception text",()=>{
  const value=new Proxy({}, {getOwnPropertyDescriptor(){throw new Error("synthetic-private-sentinel");}});
  expect(JSON.stringify(checkDuration(value,"duration_review_required","invalid_input",null))).not.toContain("synthetic-private-sentinel");
  expect(JSON.stringify(checkTravel(value,"facts_required","invalid_input"))).not.toContain("synthetic-private-sentinel");
 });
 it("does not mutate frozen facts or return input IDs, dates, promises or new credit identities",()=>{
  for(const value of [travel(),credited(travel()),credited(travel(),"replacement_reserved"),changed({kind:"parent_absence"}),travel({obligation:null})]){
   const input=freeze(value),before=structuredClone(input),result=assessAcademyTravelChange(input);
   expect(input).toEqual(before);expect(Object.isFrozen(result)).toBe(true);
   expect(Object.keys(result).sort()).toEqual(["version","status","reason","mayIssueCredit","mayBook","mayMarkDelivered","specificDateOrSeatGuaranteed"].sort());
   expect(result.mayIssueCredit||result.mayBook||result.mayMarkDelivered||result.specificDateOrSeatGuaranteed).toBe(false);
   expect(JSON.stringify(result)).not.toContain("synthetic-");
  }
 });
});
