import {randomUUID} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test} from "vitest";
import {classroomFamilyRetainedHistoryRequestSchema,classroomRetainedHistoryPayloadSchema} from "../../../src/features/resources/classroom-family-retained-history-contract.ts";
import {ClassroomRetainedHistoryControls,ClassroomRetainedHistoryView} from "../../../src/features/resources/classroom-retained-history-controls.tsx";
const reference={learnerId:randomUUID(),moduleId:"RM-101",version:"synthetic-only"};
const history=()=>classroomRetainedHistoryPayloadSchema.parse({state:"retained_read_only",withdrawalOperationId:randomUUID(),reference,lesson:{moduleId:"RM-101",version:reference.version,stage:1,locale:"en",title:"Synthetic lesson",instruction:"Synthetic instructions",questions:[{id:"Q01-1",prompt:"Synthetic question"}],sourceSha256:"a".repeat(64),status:"approved"},revisionId:randomUUID(),retainedEventCount:2,submission:{revisionId:randomUUID(),submittedAt:"2026-10-22T06:00:00.000Z",answers:[{questionId:"Q01-1",value:"<script>synthetic answer</script>"}]},observations:[{revisionId:randomUUID(),submissionId:randomUUID(),recordedAt:"2026-10-22T06:01:00.000Z",task:"Synthetic task",assistance:"independent",privateNote:"Synthetic private note",knowledgeAssessment:{state:"recorded",assessment:"Synthetic assessment"}}]});
test("history query has no caller household/role/grant/export authority and payload has no draft or teacher artifact channel",()=>{
 const base={applicationId:randomUUID(),stageId:randomUUID(),withdrawalOperationId:randomUUID()},query={...base,action:"read",reference};expect(classroomFamilyRetainedHistoryRequestSchema.safeParse(query).success).toBe(true);expect(classroomFamilyRetainedHistoryRequestSchema.safeParse({...base,action:"review"}).success).toBe(true);
 for(const key of ["householdId","role","grants","teacherArtifact","export","binding"])expect(classroomFamilyRetainedHistoryRequestSchema.safeParse({...query,[key]:"untrusted"}).success).toBe(false);
 expect(classroomFamilyRetainedHistoryRequestSchema.safeParse({...query,reference:{...reference,workspaceId:randomUUID()}}).success).toBe(false);
 for(const key of ["draft","teacherArtifact","ciphertext","recipients","publication"])expect(classroomRetainedHistoryPayloadSchema.safeParse({...history(),[key]:"SYNTHETIC_PRIVATE"}).success).toBe(false);
});
test.each(["en","he"]as const)("%s retained-history initial view requires saved reference and server-derived choices",locale=>{
 const html=renderToStaticMarkup(createElement(ClassroomRetainedHistoryControls,{applicationId:randomUUID(),stageId:randomUUID(),locale}));expect(html).toContain("data-classroom-retained-history");expect(html).not.toContain("data-classroom-retained-content");expect(html).not.toContain("<option");expect(html).not.toMatch(/householdId|csrf|ciphertext|type="file"/);expect(html).toContain(locale==="en"?"saved family withdrawal reference":"מזהה השמור של סיום גישת המשפחה");
});
test.each(["en","he"]as const)("%s saved submission and observations display escaped content with no write/publication controls",locale=>{
 const html=renderToStaticMarkup(createElement(ClassroomRetainedHistoryView,{history:history(),locale}));expect(html).toContain("Synthetic question");expect(html).toContain("Synthetic private note");expect(html).toContain("Synthetic assessment");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(html).not.toMatch(/<form|<input|<button|<textarea|<a /);expect(html).toContain(locale==="en"?"Read only":"לקריאה בלבד");
});
