import "server-only";
import {createHash} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import type {IdentityConfig} from "../identity/config.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {seal,unseal} from "../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import type {NativeFishingProgram} from "../fishing/native-program.ts";
import type {AcademyFamilyStore} from "../fishing/academy-family-store.ts";
import {classroomWithdrawalVersion} from "./classroom-withdrawal-contract.ts";
import {ClassroomWithdrawalNativeStore} from "./classroom-withdrawal-native-store.ts";
import {classroomFamilyWithdrawalCommandSchema,classroomFamilyWithdrawalQuerySchema,classroomFamilyWithdrawalResultSchema,type ClassroomFamilyWithdrawalReview,type ClassroomFamilyWithdrawalResult} from "./classroom-family-withdrawal-contract.ts";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function classroomFamilyWithdrawalNativeId(actor:Pick<Actor,"workspaceId"|"id">,operationId:string){const h=digest(["classroom.family.withdraw.http",actor.workspaceId,actor.id,operationId]);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
/** Ordinary saved-family adapter. Production has no runtime admission. Tests
 * may supply a genuine native program constructor, never a permissive port. */
export class ClassroomFamilyWithdrawalStore {
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,private readonly clock:IdentityClock=systemClock,private readonly programFactory?:(bound:IdentityStore)=>NativeFishingProgram){}
 private async fresh(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.config.workspaceId)throw new AppError("FORBIDDEN");
  await lockWorkspace(tx,actor.workspaceId);const now=this.clock.now(),current=await freshActor(tx,actor,now);
  if(!Number.isFinite(now.valueOf())||!current.emailVerifiedAt||current.emailVerifiedAt>now||current.role!=="practitioner")throw new AppError("FORBIDDEN");
 }
 private dependencies(tx:SqlSession,actor:Actor){
  const bound:IdentityStore={transaction:work=>work(tx)},program=this.programFactory?.(bound);
  // Historical enrollment reads deliberately do not activate a merchant. A
  // separately admitted runtime constructor is required; default is closed.
  if(!program)throw new AppError("UNAVAILABLE");
  return {program,native:new ClassroomWithdrawalNativeStore(bound,this.config.keyring,actor,program,this.clock)};
 }
 async review(actor:Actor,raw:unknown):Promise<ClassroomFamilyWithdrawalReview>{
  const parsed=classroomFamilyWithdrawalQuerySchema.safeParse(raw);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const {applicationId,stageId}=parsed.data,context=await this.family.context(actor,applicationId);
  if(context.state!=="ready"||!context.saved)throw new AppError("NOT_FOUND");
  const binding={applicationId,personId:context.personId,expectedEpoch:context.expectedEpoch,expectedAssociationVersion:context.expectedAssociationVersion,expectedFieldsDigest:context.fieldsDigest,expectedFamilyDigest:digest(context.saved)};
  return this.db.transaction(async tx=>{
   await this.fresh(tx,actor);const saved=await this.family.readForEnrollmentInTransaction(tx,actor,binding),{program,native}=this.dependencies(tx,actor),selected={stageId,householdId:saved.householdId};
   const scope=await program.readClassroomFamilyScopeInTransaction(tx,actor,selected),review=await native.review(selected),retained=await native.readRetainedAudit(selected);
   const ids=[...new Set(scope.lessons.map(l=>l.learnerId))];
   if(ids.some(id=>!saved.children.some(child=>child.learnerId===id)))throw new AppError("CONFLICT");
   const children=ids.map(learnerId=>({learnerId,displayName:saved.children.find(c=>c.learnerId===learnerId)!.displayName,lessons:scope.lessons.filter(l=>l.learnerId===learnerId).map(({moduleId,version})=>({moduleId,version}))}));
   await this.fresh(tx,actor);return {state:"ready",binding,stageId,scopeSha256:review.scopeSha256,enrollmentCount:review.enrollmentCount,lessonCount:review.lessonCount,children,withdrawn:retained.withdrawn,retainedEventCount:retained.retainedEventCount};
  });
 }
 async execute(actor:Actor,raw:unknown):Promise<ClassroomFamilyWithdrawalResult>{
  const parsed=classroomFamilyWithdrawalCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError("INVALID_REQUEST");const command=parsed.data;
  return this.db.transaction(async tx=>{
   await this.fresh(tx,actor);
   // Current saved application/family binding precedes even receipt replay.
   const saved=await this.family.readForEnrollmentInTransaction(tx,actor,command.binding),{native}=this.dependencies(tx,actor),hash=digest(command),action="classroom.family.withdraw.http";
   const aad=`classroom-withdrawal-http:v1:${actor.workspaceId}:${actor.id}:${command.operationId}:${hash}`;
   const old=await one<{action:string;hash:string;ciphertext:string}>(tx,"SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3",[actor.workspaceId,actor.id,command.operationId]);
   if(old&&(old.action!==action||old.hash!==hash))throw new AppError("CONFLICT");
   // Separate deterministic operation namespace leaves the outer ID available
   // for an encrypted receipt binding the entire normalized HTTP body.
   const innerId=classroomFamilyWithdrawalNativeId(actor,command.operationId);
   const result=await native.withdraw({version:classroomWithdrawalVersion,operationId:innerId,stageId:command.stageId,householdId:saved.householdId,expectedScopeSha256:command.expectedScopeSha256});
   const output=classroomFamilyWithdrawalResultSchema.parse({operationId:command.operationId,stageId:result.stageId,state:result.state,revokedLessonCount:result.revokedLessonCount,recordedAt:result.recordedAt,replayed:false});
   if(old){const prior=classroomFamilyWithdrawalResultSchema.parse(JSON.parse(unseal(old.ciphertext,aad,this.config.keyring)));if(digest(prior)!==digest(output)||!result.replayed)throw new AppError("UNAVAILABLE");await this.fresh(tx,actor);return {...prior,replayed:true};}
   if(result.replayed)throw new AppError("UNAVAILABLE");
   await tx.query("INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[actor.workspaceId,actor.id,command.operationId,action,hash,seal(JSON.stringify(output),aad,this.config.keyring),output.recordedAt]);
   await this.fresh(tx,actor);return output;
  });
 }
}
