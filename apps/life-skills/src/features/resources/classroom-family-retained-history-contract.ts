import {z} from "zod";
// Browser-safe closed DTOs only. Native authority and chain verification stay
// in the server reader; no server-only journey/crypto module is imported here.
const reference=z.strictObject({learnerId:z.uuid(),moduleId:z.string().regex(/^RM-[1-4](?:0[1-9]|1[0-2])$/),version:z.string().trim().min(1).max(100)});
const base={applicationId:z.uuid(),stageId:z.uuid(),withdrawalOperationId:z.uuid()};
export const classroomFamilyRetainedHistoryPath="/api/private/group-applications/classroom-history";
export const classroomFamilyRetainedHistoryRequestSchema=z.discriminatedUnion("action",[
 z.strictObject({...base,action:z.literal("review")}),
 z.strictObject({...base,action:z.literal("read"),reference}),
]);
export type ClassroomFamilyRetainedHistoryRequest=z.infer<typeof classroomFamilyRetainedHistoryRequestSchema>;
export const classroomFamilyRetainedHistoryReviewSchema=z.strictObject({...base,state:z.literal("ready"),children:z.array(z.strictObject({learnerId:z.uuid(),displayName:z.string().min(1).max(200),lessons:z.array(reference.omit({learnerId:true})).min(1).max(240)})).min(1).max(240)});
export type ClassroomFamilyRetainedHistoryReview=z.infer<typeof classroomFamilyRetainedHistoryReviewSchema>;
const text=z.string().trim().min(1).max(2000);
export const classroomRetainedHistoryPayloadSchema=z.strictObject({state:z.literal("retained_read_only"),withdrawalOperationId:z.uuid(),reference,
 lesson:z.strictObject({moduleId:reference.shape.moduleId,version:reference.shape.version,stage:z.number().int().min(1).max(4),locale:z.enum(["en","he"]),title:text,instruction:text,questions:z.array(z.strictObject({id:z.string().regex(/^Q\d{2}-[1-3]$/),prompt:text})).min(1).max(3),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(["prepared","approved","withdrawn"])}),
 revisionId:z.uuid().nullable(),retainedEventCount:z.number().int().min(0).max(500),submission:z.strictObject({revisionId:z.uuid(),submittedAt:z.iso.datetime(),answers:z.array(z.strictObject({questionId:z.string(),value:z.string().max(2000)})).min(1).max(3)}).nullable(),
 observations:z.array(z.strictObject({revisionId:z.uuid(),submissionId:z.uuid(),recordedAt:z.iso.datetime(),task:z.string().max(2000),assistance:z.enum(["not_observed","with_guidance","independent"]),privateNote:z.string().max(2000).optional(),knowledgeAssessment:z.discriminatedUnion("state",[z.strictObject({state:z.literal("not_assessed")}),z.strictObject({state:z.literal("recorded"),assessment:text})]).optional()})).max(500),
});
export type ClassroomRetainedHistoryPayload=z.infer<typeof classroomRetainedHistoryPayloadSchema>;
