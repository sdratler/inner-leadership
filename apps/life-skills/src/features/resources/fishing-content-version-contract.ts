import {z} from "zod";
const ref=z.string().trim().min(1).max(500);
const uuid=z.string().uuid();
const instant=z.string().datetime({offset:true});
export const educationArtifactVersionSchema=z.object({
 sourceId:ref,version:ref,sha256:z.string().regex(/^[a-f0-9]{64}$/),
 locale:z.enum(["en","he"]),status:z.enum(["prepared","reviewed","approved","withdrawn"]),
 audience:z.enum(["learner_content","teacher_only","parent_safe_summary"]),
}).strict();
export const educationLessonVersionSchema=z.object({
 lessonKey:ref,version:ref,program:z.literal("sunday_fishing_academy"),
 rank:z.enum(["A","B","C","advanced_after_B"]),learner:educationArtifactVersionSchema,
 teacherGuide:educationArtifactVersionSchema,parentSummary:educationArtifactVersionSchema.nullable(),
 sourceRefs:z.array(ref).min(1).max(30),
}).strict().superRefine((value,ctx)=>{
 for(const [key,expected] of [["learner","learner_content"],["teacherGuide","teacher_only"]] as const)
  if(value[key].audience!==expected)ctx.addIssue({code:"custom",path:[key,"audience"],message:"WRONG_AUDIENCE"});
 if(value.parentSummary&&value.parentSummary.audience!=="parent_safe_summary")
  ctx.addIssue({code:"custom",path:["parentSummary","audience"],message:"WRONG_AUDIENCE"});
 const sources=[value.learner.sourceId,value.teacherGuide.sourceId,...(value.parentSummary?[value.parentSummary.sourceId]:[])];
 if(new Set(sources).size!==sources.length)ctx.addIssue({code:"custom",message:"ARTIFACT_SOURCE_REUSE"});
 if(value.learner.sha256===value.teacherGuide.sha256||value.parentSummary?.sha256===value.teacherGuide.sha256)
  ctx.addIssue({code:"custom",message:"PROTECTED_TEACHER_CONTENT_REUSE"});
});
// Parent/learner delivery remains closed in the initial owner-private scope.
export function proposedParentLessonProjection(){return null;}
export const factualLearningObservationSchema=z.object({
 operationId:uuid,lessonKey:ref,lessonVersion:ref,taskKey:ref,observedAt:instant,
 assistance:z.enum(["not_yet","with_guidance","independent","safe_and_proficient"]),
 sourceRef:ref,
}).strict();
// Observer, authorized subject and audience derive from the future admitted service grant.
// No readiness/credit/payment/knife/fire/helper-rate or diagnostic field is accepted here.
