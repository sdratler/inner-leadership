import {AppError} from "../../lib/errors.ts";
import {asId} from "../../lib/ids.ts";
import type {SqlSession} from "../identity/store.ts";
import type {AccountFacts} from "../identity/types.ts";
import type {AudienceFacts,CaseFacts} from "../cases/policy.ts";
import type {Responsibility} from "../assignment-participants/contracts.ts";
import {planOccurrences,validateResponsibility} from "../assignment-participants/scheduling.ts";
import {responsibilityInput,type ResponsibilityInput,type ResponsibilityParticipants} from "./responsibility-input.ts";
import {assertCalendarDate} from "./policy.ts";

/** Only actual active, subject/guardian-bound members of this exact audience.
 * It is not a list of all workspace logins or an invitation/role-grant API. */
export async function nativeResponsibilityParticipants(tx:SqlSession,actor:AccountFacts,item:CaseFacts,audience:AudienceFacts):Promise<ResponsibilityParticipants>{
  const accounts=await tx.query<ResponsibilityParticipants["accounts"][number]>(`SELECT ac.id AS "accountId",ac.role FROM ls_identity.accounts ac
   WHERE ac.workspace_id=$1 AND ac.state='active' AND ac.id=ANY($2::uuid[])
   AND ((ac.role='parent' AND $3='minor' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g
     WHERE g.workspace_id=ac.workspace_id AND g.case_id=$4 AND g.account_id=ac.id AND g.revoked_at IS NULL))
    OR (((ac.role='child' AND $3='minor') OR (ac.role='adult_client' AND $3='adult')) AND EXISTS(SELECT 1 FROM ls_identity.account_subjects s
     WHERE s.workspace_id=ac.workspace_id AND s.account_id=ac.id AND s.person_id=$5))) ORDER BY ac.role,ac.id LIMIT 4`,
  [actor.workspaceId,audience.accountIds,item.kind,item.id,item.clientPersonId]);
  if(accounts.length>3)throw new AppError("UNAVAILABLE");
  return {caseKind:item.kind,accounts};
}
export function parseSavedResponsibility(value:unknown):ResponsibilityInput|null{
  if(value===null)return null;
  const parsed=responsibilityInput.safeParse(value);if(!parsed.success)throw new AppError("UNAVAILABLE");return parsed.data;
}
export async function authorizeResponsibility(tx:SqlSession,actor:AccountFacts,item:CaseFacts,audience:AudienceFacts,value:unknown,startsOn:string,endsOn:string|null,instructions:string):Promise<ResponsibilityInput>{
  const parsed=responsibilityInput.safeParse(value);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  if(item.state!=="active")throw new AppError("NOT_FOUND");
  const input=parsed.data,participants=await nativeResponsibilityParticipants(tx,actor,item,audience);
  assertCalendarDate(startsOn);if(!endsOn)throw new AppError("INVALID_REQUEST");assertCalendarDate(endsOn);
  if(endsOn<startsOn||Date.parse(endsOn)-Date.parse(startsOn)>366*86400000||instructions.trim().length<1||instructions.length>2000)throw new AppError("INVALID_REQUEST");
  const byId=new Map(participants.accounts.map(row=>[row.accountId,row.role]));
  if(input.participant==="parent"&&item.kind!=="minor")throw new AppError("NOT_FOUND");
  const expected=input.participant==="parent"?"parent":item.kind==="minor"?"child":"adult_client";
  if(input.assigneeAccountIds.some(id=>byId.get(id)!==expected)||input.assistedByParentAccountIds.some(id=>item.kind!=="minor"||byId.get(id)!=="parent")||input.reminderRecipients.some(row=>!byId.has(row.accountId)))throw new AppError("NOT_FOUND");
  // A reminder-only audience member is deliberately NOT added to reporting IDs.
  if(input.reminderRecipients.some(row=>row.purpose==="self"&&!input.assigneeAccountIds.includes(row.accountId)||row.purpose==="remind_child"&&(item.kind!=="minor"||input.participant!=="client"||byId.get(row.accountId)!=="parent")||row.purpose==="support"&&byId.get(row.accountId)!=="parent"))throw new AppError("INVALID_REQUEST");
  return input;
}
export function nativeResponsibility(source:{workspaceId:string;caseId:string;assignmentId:string;versionId:string;version:number;instructions:string;startsOn:string;endsOn:string|null},subjectPersonId:string,input:ResponsibilityInput,audienceAccountIds:readonly string[]):Responsibility{
  if(!source.endsOn)throw new AppError("UNAVAILABLE");
  const value:Responsibility={id:source.versionId,assignmentId:source.assignmentId,version:source.version,workspaceId:source.workspaceId,caseId:source.caseId,subjectPersonId,participant:input.participant,instructions:source.instructions,assigneeAccountIds:input.assigneeAccountIds,assistedByParentAccountIds:input.assistedByParentAccountIds,audienceAccountIds,reminderRecipients:input.reminderRecipients,completionMode:input.completionMode,startsOn:source.startsOn,endsOn:source.endsOn,weekdays:input.weekdays,localTime:input.localTime,timezone:input.timezone,timeOrigin:input.timeOrigin,state:"published"};
  try{validateResponsibility(value);}catch{throw new AppError("UNAVAILABLE");}return value;
}
/** Resolve each calendar date in its own zone. A gap/fold is never normalized or
 * silently picked, and this proposal performs no send/booking/provider action. */
export function nativeResponsibilityOccurrences(value:Responsibility,input:ResponsibilityInput,from:string,days:number){
  try{return planOccurrences(value,null,from,days,input.foldChoice);}catch{throw new AppError("INVALID_REQUEST");}
}
export function nativeOccurrenceId(plannedId:string){
  if(!/^occ_[a-f0-9]{32}$/.test(plannedId))throw new AppError("UNAVAILABLE");
  const hex=plannedId.slice(4),value=hex.slice(0,8)+"-"+hex.slice(8,12)+"-5"+hex.slice(13,16)+"-8"+hex.slice(17,20)+"-"+hex.slice(20);
  return asId(value,"occurrence");
}
