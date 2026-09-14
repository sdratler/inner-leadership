import { describe, expect, it } from "vitest";
import { asId } from "../../src/lib/ids.ts";
import { Ls050HttpBoundary } from "../../src/features/forms/http-boundary.ts";

const token = "a".repeat(43);
const csrf = "b".repeat(43);
const actor = Object.freeze({
  id: asId("10000000-0000-4000-8000-000000000001", "account"),
  workspaceId: asId("10000000-0000-4000-8000-000000000002", "workspace"),
  personId: asId("10000000-0000-4000-8000-000000000003", "person"),
  role: "parent" as const,
  state: "active" as const,
  locale: "en" as const,
  sessionDigest: "f".repeat(64),
  expiresAt: Date.now() + 60_000,
});

function boundary() {
  const audit: unknown[] = [];
  const result = new Ls050HttpBoundary({
    config: {
      enabled: true,
      origin: "https://app.example.invalid",
      workspaceId: actor.workspaceId,
      csrfKey: Buffer.alloc(32, 1),
      lookupKey: Buffer.alloc(32, 2),
      rateLimitKey: "rate-limit-private-key-material-0123456789",
      keyring: { activeKeyId: "v1", keys: { v1: Buffer.alloc(32, 3) } },
      sessionSeconds: 3600,
    },
    sessions: { async actor(value: string) { if (value !== token) throw new Error("bad token"); return actor; }, csrf() { return csrf; } },
    limits: { async consume() { return { count: 1, retryAfterMs: 0 }; } },
    audit: { async write(event) { audit.push(event); } },
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
  });
  return { result, audit };
}

describe("LS-050 protected HTTP boundary", () => {
  it("derives actor from the session and applies private security headers", async () => {
    const { result } = boundary();
    const response = await result.handle(new Request("https://app.example.invalid/api/forms/templates?locale=en", {
      headers: { cookie: `__Host-ls-session=${token}` },
    }), ["GET"], async (received) => ({ data: { accountId: received.id } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { accountId: actor.id } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("rejects missing and duplicate session cookies", async () => {
    const { result } = boundary();
    const missing = await result.handle(new Request("https://app.example.invalid/api/forms/templates"), ["GET"], async () => ({ data: {} }));
    const duplicate = await result.handle(new Request("https://app.example.invalid/api/forms/templates", { headers: { cookie: `__Host-ls-session=${token}; __Host-ls-session=${token}` } }), ["GET"], async () => ({ data: {} }));
    expect(missing.status).toBe(401);
    expect(duplicate.status).toBe(401);
  });

  it("requires exact same-origin and CSRF for mutations", async () => {
    const { result } = boundary();
    const base = { method: "POST", headers: { cookie: `__Host-ls-session=${token}`, "content-type": "application/json" }, body: "{}" };
    const noOrigin = await result.handle(new Request("https://app.example.invalid/api/forms/templates", base), ["POST"], async () => ({ data: {} }));
    const noCsrf = await result.handle(new Request("https://app.example.invalid/api/forms/templates", { ...base, headers: { ...base.headers, origin: "https://app.example.invalid" } }), ["POST"], async () => ({ data: {} }));
    const valid = await result.handle(new Request("https://app.example.invalid/api/forms/templates", { ...base, headers: { ...base.headers, origin: "https://app.example.invalid", "x-csrf-token": csrf } }), ["POST"], async () => ({ data: { accepted: true }, status: 201 }));
    expect(noOrigin.status).toBe(403);
    expect(noCsrf.status).toBe(403);
    expect(valid.status).toBe(201);
  });

  it("rejects an unregistered method before dispatch", async () => {
    const { result } = boundary();
    let called = false;
    const response = await result.handle(new Request("https://app.example.invalid/api/forms/templates", { headers: { cookie: `__Host-ls-session=${token}` } }), ["POST"], async () => { called = true; return { data: {} }; });
    expect(response.status).toBe(404);
    expect(called).toBe(false);
  });
});
