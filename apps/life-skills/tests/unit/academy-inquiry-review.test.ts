import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,describe,expect,it,vi} from "vitest";
import {decodeInquiryReview,requestGroupApplications,GroupApplicationReviewWorkspace} from "../../src/features/group-application/review-workspace.tsx";
import {InquiryReviewList} from "../../src/features/group-application/inquiry-review-list.tsx";
import {AcademyInquiryFilters} from "../../src/features/group-application/academy-inquiry-filters.tsx";
import {emptyAcademyInquiryFilters} from "../../src/features/group-application/academy-inquiry-filters.ts";
import {practitionerContext,breadcrumbItems} from "../../src/ui/workspace/navigation-model.ts";
import type {Trip390Interest} from "../../src/features/group-application/academy-trip390-contract.ts";
import {TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER} from "../../src/features/group-application/academy-trip390-v1.ts";
import type {GroupApplicationRecord} from "../../src/features/group-application/contract.ts";
vi.mock("server-only",()=>({}));
const ref="11111111-1111-4111-8111-111111111111";
const fields:Trip390Interest={version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,guardianName:"Synthetic <Parent>",email:"synthetic@example.invalid",city:"Synthetic District",postalCode:"01234-5678",messageLanguage:"he" as const,instructionLanguage:"either" as const,children:[{id:"22222222-2222-4222-8222-222222222222",name:"Older synthetic",ageYears:12,experience:"some" as const},{id:"33333333-3333-4333-8333-333333333333",name:"Younger synthetic",ageYears:9,experience:"new" as const}],acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:"en" as const,conductExplained:true as const,interestPrivacySafety:true as const,whatsapp:false}};
const item:GroupApplicationRecord={id:ref,source:"public_group_application",state:"owner_review",receivedAt:"2026-11-04T12:00:00.000Z",fields};
const body={ok:true,data:{items:[item],nextCursor:null,emailSetup:null}};
afterEach(()=>vi.unstubAllGlobals());
describe("Fishing inquiry presentation boundary",()=>{
 it("keeps mailbox evidence narrow and bound to the selected inquiry",()=>{
  const emailControl={kind:'inquiry_mailbox_control_only',applicationId:ref,verifiedAt:'2026-11-09T12:00:00.000Z'};
  expect(decodeInquiryReview({ok:true,data:{...body.data,emailControl}})).toEqual({...body.data,emailControl});
  expect(decodeInquiryReview({ok:true,data:{...body.data,emailControl:null}})).toEqual({...body.data,emailControl:null});
  for(const bad of [{...emailControl,applicationId:fields.children[0]!.id},{...emailControl,kind:'legal_guardian'},{...emailControl,guardianAssurance:true},{...emailControl,verifiedAt:'not-a-date'}])expect(()=>decodeInquiryReview({ok:true,data:{...body.data,emailControl:bad}})).toThrow();
  expect(()=>decodeInquiryReview({ok:true,data:{items:[],emailControl}})).toThrow();
 });
 it("decodes the complete saved tuple and distinguishes an actual empty page",()=>{
  expect(decodeInquiryReview(body)).toEqual(body.data);
  expect(decodeInquiryReview({ok:true,data:{items:[]}})).toEqual({items:[]});
 });
 const badRows=[null,{...item,fields:null},{...item,id:"bad"},{...item,receivedAt:"2026-02-30T12:00:00Z"},{...item,receivedAt:"not-a-date"},{...item,state:"enrolled"},{...item,source:"other"},{...item,fields:{...fields,version:"unknown"}},{...item,fields:{...fields,children:[fields.children[0],fields.children[0]]}},{...item,fields:{...fields,postalCode:null}},{...item,fields:{...fields,messageLanguage:""}}];
 it.each(badRows)("rejects malformed row %# as unavailable, never a partial or empty page",bad=>{
  expect(()=>decodeInquiryReview({ok:true,data:{items:[item,bad]}})).toThrow("INQUIRY_REVIEW_FAILED");
 });
 it.each([null,{}, {ok:false,data:body.data},{ok:true,data:null},{ok:true,data:{items:null}},{ok:true,data:{items:[item,item]}},{ok:true,data:{items:[item],nextCursor:"bad"}},{ok:true,data:{items:[item],emailSetup:{status:"CONNECTED"}}}])("rejects invalid envelope %#",bad=>expect(()=>decodeInquiryReview(bad)).toThrow());
 it("checks exact-reference response identity and preserves private read-only transport",async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(body)));vi.stubGlobal("fetch",fetcher);
  expect((await requestGroupApplications(ref,null,true)).items).toEqual([item]);
  expect(fetcher).toHaveBeenCalledWith("/api/private/group-applications?reference="+ref,{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
  await expect(requestGroupApplications(fields.children[0]!.id,null,true)).rejects.toThrow();
 });
 it.each([401,403,503])("propagates HTTP %s without treating a failure as empty",async status=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}",{status})));
  await expect(requestGroupApplications("",null)).rejects.toMatchObject({status});
 });
 it.each(["en","he"] as const)("renders a readable sibling-preserving %s list with an explicit detail action, no fabricated follow-up",locale=>{
  const choose=vi.fn(),html=renderToStaticMarkup(createElement(InquiryReviewList,{items:[item],locale,disabled:false,onSelect:choose}));
  for(const text of ["Synthetic &lt;Parent&gt;","synthetic@example.invalid","Older synthetic","Younger synthetic","12","9","01234-5678",`data-inquiry-row="${ref}"`])expect(html).toContain(text);
  expect(html).toContain(locale==="he"?"פתיחת הפנייה של":"Open inquiry from");expect(html).toContain(locale==="he"?"עברית":"Hebrew");
  expect(html).not.toMatch(/awaiting owner review|contacted|enrolled|Send email|<form/);expect(choose).not.toHaveBeenCalled();
 });
 it.each(["en","he"] as const)("starts %s in loading state without empty-state or founder/transport actions",locale=>{
  const html=renderToStaticMarkup(createElement(GroupApplicationReviewWorkspace,{locale}));
  expect(html).toContain(locale==="he"?"טוען פניות":"Loading inquiries");
  expect(html).not.toMatch(/data-inquiry-email-setup|Read current reservations|No Academy inquiries loaded|data-inquiry-row/);
 });
 it.each(["en","he"] as const)("keeps Trip-only %s filters relevant, historical filters retained separately",locale=>{
  const props={locale,value:emptyAcademyInquiryFilters,onChange:vi.fn(),loadedCount:1,visibleCount:1};
  const trip=renderToStaticMarkup(createElement(AcademyInquiryFilters,{...props,tripOnly:true}));
  const old=renderToStaticMarkup(createElement(AcademyInquiryFilters,props));
  expect(trip).toContain(locale==="he"?"שפת הדרכה מועדפת":"Preferred instruction language");
  expect(trip).not.toContain('<option value="foundation">');expect(old).toContain('<option value="foundation">');
 });
 it("makes the existing Fishing destination first in People without changing other destinations or roles",()=>{
  const contexts=practitionerContext("/en/app/clients",null);
  expect(contexts[0]).toEqual({key:"group_applications",path:"app/group-applications",en:"Fishing inquiries",he:"פניות לדיג"});
  expect(contexts.slice(1).map(x=>x.key)).toEqual(["all","prospects","audience","whatsapp_group","needs_review","paid","active","archived"]);
  expect(breadcrumbItems("en","practitioner","/en/app/group-applications").at(-1)?.label).toBe("Fishing inquiries");
 });
});
