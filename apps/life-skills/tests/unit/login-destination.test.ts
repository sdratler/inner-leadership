import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { destinationForRole, LoginClient } from "../../src/features/identity/login-client.tsx";

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
