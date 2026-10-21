import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import type {Actor} from "../identity/types.ts";

const uuid=z.uuid(),text=z.string().trim().min(1).max(2000);
const moduleId=z.string().regex(/^RM-[1-4](?:0[1-9]|1[0-2])$/);
const version=z.string().trim().min(1).max(100);
export const lessonReferenceSchema=z.strictObject({learnerId:uuid,moduleId,version});
export type LessonReference=z.infer<typeof lessonReferenceSchema>;
// Only this closed learner shape may enter a browser payload. No teacher artifact.
export const learnerLessonSchema=z.strictObject({
 moduleId,version,stage:z.number().int().min(1).max(4),locale:z.enum(["en","he"]),
 title:text,instruction:text,questions:z.array(z.strictObject({id:z.string().regex(/^Q\d{2}-[1-3]$/),prompt:text})).min(1).max(3),
 sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(["prepared","approved","withdrawn"]),
}).superRefine((value,ctx)=>{
 if(Number(value.moduleId[3])!==value.stage)ctx.addIssue({code:"custom",message:"STAGE_MISMATCH"});
 const session=(value.stage-1)*12+Number(value.moduleId.slice(4));
 if(new Set(value.questions.map(q=>q.id)).size!==value.questions.length||
    value.questions.some(q=>Number(q.id.slice(1,3))!==session))
  ctx.addIssue({code:"custom",message:"QUESTION_BINDING_MISMATCH"});
});
export type LearnerLesson=z.infer<typeof learnerLessonSchema>;
const base={operationId:uuid,expectedRevisionId:uuid.nullable()};
export const lessonKnowledgeAssessmentSchema=z.discriminatedUnion("state",[
 z.strictObject({state:z.literal("not_assessed")}),
 z.strictObject({state:z.literal("recorded"),assessment:text}),
]);
export const lessonJourneyCommandSchema=z.discriminatedUnion("action",[
 z.strictObject({...base,action:z.literal("save_draft"),answers:z.array(z.strictObject({questionId:z.string().regex(/^Q\d{2}-[1-3]$/),value:z.string().max(2000)})).max(3)}),
 z.strictObject({...base,action:z.literal("submit"),answers:z.array(z.strictObject({questionId:z.string().regex(/^Q\d{2}-[1-3]$/),value:text})).min(1).max(3)}),
 z.strictObject({...base,action:z.literal("observe"),submissionId:uuid,task:text,
  assistance:z.enum(["not_observed","with_guidance","independent"]),privateNote:text.optional(),knowledgeAssessment:lessonKnowledgeAssessmentSchema.optional()}),
 z.strictObject({...base,action:z.literal("publish_parent_summary"),observationId:uuid,
  summary:text,parentAccountIds:z.array(uuid).min(1).max(10)}),
]);
type Command=z.infer<typeof lessonJourneyCommandSchema>;
type Action=Command["action"];
type Permission=Action|"read_learner"|"read_teacher"|"read_parent";
export type LessonJourneyContext={
 actor:Actor;sessionRevoked:boolean;lesson:LearnerLesson;
 assignment:{workspaceId:string;learnerId:string;moduleId:string;version:string;active:boolean};
 // Loaded from verified current relationships, never from command/body labels.
 grant:{workspaceId:string;accountId:string;learnerId:string;moduleId:string;version:string;active:boolean;permissions:readonly Permission[]};
 authorizedParentAccountIds:readonly string[];
 // Independent publication eligibility, not assisted-submission authority.
 eligibleSummaryRecipients:readonly {accountId:string;label:string}[];
};
export type LessonJourneyEvent={
 id:string;operationId:string;digest:string;previousRevisionId:string|null;
 workspaceId:string;learnerId:string;moduleId:string;version:string;sourceSha256:string;
 actorId:string;actorRole:Actor["role"];at:string;command:Command;
};
export type LessonLearnerRead={
 lesson:Pick<LearnerLesson,"moduleId"|"version"|"stage"|"locale"|"title"|"instruction"|"questions"|"sourceSha256">;
 revisionId:string|null;
 submission:{revisionId:string;answers:Extract<Command,{action:"submit"}>["answers"];submittedAt:string;submittedBy:string;assistedBy:string|null}|null;
 // Actor-private partial work. Optional only for retained pre-extension DTOs.
 draft?:{revisionId:string;answers:Extract<Command,{action:"save_draft"}>["answers"];savedAt:string}|null|undefined;
};
export type LessonTeacherRead=Omit<LessonLearnerRead,"draft">&{
 observations:LessonJourneyEvent[];summaryRecipients:{accountId:string;label:string}[];
};
export type LessonParentRead={moduleId:string;version:string;
 portfolio:{revisionId:string;summary:string;publishedAt:string;sourceSha256:string}|null;};
/** Adapter admission is still required. Atomic transaction/CAS and encrypted native
 * storage are mandatory; this port is not a permissive production fallback. */
export interface LessonJourneyTransaction {
 resolveFreshContext(reference:LessonReference):Promise<LessonJourneyContext|null>;
 readEvents(reference:LessonReference,workspaceId:string):Promise<readonly LessonJourneyEvent[]>;
 append(event:LessonJourneyEvent,expectedRevisionId:string|null):Promise<void>;
}
export interface LessonJourneyStore {
 transaction<T>(work:(tx:LessonJourneyTransaction)=>Promise<T>):Promise<T>;
}
function deny():never{throw Error("LESSON_JOURNEY_FORBIDDEN");}
function requireContext(context:LessonJourneyContext|null,ref:LessonReference,now:Date,permission:Permission){
 if(!context)deny();
 const {actor,assignment,grant}=context,lesson=learnerLessonSchema.parse(context.lesson);
 if(actor.state!=="active"||context.sessionRevoked||actor.expiresAt<=now.getTime()||
    !assignment.active||!grant.active||lesson.status!=="approved"||
    assignment.workspaceId!==actor.workspaceId||grant.workspaceId!==actor.workspaceId||
    grant.accountId!==actor.id||assignment.learnerId!==ref.learnerId||grant.learnerId!==ref.learnerId||
    assignment.moduleId!==ref.moduleId||grant.moduleId!==ref.moduleId||lesson.moduleId!==ref.moduleId||
    assignment.version!==ref.version||grant.version!==ref.version||lesson.version!==ref.version||
    !grant.permissions.includes(permission))deny();
 if((permission==="observe"||permission==="publish_parent_summary"||permission==="read_teacher")&&actor.role!=="practitioner")deny();
 if((permission==="submit"||permission==="read_learner")&&
    !(actor.role==="parent"||actor.role==="child"&&actor.personId===ref.learnerId))deny();
 if(permission==="read_parent"&&!(actor.role==="parent"&&context.authorizedParentAccountIds.includes(actor.id)))deny();
 if((permission==="submit"||permission==="read_learner")&&actor.role==="parent"&&!context.authorizedParentAccountIds.includes(actor.id))deny();
 return {...context,lesson};
}
function validateEvents(events:readonly LessonJourneyEvent[],context:LessonJourneyContext,ref:LessonReference){
 let prior:string|null=null;
 const ids=new Set<string>();
 for(const event of events){
  if(event.previousRevisionId!==prior||ids.has(event.id)||event.workspaceId!==context.actor.workspaceId||
     event.learnerId!==ref.learnerId||event.moduleId!==ref.moduleId||event.version!==ref.version||
     event.sourceSha256!==context.lesson.sourceSha256)throw Error("LESSON_JOURNEY_LEDGER_MISMATCH");
  ids.add(event.id);prior=event.id;
 }
 return prior;
}
function learnerProjection(lesson:LearnerLesson){
 return {moduleId:lesson.moduleId,version:lesson.version,stage:lesson.stage,locale:lesson.locale,
  title:lesson.title,instruction:lesson.instruction,questions:lesson.questions,sourceSha256:lesson.sourceSha256};
}
function latest(events:readonly LessonJourneyEvent[],predicate:(event:LessonJourneyEvent)=>boolean){
 return [...events].reverse().find(predicate);
}
export class FishingLessonJourney {
 constructor(private readonly store:LessonJourneyStore,private readonly now:()=>Date){}
 async save(reference:unknown,input:unknown){
  const ref=lessonReferenceSchema.parse(reference),command=lessonJourneyCommandSchema.parse(input);
  return this.store.transaction(async tx=>{
   const now=this.now(),context=requireContext(await tx.resolveFreshContext(ref),ref,now,command.action==="save_draft"?"submit":command.action);
   const events=await tx.readEvents(ref,context.actor.workspaceId),current=validateEvents(events,context,ref);
   const digest=createHash("sha256").update(JSON.stringify({ref,command,actorId:context.actor.id,workspaceId:context.actor.workspaceId,sourceSha256:context.lesson.sourceSha256})).digest("hex");
   const replay=events.find(e=>e.actorId===context.actor.id&&e.operationId===command.operationId);
   if(replay){if(replay.digest!==digest)throw Error("LESSON_JOURNEY_CONFLICT");return {revisionId:replay.id,duplicate:true};}
   if(current!==command.expectedRevisionId)throw Error("LESSON_JOURNEY_CONFLICT");
   if(command.action==="submit"||command.action==="save_draft"){
    const questions=new Set(context.lesson.questions.map(q=>q.id));
    if(command.action==="submit"&&command.answers.length!==questions.size||new Set(command.answers.map(a=>a.questionId)).size!==command.answers.length||command.answers.some(a=>!questions.has(a.questionId)))
     throw Error("LESSON_JOURNEY_QUESTION_MISMATCH");
   }else if(command.action==="observe"){
    const submission=events.find(e=>e.id===command.submissionId&&e.command.action==="submit");
    const currentSubmission=latest(events,e=>e.command.action==="submit");
    if(!submission||currentSubmission?.id!==submission.id)throw Error("LESSON_JOURNEY_SUBMISSION_MISMATCH");
   }else{
    const observed=events.find(e=>e.id===command.observationId&&e.command.action==="observe");
    if(!observed||observed.command.action!=="observe"||
       latest(events,e=>e.command.action==="observe")?.id!==observed.id||
       latest(events,e=>e.command.action==="submit")?.id!==observed.command.submissionId)
     throw Error("LESSON_JOURNEY_OBSERVATION_MISMATCH");
    if(new Set(command.parentAccountIds).size!==command.parentAccountIds.length||
       command.parentAccountIds.some(id=>!context.eligibleSummaryRecipients.some(parent=>parent.accountId===id)))deny();
   }
   const event:LessonJourneyEvent={id:randomUUID(),operationId:command.operationId,digest,previousRevisionId:current,
    workspaceId:context.actor.workspaceId,learnerId:ref.learnerId,moduleId:ref.moduleId,version:ref.version,
    sourceSha256:context.lesson.sourceSha256,actorId:context.actor.id,actorRole:context.actor.role,at:now.toISOString(),command};
   await tx.append(event,current);
   return {revisionId:event.id,duplicate:false};
  });
 }
 read(reference:unknown,view:"learner"):Promise<LessonLearnerRead>;
 read(reference:unknown,view:"teacher"):Promise<LessonTeacherRead>;
 read(reference:unknown,view:"parent"):Promise<LessonParentRead>;
 read(reference:unknown,view:"learner"|"teacher"|"parent"):Promise<LessonLearnerRead|LessonTeacherRead|LessonParentRead>;
 async read(reference:unknown,view:"learner"|"teacher"|"parent"):Promise<LessonLearnerRead|LessonTeacherRead|LessonParentRead>{
  const ref=lessonReferenceSchema.parse(reference);
  return this.store.transaction(async tx=>{
   const context=requireContext(await tx.resolveFreshContext(ref),ref,this.now(),`read_${view}`);
   const events=await tx.readEvents(ref,context.actor.workspaceId),revisionId=validateEvents(events,context,ref);
   if(view==="parent"){
    const share=latest(events,e=>e.command.action==="publish_parent_summary"&&e.command.parentAccountIds.includes(context.actor.id));
    // Closed exact projection: no raw learner answers, private observations or key.
    return {moduleId:ref.moduleId,version:ref.version,portfolio:share&&share.command.action==="publish_parent_summary"?
     {revisionId:share.id,summary:share.command.summary,publishedAt:share.at,sourceSha256:share.sourceSha256}:null};
   }
   const submission=latest(events,e=>e.command.action==="submit");
   const common={lesson:learnerProjection(context.lesson),revisionId,
    submission:submission&&submission.command.action==="submit"?{revisionId:submission.id,answers:submission.command.answers,
     submittedAt:submission.at,submittedBy:submission.actorId,assistedBy:submission.actorRole==="parent"?submission.actorId:null}:null};
   if(view==="teacher")return {...common,observations:events.filter(e=>e.command.action==="observe"),
    summaryRecipients:context.eligibleSummaryRecipients.map(parent=>({accountId:parent.accountId,label:parent.label}))};
   // Ledger order, not wall time. Any later final supersedes earlier drafts;
   // exact replay of an old final appends nothing and cannot erase a newer draft.
   const finalIndex=submission?events.findIndex(e=>e.id===submission.id):-1;
   const draft=latest(events.slice(finalIndex+1),e=>e.actorId===context.actor.id&&e.command.action==="save_draft");
   return {...common,draft:draft&&draft.command.action==="save_draft"?
    {revisionId:draft.id,answers:draft.command.answers,savedAt:draft.at}:null,
   };
  });
 }
}
