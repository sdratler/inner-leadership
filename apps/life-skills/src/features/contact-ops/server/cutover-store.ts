import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {freshActor} from "../../identity/data.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {advanceCutover,writeDestination,type CutoverState,type CutoverProof,type CutoverAction} from "../core/cutover.ts";
import {privateDigest} from "./digests.ts";
import {cutoverEpochSchema as safeEpoch,cutoverStateSchema as stateSchema,cutoverStateAad as stateAad,readCutoverState} from "./cutover-state.ts";

const source=z.string().min(1).max(200);
export type CutoverEvidence=CutoverProof & {observedNativeWritesSinceSwitch:number};
const proofSchema=z.object({batchId:source,sourceFileId:source,sourceRevision:source,expectedEpoch:safeEpoch,
 observedNativeWritesSinceSwitch:safeEpoch,
 backupRestored:z.boolean(),snapshotMatched:z.boolean(),imported:z.boolean(),rowContentMatched:z.boolean(),allRowsAccounted:z.boolean(),
 identityConflicts:z.number().int().min(0),paymentsReconciled:z.boolean(),writersFenced:z.boolean(),inboundDurable:z.boolean(),
 deltaDrained:z.boolean(),consumersRepointed:z.boolean(),sheetConsumersRepointed:z.boolean(),nativeBrowserVerified:z.boolean(),
 oldSchedulesDisabled:z.boolean(),sourceFrozen:z.boolean(),restorePlanReady:z.boolean()}).strict();
const actionSchema=z.enum(["prepare","freeze","switch_native","retire_sheet","prepare_rollback","finish_rollback"]);
const operationSchema=z.string().min(1).max(128);
const historyAad=(workspace:string,operation:string)=>`ls_contact_ops/cutover-history/v1/${workspace}/${operation}`;
type Prior={digest:string;actorId:string;ciphertext:string;resultEpoch:string};

/** Durable adapter for the existing pure gate. Internal server/operator use only:
 * no public transition endpoint and no activation from browser-supplied booleans.
 * The coordinator must obtain actual receipt/fence/delta proofs before calling
 * advance; persistence cannot itself prove an external receiver is fenced.
 * All future operational DB reads/writes must use withDestination's transaction.
 */
export class ContactCutoverStore {
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){}
 private async authorize(tx:SqlSession,a:Actor){requirePractitioner(await freshActor(tx,a,this.clock.now()));}
 private async lock(tx:SqlSession,a:Actor){
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${a.workspaceId}:contact-authority`]);
  await this.authorize(tx,a);
 }
 private decode<T>(schema:z.ZodType<T>,ciphertext:string,aad:string):T{
  try{return schema.parse(JSON.parse(unseal(ciphertext,aad,this.keyring)));}catch{throw new AppError("UNAVAILABLE");}
 }
 private async current(tx:SqlSession,a:Actor,forUpdate=true):Promise<CutoverState>{
  return readCutoverState(tx,a.workspaceId,this.keyring,forUpdate);
 }
 private async save(tx:SqlSession,a:Actor,s:CutoverState){
  stateSchema.parse(s);
  await tx.query(`INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,$2,$3,$4)
   ON CONFLICT(workspace_id) DO UPDATE SET epoch=EXCLUDED.epoch,phase=EXCLUDED.phase,state_ciphertext=EXCLUDED.state_ciphertext,updated_at=clock_timestamp()`,
   [a.workspaceId,s.epoch,s.phase,seal(JSON.stringify(s),stateAad(a.workspaceId,s.epoch),this.keyring)]);
 }
 async read(a:Actor):Promise<CutoverState>{return this.db.transaction(async tx=>{
  await tx.query("SET TRANSACTION READ ONLY");await this.lock(tx,a);return this.current(tx,a,false);
 });}
 async advance(a:Actor,input:{action:CutoverAction;proof:CutoverEvidence;operationId:string}):Promise<{state:CutoverState;replayed:boolean}>{
  const proof=proofSchema.parse(input.proof),action=actionSchema.parse(input.action),operation=operationSchema.parse(input.operationId);
  const digest=privateDigest({actorId:a.id,workspaceId:a.workspaceId,action,proof},this.integrityKey);
  return this.db.transaction(async tx=>{
   await this.lock(tx,a);
   const previous=await tx.query<Prior>(`SELECT payload_digest AS digest,actor_account_id AS "actorId",
    evidence_ciphertext AS ciphertext,result_epoch::text AS "resultEpoch" FROM ls_contact_ops.cutover_history
    WHERE workspace_id=$1 AND operation_id=$2`,[a.workspaceId,operation]);
   if(previous[0]){
    const p=previous[0];if(p.digest!==digest||p.actorId!==a.id)throw new AppError("CONFLICT");
    const record=this.decode(z.object({state:stateSchema,proof:proofSchema}).strict(),p.ciphertext,historyAad(a.workspaceId,operation));
    if(record.state.epoch!==Number(p.resultEpoch)||record.state.epoch!==proof.expectedEpoch+1)throw new AppError("UNAVAILABLE");
    // This is the immutable operation result, not a claim about the current phase.
    return {state:record.state,replayed:true};
   }
   const current=await this.current(tx,a);
   // Writes keep the phase epoch but advance this counter. Bind EVERY transition's
   // evidence to both, so an intervening write invalidates a rollback/delta proof.
   if(current.epoch!==proof.expectedEpoch||current.nativeWritesSinceSwitch!==proof.observedNativeWritesSinceSwitch||current.epoch>=Number.MAX_SAFE_INTEGER-1)throw new AppError("CONFLICT");
   let next:CutoverState;
   try{next=advanceCutover(current,action,proof,proof.batchId);}catch{throw new AppError("CONFLICT");}
   await this.save(tx,a,next);
   await tx.query(`INSERT INTO ls_contact_ops.cutover_history(workspace_id,operation_id,actor_account_id,action,
    from_epoch,result_epoch,payload_digest,evidence_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.workspaceId,operation,a.id,action,current.epoch,next.epoch,digest,
     seal(JSON.stringify({state:next,proof}),historyAad(a.workspaceId,operation),this.keyring)]);
   return {state:next,replayed:false};
  });
 }
 /** Native DB operations only, never Sheet/network/provider effects. The legacy
  * Sheet writer must use its own durable external fence, not a DB callback.
  * Read intents are PostgreSQL READ ONLY, not a caller promise. Use this same tx
  * for native writes; never select authority and commit a separate transaction.
  */
 async withDestination<T>(a:Actor,input:{destination:"sheet"|"native";intent:"read"|"write";expectedEpoch:number},
  work:(tx:SqlSession,state:CutoverState)=>Promise<T>):Promise<T>{
  if(!safeEpoch.safeParse(input.expectedEpoch).success||!["sheet","native"].includes(input.destination)||!["read","write"].includes(input.intent))throw new AppError("INVALID_REQUEST");
  if(input.destination!=="native")throw new AppError("CONFLICT");
  return this.db.transaction(async tx=>{
   // Keep READ COMMITTED: after waiting for the authority lock, the following
   // query must observe its newly committed epoch, not a pre-lock snapshot.
   if(input.intent==="read")await tx.query("SET TRANSACTION READ ONLY");
   await this.lock(tx,a);
   const current=await this.current(tx,a,input.intent==="write");
   if(current.epoch!==input.expectedEpoch||writeDestination(current.phase)!==input.destination)throw new AppError("CONFLICT");
   const result=await work(tx,{...current});
   if(input.intent==="write"&&input.destination==="native"){
    if(current.nativeWritesSinceSwitch>=Number.MAX_SAFE_INTEGER-1)throw new AppError("UNAVAILABLE");
    await this.save(tx,a,{...current,nativeWritesSinceSwitch:current.nativeWritesSinceSwitch+1});
   }
   return result;
  });
 }
}
