import "server-only";
import {createHash} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import type {IdentityConfig} from "../identity/config.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {unseal} from "../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import type {AcademyFamilyStore} from "../fishing/academy-family-store.ts";
import type {NativeFishingProgram} from "../fishing/native-program.ts";
import {classroomFamilyWithdrawalNativeId} from "./classroom-family-withdrawal-store.ts";
import {classroomFamilyWithdrawalResultSchema} from "./classroom-family-withdrawal-contract.ts";
import {readWithdrawalManifest} from "./classroom-withdrawal-manifest.ts";
import {ClassroomRetainedHistoryNativeStore} from "./classroom-retained-history-native-store.ts";
import {classroomFamilyRetainedHistoryRequestSchema,classroomFamilyRetainedHistoryReviewSchema} from "./classroom-family-retained-history-contract.ts";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Saved-family owner-only adapter; runtime factory is deliberately absent by
 * default. Read requests never restore ordinary access or mutate history. */
export class ClassroomFamilyRetainedHistoryStore {
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,private readonly clock:IdentityClock=systemClock,private readonly programFactory?:(bound:IdentityStore)=>NativeFishingProgram){}
 private async fresh(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.config.workspaceId)throw new AppError("FORBIDDEN");
  await lockWorkspace(tx,actor.workspaceId);const now=this.clock.now(),current=await freshActor(tx,actor,now);
  if(!Number.isFinite(now.valueOf())||!current.emailVerifiedAt||current.emailVerifiedAt>now||current.role!=="practitioner")throw new AppError("FORBIDDEN");
 }
 async read(actor:Actor,raw:unknown){
  const parsed=classroomFamilyRetainedHistoryRequestSchema.safeParse(raw);if(!parsed.success)throw new AppError("INVALID_REQUEST");const input=parsed.data;
  // Check actual session/role before deriving saved application information.
  await this.db.transaction(tx=>this.fresh(tx,actor));if(!this.programFactory)throw new AppError("UNAVAILABLE");
  const context=await this.family.context(actor,input.applicationId);if(context.state!=="ready"||!context.saved)throw new AppError("NOT_FOUND");
  const binding={applicationId:input.applicationId,personId:context.personId,expectedEpoch:context.expectedEpoch,expectedAssociationVersion:context.expectedAssociationVersion,expectedFieldsDigest:context.fieldsDigest,expectedFamilyDigest:digest(context.saved)};
  return this.db.transaction(async tx=>{
   await this.fresh(tx,actor);const saved=await this.family.readForEnrollmentInTransaction(tx,actor,binding),bound:IdentityStore={transaction:work=>work(tx)},program=this.programFactory!(bound),innerId=classroomFamilyWithdrawalNativeId(actor,input.withdrawalOperationId);
   const scope=await program.readClassroomFamilyScopeInTransaction(tx,actor,{stageId:input.stageId,householdId:saved.householdId}),manifest=await readWithdrawalManifest(tx,this.config.keyring,actor.workspaceId,actor.id,innerId);
   if(manifest.command.stageId!==input.stageId||manifest.command.householdId!==saved.householdId||JSON.stringify(scope.template)!==JSON.stringify(manifest.snapshot.scope.template))throw new AppError("FORBIDDEN");
   const outer=await one<{action:string;hash:string;ciphertext:string}>(tx,"SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3",[actor.workspaceId,actor.id,input.withdrawalOperationId]);
   if(!outer||outer.action!=="classroom.family.withdraw.http"||!/^[a-f0-9]{64}$/.test(outer.hash))throw new AppError("UNAVAILABLE");
   // This verifies a hash-bound result, not the original full HTTP command.
   // Current saved-family authority and original manifest authorize the read.
   const result=classroomFamilyWithdrawalResultSchema.parse(JSON.parse(unseal(outer.ciphertext,`classroom-withdrawal-http:v1:${actor.workspaceId}:${actor.id}:${input.withdrawalOperationId}:${outer.hash}`,this.config.keyring)));
   if(result.operationId!==input.withdrawalOperationId||result.stageId!==input.stageId||result.replayed||result.state!==manifest.result.state||result.recordedAt!==manifest.result.recordedAt||result.revokedLessonCount!==manifest.result.revokedLessonCount)throw new AppError("UNAVAILABLE");
   const lessons=manifest.snapshot.scope.lessons.filter(original=>scope.lessons.some(current=>JSON.stringify(current)===JSON.stringify(original)));
   if(!lessons.length||lessons.some(l=>!saved.children.some(c=>c.learnerId===l.learnerId)))throw new AppError("FORBIDDEN");
   if(input.action==="review"){
    const children=[...new Set(lessons.map(l=>l.learnerId))].map(learnerId=>({learnerId,displayName:saved.children.find(c=>c.learnerId===learnerId)!.displayName,lessons:lessons.filter(l=>l.learnerId===learnerId).map(({moduleId,version})=>({moduleId,version}))}));
    await this.fresh(tx,actor);return classroomFamilyRetainedHistoryReviewSchema.parse({state:"ready",applicationId:input.applicationId,stageId:input.stageId,withdrawalOperationId:input.withdrawalOperationId,children});
   }
   if(!lessons.some(l=>l.learnerId===input.reference.learnerId&&l.moduleId===input.reference.moduleId&&l.version===input.reference.version))throw new AppError("FORBIDDEN");
   const history=await new ClassroomRetainedHistoryNativeStore(bound,this.config.keyring,actor,program,this.clock).read({stageId:input.stageId,householdId:saved.householdId,withdrawalOperationId:innerId,reference:input.reference});
   await this.fresh(tx,actor);return {...history,withdrawalOperationId:input.withdrawalOperationId};
  });
 }
}
