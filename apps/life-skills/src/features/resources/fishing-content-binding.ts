// PREPARED server-only boundary; dependencies are trusted backend reads, not JSON/body labels.
import "server-only";
import {educationArtifactVersionSchema,educationLessonVersionSchema} from "./fishing-content-version-contract.ts";
type CatalogActor={id:string;workspaceId:string;role:string;state:string;sessionRevoked:boolean};
type StoredBinding={workspaceId:string;sourceId:string;version:string;locale:"en"|"he";sha256:string;status:"prepared"|"reviewed"|"approved"|"withdrawn";storageClass:"resource_learner"|"protected_teacher"|"resource_parent_summary"};
type StoredLesson={workspaceId:string;manifest:unknown};
type CatalogServer={canonicalWorkspaceId:string;workspaceOwnerAccountId:string;readFreshActor():Promise<CatalogActor|null>;resolveStoredLesson(reference:{workspaceId:string;lessonKey:string;version:string}):Promise<StoredLesson|null>;resolveStoredArtifact(reference:{workspaceId:string;sourceId:string;version:string;locale:"en"|"he"}):Promise<StoredBinding|null>};

export async function proposedOwnerCatalogProjection(lesson:unknown,server:CatalogServer){
 const actor=await server.readFreshActor();
 if(!actor||actor.id!==server.workspaceOwnerAccountId||actor.workspaceId!==server.canonicalWorkspaceId||
    actor.role!=="practitioner"||actor.state!=="active"||actor.sessionRevoked)
  throw Error("FISHING_CATALOG_FORBIDDEN");
 const value=educationLessonVersionSchema.parse(lesson);
 const stored=await server.resolveStoredLesson({workspaceId:actor.workspaceId,lessonKey:value.lessonKey,version:value.version});
 if(!stored||stored.workspaceId!==actor.workspaceId)throw Error("FISHING_CATALOG_MANIFEST_BINDING_DENIED");
 const canonical=educationLessonVersionSchema.parse(stored.manifest);
 if(JSON.stringify(value)!==JSON.stringify(canonical))throw Error("FISHING_CATALOG_MANIFEST_BINDING_DENIED");
 const classified:Record<string,ReturnType<typeof educationArtifactVersionSchema.parse>|null>={};
 for(const [key,storageClass] of [["learner","resource_learner"],["teacherGuide","protected_teacher"],["parentSummary","resource_parent_summary"]] as const){
  const reference=value[key];if(!reference){classified[key]=null;continue;}
  const binding=await server.resolveStoredArtifact({workspaceId:actor.workspaceId,sourceId:reference.sourceId,version:reference.version,locale:reference.locale});
  if(!binding||binding.workspaceId!==actor.workspaceId||binding.storageClass!==storageClass||
     binding.sourceId!==reference.sourceId||binding.version!==reference.version||
     binding.locale!==reference.locale||binding.sha256!==reference.sha256||
     binding.status!==reference.status||binding.status==="withdrawn")
   throw Error("FISHING_CATALOG_STORAGE_BINDING_DENIED");
  classified[key]=educationArtifactVersionSchema.parse({
   sourceId:binding.sourceId,version:binding.version,sha256:binding.sha256,locale:binding.locale,status:binding.status,
   audience:storageClass==="resource_learner"?"learner_content":storageClass==="protected_teacher"?"teacher_only":"parent_safe_summary",
  });
 }
 // Only the freshly authenticated canonical workspace owner can obtain this PRIVATE DTO.
 // No parent/learner projection or educational grant is enabled by this candidate.
 return {lessonKey:value.lessonKey,version:value.version,rank:value.rank,program:value.program,
  learner:classified.learner,teacherGuide:classified.teacherGuide,parentSummary:classified.parentSummary};
}
