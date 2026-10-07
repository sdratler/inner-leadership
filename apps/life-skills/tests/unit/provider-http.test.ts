import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { handleProviderRequest } from "../../src/features/provider-index/server/http.ts";

describe("R35 provider HTTP transport boundary", () => {
  beforeEach(() => vi.stubEnv("LS_APP_ORIGIN", "https://life-skills.example.test"));

  it.each(["directory", "referrals"] as const)("rejects an untrusted forwarded host before identity or data access: %s", async surface => {
    const response = await handleProviderRequest(new Request(`http://127.0.0.1:3125/api/provider-${surface === "directory" ? "index" : "referrals"}`, {
      method: "POST",
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "untrusted.example.test" },
      body: "{}",
    }), surface);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
  });

  it("validates method and query only after rebuilding the canonical request", async () => {
    const response = await handleProviderRequest(new Request("http://127.0.0.1:3125/api/provider-index?private=leak", {
      method: "POST",
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "life-skills.example.test" },
      body: "{}",
    }), "directory");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });
});
