import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {Actor} from "../../identity/types.ts";
import type {identityRuntime} from "../../identity/runtime.ts";
import {updateProspect} from "../../prospects/bridge.ts";
import {prospectUpdateFieldsSchema,type ProspectUpdateFields} from "../../prospects/native-edit.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {OperationalNativeCrmStore} from "./operational-store.ts";

export const prospectUpdateSchema=z.object({action:z.literal("update"),leadId:z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/),
 fields:prospectUpdateFieldsSchema,expectedEpoch:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1).optional(),
 expectedVersion:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1).optional(),operationId:z.string().uuid().optional()}).strict();
export type ProspectUpdateInput=z.infer<typeof prospectUpdateSchema>;
export type ProspectUpdateDependencies={authority:{read:(actor:Actor)=>Promise<CutoverState>};
 native:{updateProspectFields:(actor:Actor,leadId:string,fields:ProspectUpdateFields,version:number,operation:string,epoch:number)=>Promise<{personId:string;version:number;replayed:boolean}>};
 sheet:{update:(leadId:string,fields:Record<string,string>)=>Promise<unknown>}};

/** Existing legacy writes retain their actual external receiver fence. Never put
 * Sheet/network effects inside a PostgreSQL transaction or claim cross-service
 * atomicity. After cutover a missing/stale native context conflicts; failure must
 * not revive the Sheet writer. The browser cannot select authority or a person.
 */
export async function authoritativeProspectUpdate(actor:Actor,input:ProspectUpdateInput,d:ProspectUpdateDependencies){
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 const parsed=prospectUpdateSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
 const request=parsed.data,state=await d.authority.read(actor),destination=writeDestination(state.phase);
 if(destination==="durable_queue_only")throw new AppError("CONFLICT");
 const fields=Object.fromEntries(Object.entries(request.fields).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
 if(destination==="sheet"){
  // A tab opened before a rollback must refresh; do not silently apply its
  // native optimistic edit to the restored legacy writer.
  if(request.expectedEpoch!==undefined||request.expectedVersion!==undefined||request.operationId!==undefined)throw new AppError("CONFLICT");
  await d.sheet.update(request.leadId,fields);return {updated:true as const,source:"sheet" as const};
 }
 if(request.expectedEpoch!==state.epoch||request.expectedVersion===undefined||request.operationId===undefined)throw new AppError("CONFLICT");
 const result=await d.native.updateProspectFields(actor,request.leadId,fields,request.expectedVersion,request.operationId,state.epoch);
 return {updated:true as const,source:"native" as const,...result};
}
export function updateAuthoritativeProspect(actor:Actor,input:ProspectUpdateInput,runtime:Pick<Awaited<ReturnType<typeof identityRuntime>>,"store"|"config"|"clock">){
 const key=runtime.config.lookupKey.toString("hex");
 return authoritativeProspectUpdate(actor,input,{authority:new ContactCutoverStore(runtime.store,runtime.config.keyring,key,runtime.clock),
  native:new OperationalNativeCrmStore(runtime.store,runtime.config.keyring,key,runtime.clock),sheet:{update:updateProspect}});
}
