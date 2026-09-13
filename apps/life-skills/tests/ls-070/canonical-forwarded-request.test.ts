import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.ts";
import { canonicalForwardedRequest } from "../../src/features/integration/canonical-forwarded-request.ts";

const configuredOrigin = "https://private.life-skills.example:3446";

describe("LS-070 canonical forwarded request", () => {
  it("restores the configured public HTTPS origin without changing the path or query", () => {
    const request = new Request("http://127.0.0.1:3104/api/identity/session?continue=%2Fen%2Fapp", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "private.life-skills.example:3446" },
    });
    const canonical = canonicalForwardedRequest(request, configuredOrigin);
    expect(canonical.url).toBe("https://private.life-skills.example:3446/api/identity/session?continue=%2Fen%2Fapp");
  });

  it("preserves request method, headers, and body", async () => {
    const request = new Request("http://127.0.0.1:3104/api/identity/password-reset/complete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https", host: "private.life-skills.example:3446" },
      body: JSON.stringify({ token: "synthetic", password: "synthetic-long-password" }),
    });
    const canonical = canonicalForwardedRequest(request, configuredOrigin);
    expect(canonical.method).toBe("POST");
    expect(canonical.headers.get("content-type")).toBe("application/json");
    expect(await canonical.json()).toEqual({ token: "synthetic", password: "synthetic-long-password" });
  });

  it.each([
    ["http", "private.life-skills.example:3446"],
    ["https", "other.example:3446"],
    ["https,http", "private.life-skills.example:3446"],
    ["https", "private.life-skills.example:3446,other.example"],
  ])("fails closed for an untrusted forwarding pair", (protocol, host) => {
    const request = new Request("http://127.0.0.1:3104/api/identity/session", {
      headers: { "x-forwarded-proto": protocol, "x-forwarded-host": host },
    });
    expect(() => canonicalForwardedRequest(request, configuredOrigin)).toThrowError(AppError);
    try { canonicalForwardedRequest(request, configuredOrigin); } catch (error) {
      expect((error as AppError).code).toBe("UNAVAILABLE");
    }
  });
});
