import "server-only";
import {z} from "zod";
import {learnerLessonSchema,lessonReferenceSchema,lessonKnowledgeAssessmentSchema,validateLessonEventChain,type LearnerLesson,type LessonJourneyEvent} from "./fishing-lesson-journey.ts";
export const classroomRetainedHistoryQuerySchema=z.strictObject({stageId:z.uuid(),householdId:z.uuid(),withdrawalOperationId:z.uuid(),reference:lessonReferenceSchema});
const resultSchema=z.strictObject({state:z.literal("retained_read_only"),withdrawalOperationId:z.uuid(),reference:lessonReferenceSchema,lesson:learnerLessonSchema,revisionId:z.uuid().nullable(),retainedEventCount:z.number().int().min(0).max(500),submission:z.strictObject({revisionId:z.uuid(),submittedAt:z.iso.datetime(),answers:z.array(z.strictObject({questionId:z.string(),value:z.string().max(2000)})).min(1).max(3)}).nullable(),observations:z.array(z.strictObject({revisionId:z.uuid(),submissionId:z.uuid(),recordedAt:z.iso.datetime(),task:z.string().max(2000),assistance:z.enum(["not_observed","with_guidance","independent"]),privateNote:z.string().max(2000).optional(),knowledgeAssessment:lessonKnowledgeAssessmentSchema.optional()})).max(500)});
export type ClassroomRetainedHistory=z.infer<typeof resultSchema>;
/** Projection/integrity only; caller must supply native authorization first. */
export function retainedClassroomProjection(raw:unknown,lesson:LearnerLesson,events:readonly LessonJourneyEvent[],workspaceId:string):ClassroomRetainedHistory{
 const query=classroomRetainedHistoryQuerySchema.parse(raw),revisionId=validateLessonEventChain(events,{workspaceId,sourceSha256:lesson.sourceSha256},query.reference);
 if(events.length>500||lesson.status!=="approved"||lesson.moduleId!==query.reference.moduleId||lesson.version!==query.reference.version)throw Error("RETAINED_HISTORY_BINDING_MISMATCH");
 const submission=[...events].reverse().find(e=>e.command.action==="submit");
 return resultSchema.parse({state:"retained_read_only",withdrawalOperationId:query.withdrawalOperationId,reference:query.reference,lesson,revisionId,retainedEventCount:events.length,submission:submission?.command.action==="submit"?{revisionId:submission.id,submittedAt:submission.at,answers:submission.command.answers}:null,observations:events.filter(e=>e.command.action==="observe").map(e=>{
  if(e.command.action!=="observe")throw Error("RETAINED_HISTORY_BINDING_MISMATCH");const c=e.command;return {revisionId:e.id,submissionId:c.submissionId,recordedAt:e.at,task:c.task,assistance:c.assistance,...c.privateNote===undefined?{}:{privateNote:c.privateNote},...c.knowledgeAssessment===undefined?{}:{knowledgeAssessment:c.knowledgeAssessment}};
 })});
}
