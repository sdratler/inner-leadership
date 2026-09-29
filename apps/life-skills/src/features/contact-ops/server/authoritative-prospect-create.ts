import "server-only";
import {AppError} from "../../../lib/errors.ts";
import type {Actor} from "../../identity/types.ts";
import type {identityRuntime} from "../../identity/runtime.ts";
import {createProspect} from "../../prospects/bridge.ts";
import {prospectCreateSchema,type ProspectCreateInput,type ProspectCreateFields} from "../core/people-create.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {OperationalNativeCrmStore} from "./operational-store.ts";

export type ProspectCreateDependencies={authority:{read:(actor:Actor)=>Promise<CutoverState>};
 native:{createContact:(actor:Actor,fields:ProspectCreateFields,operationId:string,epoch:number)=>Promise<{personId:string;leadId:string;version:number;replayed:boolean}>};
 sheet:{create:(fields:ProspectCreateFields)=>Promise<{success:true;result:{action:"created"|"existing";leadId:string;row:number}}>}};

/** The existing receiver still fences its own Sheet writes. No network effect is
 * put in a native transaction; a frozen/stale/native failure never revives Sheet.
 */
export async function authoritativeProspectCreate(actor:Actor,input:ProspectCreateInput,d:ProspectCreateDependencies){
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 const parsed=prospectCreateSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
 const {action:_action,expectedEpoch,operationId,...fields}=parsed.data;
 void _action;
 const state=await d.authority.read(actor),destination=writeDestination(state.phase);
 if(destination==="durable_queue_only")throw new AppError("CONFLICT");
 if(destination==="sheet"){
  if(expectedEpoch!==undefined||operationId!==undefined)throw new AppError("CONFLICT");
  const created=await d.sheet.create(fields);return {...created.result,source:"sheet" as const};
 }
 if(expectedEpoch!==state.epoch||operationId===undefined)throw new AppError("CONFLICT");
 const result=await d.native.createContact(actor,fields,operationId,state.epoch);
 return {action:"created" as const,source:"native" as const,authorityEpoch:state.epoch,...result};
}
export function createAuthoritativeProspect(actor:Actor,input:ProspectCreateInput,runtime:Pick<Awaited<ReturnType<typeof identityRuntime>>,"store"|"config"|"clock">){
 const key=runtime.config.lookupKey.toString("hex");
 return authoritativeProspectCreate(actor,input,{authority:new ContactCutoverStore(runtime.store,runtime.config.keyring,key,runtime.clock),
  native:new OperationalNativeCrmStore(runtime.store,runtime.config.keyring,key,runtime.clock),sheet:{create:createProspect}});
}
