import "server-only";
import {AppError} from "../../../lib/errors.ts";
import type {Actor} from "../../identity/types.ts";
import type {identityRuntime} from "../../identity/runtime.ts";
import {listProspects,sendProspectMessage,updateProspect,type Prospect} from "../../prospects/bridge.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import {readCutoverState} from "./cutover-state.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {OutboundProjectionStore,type OutboundReceipt} from "./outbound-projection-store.ts";

type Runtime=Pick<Awaited<ReturnType<typeof identityRuntime>>,"store"|"config"|"clock">;
type Authority={read:(actor:Actor)=>Promise<CutoverState>};
type Sender=(leadId:string,message:string,context:{store:Runtime["store"];workspaceId:string})=>ReturnType<typeof sendProspectMessage>;
type LegacyUpdate=(leadId:string,fields:Record<string,string>)=>Promise<unknown>;
type LegacyList=()=>Promise<Prospect[]>;
type Ledger=Pick<OutboundProjectionStore,"prepare"|"confirm"|"projected"|"read">;
const ledger=(runtime:Runtime)=>new OutboundProjectionStore(runtime.store,runtime.config.keyring,
 runtime.config.lookupKey.toString("hex"),runtime.clock);

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
 plannedFields:Record<string,string>,dependencies?:{authority:Authority;sender:Sender;ledger:Ledger},expectedEpoch?:number){
 const authorityEpoch=await assertLegacyProspectSenderAvailable(actor,runtime,dependencies?.authority);
 if(expectedEpoch!==undefined&&authorityEpoch!==expectedEpoch)throw new AppError("CONFLICT");
 const operationId=await (dependencies?.ledger??ledger(runtime)).prepare(actor,leadId,authorityEpoch,message,plannedFields);
 const sent=await (dependencies?.sender??sendProspectMessage)(leadId,message,{store:runtime.store,workspaceId:runtime.config.workspaceId});
 return {...sent,authorityEpoch,operationId};
}

/** Provider delivery and a Sheet update are not atomic. If authority changed
 * while delivery was in flight, retain the provider receipt and report pending
 * projection for explicit cutover reconciliation; never revive the old writer.
 */
export async function projectLegacyProspectAfterSend(actor:Actor,runtime:Runtime,leadId:string,
 fields:Record<string,string>,expectedEpoch:number,operationId:string,receipt:OutboundReceipt,
 dependencies?:{authority:Authority;update:LegacyUpdate;list:LegacyList;ledger:Ledger}):Promise<{projectionPending:boolean}>{
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 const pending={projectionPending:true};
 const selectedLedger=dependencies?.ledger??ledger(runtime);
 // The prepared encrypted intent already contains the requested fields. Store
 // the provider receipt and final fields before any Sheet projection is tried.
 let confirmed=false;
 for(let attempt=0;attempt<3&&!confirmed;attempt++){
  try{await selectedLedger.confirm(actor,operationId,receipt,fields);confirmed=true;}
  catch{
   // A committed transaction can lose its response. Read back before retrying
   // or declaring failure, and never acknowledge an unpersisted provider send.
   try{const saved=await selectedLedger.read(actor,operationId);
    confirmed=saved?.state==="sent_pending"&&JSON.stringify(saved.receipt)===JSON.stringify(receipt)&&
     JSON.stringify(saved.fields)===JSON.stringify(fields);
   }catch{confirmed=false;}
  }
 }
 if(!confirmed)throw new AppError("UNAVAILABLE");
 const authority=dependencies?.authority??new ContactCutoverStore(runtime.store,runtime.config.keyring,
  runtime.config.lookupKey.toString("hex"),runtime.clock);
 // Delivery already succeeded. A failed authority read must not turn the
 // response into an apparent send failure that could prompt a duplicate send.
 let state:CutoverState;
 try{state=await authority.read(actor);}catch{return pending;}
 if(state.epoch!==expectedEpoch||writeDestination(state.phase)!=="sheet")return pending;
 try{
  await (dependencies?.update??updateProspect)(leadId,fields);
  await verifyLegacyProjection(leadId,fields,dependencies?.list??listProspects);
  await selectedLedger.projected(actor,operationId);
  return {projectionPending:false};
 }catch{return pending;}
}

async function verifyLegacyProjection(leadId:string,fields:Record<string,string>,list:LegacyList):Promise<void>{
 const observed=(await list()).find(row=>row.leadId===leadId);
 if(!observed||!Object.entries(fields).every(([field,value])=>
  (observed as unknown as Record<string,unknown>)[field]===value))throw new AppError("UNAVAILABLE");
}

/** Explicit practitioner reconciliation of a durably confirmed send. Never
 * resend the provider message. Read back the Sheet fields before draining the
 * authority fence; prepared/uncertain sends need separate provider evidence.
 */
export async function reconcileLegacyProspectProjection(actor:Actor,runtime:Runtime,operationId:string,
 dependencies?:{authority:Authority;update:LegacyUpdate;list:LegacyList;ledger:Ledger}):Promise<{projected:true}>{
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
 const selectedLedger=dependencies?.ledger??ledger(runtime),record=await selectedLedger.read(actor,operationId);
 if(!record||record.state!=="sent_pending"||!record.receipt)throw new AppError("CONFLICT");
 const authority=dependencies?.authority??new ContactCutoverStore(runtime.store,runtime.config.keyring,
  runtime.config.lookupKey.toString("hex"),runtime.clock);
 const state=await authority.read(actor);
 if(state.epoch!==record.authorityEpoch||writeDestination(state.phase)!=="sheet")throw new AppError("CONFLICT");
 await (dependencies?.update??updateProspect)(record.leadId,record.fields);
 await verifyLegacyProjection(record.leadId,record.fields,dependencies?.list??listProspects);
 try{await selectedLedger.projected(actor,operationId);}
 catch{if((await selectedLedger.read(actor,operationId))?.state!=="projected")throw new AppError("UNAVAILABLE");}
 return {projected:true};
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
