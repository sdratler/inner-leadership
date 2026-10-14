import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {academyFitSchema,floridaParentApplicationFieldsSchema,floridaGroupApplicationReadableFieldsSchema,floridaGroupApplicationNotice,normalizeFloridaLeadContact,
 normalizeGroupApplicationPhone} from "../../src/features/group-application/contract.ts";
import {AcademyFitFields,AcademyFitReadback,academyFitFromForm} from "../../src/features/group-application/fit-fields.tsx";

const fit={version:"RM-FIT-20261014-04-v1" as const,learners:[{approximateAge:10,gear:"needs_advice" as const,experience:"new" as const},
 {approximateAge:13,gear:"has_gear" as const,experience:"some" as const}],maximumDriveMinutes:30,parentDropoff:"yes" as const};
const fields={parentName:"Synthetic parent",contact:"3055550100",language:"en" as const,cityArea:"Synthetic Florida",neighborhood:"Synthetic neighborhood",
 programId:"sunday_fishing_academy" as const,scheduleContext:"program_format_interest" as const,schedulePreference:["weekday_before_school" as const],
 academyFit:fit,permission:{confirmed:true as const,version:floridaGroupApplicationNotice.version,language:"en" as const}};
describe("RM04 narrow group-fit inquiry and compatibility",()=>{
 it("reads the historically accepted language tuple unchanged but denies it for all new writes",()=>{
  const old={parentName:"Synthetic retained compatibility inquiry",contact:"synthetic-compatibility@example.invalid",language:"en" as const,
   childAge:"10",cityArea:"Synthetic Florida",programId:"sunday_fishing_academy" as const,schedulePreference:["sunday" as const],
   permission:{confirmed:true as const,version:floridaGroupApplicationNotice.version,language:"he" as const}};
  expect(floridaGroupApplicationReadableFieldsSchema.parse(old)).toEqual(old);
  expect(floridaParentApplicationFieldsSchema.safeParse(old).success).toBe(false);
  for(const changed of [{...old,academyFit:fit},{...old,paid:true},{...old,permission:{...old.permission,confirmed:false}},
   {...old,permission:{...old.permission,version:"unknown"}},{...old,contact:"invalid"},
   {...old,scheduleContext:"program_format_interest",schedulePreference:["weekday_before_school"]}])
   expect(floridaGroupApplicationReadableFieldsSchema.safeParse(changed).success).toBe(false);
 });
 it("captures siblings once in an adult inquiry, without child identities or new permissions",()=>{
  expect(floridaParentApplicationFieldsSchema.parse(fields)).toEqual(fields);expect(fit.learners).toHaveLength(2);
  for(const extra of [{childName:"forbidden"},{diagnosis:"forbidden"},{mediaPermission:true},{paymentToken:"forbidden"},{guardianVerified:true}])
   expect(floridaParentApplicationFieldsSchema.safeParse({...fields,...extra}).success).toBe(false);
  expect(academyFitSchema.safeParse({...fit,learners:[{...fit.learners[0],fullName:"forbidden"}]}).success).toBe(false);
 });
 it("reads old Florida saved shapes unchanged and retains Israel normalization",()=>{
  const {academyFit:unused,...older}=fields;void unused;
  expect(floridaParentApplicationFieldsSchema.parse({...older,childAge:"10",schedulePreference:["sunday"]})).toEqual({...older,childAge:"10",schedulePreference:["sunday"]});
  expect(normalizeGroupApplicationPhone("052-000-2000")).toBe("+972520002000");
 });
 it.each([["3055550100","+13055550100"],["(305) 555-0100","+13055550100"],["13055550100","+13055550100"],
  ["+1 305 555 0100","+13055550100"],["0013055550100","+13055550100"],["+972520002000","+972520002000"],
  ["0520002000",null],["parent@example.invalid",null],["5550100",null]])("normalizes Florida bridge %s without defaulting to Israel",(input,expected)=>{
   expect(normalizeFloridaLeadContact(input)).toBe(expected);
  });
 it("keeps email-only inquiry reviewable but never invents a phone or chat",()=>{
  expect(floridaParentApplicationFieldsSchema.safeParse({...fields,contact:"parent@example.invalid"}).success).toBe(true);
  expect(normalizeFloridaLeadContact("parent@example.invalid")).toBeNull();
 });
 it("denies unknown phone origin for new fit, incorrect notice language, and fit on other programs",()=>{
  expect(floridaParentApplicationFieldsSchema.safeParse({...fields,contact:"0520002000"}).success).toBe(false);
  expect(floridaParentApplicationFieldsSchema.safeParse({...fields,permission:{...fields.permission,language:"he"}}).success).toBe(false);
  expect(floridaParentApplicationFieldsSchema.safeParse({...fields,programId:"morning_torah_learning"}).success).toBe(false);
 });
 it("does not interpret missing age or drive preference as zero",()=>{
  const form=new FormData();form.set("learnerCount","1");form.set("learnerGear-0","not_sure");form.set("learnerExperience-0","not_sure");form.set("parentDropoff","discuss");
  const value=academyFitFromForm(form);expect(academyFitSchema.safeParse(value).success).toBe(false);
  form.set("learnerAge-0","10");const parsed=academyFitSchema.parse(academyFitFromForm(form));expect(parsed).not.toHaveProperty("maximumDriveMinutes");
  form.set("learnerCount","999");expect(academyFitFromForm(form)).toBeNull();
 });
 it.each(["en","he"] as const)("uses one compact field family and collapsed owner readback in %s",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyFitFields,{locale,count:2,onCount:()=>{}}));
  expect(html).toContain('name="learnerCount"');expect(html).toContain('name="learnerAge-1"');expect(html).not.toMatch(/name="(?:childName|diagnosis|mediaPermission|payment)"/);
  const readback=renderToStaticMarkup(createElement(AcademyFitReadback,{locale,fit}));expect(readback).toMatch(/<details\b[^>]*>/);expect(readback).not.toMatch(/<details\b[^>]*\bopen(?:[\s=>])/);expect(readback).not.toContain("<details open");
  expect(readback).toContain("30");expect(readback).toContain("13");
 });
});
