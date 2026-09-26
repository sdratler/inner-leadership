import React from "react";
import {readFileSync} from "node:fs";
import {renderToStaticMarkup} from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { destinationForRole, LoginClient } from "../../src/features/identity/login-client.tsx";
import { loginHref, loginReturnDestination, practitionerReturnPath } from "../../src/features/identity/login-return.ts";

vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));

describe("shared private-app sign-in destination", () => {
  it("routes each enabled account type to its own workspace", () => {
    expect(destinationForRole("he", "practitioner")).toBe("/he/app");
    expect(destinationForRole("en", "parent")).toBe("/en/family");
    expect(destinationForRole("he", "adult_client")).toBe("/he/client");
  });
  it("does not introduce independent student access", () => {
    expect(destinationForRole("en", "child")).toBeNull();
  });
  it("returns an expired practitioner session to the requested Calendar or People context",()=>{
    const calendar=practitionerReturnPath("he","calendar",{date:"2026-09-27",view:"week",caseId:"11111111-1111-4111-8111-111111111111",context:"client"});
    expect(calendar).toBe("/he/app/calendar?date=2026-09-27&view=week&caseId=11111111-1111-4111-8111-111111111111&context=client");
    expect(new URL(loginHref("he",calendar),"https://life-skills.invalid").searchParams.get("next")).toBe(calendar);
    expect(loginReturnDestination("he","practitioner",calendar)).toBe(calendar);
    const people=practitionerReturnPath("en","clients",{section:"paid",filter:"booking"});
    expect(loginReturnDestination("en","practitioner",people)).toBe("/en/app/clients?section=paid&filter=booking");
  });
  it("rejects cross-origin, cross-role, cross-locale and malformed login returns",()=>{
    for(const value of ["//evil.example/en/app", "https://evil.example/en/app", "/en/family", "/he/app/calendar", "/en/app/../family", "/en/app\\calendar", "/en/app/calendar#token", "/en/app/%2e%2e/family"]){
      expect(loginReturnDestination("en","practitioner",value)).toBe("/en/app");
    }
    expect(loginReturnDestination("en","parent","/en/app/clients")).toBe("/en/family");
    expect(loginReturnDestination("en","adult_client","/en/client/calendar?view=week")).toBe("/en/client/calendar?view=week");
    expect(loginReturnDestination("en","child","/en/client/calendar")).toBeNull();
  });
  it("forwards only known deep-link parameters and gates People and Calendar before client rendering",()=>{
    expect(practitionerReturnPath("en","clients",{section:"active",filter:"today",other:"private"})).toBe("/en/app/clients?section=active&filter=today");
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
    expect(proxy).toContain('inbound.set("x-ls-practitioner-return", practitionerReturnPath(locale, page, query))');
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
