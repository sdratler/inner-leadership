import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {availableGroupInterests,availableMoveDestinations,classifyGroupPlacementSaveFailure,groupInterestProvenance,GroupPlacementWorkspace} from "../../src/features/group-placement/workspace.tsx";
import type {GroupPlacementList} from "../../src/features/group-placement/contract.ts";
import {moveProposedPlacementCommandSchema,proposedDraftMeetingCommandSchema,reviseDraftMeetingCommandSchema} from "../../src/features/group-placement/contract.ts";
import {activeItem,breadcrumbItems,practitionerContext} from "../../src/ui/workspace/navigation-model.ts";
import {groupInterestCandidateEnabled} from "../../src/features/group-interest/candidate.ts";
import {DraftMeetingPlanner} from "../../src/features/group-placement/meeting-workspace.tsx";

describe("draft group and proposed placement workspace",()=>{
 it.each(["en","he"] as const)("labels the owner-only state boundary in %s",locale=>{
  const html=renderToStaticMarkup(createElement(GroupPlacementWorkspace,{locale}));
  expect(html).toContain(locale==="he"?"קבוצות טיוטה והצעות שיבוץ":"Draft groups and proposed placements");
  expect(html).toContain(locale==="he"?"הצעת שיבוץ אינה ניסיון":"A proposed placement is not a trial");
  expect(html).toContain(locale==="he"?"הוספת קבוצת טיוטה":"Add draft group");
  expect(html).not.toMatch(/price/i);
 });
 it("distinguishes confirmed client failures from unknown write outcomes",()=>{
  expect(classifyGroupPlacementSaveFailure(false)).toBe("reauth");expect(classifyGroupPlacementSaveFailure(true,401)).toBe("reauth");
  for(const status of [400,403,404,409,429])expect(classifyGroupPlacementSaveFailure(true,status)).toBe("correctable");
  for(const status of [500,503,undefined])expect(classifyGroupPlacementSaveFailure(true,status)).toBe("unconfirmed");
  expect(classifyGroupPlacementSaveFailure(false,undefined,true)).toBe("unconfirmed");
  expect(classifyGroupPlacementSaveFailure(true,409,true)).toBe("correctable");
 });
 it("keeps the same interest available for other draft groups but not duplicated within one",()=>{
  const data:GroupPlacementList={draftGroups:[],eligibleGroupInterests:[{id:"interest",state:"service_interest",serviceType:"group",familyId:"family",familyLabel:"Family",personId:"person",personLabel:"Child",sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z"}],
  proposedPlacements:[{id:"proposal",state:"proposed_placement",draftGroupId:"group-a",serviceInterestId:"interest",familyId:"family",familyLabel:"Family",personId:"person",personLabel:"Child",sourceInquiryId:"11111111-1111-4111-8111-111111111111",sourceInquiryCreatedAt:"2029-01-01T00:00:00.000Z",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z",proposalStatus:"current",movedFromProposalId:null,movedToProposalId:null}],proposalMovements:[],meetingRevisions:[]};
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
  const data:GroupPlacementList={draftGroups:[{id:"group-a",state:"draft_group",label:"A",recordedBy:"actor",createdAt:source.createdAt},{id:"group-b",state:"draft_group",label:"B",recordedBy:"actor",createdAt:source.createdAt},{id:"group-c",state:"draft_group",label:"C",recordedBy:"actor",createdAt:source.createdAt}],eligibleGroupInterests:[],proposedPlacements:[source,occupied],proposalMovements:[],meetingRevisions:[]};
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
 it("requires an explicit bounded Jerusalem proposal and trusted revision source",()=>{
  const base={operationId:"11111111-1111-4111-8111-111111111111",timeZone:"Asia/Jerusalem",localStart:"2026-10-11T10:30",durationMinutes:60,venue:"Private room"};
  expect(proposedDraftMeetingCommandSchema.safeParse({action:"propose_draft_group_meeting",draftGroupId:"22222222-2222-4222-8222-222222222222",...base}).success).toBe(true);
  expect(proposedDraftMeetingCommandSchema.safeParse({action:"propose_draft_group_meeting",draftGroupId:"22222222-2222-4222-8222-222222222222",...base,timeZone:"UTC"}).success).toBe(false);
  expect(proposedDraftMeetingCommandSchema.safeParse({action:"propose_draft_group_meeting",draftGroupId:"22222222-2222-4222-8222-222222222222",...base,durationMinutes:0}).success).toBe(false);
  expect(reviseDraftMeetingCommandSchema.safeParse({action:"revise_draft_group_meeting",sourceRevisionId:"33333333-3333-4333-8333-333333333333",...base,draftGroupId:"untrusted"}).success).toBe(false);
 });
 it.each(["en","he"] as const)("renders the owner-only proposed occurrence boundary and redacted conflict in %s",locale=>{
  const group={id:"22222222-2222-4222-8222-222222222222",state:"draft_group" as const,label:"Synthetic group",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z"},
   revision={id:"33333333-3333-4333-8333-333333333333",occurrenceId:"33333333-3333-4333-8333-333333333333",state:"proposed" as const,draftGroupId:group.id,timeZone:"Asia/Jerusalem" as const,
    localStart:"2029-02-03T10:30",startsAt:"2029-02-03T08:30:00.000Z",endsAt:"2029-02-03T09:30:00.000Z",durationMinutes:60,venue:"Synthetic room",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z",
    previousRevisionId:null,nextRevisionId:null,revisionStatus:"current" as const,conflicts:[{kind:"private_appointment" as const,reference:"abcd1234",startsAt:"2029-02-03T08:00:00.000Z",endsAt:"2029-02-03T09:15:00.000Z"}]};
  const html=renderToStaticMarkup(createElement(DraftMeetingPlanner,{locale,group,revisions:[revision],reload:async()=>{}}));
  expect(html).toContain(locale==="he"?"מועדי פגישה מוצעים":"Proposed meeting occurrences");expect(html).toContain(locale==="he"?"התנגשות בלוח הזמנים":"Scheduling conflict");
  expect(html).toContain("abcd1234");expect(html).toContain("10:00");expect(html).toContain("11:15");
  expect(html).toContain("datetime-local");expect(html).toContain(locale==="he"?"אינם פגישות מאושרות":"are not confirmed meetings");
  expect(html).toContain('min="15" max="480" step="1" required="" name="durationMinutes" value="60"');
 });
 it("leaves a new occurrence duration empty while retaining a correction duration",()=>{
  const group={id:"22222222-2222-4222-8222-222222222222",state:"draft_group" as const,label:"Synthetic group",recordedBy:"actor",createdAt:"2029-01-01T00:00:00.000Z"};
  const html=renderToStaticMarkup(createElement(DraftMeetingPlanner,{locale:"en",group,revisions:[],reload:async()=>{}}));
  expect(html).toContain('min="15" max="480" step="1" required="" name="durationMinutes"/>');
  expect(html).not.toContain('name="durationMinutes" value=');
 });
 it.each(["en","he"] as const)("integrates the %s route as People > Groups",locale=>{
  const path=`/${locale}/app/group-interest`;
  expect(activeItem(path,locale,"practitioner")?.key).toBe("clients");
  expect(practitionerContext(path,null,false,false,true).find(item=>item.key==="groups")?.path).toBe("app/group-interest");
  expect(breadcrumbItems(locale,"practitioner",path).map(item=>item.label)).toEqual(locale==="he"?["בית","אנשים","קבוצות"]:["Home","People","Groups"]);
 });
 it.each(["en","he"] as const)("integrates public application review into the real %s People navigation",locale=>{
  const path=`/${locale}/app/group-applications`,tabs=practitionerContext(path,null);
  expect(activeItem(path,locale,"practitioner")?.key).toBe("clients");
  expect(tabs.find(item=>item.key==="group_applications")?.path).toBe("app/group-applications");
  expect(tabs.some(item=>item.key==="groups")).toBe(false);
  expect(breadcrumbItems(locale,"practitioner",path).map(item=>item.label)).toEqual(locale==="he"?["בית","אנשים","בקשות לקבוצה"]:["Home","People","Group applications"]);
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
