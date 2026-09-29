import { existsSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy, publicStaticAsset } from "../../src/proxy.ts";

describe("public static perimeter", () => {
  it("serves only the shipped app fonts via GET or HEAD", () => {
    for (const name of ["Heebo-wght.ttf", "FrankRuhlLibre-wght.ttf"]) {
      expect(existsSync(new URL(`../../public/fonts/${name}`, import.meta.url))).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "GET")).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "HEAD")).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "POST")).toBe(false);
    }
    for (const path of ["/fonts/other.ttf", "/fonts/private/Heebo-wght.ttf", "/fonts/../api/prospects", "/api/prospects"])
      expect(publicStaticAsset(path, "GET")).toBe(false);
  });
});

afterEach(() => vi.unstubAllEnvs());
describe("actual practitioner Calendar login return perimeter", () => {
  const origin = "https://life-skills.bneineviimacademy.org";
  function returned(query: string, supplied = "https://untrusted.invalid/private") {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LS_APP_MODE", "foundation_locked");
    vi.stubEnv("LS_APP_ORIGIN", origin);
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
    const response = proxy(new NextRequest(`${origin}/he/app/calendar${query}`, { headers: { "x-ls-practitioner-return": supplied } }));
    expect(response.status).toBe(200);
    return response.headers.get("x-middleware-request-x-ls-practitioner-return");
  }
  it("preserves an explicit DEMO mode with the actual bounded date/view context", () => {
    expect(returned("?date=2026-09-22&view=agenda&mode=demo&untrusted=private"))
      .toBe("/he/app/calendar?date=2026-09-22&view=agenda&mode=demo");
  });
  it.each(["?mode=demo&mode=live", "?mode=all", "?mode=parent", ""])("rejects unsafe mode and caller return headers: %s", query => {
    expect(returned(query)).toBe("/he/app/calendar");
  });
});
