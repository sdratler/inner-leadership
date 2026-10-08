import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {availableGroupInterests,classifyGroupPlacementSaveFailure,groupInterestProvenance,GroupPlacementWorkspace} from "../../src/features/group-placement/workspace.tsx";
import type {GroupPlacementList} from "../../src/features/group-placement/contract.ts";
import {activeItem,breadcrumbItems,practitionerContext} from "../../src/ui/workspace/navigation-model.ts";

describe("draft group and proposed placement workspace",()=>{
 it.each(["en","he"] as const)("labels the owner-only state boundary in %s",locale=>{
  const html=renderToStaticMarkup(createElement(GroupPlacementWorkspace,{locale}));
  expect(html).toContain(locale==="he"?"קבוצות טיוטה והצעות שיבוץ":"Draft groups and proposed placements");
  expect(html).toContain(locale==="he"?"הצעת שיבוץ אינה ניסיון":"A proposed placement is not a trial");
  expect(html).toContain(locale==="he"?"הוספת קבוצת טיוטה":"Add draft group");
  expect(html).not.toMatch(/fee|price|capacity|venue|schedule/i);
 });
 it("distinguishes confirmed client failures from unknown write outcomes",()=>{
  expect(classifyGroupPlacementSaveFailure(false)).toBe("reauth");expect(classifyGroupPlacementSaveFailure(true,401)).toBe("reauth");
  for(const status of [400,403,404,409,429])expect(classifyGroupPlacementSaveFailure(true,status)).toBe("correctable");
  for(const status of [500,503,undefined])expect(classifyGroupPlacementSaveFailure(true,status)).toBe("unconfirmed");
  expect(classifyGroupPlacementSaveFailure(true,409,true)).toBe("unconfirmed");
 });
 it("keeps the same interest available for other draft groups but not duplicated within one",()=>{
  const data:GroupPlacementList={draftGroups:[],eligibleGroupInterests:[{id:"interest",state:"service_interest",serviceType:"group",familyId:"family",familyLabel:"Family",personId:"person",personLabel:"Child",sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z"}],
   proposedPlacements:[{id:"proposal",state:"proposed_placement",draftGroupId:"group-a",serviceInterestId:"interest",familyId:"family",familyLabel:"Family",personId:"person",personLabel:"Child",sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z"}]};
  expect(availableGroupInterests(data,"group-a")).toEqual([]);expect(availableGroupInterests(data,"group-b")).toHaveLength(1);
 });
 it("gives same-child interests distinct nonclinical inquiry provenance",()=>{
  const first={sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z"};
  const second={sourceInquiryId:"22222222-2222-4222-8222-222222222222",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z"};
  expect(groupInterestProvenance(first,"en")).toContain("ref 11111111");
  expect(groupInterestProvenance(second,"en")).toContain("ref 22222222");
  expect(groupInterestProvenance(first,"en")).not.toBe(groupInterestProvenance(second,"en"));
  expect(groupInterestProvenance(first,"he")).toContain("מזהה 11111111");
 });
 it.each(["en","he"] as const)("integrates the %s route as People > Groups",locale=>{
  const path=`/${locale}/app/group-interest`;
  expect(activeItem(path,locale,"practitioner")?.key).toBe("clients");
  expect(practitionerContext(path,null).find(item=>item.key==="groups")?.path).toBe("app/group-interest");
  expect(breadcrumbItems(locale,"practitioner",path).map(item=>item.label)).toEqual(locale==="he"?["בית","אנשים","קבוצות"]:["Home","People","Groups"]);
 });
});
