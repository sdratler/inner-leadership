import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {Actor} from "../identity/types.ts";
import {learnerLessonSchema,lessonJourneyCommandSchema,type LessonJourneyEvent} from "./fishing-lesson-journey.ts";

const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),ref=z.string().trim().min(1).max(500);
const moduleId=z.string().regex(/^RM-[1-4](?:0[1-9]|1[0-2])$/),version=z.string().trim().min(1).max(100);
const state=z.enum(["prepared","approved","withdrawn"]);
const artifactSchema=z.strictObject({sourceId:ref,version,locale:z.enum(["en","he"]),sha256:sha,
 storageClass:z.enum(["resource_learner","protected_teacher"]),state});
export const educationStorageBindingSchema=z.strictObject({workspaceId:uuid,moduleId,version,state,
 source:z.strictObject({sourceId:ref,revision:ref,sha256:sha}),learner:artifactSchema,teacher:artifactSchema,
}).superRefine((value,ctx)=>{
 if(value.learner.storageClass!=="resource_learner"||value.teacher.storageClass!=="protected_teacher"||
    value.learner.sourceId===value.teacher.sourceId||value.learner.sha256===value.teacher.sha256||
    value.learner.state!==value.state||value.teacher.state!==value.state)
  ctx.addIssue({code:"custom",message:"PROTECTED_ARTIFACT_BINDING_MISMATCH"});
});
export type EducationStorageBinding=z.infer<typeof educationStorageBindingSchema>;
type Artifact=z.infer<typeof artifactSchema>;
export interface OwnerLessonStorage {
 canonicalWorkspaceId:string;ownerAccountId:string;
 readFreshActor():Promise<{actor:Actor;sessionRevoked:boolean}|null>;
 resolveCatalog(ref:{workspaceId:string;moduleId:string;version:string}):Promise<unknown>;
 resolveArtifact(ref:Artifact&{workspaceId:string}):Promise<{workspaceId:string;reference:unknown;ciphertext:string}|null>;
}
function hash(value:string){return createHash("sha256").update(value).digest("hex");}
export function educationArtifactAad(workspaceId:string,reference:Artifact){
 const item=artifactSchema.parse(reference);
 return `education-artifact:${uuid.parse(workspaceId)}:${hash(JSON.stringify(item))}`;
}
/** Existing owner-private scope only. No learner/parent grant or native importer. */
export async function readOwnerVersionedLesson(input:unknown,server:OwnerLessonStorage,keyring:Keyring,now:Date){
 const reference=z.strictObject({moduleId,version}).parse(input),fresh=await server.readFreshActor();
 if(!fresh||fresh.sessionRevoked||fresh.actor.id!==server.ownerAccountId||fresh.actor.workspaceId!==server.canonicalWorkspaceId||
    fresh.actor.role!=="practitioner"||fresh.actor.state!=="active"||fresh.actor.expiresAt<=now.getTime())
  throw Error("LESSON_STORAGE_FORBIDDEN");
 const stored=await server.resolveCatalog({...reference,workspaceId:server.canonicalWorkspaceId});
 const catalog=educationStorageBindingSchema.parse(stored);
 if(catalog.workspaceId!==server.canonicalWorkspaceId||catalog.moduleId!==reference.moduleId||catalog.version!==reference.version||catalog.state==="withdrawn")
  throw Error("LESSON_STORAGE_BINDING_DENIED");
 let learnerBytes="";
 for(const expected of [catalog.learner,catalog.teacher]){
  const artifact=await server.resolveArtifact({...expected,workspaceId:catalog.workspaceId});
  if(!artifact||artifact.workspaceId!==catalog.workspaceId||
     JSON.stringify(artifactSchema.parse(artifact.reference))!==JSON.stringify(expected))throw Error("LESSON_STORAGE_BINDING_DENIED");
  const bytes=unseal(artifact.ciphertext,educationArtifactAad(catalog.workspaceId,expected),keyring);
  if(hash(bytes)!==expected.sha256)throw Error("LESSON_STORAGE_CONTENT_HASH_MISMATCH");
  if(expected.storageClass==="resource_learner")learnerBytes=bytes;
  // Teacher bytes are verified only on the owner-private server and NEVER returned.
 }
 const learner=learnerLessonSchema.parse(JSON.parse(learnerBytes));
 if(learner.moduleId!==catalog.moduleId||learner.version!==catalog.version||learner.locale!==catalog.learner.locale||
    learner.status!==catalog.state||learner.sourceSha256!==catalog.source.sha256)throw Error("LESSON_STORAGE_BINDING_DENIED");
 return {catalogState:catalog.state,source:catalog.source,lesson:learner};
}

export const lessonEventHeaderSchema=z.strictObject({id:uuid,operationId:uuid,digest:sha,previousRevisionId:uuid.nullable(),
 workspaceId:uuid,learnerId:uuid,moduleId,version,sourceSha256:sha,actorId:uuid,
 actorRole:z.enum(["practitioner","parent","adult_client","child"]),at:z.string().datetime({offset:true})});
const eventSchema=lessonEventHeaderSchema.extend({command:lessonJourneyCommandSchema});
export type LessonEventHeader=z.infer<typeof lessonEventHeaderSchema>;
function headerFor(event:z.infer<typeof eventSchema>):LessonEventHeader{
 return lessonEventHeaderSchema.parse({id:event.id,operationId:event.operationId,digest:event.digest,previousRevisionId:event.previousRevisionId,
  workspaceId:event.workspaceId,learnerId:event.learnerId,moduleId:event.moduleId,version:event.version,sourceSha256:event.sourceSha256,
  actorId:event.actorId,actorRole:event.actorRole,at:event.at});
}
function validEvent(input:unknown){
 const event=eventSchema.parse(input);
 const digest=hash(JSON.stringify({ref:{learnerId:event.learnerId,moduleId:event.moduleId,version:event.version},command:event.command,
  actorId:event.actorId,workspaceId:event.workspaceId,sourceSha256:event.sourceSha256}));
 if(digest!==event.digest||event.operationId!==event.command.operationId||event.previousRevisionId!==event.command.expectedRevisionId)
  throw Error("LESSON_STORAGE_EVENT_MISMATCH");
 return event;
}
function eventAad(header:LessonEventHeader){
 return `education-event:${header.workspaceId}:${header.id}:${hash(JSON.stringify({learnerId:header.learnerId,moduleId:header.moduleId,version:header.version}))}`;
}
/** Reuses the admitted AEAD/keyring primitive; installs no store or live key. */
export function encodeLessonEvent(input:LessonJourneyEvent,keyring:Keyring){
 const event=validEvent(input),header=headerFor(event);
 return {header,ciphertext:seal(JSON.stringify(event),eventAad(header),keyring)};
}
export function decodeLessonEvent(expected:unknown,ciphertext:string,keyring:Keyring):LessonJourneyEvent{
 const header=lessonEventHeaderSchema.parse(expected);
 const event=validEvent(JSON.parse(unseal(ciphertext,eventAad(header),keyring)));
 if(JSON.stringify(headerFor(event))!==JSON.stringify(header))throw Error("LESSON_STORAGE_EVENT_MISMATCH");
 return event;
}
