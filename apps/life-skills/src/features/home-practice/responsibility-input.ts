import {z} from "zod";
import {validClock} from "../assignment-participants/wall-time.ts";
import {validTimezone} from "../session-workflow/policy.ts";

const accounts=z.array(z.string().uuid()).max(2).refine(ids=>new Set(ids).size===ids.length);
/** Browser-safe input only. Subject, source IDs and attribution come from native
 * case/version records, never from a role switch or client-supplied actor. */
export const responsibilityInput=z.object({
  participant:z.enum(["client","parent"]),
  period:z.enum(["morning","evening"]),
  assigneeAccountIds:accounts,
  assistedByParentAccountIds:accounts,
  reminderRecipients:z.array(z.object({accountId:z.string().uuid(),purpose:z.enum(["self","support","remind_child"])}).strict()).max(3)
    .refine(rows=>new Set(rows.map(row=>row.accountId)).size===rows.length),
  completionMode:z.enum(["any_assignee","each_assignee"]),
  weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days=>new Set(days).size===days.length),
  localTime:z.string().refine(validClock),
  timezone:z.string().max(100).refine(validTimezone),
  timeOrigin:z.enum(["session_agreement","practitioner"]),
  foldChoice:z.enum(["earlier","later"]).nullable(),
}).strict().superRefine((value,ctx)=>{
  if(value.participant==="parent"&&(value.assistedByParentAccountIds.length||!value.assigneeAccountIds.length))ctx.addIssue({code:"custom",message:"PARENT_RESPONSIBILITY_ACTORS"});
  if(value.participant==="client"&&value.assigneeAccountIds.length>1)ctx.addIssue({code:"custom",message:"ONE_EXACT_CLIENT_SUBJECT"});
  if(!value.assigneeAccountIds.length&&!value.assistedByParentAccountIds.length)ctx.addIssue({code:"custom",message:"RESPONSIBILITY_NEEDS_AUTHORIZED_ACTOR"});
  if(value.completionMode==="each_assignee"&&(value.participant!=="parent"||value.assigneeAccountIds.length!==2))ctx.addIssue({code:"custom",message:"BOTH_PARENT_REPORTS_REQUIRED"});
  if(value.assigneeAccountIds.some(id=>value.assistedByParentAccountIds.includes(id)))ctx.addIssue({code:"custom",message:"ACTOR_ROLES_MUST_BE_DISTINCT"});
});
export type ResponsibilityInput=z.infer<typeof responsibilityInput>;
export const assistedCheckInInput=z.object({mode:z.enum(["together","parent_report"]),note:z.string().max(2000)}).strict();
export type AssistedCheckInInput=z.infer<typeof assistedCheckInInput>;
export type ResponsibilityParticipants={caseKind:"minor"|"adult";accounts:{accountId:string;role:"parent"|"child"|"adult_client"}[]};
export function sameResponsibilityInput(left:ResponsibilityInput|null|undefined,right:ResponsibilityInput|null|undefined):boolean{
  if(left==null||right==null)return left==null&&right==null;
  const canonical=(x:ResponsibilityInput)=>JSON.stringify([x.participant,x.period,[...x.assigneeAccountIds].sort(),[...x.assistedByParentAccountIds].sort(),[...x.reminderRecipients].sort((a,b)=>a.accountId.localeCompare(b.accountId)),x.completionMode,[...x.weekdays].sort(),x.localTime,x.timezone,x.timeOrigin,x.foldChoice]);
  return canonical(left)===canonical(right);
}
