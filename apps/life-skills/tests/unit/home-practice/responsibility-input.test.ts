import {expect,test} from "vitest";
import {randomUUID} from "node:crypto";
import {assistedCheckInInput,responsibilityInput,sameResponsibilityInput} from "../../../src/features/home-practice/responsibility-input.ts";
const parent=randomUUID(),other=randomUUID(),child=randomUUID();
const input={participant:"client",period:"evening",assigneeAccountIds:[child],assistedByParentAccountIds:[parent,other],reminderRecipients:[{accountId:parent,purpose:"remind_child"}],completionMode:"any_assignee",weekdays:[0,2,4],localTime:"18:35",timezone:"Asia/Jerusalem",timeOrigin:"session_agreement",foldChoice:null} as const;
test("actual child access is optional; parent-assisted practice needs no child login",()=>{
  expect(responsibilityInput.parse(input)).toEqual(input);
  expect(responsibilityInput.parse({...input,assigneeAccountIds:[]})).toMatchObject({assigneeAccountIds:[],assistedByParentAccountIds:[parent,other]});
  expect(responsibilityInput.safeParse({...input,assigneeAccountIds:[],assistedByParentAccountIds:[]}).success).toBe(false);
});
test("parent support is distinct and may require one or both actual parents",()=>{
  expect(responsibilityInput.safeParse({...input,participant:"parent",assigneeAccountIds:[parent],assistedByParentAccountIds:[]}).success).toBe(true);
  expect(responsibilityInput.safeParse({...input,participant:"parent",assigneeAccountIds:[parent,other],assistedByParentAccountIds:[],completionMode:"each_assignee"}).success).toBe(true);
  for(const value of [{...input,participant:"parent"},{...input,completionMode:"each_assignee"},{...input,participant:"parent",assigneeAccountIds:[parent],assistedByParentAccountIds:[],completionMode:"each_assignee"}])expect(responsibilityInput.safeParse(value).success).toBe(false);
});
test.each(["", "24:00", "8:00", "12:60", null])("no implicit or normalized clock for %s",localTime=>expect(responsibilityInput.safeParse({...input,localTime}).success).toBe(false));
test.each([[],[0,0],[7],[1.5],[0,1,2,3,4,5,6,0]].map(weekdays=>[weekdays] as const))("weekdays are bounded and explicit: %j",weekdays=>expect(responsibilityInput.safeParse({...input,weekdays}).success).toBe(false));
test("strict source boundary rejects fabricated actor, subject, defaults and unknown fields",()=>{
  for(const extra of [{accountId:parent},{subjectPersonId:randomUUID()},{role:"student"},{instructions:"private text"},{savedDefault:{localTime:"08:00"}}])expect(responsibilityInput.safeParse({...input,...extra}).success).toBe(false);
  expect(responsibilityInput.safeParse({...input,timeOrigin:"case_default"}).success).toBe(false);
  expect(responsibilityInput.safeParse({...input,timezone:"Unknown/Zone"}).success).toBe(false);
});
test("roles and routing are duplicate-free; reminders never confer reporting authority",()=>{
  for(const extra of [{assigneeAccountIds:[child,child]},{assistedByParentAccountIds:[parent,parent]},{assistedByParentAccountIds:[child]},{reminderRecipients:[{accountId:parent,purpose:"support"},{accountId:parent,purpose:"self"}]}])expect(responsibilityInput.safeParse({...input,...extra}).success).toBe(false);
  const changed=responsibilityInput.parse({...input,reminderRecipients:[{accountId:other,purpose:"support"}]});expect(changed.assigneeAccountIds).toEqual([child]);
});
test("exact readback compares every saved field without depending on array order",()=>{
  const saved=responsibilityInput.parse(input);expect(sameResponsibilityInput(saved,{...saved,weekdays:[4,0,2],assistedByParentAccountIds:[other,parent]})).toBe(true);
  for(const changed of [{localTime:"18:36"},{timeOrigin:"practitioner" as const},{foldChoice:"later" as const},{reminderRecipients:[]},{assistedByParentAccountIds:[]},{period:"morning" as const}])expect(sameResponsibilityInput(saved,{...saved,...changed})).toBe(false);
  expect(sameResponsibilityInput(null,undefined)).toBe(true);expect(sameResponsibilityInput(null,saved)).toBe(false);
});
test("an assisted note is bounded and cannot invent authenticated identity or authorship",()=>{
  expect(assistedCheckInInput.parse({mode:"together",note:"DEMO — completed together"})).toEqual({mode:"together",note:"DEMO — completed together"});
  for(const value of [{mode:"self",note:""},{mode:"together",note:"x".repeat(2001)},{mode:"parent_report",note:"",authorAccountId:parent}])expect(assistedCheckInInput.safeParse(value).success).toBe(false);
});
