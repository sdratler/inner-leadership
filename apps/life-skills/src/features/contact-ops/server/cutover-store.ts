import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {freshActor,lockWorkspace} from "../../identity/data.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {advanceCutover,writeDestination,type CutoverState,type CutoverProof,type CutoverAction} from "../core/cutover.ts";
import {privateDigest} from "./digests.ts";
import {cutoverEpochSchema as safeEpoch,cutoverStateSchema as stateSchema,cutoverStateAad as stateAad,readCutoverState} from "./cutover-state.ts";
import {asId} from '../../../lib/ids.ts';
import {assertCutoverOperatorPayload,authorizeCutoverOperator,type CutoverOperatorPermit,type CutoverPrincipal} from './cutover-operator.ts';
import {ACADEMY_CRM_PROGRAM,academyInitializationInputSchema,type AcademyInitializationInput} from '../core/academy-crm.ts';
import {demoAccountBatch} from '../../demo/provenance.ts';

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
export type CutoverAdvanceInput={action:CutoverAction;proof:CutoverEvidence;operationId:string};

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
 private async current(tx:SqlSession,a:CutoverPrincipal,forUpdate=true):Promise<CutoverState>{
  return readCutoverState(tx,a.workspaceId,this.keyring,forUpdate);
 }
 private async save(tx:SqlSession,a:CutoverPrincipal,s:CutoverState){
  stateSchema.parse(s);
  await tx.query(`INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,$2,$3,$4)
   ON CONFLICT(workspace_id) DO UPDATE SET epoch=EXCLUDED.epoch,phase=EXCLUDED.phase,state_ciphertext=EXCLUDED.state_ciphertext,updated_at=clock_timestamp()`,
   [a.workspaceId,s.epoch,s.phase,seal(JSON.stringify(s),stateAad(a.workspaceId,s.epoch),this.keyring)]);
 }
 async read(a:Actor):Promise<CutoverState>{return this.db.transaction(async tx=>{
  await tx.query("SET TRANSACTION READ ONLY");await this.lock(tx,a);return this.current(tx,a,false);
 });}
 async advance(a:Actor,input:CutoverAdvanceInput):Promise<{state:CutoverState;replayed:boolean}>{
  return this.advanceAuthorized(a,input,tx=>this.authorize(tx,a));
 }
 /** Reviewed server-side coordination only; deliberately absent from HTTP and
  * the old signed import operator. External evidence is a coordinator duty.
  * This method neither imports nor deletes anything. Existing CRM profiles
  * require their exact preservation/removal reconciliation before this path. */
 async initializeAcademy(a:Actor,input:AcademyInitializationInput):Promise<{state:CutoverState;replayed:boolean}>{
  const proof=academyInitializationInputSchema.parse(input),operation=proof.operationId;
  const digest=privateDigest({actorId:a.id,workspaceId:a.workspaceId,action:"initialize_academy",proof},this.integrityKey);
  return this.db.transaction(async tx=>{
   await this.lock(tx,a);
   if(await demoAccountBatch(tx,a.workspaceId,a.id)!==null)throw new AppError("FORBIDDEN");
   const previous=await tx.query<Prior>(`SELECT payload_digest AS digest,actor_account_id AS "actorId",
    evidence_ciphertext AS ciphertext,result_epoch::text AS "resultEpoch" FROM ls_contact_ops.cutover_history
    WHERE workspace_id=$1 AND operation_id=$2`,[a.workspaceId,operation]);
   if(previous[0]){
    const prior=previous[0];if(prior.digest!==digest||prior.actorId!==a.id)throw new AppError("CONFLICT");
    const record=this.decode(z.object({state:stateSchema,proof:academyInitializationInputSchema}).strict(),prior.ciphertext,historyAad(a.workspaceId,operation));
    if(record.state.phase!=="academy_native"||record.state.epoch!==Number(prior.resultEpoch)||
     record.state.epoch!==proof.expectedEpoch+1||record.state.academy?.operationId!==operation)throw new AppError("UNAVAILABLE");
    return {state:record.state,replayed:true};
   }
   const current=await this.current(tx,a);
   if(current.phase!=="sheet_active"||current.academy||current.epoch!==proof.expectedEpoch||
    current.nativeWritesSinceSwitch!==proof.observedNativeWritesSinceSwitch||current.nativeWritesSinceSwitch!==0||
    current.epoch>=Number.MAX_SAFE_INTEGER-1)throw new AppError("CONFLICT");
   // The identity lock also serializes shadow-import/profile creation. Identity
   // accounts, genuine Academy applications, families and receipts stay intact.
   await lockWorkspace(tx,a.workspaceId);
   const existing=await tx.query(`SELECT person_id FROM ls_contact_ops.profiles WHERE workspace_id=$1 LIMIT 1`,[a.workspaceId]);
   if(existing.length)throw new AppError("CONFLICT");
   await this.assertNoPendingEffects(tx,a.workspaceId);
   const next:CutoverState={phase:"academy_native",epoch:current.epoch+1,batchId:operation,
    sourceFileId:null,sourceRevision:null,nativeWritesSinceSwitch:0,
    academy:{kind:"academy_fresh",program:ACADEMY_CRM_PROGRAM,operationId:operation,decisionId:proof.decisionId,
     initializedAt:this.clock.now().toISOString(),importedRows:0,evidence:proof.evidence}};
   await this.save(tx,a,next);
   await tx.query(`INSERT INTO ls_contact_ops.cutover_history(workspace_id,operation_id,actor_account_id,action,
    from_epoch,result_epoch,payload_digest,evidence_ciphertext) VALUES($1,$2,$3,'initialize_academy',$4,$5,$6,$7)`,
    [a.workspaceId,operation,a.id,current.epoch,next.epoch,digest,
     seal(JSON.stringify({state:next,proof}),historyAad(a.workspaceId,operation),this.keyring)]);
   return {state:next,replayed:false};
  });
 }
 private async assertNoPendingEffects(tx:SqlSession,workspaceId:string){
  const pending=await tx.query(`SELECT operation_id FROM ls_contact_ops.outbound_projections
   WHERE workspace_id=$1 AND state IN ('prepared','sent_pending') LIMIT 1`,[workspaceId]);
  if(pending.length)throw new AppError("CONFLICT");
  const labelTable=await tx.query<{labels:string|null}>("SELECT to_regclass('ls_contact_ops.fishing_label_projection')::text AS labels");
  if(labelTable[0]?.labels){
   const labels=await tx.query(`SELECT person_id FROM ls_contact_ops.fishing_label_projection
    WHERE workspace_id=$1 AND (status IN ('pending','outcome_unknown') OR unresolved_effect) LIMIT 1`,[workspaceId]);
   if(labels.length)throw new AppError("CONFLICT");
  }
 }
 /** The fresh Academy adapter is separate from generic native authority. Its
  * caller must enforce immutable contact admission before every data access. */
 async withAcademy<T>(a:Actor,input:{intent:"read"|"write";expectedEpoch:number},
  work:(tx:SqlSession,state:CutoverState&{academy:NonNullable<CutoverState["academy"]>})=>Promise<T>):Promise<T>{
  if(!safeEpoch.safeParse(input.expectedEpoch).success||!["read","write"].includes(input.intent))throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   if(input.intent==="read")await tx.query("SET TRANSACTION READ ONLY");
   await this.lock(tx,a);const current=await this.current(tx,a,input.intent==="write");
   if(current.phase!=="academy_native"||!current.academy||current.academy.program!==ACADEMY_CRM_PROGRAM||
    current.epoch!==input.expectedEpoch)throw new AppError("CONFLICT");
   const result=await work(tx,{...current,academy:current.academy});
   if(input.intent==="write"){
    if(current.nativeWritesSinceSwitch>=Number.MAX_SAFE_INTEGER-1)throw new AppError("UNAVAILABLE");
    await this.save(tx,a,{...current,nativeWritesSinceSwitch:current.nativeWritesSinceSwitch+1});
   }
   return result;
  });
 }
 async advanceAsOperator(input:CutoverAdvanceInput,permit:CutoverOperatorPermit,lookupKey:Buffer){
  assertCutoverOperatorPayload(permit,input,this.integrityKey);
  const a={workspaceId:asId(permit.envelope.workspaceId,'workspace'),id:asId(permit.envelope.ownerAccountId,'account')};
  if(input.action==='retire_sheet')throw new AppError('FORBIDDEN');
  const action=input.action;
  return this.advanceAuthorized(a,input,async tx=>{await authorizeCutoverOperator(tx,this.keyring,lookupKey,permit,[action],this.clock.now());});
 }
 private async advanceAuthorized(a:CutoverPrincipal,input:CutoverAdvanceInput,authorize:(tx:SqlSession)=>Promise<void>):Promise<{state:CutoverState;replayed:boolean}>{
  const proof=proofSchema.parse(input.proof),action=actionSchema.parse(input.action),operation=operationSchema.parse(input.operationId);
  const digest=privateDigest({actorId:a.id,workspaceId:a.workspaceId,action,proof},this.integrityKey);
  return this.db.transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${a.workspaceId}:contact-authority`]);
   await authorize(tx);
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
   // Every action, including prepare and both rollback steps, advances the
   // authority epoch. The same lock protects pre-send intents: no transition
   // may strand a receipt or Sheet projection awaiting reconciliation.
   // The additive label table is not a dependency of the earlier inquiry-only
   // release. Once installed, do not strand an unfinished managed association
   // by switching authority, even when the caller obtained a fresh counter.
   await this.assertNoPendingEffects(tx,a.workspaceId);
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
