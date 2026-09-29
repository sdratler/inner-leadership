import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {SqlSession} from "../../identity/store.ts";
import {unseal,type Keyring} from "../../identity/crypto.ts";
import type {CutoverState} from "../core/cutover.ts";

export const cutoverEpochSchema=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const source=z.string().min(1).max(200);
export const cutoverStateSchema=z.object({phase:z.enum(["sheet_active","shadow_ready","frozen","native_active","retired","rollback_prepared"]),
 epoch:cutoverEpochSchema,batchId:source.nullable(),sourceFileId:source.nullable(),sourceRevision:source.nullable(),
 nativeWritesSinceSwitch:cutoverEpochSchema}).strict();
export const cutoverStateAad=(workspace:string,epoch:number)=>`ls_contact_ops/cutover/v1/${workspace}/${epoch}`;
/** Internal transaction composition only. This is NOT an authorization boundary:
 * ordinary APIs still require their fresh practitioner actor; provider ingestion
 * still requires its exact configured bridge/binding. Both hold the same fence. */
export async function readCutoverState(tx:SqlSession,workspace:string,keyring:Keyring,forUpdate:boolean):Promise<CutoverState>{
 const rows=await tx.query<{epoch:string;phase:CutoverState["phase"];ciphertext:string}>(`SELECT epoch::text,phase,state_ciphertext AS ciphertext
  FROM ls_contact_ops.cutover WHERE workspace_id=$1${forUpdate?" FOR UPDATE":""}`,[workspace]);
 if(rows.length>1)throw new AppError("UNAVAILABLE");
 const row=rows[0];if(!row)return {phase:"sheet_active",epoch:0,batchId:null,sourceFileId:null,sourceRevision:null,nativeWritesSinceSwitch:0};
 const epoch=Number(row.epoch);if(!cutoverEpochSchema.safeParse(epoch).success)throw new AppError("UNAVAILABLE");
 let state:CutoverState;
 try{state=cutoverStateSchema.parse(JSON.parse(unseal(row.ciphertext,cutoverStateAad(workspace,epoch),keyring)));}
 catch{throw new AppError("UNAVAILABLE");}
 if(state.epoch!==epoch||state.phase!==row.phase||
  (state.phase==="sheet_active"?(state.batchId!==null||state.sourceFileId!==null||state.sourceRevision!==null||state.nativeWritesSinceSwitch!==0):
   !state.batchId||!state.sourceFileId||!state.sourceRevision))throw new AppError("UNAVAILABLE");
 return state;
}
