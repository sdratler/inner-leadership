import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import type {NativeFishingProgram} from "../fishing/native-program.ts";
import {classroomWithdrawalCommandSchema,classroomWithdrawalReceiptSchema,classroomWithdrawalScopeSchema,classroomWithdrawalVersion} from "./classroom-withdrawal-contract.ts";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex"),action="classroom.family.withdraw";
type Revocation={id:string;accountId:string|null;learnerId:string|null;moduleId:string|null;version:string|null};
/** Unmounted command: no importer, provider, migration, financial withdrawal,
 * runtime enablement or historical-content disclosure is supplied here. */
export class ClassroomWithdrawalNativeStore {
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly actor:Actor,private readonly program:NativeFishingProgram,private readonly clock:IdentityClock=systemClock){}
 private async fresh(tx:SqlSession){
  await lockWorkspace(tx,this.actor.workspaceId);const now=this.clock.now(),account=await freshActor(tx,this.actor,now);
  if(!Number.isFinite(now.valueOf())||!account.emailVerifiedAt||account.emailVerifiedAt>now||account.role!=="practitioner")throw new AppError("FORBIDDEN");
  return {...this.actor,...account};
 }
 private aad(operationId:string,hash:string){return `classroom-withdrawal:v1:${this.actor.workspaceId}:${this.actor.id}:${operationId}:${hash}`;}
 private async snapshot(tx:SqlSession,raw:unknown){
  const actor=await this.fresh(tx),scope=await this.program.readClassroomFamilyScopeInTransaction(tx,actor,raw);
  const learnerIds=[...new Set(scope.lessons.map(l=>l.learnerId))];
  const revocations=await tx.query<Revocation>(`SELECT id,account_id AS "accountId",learner_id AS "learnerId",module_id AS "moduleId",version FROM ls_education.access_revocations
   WHERE workspace_id=$1 AND (learner_id IS NULL OR learner_id=ANY($2::uuid[])) ORDER BY id LIMIT 2001`,[actor.workspaceId,learnerIds]);
  if(revocations.length>2000)throw new AppError("UNAVAILABLE");return {scope,revocations,scopeSha256:digest({scope,revocations})};
 }
 async review(raw:unknown){const input=classroomWithdrawalScopeSchema.parse(raw);return this.db.transaction(async tx=>{
  const s=await this.snapshot(tx,input);await this.fresh(tx);return {...input,scopeSha256:s.scopeSha256,enrollmentCount:s.scope.enrollments.length,lessonCount:s.scope.lessons.length};
 });}
 async withdraw(raw:unknown){const input=classroomWithdrawalCommandSchema.parse(raw),hash=digest(input);return this.db.transaction(async tx=>{
  // Current operator/family/source authority precedes even exact replay.
  const selected={stageId:input.stageId,householdId:input.householdId},s=await this.snapshot(tx,selected);
  const old=await one<{action:string;hash:string;ciphertext:string}>(tx,`SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts
   WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3`,[this.actor.workspaceId,this.actor.id,input.operationId]);
  if(old){
   if(old.action!==action||old.hash!==hash)throw new AppError("CONFLICT");
   const saved=classroomWithdrawalReceiptSchema.parse(JSON.parse(unseal(old.ciphertext,this.aad(input.operationId,hash),this.ring)));
   if(saved.operationId!==input.operationId||saved.stageId!==input.stageId||saved.householdId!==input.householdId||saved.scopeSha256!==input.expectedScopeSha256)throw new AppError("UNAVAILABLE");
   await this.fresh(tx);return {...saved,replayed:true};
  }
  if(s.scopeSha256!==input.expectedScopeSha256)throw new AppError("CONFLICT");
  for(const lesson of s.scope.lessons)await tx.query(`INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,module_id,version,recorded_by)
   VALUES($1,$2,NULL,$3,$4,$5,$6)`,[this.actor.workspaceId,randomUUID(),lesson.learnerId,lesson.moduleId,lesson.version,this.actor.id]);
  const current=await this.program.readClassroomFamilyScopeInTransaction(tx,await this.fresh(tx),selected);
  if(digest(current)!==digest(s.scope))throw new AppError("CONFLICT");
  const result=classroomWithdrawalReceiptSchema.parse({...selected,version:classroomWithdrawalVersion,operationId:input.operationId,scopeSha256:s.scopeSha256,state:"withdrawn",revokedLessonCount:s.scope.lessons.length,recordedAt:this.clock.now().toISOString()});
  await tx.query(`INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[this.actor.workspaceId,this.actor.id,input.operationId,action,hash,seal(JSON.stringify(result),this.aad(input.operationId,hash),this.ring),result.recordedAt]);
  await this.fresh(tx);return {...result,replayed:false};
 });}
 /** Counts/digests-only internal retention proof, never a content DTO. */
 async readRetainedAudit(raw:unknown){const input=classroomWithdrawalScopeSchema.parse(raw);return this.db.transaction(async tx=>{
  const s=await this.snapshot(tx,input),history:unknown[]=[];let retainedEventCount=0;
  for(const lesson of s.scope.lessons){const rows=await tx.query<{id:string;digest:string;ciphertext:string}>(`SELECT id,digest,payload_ciphertext AS ciphertext FROM ls_education.lesson_events WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 ORDER BY sequence LIMIT 501`,[this.actor.workspaceId,lesson.learnerId,lesson.moduleId,lesson.version]);
   if(rows.length>500)throw new AppError("UNAVAILABLE");retainedEventCount+=rows.length;history.push({lesson,rows});}
  await this.fresh(tx);return {...input,retainedEventCount,historySha256:digest(history),lessonCount:s.scope.lessons.length,withdrawn:s.scope.lessons.every(l=>s.revocations.some(r=>r.accountId===null&&r.learnerId===l.learnerId&&r.moduleId===l.moduleId&&r.version===l.version))};
 });}
}
