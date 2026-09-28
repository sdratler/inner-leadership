import "server-only";
import {AppError} from "../../../lib/errors.ts";
import type {Actor} from "../../identity/types.ts";
import type {identityRuntime} from "../../identity/runtime.ts";
import {listProspects,type Prospect} from "../../prospects/bridge.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {OperationalNativeCrmStore} from "./operational-store.ts";

export type ProspectReadDependencies={
 authority:{read:(actor:Actor)=>Promise<CutoverState>};
 native:{prospects:(actor:Actor,expectedEpoch:number)=>Promise<Prospect[]>};
 sheet:{list:()=>Promise<Prospect[]>};
};
/** One server-side destination. Neither a browser query nor native failure may
 * choose the shadow, revive the Sheet, or change authority. Genuine legacy
 * reads remain available until the separately verified writer cutover.
 */
export async function authoritativeProspects(actor:Actor,d:ProspectReadDependencies):Promise<Prospect[]>{
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 const state=await d.authority.read(actor),destination=writeDestination(state.phase);
 if(destination==="durable_queue_only")throw new AppError("CONFLICT");
 if(destination==="native")return d.native.prospects(actor,state.epoch);
 return d.sheet.list();
}
export function readAuthoritativeProspects(actor:Actor,runtime:Pick<Awaited<ReturnType<typeof identityRuntime>>,"store"|"config"|"clock">){
 const key=runtime.config.lookupKey.toString("hex");
 return authoritativeProspects(actor,{
  authority:new ContactCutoverStore(runtime.store,runtime.config.keyring,key,runtime.clock),
  native:new OperationalNativeCrmStore(runtime.store,runtime.config.keyring,key,runtime.clock),sheet:{list:listProspects},
 });
}
