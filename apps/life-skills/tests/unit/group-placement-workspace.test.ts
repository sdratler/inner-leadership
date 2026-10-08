import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {availableGroupInterests,availableMoveDestinations,classifyGroupPlacementSaveFailure,groupInterestProvenance,GroupPlacementWorkspace} from "../../src/features/group-placement/workspace.tsx";
import type {GroupPlacementList} from "../../src/features/group-placement/contract.ts";
import {moveProposedPlacementCommandSchema} from "../../src/features/group-placement/contract.ts";
import {activeItem,breadcrumbItems,practitionerContext} from "../../src/ui/workspace/navigation-model.ts";
import {groupInterestCandidateEnabled} from "../../src/features/group-interest/candidate.ts";

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
 });
 it("keeps the same interest available for other draft groups but not duplicated within one",()=>{
  const data:GroupPlacementList={draftGroups:[],eligibleGroupInterests:[{id:"interest",state:"service_interest",serviceType:"group",familyId:"family",familyLabel:"Family",personId:"person",personLabel:"Child",sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z"}],
  proposedPlacements:[{id:"proposal",state:"proposed_placement",draftGroupId:"group-a",serviceInterestId:"interest",familyId:"family",familyLabel:"Family",personId:"person",personLabel:"Child",sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z",proposalStatus:"current",movedFromProposalId:null,movedToProposalId:null}],proposalMovements:[]};
  expect(availableGroupInterests(data,"group-a")).toEqual([]);expect(availableGroupInterests(data,"group-b")).toHaveLength(1);
 });
 it("keeps syntax validation separate from trusted movement state",()=>{
  const valid={action:"move_group_placement",operationId:"11111111-1111-4111-8111-111111111111",sourceProposedPlacementId:"22222222-2222-4222-8222-222222222222",destinationDraftGroupId:"33333333-3333-4333-8333-333333333333"};
  expect(moveProposedPlacementCommandSchema.parse(valid)).toEqual(valid);
  expect(moveProposedPlacementCommandSchema.safeParse({...valid,sourceDraftGroupId:"untrusted"}).success).toBe(false);
  expect(moveProposedPlacementCommandSchema.safeParse({...valid,destinationDraftGroupId:"bad"}).success).toBe(false);
 });
 it("offers only unused destinations for a current exact-interest proposal",()=>{
  const source={id:"source",state:"proposed_placement" as const,draftGroupId:"group-a",serviceInterestId:"interest",familyId:"family",familyLabel:"Family",personId:"person",personLabel:"Child",sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z",proposalStatus:"current" as const,movedFromProposalId:null,movedToProposalId:null};
  const occupied={...source,id:"historical",draftGroupId:"group-b",proposalStatus:"moved" as const,movedToProposalId:"next"};
  const data:GroupPlacementList={draftGroups:[{id:"group-a",state:"draft_group",label:"A",recordedBy:"actor",createdAt:source.createdAt},{id:"group-b",state:"draft_group",label:"B",recordedBy:"actor",createdAt:source.createdAt},{id:"group-c",state:"draft_group",label:"C",recordedBy:"actor",createdAt:source.createdAt}],eligibleGroupInterests:[],proposedPlacements:[source,occupied],proposalMovements:[]};
  expect(availableMoveDestinations(data,source).map(item=>item.id)).toEqual(["group-c"]);
  expect(availableMoveDestinations(data,{...source,proposalStatus:"moved",movedToProposalId:"next"})).toEqual([]);
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
  expect(practitionerContext(path,null,false,false,true).find(item=>item.key==="groups")?.path).toBe("app/group-interest");
  expect(breadcrumbItems(locale,"practitioner",path).map(item=>item.label)).toEqual(locale==="he"?["בית","אנשים","קבוצות"]:["Home","People","Groups"]);
 });
 it("keeps every Groups navigation entry default-off and production-disabled",()=>{
  for(const path of ["/en/app/clients","/he/app/prospects","/en/app/group-interest"]){
   expect(practitionerContext(path,null).some(item=>item.key==="groups")).toBe(false);
   expect(practitionerContext(path,null,false,false,true).some(item=>item.key==="groups")).toBe(true);
  }
  expect(groupInterestCandidateEnabled({})).toBe(false);
  expect(groupInterestCandidateEnabled({LS_GROUP_INTEREST_CANDIDATE:"true",NODE_ENV:"production"})).toBe(false);
  expect(groupInterestCandidateEnabled({LS_GROUP_INTEREST_CANDIDATE:"true",NODE_ENV:"development"})).toBe(true);
 });
});
