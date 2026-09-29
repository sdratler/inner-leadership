import "server-only";
import {AppError} from "../../../lib/errors.ts";
import type {Actor} from "../../identity/types.ts";
import type {identityRuntime} from "../../identity/runtime.ts";
import {sendProspectMessage,updateProspect} from "../../prospects/bridge.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import {readCutoverState} from "./cutover-state.ts";
import {ContactCutoverStore} from "./cutover-store.ts";

type Runtime=Pick<Awaited<ReturnType<typeof identityRuntime>>,"store"|"config"|"clock">;
type Authority={read:(actor:Actor)=>Promise<CutoverState>};
type Sender=(leadId:string,message:string,context:{store:Runtime["store"];workspaceId:string})=>ReturnType<typeof sendProspectMessage>;
type LegacyUpdate=(leadId:string,fields:Record<string,string>)=>Promise<unknown>;

/** Legacy transport is tied to the Sheet CRM. A native or frozen authority must
 * never send through it merely because an old browser still has a lead ID.
 * The cutover operator must also fence and drain requests already in flight;
 * this preflight alone is not a completed sender migration.
 */
export async function assertLegacyProspectSenderAvailable(actor:Actor,runtime:Runtime,authority?:Authority):Promise<number>{
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 const selected=authority??new ContactCutoverStore(runtime.store,runtime.config.keyring,
  runtime.config.lookupKey.toString("hex"),runtime.clock);
 const state=await selected.read(actor);
 if(writeDestination(state.phase)!=="sheet")throw new AppError("CONFLICT");
 return state.epoch;
}
export async function sendAuthoritativeProspectMessage(actor:Actor,runtime:Runtime,leadId:string,message:string,
 dependencies?:{authority:Authority;sender:Sender},expectedEpoch?:number){
 const authorityEpoch=await assertLegacyProspectSenderAvailable(actor,runtime,dependencies?.authority);
 if(expectedEpoch!==undefined&&authorityEpoch!==expectedEpoch)throw new AppError("CONFLICT");
 const sent=await (dependencies?.sender??sendProspectMessage)(leadId,message,{store:runtime.store,workspaceId:runtime.config.workspaceId});
 return {...sent,authorityEpoch};
}

/** Provider delivery and a Sheet update are not atomic. If authority changed
 * while delivery was in flight, retain the provider receipt and report pending
 * projection for explicit cutover reconciliation; never revive the old writer.
 */
export async function projectLegacyProspectAfterSend(actor:Actor,runtime:Runtime,leadId:string,
 fields:Record<string,string>,expectedEpoch:number,dependencies?:{authority:Authority;update:LegacyUpdate}):Promise<boolean>{
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 const authority=dependencies?.authority??new ContactCutoverStore(runtime.store,runtime.config.keyring,
  runtime.config.lookupKey.toString("hex"),runtime.clock);
 // Delivery already succeeded. A failed authority read must not turn the
 // response into an apparent send failure that could prompt a duplicate send.
 let state:CutoverState;
 try{state=await authority.read(actor);}catch{return true;}
 if(state.epoch!==expectedEpoch||writeDestination(state.phase)!=="sheet")return true;
 try{await (dependencies?.update??updateProspect)(leadId,fields);return false;}catch{return true;}
}

/** A submitted form is already durable in the private onboarding store. Its
 * legacy convenience projection may touch Sheet only while Sheet is authority.
 * Native form facts must be read from onboarding data, not invented from Sheet.
 */
export async function projectIntakeToLegacyIfCurrent(runtime:Runtime,leadId:string,fields:Record<string,string>,
 dependencies?:{read:()=>Promise<CutoverState>;update:LegacyUpdate}):Promise<boolean>{
 const state=await (dependencies?.read??(()=>runtime.store.transaction(tx=>
  readCutoverState(tx,runtime.config.workspaceId,runtime.config.keyring,false))))();
 if(writeDestination(state.phase)!=="sheet")return true;
 try{await (dependencies?.update??updateProspect)(leadId,fields);return false;}catch{return true;}
}
