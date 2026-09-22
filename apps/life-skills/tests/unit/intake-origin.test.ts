import { describe, expect, it } from "vitest";
import { intakePublicOrigin, intakeStaffEntry, verifyIntakeMutationOrigin } from "../../src/features/forms/pre-enrollment/public-origin.ts";
const old = "https://original.example.test", branded = "https://intake.example.test";
const config = { NODE_ENV: "production", LS_APP_MODE: "foundation_locked", LS_APP_ORIGIN: old, LS_INTAKE_PUBLIC_ORIGIN: branded };
const get = (url: string) => new Request(url, { headers: { Host: new URL(url).host } });
const post = (origin: string, header = origin, site = "same-origin", path = "/api/intake") => new Request(origin + path, { method: "POST", headers: { Host: new URL(origin).host, Origin: header, "Sec-Fetch-Site": site } });
describe("parent-only branded intake origin", () => {
  it("defaults to the original origin and accepts both old and new same-origin requests", () => {
    expect(intakePublicOrigin({ ...config, LS_INTAKE_PUBLIC_ORIGIN: undefined })).toBe(old);
    expect(intakePublicOrigin(config)).toBe(branded);
    expect(() => verifyIntakeMutationOrigin(post(old), config)).not.toThrow();
    expect(() => verifyIntakeMutationOrigin(post(branded), config)).not.toThrow();
  });
  it.each(["http://intake.example.test", "https://user:pass@intake.example.test", branded + "/intake", branded + "?x=1", branded + "#token", "https://*.example.test", "https://intake.example.test:8443", "invalid"])("rejects malformed public configuration %s", value => {
    expect(() => intakePublicOrigin({ ...config, LS_INTAKE_PUBLIC_ORIGIN: value })).toThrow();
  });
  it("rejects cross-origin, unknown-host, missing-origin, cross-site and non-parent-route writes", () => {
    for (const request of [post(old, branded), post(branded, old), post("https://evil.example.test"), post(old, ""), post(branded, branded, "cross-site"), post(branded, branded, "same-origin", "/api/identity/login"), post(branded, branded, "same-origin", "/api/intake?token=x")]) {
      expect(() => verifyIntakeMutationOrigin(request, config)).toThrow();
    }
    expect(() => verifyIntakeMutationOrigin(new Request(branded + "/api/intake"), config)).toThrow();
    expect(() => verifyIntakeMutationOrigin(new Request(branded + "/api/intake", { method: "POST", headers: { Origin: branded } }), config)).toThrow();
    expect(() => verifyIntakeMutationOrigin(post(branded), { ...config, LS_INTAKE_PUBLIC_ORIGIN: undefined })).toThrow();
  });
  it("keeps owner sign-in on the unchanged identity origin without redirecting parent links or API bodies", () => {
    expect(intakeStaffEntry(get(branded + "/"), config)?.href).toBe(old + "/en/intake/staff");
    expect(intakeStaffEntry(get(old + "/"), config)?.href).toBe(old + "/en/intake/staff");
    expect(intakeStaffEntry(get(branded + "/he/intake/staff?mode=invite"), config)?.href).toBe(old + "/he/intake/staff?mode=invite");
    for (const url of [old + "/en/intake/staff", old + "/he/intake", branded + "/en/intake", branded + "/en/intake/staff?token=x", "https://evil.example.test/"]) {
      expect(intakeStaffEntry(get(url), config)).toBeNull();
    }
    expect(intakeStaffEntry(post(branded), config)).toBeNull();
    expect(intakeStaffEntry(new Request(branded + "/", { method: "POST" }), config)).toBeNull();
  });
  it("supports the Next internal listen URL but rejects missing, unknown or forwarded-only hosts", () => {
    const headers = { Host: new URL(branded).host, Origin: branded, "Sec-Fetch-Site": "same-origin" };
    expect(() => verifyIntakeMutationOrigin(new Request("http://0.0.0.0:8080/api/intake", { method: "POST", headers }), config)).not.toThrow();
    expect(intakeStaffEntry(new Request("http://0.0.0.0:8080/", { headers }), config)?.href).toBe(old + "/en/intake/staff");
    for (const host of ["", "evil.example.test", "intake.example.test.evil.test", "intake.example.test:8080", "intake.example.test,evil.test"]) {
      const request = new Request("http://0.0.0.0:8080/api/intake", { method: "POST", headers: { ...headers, Host: host, "X-Forwarded-Host": new URL(branded).host, "X-Forwarded-Proto": "https" } });
      expect(() => verifyIntakeMutationOrigin(request, config)).toThrow();
    }
  });
});
