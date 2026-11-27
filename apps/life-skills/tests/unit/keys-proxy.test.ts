import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { proxy } from "../../src/proxy.ts";

afterEach(() => vi.unstubAllEnvs());
it("preserves the named Keys destination through sign-in and drops untrusted query/header values", () => {
  const origin = "https://fishing.example.invalid";
  for (const [key, value] of Object.entries({ NODE_ENV: "production", LS_APP_MODE: "foundation_locked", LS_APP_ORIGIN: origin, LS_PRIVATE_APP_ENABLED: "true" })) vi.stubEnv(key, value);
  const header = "x-middleware-request-x-ls-practitioner-return";
  const reference = "123e4567-e89b-42d3-a456-426614174000";
  for (const locale of ["en", "he"]) {
    const path = `/${locale}/app/keys`;
    const request = (query: string) => new NextRequest(origin + path + query, { headers: { "x-ls-practitioner-return": "https://untrusted.invalid", "host": new URL(origin).host } });
    expect(proxy(request(`?reference=${reference}&secret=discard&role=parent`)).headers.get(header)).toBe(`${path}?reference=${reference}`);
    expect(proxy(request(`?reference=${reference}&reference=${reference}`)).headers.get(header)).toBe(path);
    expect(proxy(request("?reference=https://untrusted.invalid")).headers.get(header)).toBe(path);
  }
});
