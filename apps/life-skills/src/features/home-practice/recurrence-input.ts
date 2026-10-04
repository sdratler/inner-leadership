import {z} from "zod";
import {validDate,validTimezone} from "../session-workflow/policy.ts";
import {validClock} from "../assignment-participants/wall-time.ts";
const uuid=z.string().uuid().transform(value=>value.toLowerCase()),digest=z.string().regex(/^[a-f0-9]{64}$/),date=z.string().refine(validDate);
export const recurrenceInput=z.object({assignmentId:uuid,expectedVersionId:uuid,expectedSnapshotDigest:digest,from:date,to:date}).strict().refine(value=>{
 const days=(Date.parse(value.to+"T12:00:00Z")-Date.parse(value.from+"T12:00:00Z"))/86400000+1;
 return Number.isInteger(days)&&days>=1&&days<=42;
},"Choose an inclusive range of at most 42 calendar dates.");
export const recurrenceCommand=recurrenceInput.safeExtend({expectedPlanDigest:digest});
export const recurrenceRow=z.object({id:uuid,assignmentId:uuid,practiceVersionId:uuid,coordinationVersionId:uuid,occursOn:date,period:z.enum(["morning","evening"]),occursAt:z.iso.datetime(),state:z.enum(["open","closed"]),existing:z.boolean()}).strict();
export const recurrencePlan=z.object({assignmentId:uuid,practiceVersionId:uuid,caseId:uuid,audienceId:uuid,from:date,to:date,localTime:z.string().refine(validClock),timezone:z.string().max(100).refine(validTimezone),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days=>new Set(days).size===days.length),planDigest:digest,items:z.array(recurrenceRow).min(1).max(42)}).strict().refine(plan=>{
 const days=(Date.parse(plan.to+"T12:00:00Z")-Date.parse(plan.from+"T12:00:00Z"))/86400000+1;
 if(!Number.isInteger(days)||days<1||days>42)return false;
 const dates=Array.from({length:days},(_,index)=>new Date(Date.parse(plan.from+"T12:00:00Z")+index*86400000)).filter(day=>plan.weekdays.includes(day.getUTCDay())).map(day=>day.toISOString().slice(0,10));
 return dates.length===plan.items.length&&new Set(plan.items.map(row=>row.id)).size===plan.items.length&&plan.items.every((row,index)=>row.assignmentId===plan.assignmentId&&row.practiceVersionId===plan.practiceVersionId&&row.occursOn===dates[index]);
});
export type RecurrenceInput=z.infer<typeof recurrenceInput>;
export type RecurrenceCommand=z.infer<typeof recurrenceCommand>;
export type RecurrencePlan=z.infer<typeof recurrencePlan>;
