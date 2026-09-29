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
describe("actual parent check-in deep-link proxy", () => {
  it("projects one bounded section and strips repeated or caller-supplied values", () => {
    const origin="https://life-skills.bneineviimacademy.org", id="123e4567-e89b-42d3-a456-426614174000";
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("LS_APP_MODE","foundation_locked");vi.stubEnv("LS_APP_ORIGIN",origin);vi.stubEnv("LS_PRIVATE_APP_ENABLED","true");
    const path=`/he/family/practice?caseId=${id}&audienceId=${id}`;
    const valid=proxy(new NextRequest(origin+path+"&section=checkins",{headers:{"x-ls-parent-return":"/he/family/settings"}}));
    expect(valid.headers.get("x-middleware-request-x-ls-parent-return")).toBe(path+"&section=checkins");
    for(const query of ["&section=checkins&section=checkins","&section=untrusted"]){
      const response=proxy(new NextRequest(origin+path+query));
      expect(response.headers.get("x-middleware-request-x-ls-parent-return")).toBe(path);
    }
  });
});
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
  it('derives exact reports/session login returns from the actual path, stripping caller headers and unrelated query',()=>{
    returned('');
    const id='123e4567-e89b-42d3-a456-426614174000';
    for(const path of ['/he/app/reports',`/he/app/cases/${id}/sessions`,`/he/app/cases/${id}/sessions/223e4567-e89b-42d3-a456-426614174000`]){
      const response=proxy(new NextRequest(`${origin}${path}?mode=demo&date=2026-09-22&view=day&secret=private`,{headers:{'x-ls-practitioner-return':'https://untrusted.invalid'}}));
      expect(response.headers.get('x-middleware-request-x-ls-practitioner-return')).toBe(path+'?mode=demo&date=2026-09-22&view=day');
    }
    const response=proxy(new NextRequest(`${origin}/he/app/marketing`,{headers:{'x-ls-practitioner-return':'/he/app/reports?mode=demo'}}));
    expect(response.headers.get('x-middleware-request-x-ls-practitioner-return')).toBeNull();
  });
});

describe("actual practice proxy validates transport before header rewriting", () => {
  const origin = "https://life-skills.bneineviimacademy.org";
  const paths = ["/api/goals", "/api/commitments", "/api/home-practice", "/api/checkins"];
  function configured() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LS_APP_MODE", "foundation_locked");
    vi.stubEnv("LS_APP_ORIGIN", origin);
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
  }
  it.each(paths)("admits a single canonical HTTPS forwarding chain: %s", path => {
    configured();
    const response = proxy(new NextRequest(`http://127.0.0.1:8080${path}`, { headers: {
      host: new URL(origin).host, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https",
    } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-forwarded-proto")).toBe("https");
    expect(response.headers.get("x-middleware-request-x-forwarded-host")).toBe(new URL(origin).host);
  });
  it.each(paths)("rejects invalid transport before it can become canonical: %s", async path => {
    configured();
    const valid = { host: new URL(origin).host, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https" };
    const invalid: Record<string, string>[] = [
      { ...valid, "x-forwarded-proto": "http" },
      { ...valid, "x-forwarded-proto": "https,http" },
      { ...valid, "x-forwarded-proto": "" },
      { ...valid, "x-forwarded-host": "evil.invalid" },
      { ...valid, "x-forwarded-host": `${new URL(origin).host},evil.invalid` },
      { ...valid, "x-forwarded-host": "" },
      { ...valid, host: "evil.invalid" },
      { ...valid, host: `${new URL(origin).host},evil.invalid` },
      { host: new URL(origin).host, "x-forwarded-host": new URL(origin).host },
      { host: new URL(origin).host },
      {},
    ];
    for (const headers of invalid) {
      const response = proxy(new NextRequest(`http://127.0.0.1:8080${path}`, { headers }));
      expect(response.status, JSON.stringify(headers)).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("x-middleware-override-headers")).toBeNull();
    }
  });
  it("preserves direct canonical requests and HTTPS proto plus canonical Host without a forwarded Host", () => {
    configured();
    for (const request of [new NextRequest(`${origin}/api/home-practice`),
      new NextRequest("http://127.0.0.1:8080/api/home-practice", { headers: { host: new URL(origin).host, "x-forwarded-proto": "https" } })])
      expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });
  it("does not manufacture HTTPS for a foundation HTTP loopback (not private authentication proof)", () => {
    configured(); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("LS_APP_ORIGIN", "http://127.0.0.1:3001");
    const response = proxy(new NextRequest("http://127.0.0.1:3001/api/home-practice", { headers: { host: "127.0.0.1:3001" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-forwarded-proto")).toBe("http");
  });
  it("rejects a fragment before the boundary can lose it", () => {
    configured();
    const response = proxy(new NextRequest(`${origin}/api/home-practice#untrusted`));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });
});
