import React from "react";
import {readFileSync} from "node:fs";
import {renderToStaticMarkup} from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { destinationForRole, LoginClient } from "../../src/features/identity/login-client.tsx";
import { loginHref, loginReturnDestination, parentReturnPath, practitionerReturnPath } from "../../src/features/identity/login-return.ts";
import { visibleHomeCases } from "../../src/ui/workspace/family-home.tsx";
import { visibleUpdateCases } from "../../src/features/updates/updates-workspace.tsx";
import { PracticeList } from "../../src/features/home-practice/practice-list.tsx";

vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));

describe("shared private-app sign-in destination", () => {
  it("routes each enabled account type to its own workspace", () => {
    expect(destinationForRole("he", "practitioner")).toBe("/he/app/calendar");
    expect(destinationForRole("en", "parent")).toBe("/en/family/schedule");
    expect(destinationForRole("he", "adult_client")).toBe("/he/client");
  });
  it("routes the already-authorized child role to the shared client shell, not a new student app", () => {
    expect(destinationForRole("en", "child")).toBe("/en/client");
  });
  it("keeps child and adult client context separate in real client views",()=>{
    const cases=[{id:"minor",displayName:"DEMO Child",kind:"minor" as const},{id:"adult",displayName:"DEMO Adult",kind:"adult" as const}];
    expect(visibleHomeCases("child",cases).map(item=>item.id)).toEqual(["minor"]);
    expect(visibleHomeCases("adult_client",cases).map(item=>item.id)).toEqual(["adult"]);
    expect(visibleUpdateCases("child",cases).map(item=>item.id)).toEqual(["minor"]);
    expect(visibleUpdateCases("adult_client",cases).map(item=>item.id)).toEqual(["adult"]);
    const empty=renderToStaticMarkup(React.createElement(PracticeList,{locale:"en",role:"child",kind:"home-practice"}));
    expect(empty).toContain('href="/en/client"');
    expect(empty).not.toContain('href="/en/family"');
    const practice=readFileSync(new URL("../../src/features/home-practice/practice-list.tsx",import.meta.url),"utf8");
    expect(practice).toContain('role === "parent" && versionId');
    const home=readFileSync(new URL("../../src/ui/workspace/family-home.tsx",import.meta.url),"utf8");
    expect(home).toContain('role==="parent"?(he?"דיווח או שאלה":"Share an update or question"):(he?"עדכוני מפגשים ששותפו":"Shared session updates")');
    const layout=readFileSync(new URL("../../src/app/[locale]/client/layout.tsx",import.meta.url),"utf8");
    expect(layout).toContain('requireWorkspaceRoles(["adult_client","child"])');
    expect(layout).toContain('error.code==="UNAUTHENTICATED"');
    expect(layout).toContain('error.code==="FORBIDDEN"');
    expect(layout).not.toContain("PrivateWorkspaceUnavailable");
    for(const path of ["../../src/app/[locale]/client/page.tsx","../../src/app/[locale]/client/practice/page.tsx","../../src/app/[locale]/client/messages/page.tsx"]){
      const source=readFileSync(new URL(path,import.meta.url),"utf8");
      expect(source).toContain('requireWorkspaceRoles(["adult_client","child"])');
      expect(source).toContain('role={session.role}');
    }
  });
  it("returns an expired practitioner session to the requested Calendar or People context",()=>{
    const calendar=practitionerReturnPath("he","calendar",{date:"2026-09-27",view:"week",caseId:"11111111-1111-4111-8111-111111111111",context:"client"});
    expect(calendar).toBe("/he/app/calendar?date=2026-09-27&view=week&caseId=11111111-1111-4111-8111-111111111111&context=client");
    expect(new URL(loginHref("he",calendar),"https://life-skills.invalid").searchParams.get("next")).toBe(calendar);
    expect(loginReturnDestination("he","practitioner",calendar)).toBe(calendar);
    const people=practitionerReturnPath("en","clients",{section:"paid",filter:"booking"});
    expect(loginReturnDestination("en","practitioner",people)).toBe("/en/app/clients?section=paid&filter=booking");
    const pageTwo=practitionerReturnPath("en","clients",{section:"prospects",page:"2",search:"synthetic",language:"he",due:"overdue"});
    expect(loginReturnDestination("en","practitioner",pageTwo)).toBe("/en/app/clients?section=prospects&page=2&search=synthetic&language=he&due=overdue");
  });
  it("sends a signed-out parent to login without disguising forbidden access or outages",()=>{
    const layout=readFileSync(new URL("../../src/app/[locale]/family/layout.tsx",import.meta.url),"utf8");
    expect(layout).toContain('requireWorkspaceRole("parent")');
    expect(layout).toContain('error.code === "UNAUTHENTICATED"');
    expect(layout).toContain('redirect(loginHref(locale, loginReturnDestination(locale, "parent", requested)!))');
    expect(layout).toContain('error.code === "FORBIDDEN"');
    expect(layout).toContain('error.code === "NOT_FOUND"');
    expect(layout).toContain('throw error');
    expect(layout).not.toContain("PrivateWorkspaceUnavailable");
    expect(loginReturnDestination("en","parent","/en/family/schedule?view=week")).toBe("/en/family/schedule?view=week");
    const schedule=parentReturnPath("en","/en/family/schedule",{date:"2026-09-27",view:"week",caseId:"11111111-1111-4111-8111-111111111111",unknown:"private"});
    expect(schedule).toBe("/en/family/schedule?caseId=11111111-1111-4111-8111-111111111111&date=2026-09-27&view=week");
    expect(loginReturnDestination("en","parent",schedule)).toBe(schedule);
    expect(loginReturnDestination("en","parent","/en/family")).toBe("/en/family");
    expect(parentReturnPath("en","/en/app/calendar",{view:"week"})).toBe("/en/family/schedule");
    expect(parentReturnPath("he","/he/family/schedule",{view:"bad",date:"bad",caseId:"not-an-id"})).toBe("/he/family/schedule");
    const proxy=readFileSync(new URL("../../src/proxy.ts",import.meta.url),"utf8");
    expect(proxy).toContain('inbound.delete("x-ls-parent-return")');
    expect(proxy).toContain('inbound.set("x-ls-parent-return", parentReturnPath(');
  });
  it("rejects cross-origin, cross-role, cross-locale and malformed login returns",()=>{
    for(const value of ["//evil.example/en/app", "https://evil.example/en/app", "/en/family", "/he/app/calendar", "/en/app/../family", "/en/app\\calendar", "/en/app/calendar#token", "/en/app/%2e%2e/family"]){
      expect(loginReturnDestination("en","practitioner",value)).toBe("/en/app/calendar");
    }
    expect(loginReturnDestination("en","parent","/en/app/clients")).toBe("/en/family/schedule");
    expect(loginReturnDestination("en","adult_client","/en/client/calendar?view=week")).toBe("/en/client/calendar?view=week");
    expect(loginReturnDestination("en","child","/en/client/calendar")).toBe("/en/client/calendar");
    expect(loginReturnDestination("en","child","/en/family")).toBe("/en/client");
  });
  it("forwards only known deep-link parameters and gates People and Calendar before client rendering",()=>{
    expect(practitionerReturnPath("en","clients",{section:"active",filter:"today",other:"private"})).toBe("/en/app/clients?section=active&filter=today");
    const focused=practitionerReturnPath("en","clients",{section:"prospects",leadId:"LS-LEAD-synthetic-one"});
    expect(loginReturnDestination("en","practitioner",focused)).toBe("/en/app/clients?section=prospects&leadId=LS-LEAD-synthetic-one");
    expect(practitionerReturnPath("en","calendar",{date:"not-a-date",view:"unknown",caseId:"not-an-id"})).toBe("/en/app/calendar");
    for(const path of ["../../src/app/[locale]/app/calendar/page.tsx","../../src/app/[locale]/app/clients/page.tsx"]){
      const source=readFileSync(new URL(path,import.meta.url),"utf8");
      expect(source).toContain("UNAUTHENTICATED");
      expect(source).toMatch(/loginHref\(locale,\s*returnPath\)/);
      expect(source).toContain("notFound()");
    }
    const layout=readFileSync(new URL("../../src/app/[locale]/app/layout.tsx",import.meta.url),"utf8");
    const proxy=readFileSync(new URL("../../src/proxy.ts",import.meta.url),"utf8");
    expect(layout).toContain('error.code === "UNAUTHENTICATED"');
    expect(layout).toContain('redirect(loginHref(locale, loginReturnDestination(locale, "practitioner", requested)!))');
    expect(layout).not.toContain("PrivateWorkspaceUnavailable");
    expect(proxy).toContain('inbound.delete("x-ls-practitioner-return")');
    expect(proxy).toContain('["section", "filter", "leadId", "personId", "mode", "page", "search", "stage", "language", "due"]');
    expect(proxy).toContain('values.length === 1 ? values[0] : undefined');
    expect(proxy).toContain('inbound.set("x-ls-practitioner-return", practitionerReturnPath(locale, page, query))');
    const personId="00000000-0000-4000-8000-000000000001";
    expect(practitionerReturnPath("he","clients",{personId,mode:"demo",role:"parent",unknown:"private"})).toBe(`/he/app/clients?personId=${personId}&mode=demo`);
    expect(practitionerReturnPath("he","clients",{personId:[personId,personId],mode:["demo","live"]})).toBe("/he/app/clients");
    expect(practitionerReturnPath("he","clients",{personId:"../../private",mode:"practitioner"})).toBe("/he/app/clients");
    expect(practitionerReturnPath("en","clients",{page:"0",search:"x".repeat(201),stage:"line\nbreak",language:"other",due:"tomorrow"})).toBe("/en/app/clients");
  });
  for (const locale of ["he", "en"] as const) {
    it(`${locale}: uses the approved local logo and an accessible password visibility control`,()=>{
      const html=renderToStaticMarkup(React.createElement(LoginClient,{locale}));
      expect(html).toContain('src="/intake-brand/life-skills-logo.png"');
      expect(html).toContain('autoComplete="current-password"');
      expect(html).toContain('type="button" aria-controls="login-password" aria-pressed="false"');
      expect(html).not.toContain("❧");
    });
  }
});
