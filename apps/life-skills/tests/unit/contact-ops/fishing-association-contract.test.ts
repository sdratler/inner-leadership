import {describe,expect,it} from "vitest";
import {fishingAssociationCommandSchema,fishingAssociationCreateSchema,fishingAssociationStatusSchema,inquiryContactPermissionSchema} from "../../../src/features/contact-ops/core/fishing-association-contract.ts";

const id="00000000-0000-4000-8000-000000000001",at="2026-10-13T18:20:00Z";
const association={action:"record_association",operationId:id,personId:id,expectedEpoch:1,expectedAssociationVersion:0,relationship:"guardian",observedAt:at,sourceRef:"synthetic-owner-selection",permission:{state:"unknown"}};
describe("initial fishing administrative contract",()=>{
 it.each(["guardian","adult_partner"])("accepts %s classification without creating permission",relationship=>{
  expect(fishingAssociationCreateSchema.parse({...association,relationship}).permission).toEqual({state:"unknown"});
 });
 it.each(["workspaceId","programId","role","recordMode","familyId","childId","caseId","phone","stage","paymentVerified","enrolled","inviteToGroup"])("rejects body-derived %s",key=>{
  expect(fishingAssociationCommandSchema.safeParse({...association,[key]:key}).success).toBe(false);
 });
 it("preserves an explicitly withdrawn permission as evidence, not eligibility",()=>{
  expect(inquiryContactPermissionSchema.parse({state:"withdrawn",observedAt:at,sourceRef:"synthetic-withdrawal"}).state).toBe("withdrawn");
 });
 it.each(["LS-FISH-FL-LANDING-20261012-01-INQUIRY-v1","LS-FISH-FL-FORMS-20261013-01-SCHOOL-INQUIRY-v1","invented"])("does not grant contact permission from a notice label %s",noticeVersion=>{
  expect(inquiryContactPermissionSchema.safeParse({state:"inquiry_contact",noticeVersion,observedAt:at,sourceRef:"synthetic"}).success).toBe(false);
 });
 it("rejects stale create version, illegal relationship and missing withdrawal evidence",()=>{
  expect(fishingAssociationCommandSchema.safeParse({...association,expectedAssociationVersion:1}).success).toBe(false);
  expect(fishingAssociationCommandSchema.safeParse({...association,relationship:"student"}).success).toBe(false);
  expect(inquiryContactPermissionSchema.safeParse({state:"withdrawn"}).success).toBe(false);
 });
 it("records a proposed follow-up without a due date or provider effect",()=>{
  const command={action:"record_manual_status",operationId:id,associationId:id,expectedEpoch:1,expectedAssociationVersion:1,event:{kind:"follow_up_planned",observedAt:at,sourceRef:"synthetic",nextAction:"Review privately",dueDate:null}};
  expect(fishingAssociationStatusSchema.parse(command).event).toEqual(command.event);
  expect(fishingAssociationCommandSchema.safeParse({...command,event:{kind:"enrolled",observedAt:at,sourceRef:"synthetic"}}).success).toBe(false);
 });
});
