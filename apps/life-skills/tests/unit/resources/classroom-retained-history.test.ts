import {randomUUID} from "node:crypto";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {classroomRetainedHistoryQuerySchema,retainedClassroomProjection} from "../../../src/features/resources/classroom-retained-history-contract.ts";
import {validateLessonEventChain,type LessonJourneyEvent,type LearnerLesson} from "../../../src/features/resources/fishing-lesson-journey.ts";
const workspaceId=randomUUID(),reference={learnerId:randomUUID(),moduleId:"RM-101",version:"synthetic-v1"},query={stageId:randomUUID(),householdId:randomUUID(),withdrawalOperationId:randomUUID(),reference},lesson:LearnerLesson={moduleId:reference.moduleId,version:reference.version,stage:1,locale:"en",title:"Synthetic lesson",instruction:"Synthetic instruction",questions:[{id:"Q01-1",prompt:"Synthetic question"}],sourceSha256:"a".repeat(64),status:"approved"};
function event(command:LessonJourneyEvent["command"],previous:string|null=null):LessonJourneyEvent{return {id:randomUUID(),operationId:command.operationId,digest:"b".repeat(64),previousRevisionId:previous,workspaceId,...reference,sourceSha256:lesson.sourceSha256,actorId:randomUUID(),actorRole:command.action==="observe"?"practitioner":"parent",at:new Date().toISOString(),command};}
test("retained projection excludes actor-private drafts, recipients, publication and command capabilities",()=>{
 const draft=event({action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"PRIVATE_DRAFT"}]}),final=event({action:"submit",operationId:randomUUID(),expectedRevisionId:draft.id,answers:[{questionId:"Q01-1",value:"Submitted only"}]},draft.id),observe=event({action:"observe",operationId:randomUUID(),expectedRevisionId:final.id,submissionId:final.id,task:"Hookless task",assistance:"independent",knowledgeAssessment:{state:"not_assessed"}},final.id);
 const value=retainedClassroomProjection(query,lesson,[draft,final,observe],workspaceId);expect(value.submission?.answers[0]?.value).toBe("Submitted only");expect(value.observations[0]?.knowledgeAssessment).toEqual({state:"not_assessed"});expect(JSON.stringify(value)).not.toMatch(/PRIVATE_DRAFT|parentAccountIds|summaryRecipients|expectedRevisionId|command/);
});
test("role-independent chain validator grants no role and rejects broken/duplicate/source/transplanted events",()=>{
 const e=event({action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[]}),binding={workspaceId,sourceSha256:lesson.sourceSha256};expect(validateLessonEventChain([e],binding,reference)).toBe(e.id);
 for(const events of [[{...e,previousRevisionId:randomUUID()}],[e,e],[{...e,sourceSha256:"c".repeat(64)}],[{...e,workspaceId:randomUUID()}],[{...e,learnerId:randomUUID()}]])expect(()=>validateLessonEventChain(events,binding,reference)).toThrow("LEDGER_MISMATCH");
});
test("retained input has exact operator-selected reference only, with no caller role or access grants",()=>{
 expect(classroomRetainedHistoryQuerySchema.safeParse(query).success).toBe(true);for(const key of ["role","permissions","allowWithdrawn","includeDrafts"])expect(classroomRetainedHistoryQuerySchema.safeParse({...query,[key]:true}).success).toBe(false);
});
