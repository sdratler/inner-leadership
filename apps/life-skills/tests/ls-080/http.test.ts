import { describe, expect, it, vi } from "vitest";
import { asId } from "../../src/lib/ids.ts";
import type { AuditSink } from "../../src/lib/audit.ts";
import type { RateLimitStore } from "../../src/lib/security/rate-limit.ts";
import type { IdentityConfig } from "../../src/features/identity/config.ts";
import type { IdentitySessions } from "../../src/features/identity/session-adapter.ts";
import type { Actor, IdentityClock } from "../../src/features/identity/types.ts";
import { Ls080Http } from "../../src/features/updates/http.ts";
import type { UpdateService } from "../../src/features/updates/service.ts";

const uuid = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workspaceId = asId(uuid(1), "workspace");
const actor: Actor = {
  id: asId(uuid(2), "account"), workspaceId, personId: asId(uuid(3), "person"), role: "parent", state: "active", locale: "en",
  sessionDigest: "a".repeat(64), expiresAt: Date.parse("2026-09-11T15:00:00.000Z"),
};
const config: IdentityConfig = {
  enabled: true, origin: "https://app.example.test", workspaceId,
  csrfKey: Buffer.alloc(32, 1), lookupKey: Buffer.alloc(32, 2), rateLimitKey: "3".repeat(64),
  keyring: { activeKeyId: "test", keys: { test: Buffer.alloc(32, 4) } }, sessionSeconds: 28_800,
};
const clock: IdentityClock = { now: () => new Date("2026-09-11T14:40:00.000Z") };
const token = "t".repeat(43), csrf = "c".repeat(43);

function makeFixture(count = 1) {
  const list = vi.fn(async () => []);
  const sessions = { actor: vi.fn(async () => actor), csrf: vi.fn(() => csrf) } as unknown as IdentitySessions;
  const limits: RateLimitStore = { consume: vi.fn(async () => ({ count, retryAfterMs: 1_000 })) };
  const audit: AuditSink = { write: vi.fn(async () => undefined) };
  const updates = { list } as unknown as UpdateService;
  return { http: new Ls080Http(config, clock, { sessions, limits, audit, updates }), list, audit };
}

describe("LS-080 HTTP boundary", () => {
  it("accepts only the exact configured origin and route", async () => {
    const fixture = makeFixture();
    const response = await fixture.http.handle(new Request(`https://evil.example/api/updates?caseId=${uuid(4)}&audienceId=${uuid(5)}`, { headers: { cookie: `__Host-ls-session=${token}` } }));
    expect(response.status).toBe(404);
    expect(fixture.list).not.toHaveBeenCalled();
  });

  it("requires exact GET query keys", async () => {
    const fixture = makeFixture();
    const response = await fixture.http.handle(new Request(`https://app.example.test/api/updates?caseId=${uuid(4)}&audienceId=${uuid(5)}&actor=${uuid(2)}`, { headers: { cookie: `__Host-ls-session=${token}` } }));
    expect(response.status).toBe(400);
    expect(fixture.list).not.toHaveBeenCalled();
  });

  it("requires same-origin mutation and the session CSRF secret", async () => {
    const fixture = makeFixture();
    const response = await fixture.http.handle(new Request("https://app.example.test/api/updates", {
      method: "POST", headers: { cookie: `__Host-ls-session=${token}`, "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ action: "review", reportId: uuid(6) }),
    }));
    expect(response.status).toBe(403);
    expect(fixture.audit.write).toHaveBeenCalledTimes(1);
  });

  it("enforces the durable rate counter before feature access", async () => {
    const fixture = makeFixture(121);
    const response = await fixture.http.handle(new Request(`https://app.example.test/api/updates?caseId=${uuid(4)}&audienceId=${uuid(5)}`, { headers: { cookie: `__Host-ls-session=${token}` } }));
    expect(response.status).toBe(429);
    expect(fixture.list).not.toHaveBeenCalled();
  });

  it("returns private no-store and hardening headers", async () => {
    const fixture = makeFixture();
    const response = await fixture.http.handle(new Request(`https://app.example.test/api/updates?caseId=${uuid(4)}&audienceId=${uuid(5)}`, { headers: { cookie: `__Host-ls-session=${token}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
