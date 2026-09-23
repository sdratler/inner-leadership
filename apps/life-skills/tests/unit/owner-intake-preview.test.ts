import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ownerPreviewConfig, ownerPreviewExchange } from "../../src/features/forms/pre-enrollment/owner-preview.ts";
import { proxy } from "../../src/proxy.ts";

const one = "A".repeat(43), two = "B".repeat(43), now = new Date("2030-01-01T00:00:00.000Z");
const previewServiceOrigin = "https://preview-service.example.test";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function environment(overrides: Record<string, string | undefined> = {}) { return { LS_APP_MODE: "isolated_preview", LS_APP_ORIGIN: "https://preview.example.test", LS_OWNER_INTAKE_PREVIEW_CONFIG: JSON.stringify({ expiresAt: "2030-01-01T12:00:00.000Z", tokens: [{ hash: hash(one), childCount: 1 }, { hash: hash(two), childCount: 2 }] }), ...overrides }; }
function applyPreviewEnvironment(config = true) { const currentConfig = JSON.stringify({ expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), tokens: [{ hash: hash(one), childCount: 1 }, { hash: hash(two), childCount: 2 }] }); const env = environment({ LS_OWNER_INTAKE_PREVIEW_CONFIG: config ? currentConfig : undefined }); for (const [key, value] of Object.entries({ ...env, LS_PREVIEW_ACCESS_KEY: "a".repeat(32), NODE_ENV: "production" })) vi.stubEnv(key, value); }
afterEach(() => vi.unstubAllEnvs());

describe("owner intake preview", () => {
  it("exchanges only the two configured fragment tokens for opaque 1/2-child slots", () => {
    expect(ownerPreviewExchange(environment(), one, now)?.childSlotIds).toHaveLength(1);
    expect(ownerPreviewExchange(environment(), two, now)?.childSlotIds).toHaveLength(2);
    expect(ownerPreviewExchange(environment(), "C".repeat(43), now)).toBeNull();
    expect(ownerPreviewExchange(environment(), "short", now)).toBeNull();
  });
  it("closes for expiry, invalid config, non-preview mode, and non-HTTPS origin", () => {
    expect(ownerPreviewConfig(environment({ LS_OWNER_INTAKE_PREVIEW_CONFIG: JSON.stringify({ expiresAt: "2029-12-31T23:59:59.000Z", tokens: [{ hash: hash(one), childCount: 1 }, { hash: hash(two), childCount: 2 }] }) }), now)).toBeNull();
    expect(ownerPreviewConfig(environment({ LS_APP_MODE: "foundation_locked" }), now)).toBeNull();
    expect(ownerPreviewConfig(environment({ LS_APP_ORIGIN: "http://preview.example.test" }), now)).toBeNull();
    expect(ownerPreviewConfig(environment({ LS_OWNER_INTAKE_PREVIEW_CONFIG: JSON.stringify({ expiresAt: "2030-01-01T12:00:00.000Z", tokens: [{ hash: hash(one), childCount: 1 }, { hash: hash(two), childCount: 1 }] }) }), now)).toBeNull();
    expect(ownerPreviewConfig(environment({ LS_OWNER_INTAKE_PREVIEW_CONFIG: JSON.stringify({ expiresAt: "2030-01-01T12:00:00.000Z", tokens: [{ hash: hash(one), childCount: 1 }, { hash: hash(one), childCount: 2 }] }) }), now)).toBeNull();
  });
  it("keeps test-preview submit browser-only", async () => {
    const client = await readFile("src/features/forms/pre-enrollment/client.tsx", "utf8");
    const branch = client.slice(client.indexOf("if (testPreview) {"), client.indexOf("idempotencyKey.current"));
    expect(branch).not.toContain("fetch(");
    expect(branch).toContain("בדיקה הושלמה — המידע לא נשלח ולא נשמר");
  });
  it("forwards only a valid configured owner preview page and exchange without Basic auth", () => {
    applyPreviewEnvironment();
    for (const request of [new NextRequest("https://preview.example.test/he/preview/intake"), new NextRequest("https://preview.example.test/api/intake-preview", { method: "POST" })]) {
      const response = proxy(request); expect(response.status).toBe(200); expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });
  it("retains Basic protection elsewhere and closes an absent config", () => {
    applyPreviewEnvironment();
    expect(proxy(new NextRequest(`${previewServiceOrigin}/he/preview`)).status).toBe(401);
    expect(proxy(new NextRequest(`${previewServiceOrigin}/api/payments`)).status).toBe(401);
    vi.unstubAllEnvs(); applyPreviewEnvironment(false);
    expect(proxy(new NextRequest("https://preview.example.test/he/preview/intake")).status).toBe(404);
    expect(proxy(new NextRequest("https://preview.example.test/api/intake-preview", { method: "POST" })).status).toBe(404);
  });
  it("opens only the four public brand assets, not arbitrary files or mutations", () => {
    applyPreviewEnvironment(false);
    for (const asset of ["life-skills-logo.png", "bna-logo.png", "Heebo-wght.ttf", "FrankRuhlLibre-wght.ttf"]) {
      expect(proxy(new NextRequest(`https://preview.example.test/intake-brand/${asset}`)).headers.get("x-middleware-next")).toBe("1");
    }
    expect(proxy(new NextRequest(`${previewServiceOrigin}/intake-brand/private.json`)).status).toBe(401);
    expect(proxy(new NextRequest(`${previewServiceOrigin}/intake-brand/life-skills-logo.png`, { method: "POST" })).status).toBe(401);
  });
});
