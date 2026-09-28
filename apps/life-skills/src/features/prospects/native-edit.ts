import {z} from "zod";
import {dateOnly} from "../contact-ops/core/validation.ts";
import type {Prospect} from "./bridge.ts";

export function contactSuppressed(value:string):boolean{return /do[ _-]?not[ _-]?contact|\bopt(?:ed)?[ _-]?out\b/i.test(value);}
export function prospectContactSuppressed(row:Pick<Prospect,"stage"|"outcome">):boolean{return contactSuppressed(row.stage)||contactSuppressed(row.outcome);}

type FollowUpValues=Pick<Prospect,"notes"|"nextAction"|"dueDate"|"owner">;
const followUpKeys=["notes","nextAction","dueDate","owner"] as const;
export type ProspectFollowUpDraft={baseline:Prospect;values:FollowUpValues;conflict:boolean};
export function prospectFollowUpDraft(row:Prospect):ProspectFollowUpDraft{
 return {baseline:row,values:{notes:row.notes,nextAction:row.nextAction,dueDate:row.dueDate,owner:row.owner},conflict:false};
}
/** Rebase only untouched inputs. A conflicting dirty field retains its observed
 * edit version: even if another card advances the shared profile, the server
 * rejects this stale save and the user's actual draft stays visible.
 */
export function reconcileProspectFollowUp(draft:ProspectFollowUpDraft,row:Prospect):ProspectFollowUpDraft{
 const dirty=followUpKeys.filter(key=>draft.values[key]!==draft.baseline[key]);
 const conflict=(draft.conflict&&dirty.length>0)||
  (dirty.length>0&&draft.baseline.nativeEdit?.authorityEpoch!==row.nativeEdit?.authorityEpoch)||
  dirty.some(key=>row[key]!==draft.baseline[key]&&draft.values[key]!==row[key]);
 const values={...draft.values};for(const key of followUpKeys)if(!dirty.includes(key))values[key]=row[key];
 const baseline=conflict&&draft.baseline.nativeEdit?{...row,nativeEdit:draft.baseline.nativeEdit}:row;
 return {baseline,values,conflict};
}
export function changedProspectFollowUp(draft:ProspectFollowUpDraft):ProspectUpdateFields{
 return Object.fromEntries(followUpKeys.filter(key=>draft.values[key]!==draft.baseline[key]).map(key=>[key,draft.values[key]]));
}

export const prospectUpdateFieldsSchema=z.object({stage:z.string().min(1).max(120).optional(),
 nextAction:z.string().max(500).optional(),dueDate:z.string().refine(v=>v===""||dateOnly(v)).optional(),
 outcome:z.string().max(500).optional(),notes:z.string().max(5000).optional(),owner:z.string().max(120).optional()
}).strict().refine(fields=>Object.values(fields).some(value=>value!==undefined));
export type ProspectUpdateFields=z.infer<typeof prospectUpdateFieldsSchema>;
export type NativeProspectUpdate={action:"update";leadId:string;fields:ProspectUpdateFields;
 expectedEpoch:number;expectedVersion:number;operationId:string};
export type NativeProspectUpdateResult={updated:true;source:"native";personId:string;version:number;replayed:boolean};

/** One exact retry key, never browser-selected authority or person identity. */
export function prepareNativeProspectUpdate(row:Prospect,fields:ProspectUpdateFields,operationId:string):NativeProspectUpdate{
 const context=row.nativeEdit,parsed=prospectUpdateFieldsSchema.parse(fields);
 if(!context||!Number.isSafeInteger(context.profileVersion)||context.profileVersion<1||
  !Number.isSafeInteger(context.authorityEpoch)||context.authorityEpoch<0||!z.string().uuid().safeParse(operationId).success)
  throw Error("INVALID_NATIVE_EDIT_CONTEXT");
 return {action:"update",leadId:row.leadId,fields:parsed,expectedEpoch:context.authorityEpoch,
  expectedVersion:context.profileVersion,operationId};
}
export function nativeProspectUpdateKey(row:Prospect,fields:ProspectUpdateFields):string{
 return JSON.stringify([row.leadId,row.nativeEdit,Object.entries(fields).sort(([a],[b])=>a.localeCompare(b))]);
}
/** Do not reload/unmount all cards after saving one: unrelated input stays put.
 * Shared profile fields advance for its other references, not their own outcomes.
 * Server-owned payment, booking, case and source facts are never merged from input.
 */
export function applyNativeProspectUpdate(rows:readonly Prospect[],request:NativeProspectUpdate,result:NativeProspectUpdateResult):Prospect[]{
 if(!Number.isSafeInteger(result.version)||result.version!==request.expectedVersion+1||result.source!=="native")throw Error("INVALID_SAVE_RESULT");
 const selected=rows.find(r=>r.leadId===request.leadId);
 if(!selected?.nativeEdit||selected.nativeEdit.personId!==result.personId)throw Error("INVALID_SAVE_RESULT");
 return rows.map(row=>{
  if(row.nativeEdit?.personId!==result.personId||row.nativeEdit.authorityEpoch!==request.expectedEpoch||row.nativeEdit.profileVersion>result.version)return row;
  const f=request.fields;
  return {...row,...(f.stage===undefined?{}:{stage:f.stage}),...(f.nextAction===undefined?{}:{nextAction:f.nextAction}),
   ...(f.dueDate===undefined?{}:{dueDate:f.dueDate}),...(f.notes===undefined?{}:{notes:f.notes}),
   ...(row.leadId===request.leadId?{...(f.owner===undefined?{}:{owner:f.owner}),...(f.outcome===undefined?{}:{outcome:f.outcome})}:{}),
   nativeEdit:{...row.nativeEdit,profileVersion:result.version}};
 });
}
