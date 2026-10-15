import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {unseal,type Keyring} from "../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {educationArtifactAad,educationStorageBindingSchema,decodeLessonEvent,encodeLessonEvent,lessonEventHeaderSchema} from "./fishing-lesson-storage-contract.ts";
import {learnerLessonSchema,type LessonJourneyStore,type LessonJourneyTransaction,type LessonJourneyContext,type LessonReference} from "./fishing-lesson-journey.ts";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export const educationCatalogAad=(workspaceId:string,moduleId:string,version:string)=>`education-catalog:${workspaceId}:${hash(JSON.stringify({moduleId,version}))}`;
const permissions=z.array(z.enum(["submit","observe","publish_parent_summary","read_learner","read_teacher","read_parent"])).min(1).max(6);
const MAX_EVENTS=500;
const denied=()=>{throw new AppError("FORBIDDEN");};
/** Prospective unmounted adapter. No importer/grant writer; all facts are native
 * server records. Clinical/CRM/inquiry/payment records are never consulted. */
export class FishingLessonNativeStore implements LessonJourneyStore {
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly actor:Actor,private readonly clock:IdentityClock=systemClock,private readonly options:{childAccountsEnabled?:boolean}={}){}
 transaction<T>(work:(tx:LessonJourneyTransaction)=>Promise<T>):Promise<T>{
  return this.db.transaction(async sql=>{
   await lockWorkspace(sql,this.actor.workspaceId);const account=await freshActor(sql,this.actor,this.clock.now());
   if(!account.emailVerifiedAt)throw new AppError("UNAUTHENTICATED");
   const actor:Actor={...this.actor,...account};let resolved:LessonReference|null=null;
   if(actor.role==="child"&&this.options.childAccountsEnabled!==true)denied();
   const same=(ref:LessonReference)=>resolved!==null&&JSON.stringify(ref)===JSON.stringify(resolved);
   const tx:LessonJourneyTransaction={
    resolveFreshContext:async ref=>{const context=await this.context(sql,actor,ref);resolved=context?{...ref}:null;return context;},
    readEvents:async(ref,workspaceId)=>{
     if(!same(ref)||workspaceId!==actor.workspaceId)denied();
     const head=await one<{id:string|null}>(sql,`SELECT revision_id AS id FROM ls_education.lesson_heads
      WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 FOR UPDATE`,[workspaceId,ref.learnerId,ref.moduleId,ref.version]);
     const rows=await sql.query<{id:string;actorId:string;operationId:string;previous:string|null;digest:string;header:unknown;ciphertext:string}>(`SELECT id,actor_account_id AS "actorId",operation_id AS "operationId",previous_revision_id AS previous,digest,header,payload_ciphertext AS ciphertext
      FROM ls_education.lesson_events WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 ORDER BY sequence LIMIT 501`,[workspaceId,ref.learnerId,ref.moduleId,ref.version]);
     if(rows.length>MAX_EVENTS)throw new AppError("UNAVAILABLE");
     const events=rows.map(row=>{
      const header=lessonEventHeaderSchema.parse(row.header);
      if(header.id!==row.id||header.actorId!==row.actorId||header.operationId!==row.operationId||header.previousRevisionId!==row.previous||header.digest!==row.digest||
       header.workspaceId!==workspaceId||header.learnerId!==ref.learnerId||header.moduleId!==ref.moduleId||header.version!==ref.version)throw new AppError("UNAVAILABLE");
      return decodeLessonEvent(header,row.ciphertext,this.ring);
     });
     if((events.at(-1)?.id??null)!==(head?.id??null))throw new AppError("UNAVAILABLE");return events;
    },
    append:async(event,expected)=>{
     const ref={learnerId:event.learnerId,moduleId:event.moduleId,version:event.version};
     if(!same(ref)||event.workspaceId!==actor.workspaceId||event.actorId!==actor.id||event.actorRole!==actor.role||event.previousRevisionId!==expected)denied();
     // Actor-global operation identity is checked before head creation/CAS. A
     // changed/cross-lesson reuse cannot append under a second aggregate.
     const old=await one(sql,`SELECT id FROM ls_education.lesson_events WHERE workspace_id=$1 AND actor_account_id=$2 AND operation_id=$3`,[actor.workspaceId,actor.id,event.operationId]);
     if(old)throw new AppError("CONFLICT");
     // Inside the same workspace-locked transaction, stop BEFORE creating an
     // unreadable501st event. Existing500 reads/replays remain valid. Count is
     // itself bounded; no paging/capacity expansion is silently introduced.
     const capacity=await one<{total:number}>(sql,`SELECT count(*)::integer AS total FROM
      (SELECT id FROM ls_education.lesson_events WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 LIMIT 500) bounded`,
      [actor.workspaceId,ref.learnerId,ref.moduleId,ref.version]);
     if(!capacity||capacity.total>=MAX_EVENTS)throw new AppError("UNAVAILABLE");
     await sql.query(`INSERT INTO ls_education.lesson_heads(workspace_id,learner_id,module_id,version,revision_id) VALUES($1,$2,$3,$4,NULL)
      ON CONFLICT(workspace_id,learner_id,module_id,version) DO NOTHING`,[actor.workspaceId,ref.learnerId,ref.moduleId,ref.version]);
     const head=await one<{id:string|null}>(sql,`SELECT revision_id AS id FROM ls_education.lesson_heads WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 FOR UPDATE`,[actor.workspaceId,ref.learnerId,ref.moduleId,ref.version]);
     if(!head||head.id!==expected)throw new AppError("CONFLICT");const encoded=encodeLessonEvent(event,this.ring);
     await sql.query(`INSERT INTO ls_education.lesson_events(workspace_id,id,learner_id,module_id,version,actor_account_id,operation_id,previous_revision_id,digest,header,payload_ciphertext)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,[actor.workspaceId,event.id,ref.learnerId,ref.moduleId,ref.version,actor.id,event.operationId,expected,event.digest,JSON.stringify(encoded.header),encoded.ciphertext]);
     const changed=await sql.query(`UPDATE ls_education.lesson_heads SET revision_id=$5 WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 AND revision_id IS NOT DISTINCT FROM $6::uuid RETURNING revision_id`,
      [actor.workspaceId,ref.learnerId,ref.moduleId,ref.version,event.id,expected]);
     if(changed.length!==1)throw new AppError("CONFLICT");
    },
   };return work(tx);
  });
 }
 private async context(tx:SqlSession,actor:Actor,ref:LessonReference):Promise<LessonJourneyContext|null>{
  const args=[actor.workspaceId,ref.learnerId,ref.moduleId,ref.version];
  const revoked=await tx.query(`SELECT id FROM ls_education.access_revocations WHERE workspace_id=$1
   AND (learner_id IS NULL OR learner_id=$2) AND (module_id IS NULL OR module_id=$3) AND (version IS NULL OR version=$4)
   AND (account_id IS NULL OR account_id=$5) LIMIT 1`,[...args,actor.id]);if(revoked.length)return null;
  const assignment=await one<{active:boolean}>(tx,`SELECT active FROM ls_education.educational_assignments WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 FOR SHARE`,args);
  const grant=await one<{active:boolean;permissions:unknown}>(tx,`SELECT active,permissions FROM ls_education.account_grants WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3 AND version=$4 AND account_id=$5 FOR SHARE`,[...args,actor.id]);
  if(!assignment?.active||!grant?.active)return null;
  const guardians=await tx.query<{id:string}>(`SELECT g.account_id AS id FROM ls_education.guardian_authorities g JOIN ls_identity.accounts a ON a.workspace_id=g.workspace_id AND a.id=g.account_id
   WHERE g.workspace_id=$1 AND g.learner_id=$2 AND g.active AND g.verified_at<=clock_timestamp() AND a.role='parent' AND a.state='active'
   AND NOT EXISTS(SELECT 1 FROM ls_education.access_revocations r WHERE r.workspace_id=g.workspace_id AND (r.account_id IS NULL OR r.account_id=g.account_id)
    AND (r.learner_id IS NULL OR r.learner_id=g.learner_id) AND (r.module_id IS NULL OR r.module_id=$3) AND (r.version IS NULL OR r.version=$4))
   ORDER BY g.account_id LIMIT 11 FOR SHARE OF g,a`,args);
  if(guardians.length>10)throw new AppError("UNAVAILABLE");
  // An education grant is not independent current guardian authority. Retained
  // access after withdrawal is unselected; no role silently bypasses this gate.
  if(guardians.length===0)return null;
  const row=await one<{sourceId:string;revision:string;sha:string;learnerId:string;teacherId:string;state:string;ciphertext:string}>(tx,`SELECT c.source_id AS "sourceId",c.source_revision AS revision,c.source_sha256 AS sha,
   c.learner_artifact_id AS "learnerId",c.teacher_artifact_id AS "teacherId",c.approval_state AS state,c.payload_ciphertext AS ciphertext FROM ls_education.catalog_versions c
   JOIN ls_identity.accounts a ON a.workspace_id=c.workspace_id AND a.id=c.approved_by
   WHERE c.workspace_id=$1 AND c.module_id=$2 AND c.version=$3 AND c.approval_provenance IS NOT NULL AND c.approved_at<=clock_timestamp()
   AND a.role='practitioner' AND a.state='active' FOR SHARE OF c,a`,[actor.workspaceId,ref.moduleId,ref.version]);
  if(!row||row.state!=="approved")return null;
  const catalog=educationStorageBindingSchema.parse(JSON.parse(unseal(row.ciphertext,educationCatalogAad(actor.workspaceId,ref.moduleId,ref.version),this.ring)));
  if(catalog.workspaceId!==actor.workspaceId||catalog.moduleId!==ref.moduleId||catalog.version!==ref.version||catalog.state!=="approved"||
   catalog.source.sourceId!==row.sourceId||catalog.source.revision!==row.revision||catalog.source.sha256!==row.sha)throw new AppError("UNAVAILABLE");
  let learnerBytes="";
  for(const [id,reference] of [[row.learnerId,catalog.learner],[row.teacherId,catalog.teacher]] as const){
   const artifact=await one<{reference:unknown;ciphertext:string;sourceId:string;version:string;locale:string;storageClass:string;sha:string}>(tx,`SELECT reference,payload_ciphertext AS ciphertext,source_id AS "sourceId",version,locale,storage_class AS "storageClass",sha256 AS sha FROM ls_education.artifact_versions WHERE workspace_id=$1 AND id=$2`,[actor.workspaceId,id]);
   if(!artifact||JSON.stringify(educationStorageBindingSchema.shape.learner.parse(artifact.reference))!==JSON.stringify(reference)||artifact.sourceId!==reference.sourceId||artifact.version!==reference.version||artifact.locale!==reference.locale||artifact.storageClass!==reference.storageClass||artifact.sha!==reference.sha256)throw new AppError("UNAVAILABLE");
   const bytes=unseal(artifact.ciphertext,educationArtifactAad(actor.workspaceId,reference),this.ring);
   if(hash(bytes)!==reference.sha256)throw new AppError("UNAVAILABLE");if(reference.storageClass==="resource_learner")learnerBytes=bytes;
  }
  const lesson=learnerLessonSchema.parse(JSON.parse(learnerBytes));
  if(lesson.moduleId!==ref.moduleId||lesson.version!==ref.version||lesson.locale!==catalog.learner.locale||lesson.status!=="approved"||lesson.sourceSha256!==catalog.source.sha256)throw new AppError("UNAVAILABLE");
  return {actor,sessionRevoked:false,lesson,assignment:{...ref,workspaceId:actor.workspaceId,active:true},grant:{...ref,workspaceId:actor.workspaceId,accountId:actor.id,active:true,permissions:permissions.parse(grant.permissions)},authorizedParentAccountIds:guardians.map(g=>g.id)};
 }
}
