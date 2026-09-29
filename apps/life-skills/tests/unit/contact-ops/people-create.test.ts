import {expect,test} from "vitest";
import {randomUUID} from "node:crypto";
import {peopleCreate,prospectCreateSchema,nativeManualInquirySchema} from "../../../src/features/contact-ops/core/people-create.ts";
const input=()=>({action:"add" as const,name:"Synthetic contact",phone:"053-555-0187",language:"he" as const,source:"Owner entered",
 notes:"  Synthetic note\nעברית / English\n  ",nextAction:"Follow up",dueDate:"2026-09-28",expectedEpoch:3,operationId:randomUUID()});
test("native request retains exact notes, aliases-independent phone and original retry operation",()=>{
 const request=input(),parsed=peopleCreate(request);expect(parsed).toEqual(request);expect(peopleCreate(parsed)).toEqual(parsed);
 expect(prospectCreateSchema.parse({...request,name:"  Synthetic contact  "}).name).toBe("Synthetic contact");
});
test("native create rejects caller-selected identity, role, mode, provider actions and fake Sheet provenance",()=>{
 for(const field of ["personId","role","recordMode","demoBatchId","send","sourceFileId","sourceSheetId","sourceRevision","paymentVerified"])
  expect(()=>peopleCreate({...input(),[field]:"untrusted"})).toThrow();
});
test("native context, phone, date and bounded fields are required; legacy context remains optional",()=>{
 const {expectedEpoch:_epoch,operationId:_operation,...legacy}=input();expect(prospectCreateSchema.safeParse(legacy).success).toBe(true);
 expect(_epoch).toBe(3);expect(_operation).toMatch(/^[0-9a-f-]{36}$/);
 expect(()=>peopleCreate(legacy as ReturnType<typeof input>)).toThrow();
 for(const patch of [{phone:"not a phone"},{dueDate:"2026-02-30"},{expectedEpoch:-1},{expectedEpoch:Number.MAX_SAFE_INTEGER},{operationId:"reused"},{notes:"x".repeat(5001)}])
  expect(()=>peopleCreate({...input(),...patch})).toThrow();
});
test("native origin is explicit with canonical normalized phone and no workbook metadata",()=>{
 const native={origin:"native_manual",leadId:"LS-LEAD-native-"+randomUUID(),phone:"+972535550187",language:"he",source:"Owner entered",createdAt:"2026-09-28T12:00:00.000Z"};
 expect(nativeManualInquirySchema.safeParse(native).success).toBe(true);
 for(const patch of [{origin:"sheet"},{phone:"0535550187"},{createdAt:"yesterday"},{sourceFileId:"invented-workbook"}])
  expect(nativeManualInquirySchema.safeParse({...native,...patch}).success).toBe(false);
});
