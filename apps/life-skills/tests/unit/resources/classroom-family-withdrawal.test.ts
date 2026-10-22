import {randomUUID} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test} from "vitest";
import {classroomFamilyWithdrawalCommandSchema,classroomFamilyWithdrawalQuerySchema} from "../../../src/features/resources/classroom-family-withdrawal-contract.ts";
import {classroomWithdrawalVersion} from "../../../src/features/resources/classroom-withdrawal-contract.ts";
import {ClassroomFamilyWithdrawalControls} from "../../../src/features/resources/classroom-family-withdrawal-controls.tsx";
test("family HTTP scope is saved application/stage binding, never caller household or grant authority",()=>{
 const binding={applicationId:randomUUID(),personId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:1,expectedFieldsDigest:"a".repeat(64),expectedFamilyDigest:"b".repeat(64)},body={version:classroomWithdrawalVersion,operationId:randomUUID(),binding,stageId:randomUUID(),expectedScopeSha256:"c".repeat(64)};
 expect(classroomFamilyWithdrawalCommandSchema.safeParse(body).success).toBe(true);
 for(const key of ["householdId","learnerId","role","workspaceId","merchant","grants"])expect(classroomFamilyWithdrawalCommandSchema.safeParse({...body,[key]:randomUUID()}).success).toBe(false);
 expect(classroomFamilyWithdrawalQuerySchema.safeParse({applicationId:binding.applicationId,stageId:body.stageId}).success).toBe(true);expect(classroomFamilyWithdrawalQuerySchema.safeParse({householdId:randomUUID(),stageId:body.stageId}).success).toBe(false);
});
test.each(["en","he"] as const)("%s initial control requires an affected-family review before a confirmation or mutation is rendered",locale=>{
 const html=renderToStaticMarkup(createElement(ClassroomFamilyWithdrawalControls,{applicationId:randomUUID(),stageId:randomUUID(),locale}));
 expect(html).toContain("data-classroom-family-withdrawal");expect(html).not.toContain('type="submit"');expect(html).not.toContain('name="confirmFamily"');expect(html).not.toMatch(/householdId|csrf|merchant|ciphertext/);
 expect(html).toContain(locale==="en"?"every affected child":"כל הילדים המושפעים");expect(html).toContain(locale==="en"?"Payments, refunds":"תשלומים, החזרים");
});
