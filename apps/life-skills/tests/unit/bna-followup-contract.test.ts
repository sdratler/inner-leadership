import {describe,expect,it} from "vitest";
import {bnaFollowupCommandSchema} from "../../src/features/bna-inquiry/contract.ts";

describe("BNA inquiry owner action",()=>{
 const base={operationId:"8bf37625-6ec3-4ca1-b1b1-ed15f155134d",
  inquiryId:"8ce5c356-433d-42ad-b4c8-0b25c1ab69d1",expectedVersion:1,
  status:"contacted",note:"Follow up after parent reply",nextAction:"Call parent",
  dueDate:"2026-11-05",waitingCondition:null} as const;
 it("requires a due date with an action",()=>{
  expect(bnaFollowupCommandSchema.safeParse(base).success).toBe(true);
  expect(bnaFollowupCommandSchema.safeParse({...base,dueDate:null}).success).toBe(false);
  expect(bnaFollowupCommandSchema.safeParse({...base,nextAction:null}).success).toBe(false);
 });
 it("accepts a waiting condition without an action or date",()=>{
  expect(bnaFollowupCommandSchema.safeParse({...base,nextAction:null,dueDate:null,waitingCondition:"Parent will confirm a time"}).success).toBe(true);
 });
});
