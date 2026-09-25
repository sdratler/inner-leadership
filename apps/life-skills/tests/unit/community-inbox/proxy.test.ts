import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../../../src/proxy.ts";

const origin = "https://life-skills.bneineviimacademy.org";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LS_APP_ORIGIN", origin);
  vi.stubEnv("LS_APP_MODE", "foundation_locked");
  vi.stubEnv("LS_PRIVATE_APP_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("captured post inbox remains inside the private app perimeter", () => {
  it("blocks the endpoint before route authentication when the private app is disabled", () => {
    const response = proxy(new NextRequest(`${origin}/api/community-posts?status=all`));
    expect(response.status).toBe(503);
    expect(response.headers.has("x-middleware-next")).toBe(false);
  });
  it("forwards the endpoint to practitioner session checks when the private app is enabled", () => {
    vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
    const response = proxy(new NextRequest(`${origin}/api/community-posts?status=ready`));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
