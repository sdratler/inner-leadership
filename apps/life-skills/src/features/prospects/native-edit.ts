import {z} from "zod";
import {dateOnly} from "../contact-ops/core/validation.ts";
import type {Prospect} from "./bridge.ts";

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
