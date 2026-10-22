import "server-only";
import {AppError} from "../../lib/errors.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {unseal,type Keyring} from "../identity/crypto.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import type {NativeFishingProgram} from "../fishing/native-program.ts";
import {educationStorageBindingSchema,readOwnerVersionedLesson,decodeLessonEvent,lessonEventHeaderSchema,type EducationStorageBinding} from "./fishing-lesson-storage-contract.ts";
import {educationCatalogAad} from "./fishing-lesson-native-store.ts";
import {readWithdrawalManifest} from "./classroom-withdrawal-manifest.ts";
import {classroomRetainedHistoryQuerySchema,retainedClassroomProjection} from "./classroom-retained-history-contract.ts";
/** UNMOUNTED operator-only retained read. No grants, draft disclosure, guardian
 * bypass for ordinary work, provider archive, write/publication or activation. */
export class ClassroomRetainedHistoryNativeStore {
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly actor:Actor,private readonly program:NativeFishingProgram,private readonly clock:IdentityClock=systemClock){}
 private async fresh(tx:SqlSession){
  await lockWorkspace(tx,this.actor.workspaceId);const now=this.clock.now(),account=await freshActor(tx,this.actor,now);
  if(!Number.isFinite(now.valueOf())||!account.emailVerifiedAt||account.emailVerifiedAt>now||account.role!=="practitioner")throw new AppError("FORBIDDEN");return {...this.actor,...account};
 }
 async read(raw:unknown){const input=classroomRetainedHistoryQuerySchema.parse(raw);return this.db.transaction(async tx=>{
  const actor=await this.fresh(tx),scope=await this.program.readClassroomFamilyScopeInTransaction(tx,actor,{stageId:input.stageId,householdId:input.householdId}),manifest=await readWithdrawalManifest(tx,this.ring,actor.workspaceId,actor.id,input.withdrawalOperationId),ref=input.reference;
  if(manifest.command.stageId!==input.stageId||manifest.command.householdId!==input.householdId)throw new AppError("FORBIDDEN");
  const same=(r:{learnerId:string;moduleId:string;version:string})=>r.learnerId===ref.learnerId&&r.moduleId===ref.moduleId&&r.version===ref.version;
  const original=manifest.snapshot.scope.lessons.find(same),current=scope.lessons.find(same);
  if(!original||!current||JSON.stringify(current)!==JSON.stringify(original)||JSON.stringify(scope.template)!==JSON.stringify(manifest.snapshot.scope.template))throw new AppError("FORBIDDEN");
  const grant=await one(tx,"SELECT account_id FROM ls_education.account_grants WHERE workspace_id=$1 AND account_id=$2 AND learner_id=$3 AND module_id=$4 AND version=$5 AND active AND 'read_teacher'=ANY(permissions) FOR SHARE",[actor.workspaceId,actor.id,ref.learnerId,ref.moduleId,ref.version]);
  if(!grant)throw new AppError("FORBIDDEN");
  // The manifest admits only its recorded family withdrawal. A separate owner
  // or broad privacy revocation must not become an archive access exception.
  const revocations=await tx.query<{id:string}>("SELECT id FROM ls_education.access_revocations WHERE workspace_id=$1 AND (account_id IS NULL OR account_id=$2) AND (learner_id IS NULL OR learner_id=$3) AND (module_id IS NULL OR module_id=$4) AND (version IS NULL OR version=$5) LIMIT 2001 FOR SHARE",[actor.workspaceId,actor.id,ref.learnerId,ref.moduleId,ref.version]);
  if(revocations.length===0||revocations.length>2000||revocations.some(r=>!manifest.createdRevocations.some(m=>m.id===r.id&&same(m))))throw new AppError("FORBIDDEN");
  let catalog:EducationStorageBinding|null=null;
  const loaded=await readOwnerVersionedLesson({moduleId:ref.moduleId,version:ref.version},{canonicalWorkspaceId:actor.workspaceId,ownerAccountId:actor.id,
   readFreshActor:async()=>({actor:await this.fresh(tx),sessionRevoked:false}),
   resolveCatalog:async()=>{
    const row=await one<{sourceId:string;revision:string;sha:string;learnerId:string;teacherId:string;ciphertext:string}>(tx,`SELECT c.source_id AS "sourceId",c.source_revision AS revision,c.source_sha256 AS sha,c.learner_artifact_id AS "learnerId",c.teacher_artifact_id AS "teacherId",c.payload_ciphertext AS ciphertext FROM ls_education.catalog_versions c JOIN ls_identity.accounts a ON a.workspace_id=c.workspace_id AND a.id=c.approved_by WHERE c.workspace_id=$1 AND c.module_id=$2 AND c.version=$3 AND c.approval_state='approved' AND c.approval_provenance IS NOT NULL AND c.approved_at<=clock_timestamp() AND a.role='practitioner' AND a.state='active' FOR SHARE OF c,a`,[actor.workspaceId,ref.moduleId,ref.version]);
    if(!row||row.sourceId!==original.sourceId||row.revision!==original.sourceRevision||row.sha!==original.sourceSha256||row.learnerId!==original.learnerArtifactId||row.teacherId!==original.teacherArtifactId)throw new AppError("UNAVAILABLE");
    catalog=educationStorageBindingSchema.parse(JSON.parse(unseal(row.ciphertext,educationCatalogAad(actor.workspaceId,ref.moduleId,ref.version),this.ring)));
    if(catalog.state!=="approved"||catalog.source.sourceId!==row.sourceId||catalog.source.revision!==row.revision||catalog.source.sha256!==row.sha)throw new AppError("UNAVAILABLE");return catalog;
   },
   resolveArtifact:async expected=>{
    if(!catalog||expected.workspaceId!==actor.workspaceId)throw new AppError("UNAVAILABLE");
    const id=expected.storageClass==="resource_learner"?original.learnerArtifactId:original.teacherArtifactId;
    const row=await one<{reference:unknown;ciphertext:string;sourceId:string;version:string;locale:string;storageClass:string;sha:string}>(tx,`SELECT reference,payload_ciphertext AS ciphertext,source_id AS "sourceId",version,locale,storage_class AS "storageClass",sha256 AS sha FROM ls_education.artifact_versions WHERE workspace_id=$1 AND id=$2`,[actor.workspaceId,id]);
    if(!row||row.sourceId!==expected.sourceId||row.version!==expected.version||row.locale!==expected.locale||row.storageClass!==expected.storageClass||row.sha!==expected.sha256)throw new AppError("UNAVAILABLE");return {workspaceId:actor.workspaceId,reference:row.reference,ciphertext:row.ciphertext};
   },
  },this.ring,this.clock.now());
  if(loaded.catalogState!=="approved"||loaded.source.sha256!==original.sourceSha256)throw new AppError("UNAVAILABLE");
  const head=await one<{id:string|null}>(tx,"SELECT revision_id AS id FROM ls_education.lesson_heads WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 FOR SHARE",[actor.workspaceId,ref.learnerId,ref.moduleId,ref.version]);
  const rows=await tx.query<{id:string;actorId:string;operationId:string;previous:string|null;digest:string;header:unknown;ciphertext:string}>(`SELECT id,actor_account_id AS "actorId",operation_id AS "operationId",previous_revision_id AS previous,digest,header,payload_ciphertext AS ciphertext FROM ls_education.lesson_events WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 ORDER BY sequence LIMIT 501`,[actor.workspaceId,ref.learnerId,ref.moduleId,ref.version]);
  if(rows.length>500)throw new AppError("UNAVAILABLE");const events=rows.map(row=>{
   const h=lessonEventHeaderSchema.parse(row.header);if(h.id!==row.id||h.actorId!==row.actorId||h.operationId!==row.operationId||h.previousRevisionId!==row.previous||h.digest!==row.digest||h.workspaceId!==actor.workspaceId||h.learnerId!==ref.learnerId||h.moduleId!==ref.moduleId||h.version!==ref.version)throw new AppError("UNAVAILABLE");return decodeLessonEvent(h,row.ciphertext,this.ring);
  });
  if((events.at(-1)?.id??null)!==(head?.id??null))throw new AppError("UNAVAILABLE");
  const result=retainedClassroomProjection(input,loaded.lesson,events,actor.workspaceId);await this.fresh(tx);return result;
 });}
}
