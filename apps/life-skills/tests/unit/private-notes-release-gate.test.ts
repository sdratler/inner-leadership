import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { intakeReleasePath, proxy } from "../../src/proxy.ts";

const localOrigin = "http://127.0.0.1:3001";
const isolatedOrigin = "https://private-app.example.test";
const previewServiceOrigin = "https://private-app-preview.example.test";
const isolatedKey = "synthetic_private_notes_preview_key_1234567890";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LS_APP_ORIGIN", localOrigin);
  vi.stubEnv("LS_APP_MODE", "foundation_locked");
  vi.stubEnv("LS_PRIVATE_APP_ENABLED", "false");
  vi.stubEnv("LS_IDENTITY_ENABLED", "false");
  vi.stubEnv("LS_INTAKE_REAL_DATA_RELEASE", "false");
  vi.stubEnv("LS_INTAKE_SYNTHETIC_LOOPBACK", "false");
  vi.stubEnv("LS_PREVIEW_ACCESS_KEY", "");
  vi.stubEnv("LS_DATABASE_URL", "");
  vi.stubEnv("LS_MIGRATION_DATABASE_URL", "");
});
afterEach(() => { vi.unstubAllEnvs(); });

function request(path: string, method = "GET", isolated = false) {
  return new NextRequest(`${isolated ? previewServiceOrigin : localOrigin}${path}`, {
    method,
    ...(isolated ? { headers: { authorization: `Basic ${Buffer.from(`preview:${isolatedKey}`).toString("base64")}` } } : {}),
  });
}

// Passing this proxy is not authorization. The existing HTTP boundary and
// practitioner/case checks remain responsible for every real request.
describe("private-notes API obeys the private-app release gate", () => {
  for (const mode of ["foundation_locked", "foundation_preview"] as const) {
    for (const method of ["GET", "POST"]) {
      it(`${mode} ${method}: denies notes when the private app is off`, async () => {
        vi.stubEnv("LS_APP_MODE", mode);
        const response = proxy(request("/api/private-notes", method));
        expect(response.status).toBe(503);
        expect((await response.json()).error.code).toBe("UNAVAILABLE");
        expect(response.headers.get("cache-control")).toContain("no-store");
      });
      it(`${mode} ${method}: forwards to the existing notes boundary only when opted in`, () => {
        vi.stubEnv("LS_APP_MODE", mode);
        vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
        const response = proxy(request("/api/private-notes", method));
        expect(response.status).toBe(200);
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.get("x-frame-options")).toBe("DENY");
      });
    }
  }
  it("an absent private-app flag does not grant access", () => {
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", undefined);
    expect(proxy(request("/api/private-notes")).status).toBe(503);
  });
  it("isolated preview still requires Basic authentication", () => {
    vi.stubEnv("LS_APP_MODE", "isolated_preview");
    vi.stubEnv("LS_APP_ORIGIN", isolatedOrigin);
    vi.stubEnv("LS_PREVIEW_ACCESS_KEY", isolatedKey);
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
    expect(proxy(new NextRequest(`${previewServiceOrigin}/api/private-notes`)).status).toBe(401);
  });
  for (const enabled of ["false", "true"]) {
    it(`isolated preview: valid Basic credentials do not replace private-app flag ${enabled}`, () => {
      vi.stubEnv("LS_APP_MODE", "isolated_preview");
      vi.stubEnv("LS_APP_ORIGIN", isolatedOrigin);
      vi.stubEnv("LS_PREVIEW_ACCESS_KEY", isolatedKey);
      vi.stubEnv("LS_PRIVATE_APP_ENABLED", enabled);
      const response = proxy(request("/api/private-notes", "GET", true));
      expect(response.status).toBe(enabled === "true" ? 200 : 503);
      expect(response.headers.get("x-middleware-next")).toBe(enabled === "true" ? "1" : null);
    });
  }
  it("uses real identity and role boundaries on the registered custom origin without exposing the synthetic preview", () => {
    vi.stubEnv("LS_APP_MODE", "isolated_preview");
    vi.stubEnv("LS_APP_ORIGIN", isolatedOrigin);
    vi.stubEnv("LS_PREVIEW_ACCESS_KEY", isolatedKey);
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
    const privateResponse = proxy(new NextRequest(`${isolatedOrigin}/api/private-notes`));
    expect(privateResponse.status).toBe(200);
    expect(privateResponse.headers.get("x-middleware-next")).toBe("1");
    expect(privateResponse.headers.get("www-authenticate")).toBeNull();
    expect(proxy(new NextRequest(`${isolatedOrigin}/he/preview`)).status).toBe(404);
    const root = proxy(new NextRequest(`${isolatedOrigin}/`));
    expect(root.status).toBe(307);
    expect(root.headers.get("location")).toBe(`${isolatedOrigin}/he/app`);
  });
  it("does not add private notes to the limited intake-release allowlist", () => {
    expect(intakeReleasePath("/api/private-notes", {})).toBe(false);
  });
  it("does not classify lookalike paths as the private-notes endpoint", () => {
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
    for (const path of ["/api/private-notes-export", "/api/private-notes/other", "/api/private-note"]) {
      expect(proxy(request(path)).status).toBe(503);
    }
  });
  it("keeps existing private routes closed with the private app off", () => {
    for (const path of ["/api/forms", "/api/resources", "/api/progress", "/en/app", "/he/app"]) {
      expect(proxy(request(path)).status).toBe(503);
    }
  });
  it("keeps liveness public without opening private routes", () => {
    expect(proxy(request("/api/health")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/private-notes")).status).toBe(503);
  });
});
