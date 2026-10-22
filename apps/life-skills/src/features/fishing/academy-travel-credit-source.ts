import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {educationCatalogAad} from '../resources/fishing-lesson-native-store.ts';
import {educationArtifactAad,educationStorageBindingSchema} from '../resources/fishing-lesson-storage-contract.ts';
import {learnerLessonSchema} from '../resources/fishing-lesson-journey.ts';
import {academyTravelCreditVersion,travelActivityBindingSchema,type TravelActivityBinding} from './academy-travel-credit-contract.ts';

export const travelDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const travelActivityAad=(workspaceId:string,id:string)=>`academy-travel-activity:v1:${workspaceId}:${id}`;
export const travelEquivalenceAad=(workspaceId:string,id:string)=>`academy-travel-equivalence:v1:${workspaceId}:${id}`;
function invalid():never{throw new AppError('UNAVAILABLE');}
const equivalenceSchema=z.strictObject({version:z.literal(academyTravelCreditVersion),id:z.uuid(),workspaceId:z.uuid(),originalBindingId:z.uuid(),replacementBindingId:z.uuid(),
 approval:travelActivityBindingSchema.shape.approval,source:travelActivityBindingSchema.shape.curriculum});
/** No approval/import writer. A missing or ambiguous adopted activity keeps
 * issuance unavailable, even when native module and quiz records exist. */
export async function readTravelActivity(tx:SqlSession,ring:Keyring,input:{workspaceId:string;templateApprovalId:string;templateSourceSha256:string;moduleId:string;moduleVersion:string},now:Date):Promise<TravelActivityBinding|null>{
 const rows=await tx.query<{id:string;sha256:string;ciphertext:string;approvedBy:string;approvedAt:Date}>(`SELECT b.id,b.sha256,b.payload_ciphertext AS ciphertext,b.approved_by AS "approvedBy",b.approved_at AS "approvedAt" FROM ls_fishing_stage.academy_travel_activity_bindings b
 JOIN ls_identity.accounts a ON a.workspace_id=b.workspace_id AND a.id=b.approved_by AND a.role='practitioner' AND a.state='active'
 WHERE b.workspace_id=$1 AND b.template_approval_id=$2 AND b.template_source_sha256=$3 AND b.module_id=$4 AND b.module_version=$5 AND b.approved_at<=$6
 AND NOT EXISTS(SELECT 1 FROM ls_fishing_stage.academy_travel_source_revocations r WHERE r.workspace_id=b.workspace_id AND r.binding_id=b.id AND r.revoked_at<=$6) ORDER BY b.id LIMIT 3 FOR SHARE OF b,a`,[input.workspaceId,input.templateApprovalId,input.templateSourceSha256,input.moduleId,input.moduleVersion,now]);
 if(!rows.length)return null;if(rows.length!==1)throw new AppError('CONFLICT');const row=rows[0]!;
 let binding:TravelActivityBinding;try{binding=travelActivityBindingSchema.parse(JSON.parse(unseal(row.ciphertext,travelActivityAad(input.workspaceId,row.id),ring)));}catch{return invalid();}
 if(travelDigest(binding)!==row.sha256||binding.id!==row.id||binding.approval.approvedBy!==row.approvedBy||binding.approval.approvedAt!==row.approvedAt.toISOString()||Object.entries(input).some(([key,value])=>binding[key as keyof typeof input]!==value))invalid();
 const catalogRow=await one<{sourceId:string;revision:string;sha256:string;artifactId:string;ciphertext:string}>(tx,`SELECT c.source_id AS "sourceId",c.source_revision AS revision,c.source_sha256 AS sha256,c.learner_artifact_id AS "artifactId",c.payload_ciphertext AS ciphertext
 FROM ls_education.catalog_versions c JOIN ls_identity.accounts a ON a.workspace_id=c.workspace_id AND a.id=c.approved_by AND a.role='practitioner' AND a.state='active'
 WHERE c.workspace_id=$1 AND c.module_id=$2 AND c.version=$3 AND c.approval_state='approved' AND c.approval_provenance IS NOT NULL AND c.approved_at<=$4 FOR SHARE OF c,a`,[input.workspaceId,input.moduleId,input.moduleVersion,now]);
 if(!catalogRow||catalogRow.sourceId!==binding.catalog.sourceId||catalogRow.revision!==binding.catalog.revision||catalogRow.sha256!==binding.catalog.sha256||catalogRow.artifactId!==binding.learnerArtifactId)invalid();
 try{
  const catalog=educationStorageBindingSchema.parse(JSON.parse(unseal(catalogRow.ciphertext,educationCatalogAad(input.workspaceId,input.moduleId,input.moduleVersion),ring)));
  if(catalog.workspaceId!==input.workspaceId||catalog.moduleId!==input.moduleId||catalog.version!==input.moduleVersion||catalog.state!=='approved'||travelDigest(catalog.source)!==travelDigest(binding.catalog)||catalog.learner.sha256!==binding.learnerArtifactSha256)invalid();
  const artifact=await one<{reference:unknown;ciphertext:string;sourceId:string;version:string;locale:string;storageClass:string;sha256:string}>(tx,`SELECT reference,payload_ciphertext AS ciphertext,source_id AS "sourceId",version,locale,storage_class AS "storageClass",sha256 FROM ls_education.artifact_versions WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[input.workspaceId,binding.learnerArtifactId]);
  if(!artifact||travelDigest(educationStorageBindingSchema.shape.learner.parse(artifact.reference))!==travelDigest(catalog.learner)||artifact.sourceId!==catalog.learner.sourceId||artifact.version!==catalog.learner.version||artifact.locale!==catalog.learner.locale||artifact.storageClass!=='resource_learner'||artifact.sha256!==catalog.learner.sha256)invalid();
  const bytes=unseal(artifact.ciphertext,educationArtifactAad(input.workspaceId,catalog.learner),ring);if(createHash('sha256').update(bytes).digest('hex')!==binding.learnerArtifactSha256)invalid();
  const lesson=learnerLessonSchema.parse(JSON.parse(bytes));if(lesson.moduleId!==input.moduleId||lesson.version!==input.moduleVersion||lesson.locale!==catalog.learner.locale||lesson.status!=='approved'||lesson.sourceSha256!==catalog.source.sha256)invalid();
 }catch{return invalid();}
 return binding;
}
/** Matching names, module text, native suitability and attendance never create
 * equivalence. An exact same approved curriculum activity or a separately
 * imported directional approval is required. */
export async function readTravelEquivalence(tx:SqlSession,ring:Keyring,original:TravelActivityBinding,replacement:TravelActivityBinding,now:Date):Promise<boolean>{
 if(original.workspaceId!==replacement.workspaceId)return false;
 if(original.activityId===replacement.activityId&&travelDigest(original.curriculum)===travelDigest(replacement.curriculum))return true;
 const rows=await tx.query<{id:string;sha256:string;ciphertext:string;approvedBy:string;approvedAt:Date}>(`SELECT e.id,e.sha256,e.payload_ciphertext AS ciphertext,e.approved_by AS "approvedBy",e.approved_at AS "approvedAt" FROM ls_fishing_stage.academy_travel_activity_equivalences e
 JOIN ls_identity.accounts a ON a.workspace_id=e.workspace_id AND a.id=e.approved_by AND a.role='practitioner' AND a.state='active'
 WHERE e.workspace_id=$1 AND e.original_binding_id=$2 AND e.replacement_binding_id=$3 AND e.approved_at<=$4
 AND NOT EXISTS(SELECT 1 FROM ls_fishing_stage.academy_travel_source_revocations r WHERE r.workspace_id=e.workspace_id AND r.equivalence_id=e.id AND r.revoked_at<=$4) ORDER BY e.id LIMIT 3 FOR SHARE OF e,a`,[original.workspaceId,original.id,replacement.id,now]);
 if(!rows.length)return false;if(rows.length!==1)throw new AppError('CONFLICT');const row=rows[0]!;
 try{const value=equivalenceSchema.parse(JSON.parse(unseal(row.ciphertext,travelEquivalenceAad(original.workspaceId,row.id),ring)));
  if(value.workspaceId!==original.workspaceId||value.id!==row.id||value.originalBindingId!==original.id||value.replacementBindingId!==replacement.id||travelDigest(value)!==row.sha256||value.approval.approvedBy!==row.approvedBy||value.approval.approvedAt!==row.approvedAt.toISOString())invalid();return true;
 }catch{return invalid();}
}
