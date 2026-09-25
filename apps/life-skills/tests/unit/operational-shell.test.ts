import React from "react";
import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {WorkspaceShell} from "../../src/ui/workspace/workspace-shell.tsx";
import {breadcrumbItems,caseDestinationHref,practitionerContext,primaryNavigation,workspaceHref} from "../../src/ui/workspace/navigation-model.ts";
import {CalendarShell} from "../../src/ui/workspace/appointments.tsx";
import {CalendarBoard} from "../../src/features/calendar/views.tsx";
import {countCurrentAssignments} from "../../src/features/calendar/attention-summary.tsx";
import {selectAuthorizedPaymentCase} from "../../src/features/payments/case-selection.ts";
import {calendarView} from "../../src/features/calendar/time.ts";
import {paymentSection,paymentVisibleCharges,paymentVisiblePanels} from "../../src/features/payments/sections.ts";

describe("operational workspace navigation",()=>{
 it("limits the practitioner sidebar to the six owner-selected destinations",()=>{
  expect(primaryNavigation.practitioner.map(item=>item.en)).toEqual(["Calendar","People","Communications","Reports","Marketing","Payments"]);
  expect(practitionerContext("/en/app/marketing",null).map(item=>item.en)).toEqual(["Overview","Content Calendar","Creatives","Needs approval","Community","Ads"]);
 });
 for(const locale of ["he","en"] as const){
  it(`${locale}: keeps desktop and mobile sections route-based with one account Settings entry`,()=>{
   const props={locale,role:"practitioner",pathname:`/${locale}/app/marketing`,section:"ads",languageHref:`/${locale==="he"?"en":"he"}/app/marketing`} as React.ComponentProps<typeof WorkspaceShell>;
   const html=renderToStaticMarkup(React.createElement(WorkspaceShell,props,React.createElement("h1",null,"Content")));
   expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
   expect(html).toContain('class="lsu-top-tabs"');
   expect(html.match(/class="lsu-top-tabs"/g)).toHaveLength(1);
   expect(html).not.toContain('class="lsu-mobile-tabs"');
   expect(html).toContain(`/${locale}/app/marketing?section=ads`);
   expect(html).toContain(`href="/${locale}/app/marketing?section=ads" aria-current="page"`);
   expect(html.match(new RegExp(`href="/${locale}/app/settings"`,"g"))).toHaveLength(1);
   expect(html).toContain(`href="/${locale}/sample"`);
  });
  it(`${locale}: changes the contextual toolbar with the current page`,()=>{
   const props={locale,role:"practitioner",pathname:`/${locale}/app/calendar`,view:"agenda",date:"2026-09-24",languageHref:`/${locale==="he"?"en":"he"}/app/calendar?view=agenda&date=2026-09-24`} as React.ComponentProps<typeof WorkspaceShell>;
   const html=renderToStaticMarkup(React.createElement(WorkspaceShell,props,React.createElement("h1",null,"Content")));
   expect(html).toContain(`/${locale}/app/calendar?view=agenda&amp;date=2026-09-24`);
   expect(html).toContain(`aria-label="${locale==="he"?"תצוגות הדף הנוכחי":"Current page views"}"`);
   expect(html).not.toContain(`href="/${locale}/app/prospects"`);
   expect(html).not.toContain(`href="/${locale}/app/practice"`);
  });
 }
 it("keeps a validated selected client in destination links, not authorization",()=>{
  const caseId="123e4567-e89b-42d3-a456-426614174000";
  expect(workspaceHref("en","app/payments",caseId)).toBe(`/en/app/payments?caseId=${caseId}`);
  expect(workspaceHref("en","app/payments","untrusted")).toBe("/en/app/payments");
  expect(caseDestinationHref("en","app/calendar",caseId)).toBe(`/en/app/calendar?caseId=${caseId}&context=client`);
  expect(()=>caseDestinationHref("en","app/calendar","untrusted")).toThrow("INVALID_CASE_CONTEXT");
  expect(breadcrumbItems("en","practitioner",`/en/app/cases/${caseId}/settings`).map(item=>item.label)).toEqual(["Home","People","Selected case","Access & participants"]);
  expect(breadcrumbItems("en","practitioner","/en/app/calendar",null,"week",true,caseId).map(item=>item.label)).toEqual(["Home","People","Selected case","Calendar"]);
  const html=renderToStaticMarkup(React.createElement(WorkspaceShell,{locale:"en",role:"practitioner",pathname:"/en/app/feedback",caseId,selectedClient:true,languageHref:`/he/app/feedback?caseId=${caseId}&context=client`} as React.ComponentProps<typeof WorkspaceShell>,React.createElement("h1",null,"Content")));
  expect(html).toContain(`/en/app/feedback?caseId=${caseId}&amp;context=client`);
  expect(html).toContain("Selected case");
  expect(html).toContain("Communications");
 });
 it("keeps controls and an actual date grid when no appointments exist",()=>{
  const board=React.createElement(CalendarBoard,{dates:["2026-09-23","2026-09-24"],items:[],locale:"en",view:"week",names:{},onOpen:()=>undefined});
  const html=renderToStaticMarkup(React.createElement(CalendarShell,{locale:"en",period:"September 2026",view:"week",viewHrefs:{day:"/en/app/calendar?view=day",week:"/en/app/calendar?view=week",month:"/en/app/calendar?view=month"},todayHref:"/en/app/calendar?date=2026-09-23",previousHref:"/en/app/calendar?date=2026-09-16",nextHref:"/en/app/calendar?date=2026-09-30",desktop:board,agenda:React.createElement("p",null,"No appointments")}));
  expect(html).toContain('class="lsw-calendar-grid"');
  expect(html).toContain('data-ls-calendar-grid="true"');
  expect(html).toContain('dateTime="2026-09-23"');
  expect(html).toContain('dateTime="2026-09-24"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("No appointments");
 });
 it("shows an explicit agenda without a second desktop calendar grid",()=>{
  expect(calendarView("agenda")).toBe("agenda");
  expect(calendarView("unexpected")).toBe("week");
  const html=renderToStaticMarkup(React.createElement(CalendarShell,{locale:"en",period:"September 2026",view:"agenda",viewHrefs:{day:"/en/app/calendar?view=day",week:"/en/app/calendar?view=week",month:"/en/app/calendar?view=month",agenda:"/en/app/calendar?view=agenda"},showViewTabs:false,todayHref:"/en/app/calendar",previousHref:"/en/app/calendar?date=2026-09-10",nextHref:"/en/app/calendar?date=2026-10-08",desktop:React.createElement("p",null,"Grid"),agenda:React.createElement("p",null,"Agenda entries")}));
  expect(html).toContain("lsw-calendar--agenda");
  expect(html).toContain("Agenda entries");
  expect(html).not.toContain("aria-label=\"Calendar\"");
 });
 it("counts the latest published assignment version, never a superseded date window",()=>{
  expect(countCurrentAssignments([
   {assignmentId:"a",version:1,startsOn:"2026-09-01",endsOn:"2026-09-30"},
   {assignmentId:"a",version:2,startsOn:"2026-10-01",endsOn:null},
   {assignmentId:"b",version:1,startsOn:"2026-09-01",endsOn:null},
  ],"2026-09-23")).toBe(1);
 });
 it("never substitutes a different payment client for an invalid bookmarked case",()=>{
  const cases=[{id:"child-a",kind:"minor" as const},{id:"adult-b",kind:"adult" as const}];
  expect(selectAuthorizedPaymentCase(cases,"practitioner","adult-b").selected?.id).toBe("adult-b");
  expect(selectAuthorizedPaymentCase(cases,"parent","adult-b")).toMatchObject({selected:undefined,invalid:true});
  expect(selectAuthorizedPaymentCase(cases,"practitioner","missing")).toMatchObject({selected:undefined,invalid:true});
 });
 it("routes payment context to distinct rendered panels without changing the existing full payment route",()=>{
  expect(paymentSection("refunds",false)).toBe("full");
  expect(paymentSection("untrusted",true)).toBe("overview");
  expect(paymentVisiblePanels(paymentSection("overview",true))).toMatchObject({balance:true,charges:true,received:true,newCharge:false,recordPayment:false,allocatePayment:false,refundCredit:false});
  expect(paymentVisiblePanels(paymentSection("awaiting",true))).toMatchObject({balance:false,charges:true,received:false,newCharge:true,recordPayment:false,allocatePayment:true,refundCredit:false});
  expect(paymentVisiblePanels(paymentSection("paid",true))).toMatchObject({balance:false,charges:false,received:true,newCharge:false,recordPayment:true,allocatePayment:false,refundCredit:false});
  expect(paymentVisiblePanels(paymentSection("credits",true))).toMatchObject({balance:true,charges:false,received:false,history:true,newCharge:false,refundCredit:false});
  expect(paymentVisiblePanels(paymentSection("refunds",true))).toMatchObject({balance:false,charges:false,received:false,history:true,newCharge:false,refundCredit:true});
  expect(Object.values(paymentVisiblePanels(paymentSection(undefined,false))).every(Boolean)).toBe(true);
  const charges=[{id:"due",status:"open" as const},{id:"settled",status:"paid" as const}];
  expect(paymentVisibleCharges(charges,"awaiting").map(item=>item.id)).toEqual(["due"]);
  expect(paymentVisibleCharges(charges,"overview").map(item=>item.id)).toEqual(["due","settled"]);
  expect(paymentVisibleCharges(charges,"full").map(item=>item.id)).toEqual(["due","settled"]);
  expect(practitionerContext("/en/app/payments",null).map(item=>item.en)).toEqual(["Overview","Awaiting","Paid","Credits","Refunds"]);
 });
});
