import {
 academyPolicyPreflightVersion,academyOrdinarySessionMinutes,
 type AcademySessionDurationInput,type AcademySessionDurationResult,
 type AcademyTravelChangeInput,type AcademyTravelChangeResult,type AcademyOriginalSessionAnchor,
} from "../fishing/academy-policy-preflight-contract.ts";

/** Unmounted Source03 classifiers, not native authorization or a credit ledger.
 * Root must resolve and revalidate these facts in its authorized transaction.
 * Only fixed reasons/scalars leave this module; it has no clock, I/O or writes. */
const sessionKinds=["ordinary","keys","offshore","unclassified"] as const;
const anchorTextKeys=["workspaceId","learnerId","cohortId","stageId","occurrenceId","moduleId","moduleVersion","activityId"] as const;
function nonempty(value:unknown):value is string{return typeof value==="string"&&value.length>0&&value===value.trim();}
function member<T extends string>(value:unknown,choices:readonly T[]):value is T{return typeof value==="string"&&choices.includes(value as T);}
/** Read only named own data properties. Accessors are not invoked; unrelated
 * metadata cannot supply policy, classify an exception, or enter the result. */
function data(value:unknown,keys:readonly string[]):Record<string,unknown>|null{
 if(typeof value!=="object"||value===null||Array.isArray(value))return null;
 const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)return null;
 const copy:Record<string,unknown>=Object.create(null);
 for(const key of keys){
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,"value"))return null;
  copy[key]=descriptor.value;
 }
 return copy;
}
function anchor(value:unknown):AcademyOriginalSessionAnchor|null{
 const fields=data(value,[...anchorTextKeys,"ordinal"]);
 if(!fields||!anchorTextKeys.every(key=>nonempty(fields[key]))||typeof fields.ordinal!=="number"||
  !Number.isInteger(fields.ordinal)||fields.ordinal<1||fields.ordinal>12)return null;
 return {workspaceId:fields.workspaceId as string,learnerId:fields.learnerId as string,cohortId:fields.cohortId as string,
  stageId:fields.stageId as string,occurrenceId:fields.occurrenceId as string,ordinal:fields.ordinal,
  moduleId:fields.moduleId as string,moduleVersion:fields.moduleVersion as string,activityId:fields.activityId as string};
}
function sameAnchor(left:AcademyOriginalSessionAnchor,right:AcademyOriginalSessionAnchor):boolean{
 return left.ordinal===right.ordinal&&anchorTextKeys.every(key=>left[key]===right[key]);
}
function validZone(value:unknown):value is string{
 if(!nonempty(value))return false;
 try{new Intl.DateTimeFormat("en-US",{timeZone:value}).format(0);return true;}catch{return false;}
}
/** Explicit offsets/Z identify instants; the named zone must also be valid.
 * Never parse naive local wall times or use the host timezone/clock. Calendar
 * validation prevents Date.parse from rolling impossible dates into next month.
 * Millisecond precision avoids silently rounding a duration into 180 minutes. */
function instant(value:unknown):number|null{
 if(typeof value!=="string")return null;
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
 if(!match)return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1]!||Number(match[4])>23||Number(match[5])>59||
  Number(match[6]??0)>59||Number(match[9]??0)>23||Number(match[10]??0)>59)return null;
 const milliseconds=Date.parse(value);return Number.isFinite(milliseconds)&&milliseconds>0?milliseconds:null;
}
function durationResult(status:AcademySessionDurationResult["status"],reason:AcademySessionDurationResult["reason"],elapsedMinutes:number|null):AcademySessionDurationResult{
 return Object.freeze({version:academyPolicyPreflightVersion,status,reason,elapsedMinutes,mayBook:false});
}
function invalidDuration():AcademySessionDurationResult{return durationResult("duration_review_required","invalid_input",null);}

export function assessAcademySessionDuration(input:AcademySessionDurationInput):AcademySessionDurationResult{
 try{
  const value=data(input,["version","sessionKind","time"]);
  if(!value||value.version!==academyPolicyPreflightVersion||!member(value.sessionKind,sessionKinds))return invalidDuration();
  const time=data(value.time,["kind","timeZone"]);
  if(!time||!validZone(time.timeZone)||!member(time.kind,["scheduled","undated"]))return invalidDuration();
  let elapsedMinutes:number|null=null;
  if(time.kind==="scheduled"){
   const scheduled=data(value.time,["startsAt","endsAt"]);
   if(!scheduled)return invalidDuration();
   const start=instant(scheduled.startsAt),end=instant(scheduled.endsAt);
   if(start===null||end===null||end<=start)return invalidDuration();
   elapsedMinutes=(end-start)/60000;
   if(!Number.isFinite(elapsedMinutes)||elapsedMinutes<=0)return invalidDuration();
  }
  if(value.sessionKind!=="ordinary")return durationResult("exception_review_required","separate_exception_terms",elapsedMinutes);
  if(elapsedMinutes===null)return durationResult("undated","undated",null);
  return elapsedMinutes===academyOrdinarySessionMinutes?durationResult("ordinary_duration_matches","ordinary_180_minutes",elapsedMinutes):
   durationResult("duration_review_required","ordinary_duration_mismatch",elapsedMinutes);
 }catch{return invalidDuration();}
}

function travelResult(status:AcademyTravelChangeResult["status"],reason:AcademyTravelChangeResult["reason"]):AcademyTravelChangeResult{
 return Object.freeze({version:academyPolicyPreflightVersion,status,reason,mayIssueCredit:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false});
}
function facts(reason:AcademyTravelChangeResult["reason"]):AcademyTravelChangeResult{return travelResult("facts_required",reason);}

export function assessAcademyTravelChange(input:AcademyTravelChangeInput):AcademyTravelChangeResult{
 try{
  const value=data(input,["version","original","obligation","existingCredit","sessionKind","change"]);
  if(!value||value.version!==academyPolicyPreflightVersion||!member(value.sessionKind,sessionKinds))return facts("invalid_input");
  const original=anchor(value.original);
  const change=data(value.change,["anchor","kind","evidenceId","weatherQualification","recordedDriveLimit","revisedOneWayMinutes","familyCannotAttend"]);
  const changedAnchor=change?anchor(change.anchor):null;
  if(!original||!change||!changedAnchor||!member(change.kind,["academy_venue","academy_schedule","academy_weather_cancelled","parent_absence","other"])||
   !member(change.weatherQualification,["qualifying","not_qualifying","unknown"])||!member(change.recordedDriveLimit,["up_to_30","up_to_45","up_to_60","over_60"])||
   !(change.revisedOneWayMinutes===null||(typeof change.revisedOneWayMinutes==="number"&&Number.isFinite(change.revisedOneWayMinutes)&&change.revisedOneWayMinutes>=0))||
   !(change.familyCannotAttend===null||typeof change.familyCannotAttend==="boolean"))return facts("invalid_input");
  if(!sameAnchor(original,changedAnchor))return facts("original_anchor_mismatch");
  if(!nonempty(change.evidenceId))return facts("change_evidence_missing");
  if(value.obligation===null)return facts("obligation_missing");
  const obligation=data(value.obligation,["anchor","evidenceId","state"]),purchasedAnchor=obligation?anchor(obligation.anchor):null;
  if(!obligation||!purchasedAnchor||!member(obligation.state,["purchased_undelivered","delivered","unpurchased","unknown"]))return facts("invalid_input");
  if(!sameAnchor(original,purchasedAnchor))return facts("original_anchor_mismatch");
  if(!nonempty(obligation.evidenceId)||obligation.state==="unknown")return facts("obligation_unknown");
  if(obligation.state==="unpurchased")return travelResult("no_new_credit","obligation_not_purchased");
  if(obligation.state==="delivered")return travelResult("no_new_credit","obligation_delivered");
  if(value.existingCredit!==null){
   const credit=data(value.existingCredit,["anchor","creditId","state"]),creditedAnchor=credit?anchor(credit.anchor):null;
   if(!credit||!creditedAnchor||!member(credit.state,["outstanding","replacement_reserved","delivered","unknown"]))return facts("invalid_input");
   if(!sameAnchor(original,creditedAnchor))return facts("credit_anchor_mismatch");
   if(!nonempty(credit.creditId)||credit.state==="unknown")return facts("credit_unknown");
   if(credit.state==="delivered")return travelResult("no_new_credit","credit_delivered");
   // Existing undelivered credit survives later changes, even if the new event
   // would not qualify for a NEW credit. Reserved does not mean delivered.
   return travelResult("retain_existing_credit","same_outstanding_credit");
  }
  if(value.sessionKind!=="ordinary")return facts("separate_exception_terms");
  if(change.kind==="parent_absence")return travelResult("no_new_credit","existing_absence_policy");
  if(change.kind==="other")return travelResult("no_new_credit","no_qualifying_change");
  if(change.kind==="academy_weather_cancelled"){
   if(change.weatherQualification==="unknown")return facts("weather_requires_review");
   return change.weatherQualification==="qualifying"?travelResult("replacement_review_required","qualifying_weather_cancellation"):
    travelResult("no_new_credit","no_qualifying_change");
  }
  if(change.recordedDriveLimit==="over_60"||change.revisedOneWayMinutes===null)return facts("drive_limit_requires_facts");
  if(change.familyCannotAttend===null)return facts("attendance_requires_facts");
  const limit=change.recordedDriveLimit==="up_to_30"?30:change.recordedDriveLimit==="up_to_45"?45:60;
  if(change.revisedOneWayMinutes<=limit)return travelResult("no_new_credit","within_recorded_limit");
  if(!change.familyCannotAttend)return travelResult("no_new_credit","family_can_attend");
  return travelResult("replacement_review_required","academy_change_exceeds_limit");
 }catch{return facts("invalid_input");}
}
