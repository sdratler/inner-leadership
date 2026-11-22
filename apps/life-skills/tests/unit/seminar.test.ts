import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { seminar, seminarHasPassed, recipientDigits, seminarPublicPath, contactUrl, seminarInvitation } from "../../src/features/seminar/config.ts";
import { proxy } from "../../src/proxy.ts";

afterEach(() => vi.unstubAllEnvs());
describe("seminar public boundary", () => {
  it("admits only exact public seminar files/pages and safe methods, with data flags off", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("LS_APP_MODE", "foundation_locked"); vi.stubEnv("LS_APP_ORIGIN", "https://life-skills.bneineviimacademy.org"); vi.stubEnv("LS_PRIVATE_APP_ENABLED", "false");
    for (const path of ["/en/florida/seminar", seminar.flyer, seminar.qrPng, seminar.qrSvg]) {
      expect(seminarPublicPath(path, "GET")).toBe(true);
      expect(proxy(new NextRequest(`https://life-skills.bneineviimacademy.org${path}`)).status).toBe(200);
      expect(seminarPublicPath(path, "POST")).toBe(false);
    }
    for (const path of ["/en/florida/seminar/private", "/he/florida/seminar", "/seminar/secret.jpg", "/api/private/people", "/seminar/../private"]) expect(seminarPublicPath(path, "GET")).toBe(false);
    expect(proxy(new NextRequest("https://life-skills.bneineviimacademy.org/fish")).headers.get("location")).toBe("https://life-skills.bneineviimacademy.org/en/florida/seminar");
    expect(proxy(new NextRequest("http://localhost:8080/fish", { headers: { host: "life-skills.bneineviimacademy.org", "x-forwarded-proto": "https" } })).headers.get("location")).toBe("https://life-skills.bneineviimacademy.org/en/florida/seminar");
    expect(proxy(new NextRequest("https://life-skills.bneineviimacademy.org/fish", { method: "POST" })).status).toBe(405);
    expect(proxy(new NextRequest("https://life-skills.bneineviimacademy.org/api/private/people")).status).not.toBe(200);
  });
  it("retains the event until the end of the Florida date without inventing an end time", () => {
    expect(seminarHasPassed(new Date("2026-11-23T04:59:59Z"))).toBe(false);
    expect(seminarHasPassed(new Date("2026-11-23T05:00:00Z"))).toBe(true);
    expect(seminarHasPassed(new Date("2026-11-22T20:00:00Z"))).toBe(false);
  });
  it("builds the correct contact, page invitation and client-only recipient draft inputs", () => {
    expect(contactUrl()).toContain("https://wa.me/13054278909?text=");
    expect(new URL(contactUrl()).searchParams.get("text")).toBe("Hi Rabbi Shlomo, I saw the Bass Fishing Seminar flyer. Please send me the details.");
    expect(seminarInvitation()).toContain(seminar.publicUrl);
    expect(seminarInvitation(true)).toContain("next Bass Fishing Seminar");
    expect(recipientDigits("+1", "(305) 427-8909")).toBe("13054278909");
    expect(recipientDigits("+972", "52-123-4567")).toBe("972521234567");
    for (const [code, number] of [["+1", "abc3055550123"], ["+972", "0521234567"], ["0", "12345678"], ["+1", "123"], ["+1", "1234567890123456"]]) expect(recipientDigits(code!, number!)).toBeNull();
  });
});
