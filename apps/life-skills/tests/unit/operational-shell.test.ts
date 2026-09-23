import React from "react";
import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {WorkspaceShell} from "../../src/ui/workspace/workspace-shell.tsx";
import {breadcrumbItems,workspaceHref} from "../../src/ui/workspace/navigation-model.ts";
import {CalendarShell} from "../../src/ui/workspace/appointments.tsx";
import {CalendarBoard} from "../../src/features/calendar/views.tsx";

describe("operational workspace navigation",()=>{
 for(const locale of ["he","en"] as const){
  it(`${locale}: keeps desktop and mobile sections route-based with one account Settings entry`,()=>{
   const props={locale,role:"practitioner",pathname:`/${locale}/app/marketing`,section:"ads",languageHref:`/${locale==="he"?"en":"he"}/app/marketing`} as React.ComponentProps<typeof WorkspaceShell>;
   const html=renderToStaticMarkup(React.createElement(WorkspaceShell,props,React.createElement("h1",null,"Content")));
   expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
   expect(html).toContain('class="lsu-top-tabs"');
   expect(html).toContain('class="lsu-mobile-tabs"');
   expect(html).toContain(`/${locale}/app/marketing?section=ads`);
   expect(html).toContain(`href="/${locale}/app/marketing?section=ads" aria-current="page"`);
   expect(html.match(new RegExp(`href="/${locale}/app/settings"`,"g"))).toHaveLength(1);
   expect(html).toContain(`href="/${locale}/sample"`);
  });
 }
 it("keeps a validated selected client in destination links, not authorization",()=>{
  const caseId="123e4567-e89b-42d3-a456-426614174000";
  expect(workspaceHref("en","app/payments",caseId)).toBe(`/en/app/payments?caseId=${caseId}`);
  expect(workspaceHref("en","app/payments","untrusted")).toBe("/en/app/payments");
  expect(breadcrumbItems("en","practitioner",`/en/app/cases/${caseId}/settings`).map(item=>item.label)).toEqual(["Home","Clients","Selected case","Access & participants"]);
 });
 it("keeps controls and an actual date grid when no appointments exist",()=>{
  const board=React.createElement(CalendarBoard,{dates:["2026-09-23","2026-09-24"],items:[],locale:"en",view:"week",names:{},onOpen:()=>undefined});
  const html=renderToStaticMarkup(React.createElement(CalendarShell,{locale:"en",period:"September 2026",view:"week",viewHrefs:{day:"/en/app/calendar?view=day",week:"/en/app/calendar?view=week",month:"/en/app/calendar?view=month"},todayHref:"/en/app/calendar?date=2026-09-23",previousHref:"/en/app/calendar?date=2026-09-16",nextHref:"/en/app/calendar?date=2026-09-30",desktop:board,agenda:React.createElement("p",null,"No appointments")}));
  expect(html).toContain('class="lsw-calendar-grid"');
  expect(html).toContain('dateTime="2026-09-23"');
  expect(html).toContain('dateTime="2026-09-24"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("No appointments");
 });
});
