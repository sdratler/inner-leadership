import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { asId } from "../../../src/lib/ids.ts";
import { SESSION_COOKIE } from "../../../src/lib/security/session.ts";
import { Ls040Http, type Ls040HttpServices } from "../../../src/features/home-practice/http.ts";
import { parseIdentityConfig, type IdentityConfig } from "../../../src/features/identity/config.ts";
import { systemClock, type Actor } from "../../../src/features/identity/types.ts";

const origin = "https://synthetic.example.invalid", token = "s".repeat(43), csrf = "c".repeat(43);
const caseId = asId("123e4567-e89b-42d3-a456-426614174000", "case");
const audienceId = asId("223e4567-e89b-42d3-a456-426614174000", "audience");
const occurrenceId = asId("323e4567-e89b-42d3-a456-426614174000", "occurrence");
const query = `?caseId=${caseId}&audienceId=${audienceId}`;
function runtimeInput(appOrigin: string): Record<string, string> {
  return { LS_IDENTITY_ENABLED: "true", LS_APP_ORIGIN: appOrigin, LS_IDENTITY_WORKSPACE_ID: randomUUID(),
    LS_IDENTITY_CSRF_KEY: randomBytes(32).toString("base64url"), LS_IDENTITY_LOOKUP_KEY: randomBytes(32).toString("base64url"),
    LS_IDENTITY_RATE_KEY: randomBytes(32).toString("base64url"), LS_IDENTITY_ACTIVE_KEY_ID: "synthetic",
    LS_IDENTITY_DATA_KEYS: JSON.stringify({ synthetic: randomBytes(32).toString("base64url") }) };
}

test.each(["http://127.0.0.1:3001", "http://localhost:3001", "http://[::1]:3001"])("private runtime remains HTTPS-only; foundation %s is not an authenticated configuration", appOrigin => {
  const input = runtimeInput(appOrigin);
  expect(parseIdentityConfig({ ...input, LS_APP_ORIGIN: "https://localhost:3001" }).origin).toBe("https://localhost:3001");
  expect(() => parseIdentityConfig(input)).toThrowError("UNAVAILABLE");
});

test("the actual private configuration accepts a local HTTPS origin and forwards its real authenticated request", async () => {
  const h = setup(), config = parseIdentityConfig(runtimeInput("https://localhost:3001"));
  const http = new Ls040Http(config, systemClock, { sessions: h.sessions, limits: h.limits, audit: h.audit,
    goals: h.goals, commitments: h.commitments, practice: h.practice, checkins: h.checkins } as unknown as Ls040HttpServices);
  const response = await http.handle(new Request("http://127.0.0.1:8080/api/home-practice" + query, {
    headers: { host: "localhost:3001", "x-forwarded-host": "localhost:3001", "x-forwarded-proto": "https", cookie: `${SESSION_COOKIE}=${token}` },
  }));
  expect(response.status).toBe(200); expect(h.sessions.actor).toHaveBeenCalledWith(token);
  expect(h.practice.list).toHaveBeenCalledWith(h.actor, caseId, audienceId);
});
function setup() {
  const actor: Actor = { id: asId(randomUUID(), "account"), workspaceId: asId(randomUUID(), "workspace"),
    personId: asId(randomUUID(), "person"), role: "practitioner", state: "active", locale: "en",
    sessionDigest: "d".repeat(64), expiresAt: Date.now() + 3600000 };
  const config: IdentityConfig = { enabled: true, origin, workspaceId: actor.workspaceId, csrfKey: randomBytes(32),
    lookupKey: randomBytes(32), rateLimitKey: randomBytes(32).toString("hex"),
    keyring: { activeKeyId: "test", keys: { test: randomBytes(32) } }, sessionSeconds: 3600 };
  const sessions = { actor: vi.fn(async () => actor), csrf: () => csrf };
  const limits = { consume: vi.fn(async () => ({ count: 1, retryAfterMs: 1000 })) };
  const audit = { write: vi.fn(async () => {}) };
  const goals = { list: vi.fn(async () => []), create: vi.fn(async () => ({ id: "synthetic-goal" })) };
  const commitments = { list: vi.fn(async () => []), create: vi.fn(async () => ({ id: "synthetic-commitment" })) };
  const practice = { list: vi.fn(async () => []), createDraft: vi.fn(async () => ({ assignmentId: "synthetic-assignment" })) };
  const checkins = { list: vi.fn(async () => []), submit: vi.fn(async () => ({ occurrenceId })) };
  // Unit boundary spies only. The separate native suite uses real persisted sessions and services.
  const http = new Ls040Http(config, systemClock, { sessions, limits, audit, goals, commitments, practice, checkins } as unknown as Ls040HttpServices);
  const request = (path = "/api/home-practice" + query, method = "GET", body?: unknown, headers: Record<string, string> = {}, transport = "http://127.0.0.1:8080") =>
    new Request(transport + path, { method, headers: { cookie: `${SESSION_COOKIE}=${token}`,
      "x-forwarded-host": "synthetic.example.invalid", "x-forwarded-proto": "https",
      ...(method === "POST" ? { origin, "content-type": "application/json", "x-csrf-token": csrf, "sec-fetch-site": "same-origin" } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { actor, config, sessions, limits, audit, goals, commitments, practice, checkins, http, request };
}

test.each(["goals", "commitments", "home-practice", "checkins"])("exact HTTPS proxy forwarding preserves authorized GET /api/%s", async kind => {
  const h = setup(), path = "/api/" + kind + (kind === "checkins" ? `?occurrenceId=${occurrenceId}` : query);
  const response = await h.http.handle(h.request(path));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, data: [] });
  expect(h.sessions.actor).toHaveBeenCalledWith(token); expect(h.limits.consume).toHaveBeenCalledTimes(1);
  const service = kind === "home-practice" ? h.practice : kind === "checkins" ? h.checkins : kind === "goals" ? h.goals : h.commitments;
  expect(service.list).toHaveBeenCalledWith(h.actor, ...(kind === "checkins" ? [occurrenceId] : [caseId, audienceId]));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

test.each([
  { "x-forwarded-host": "evil.invalid" }, { "x-forwarded-host": "synthetic.example.invalid,evil.invalid" },
  { "x-forwarded-host": "" }, { "x-forwarded-proto": "http" },
  { "x-forwarded-proto": "https,http" }, { "x-forwarded-proto": "" },
])("ambiguous or untrusted forwarding is unavailable before authentication %j", async headers => {
  const h = setup(), response = await h.http.handle(h.request(undefined, undefined, undefined, headers));
  expect(response.status).toBe(503); expect(h.sessions.actor).not.toHaveBeenCalled();
  expect(h.limits.consume).not.toHaveBeenCalled(); expect(h.practice.list).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("proxy POST validates the original body, mutation origin and CSRF without consuming the body for URL repair", async () => {
  const h = setup(), input = { action: "create_draft", caseId, audienceId, templateKey: "W01", templateVersion: "synthetic-v1",
    instructions: "Synthetic instructions preserved", startsOn: "2026-09-29", endsOn: null };
  expect((await h.http.handle(h.request("/api/home-practice", "POST", input))).status).toBe(201);
  expect(h.practice.createDraft).toHaveBeenCalledWith(h.actor, input, expect.any(String));
  for (const headers of [{ origin: "https://evil.invalid" }, { "x-csrf-token": "wrong" }, { "sec-fetch-site": "cross-site" }]) {
    const denied = setup(); expect((await denied.http.handle(denied.request("/api/home-practice", "POST", input, headers))).status).toBe(403);
    expect(denied.practice.createDraft).not.toHaveBeenCalled();
  }
  expect((await h.http.handle(h.request("/api/home-practice", "POST", { ...input, unexpected: true }))).status).toBe(400);
  expect(h.practice.createDraft).toHaveBeenCalledTimes(1);
});

test("direct canonical URLs remain supported; a wrong direct origin, unknown path or fragment is never repaired", async () => {
  const h = setup(), direct = new Request(origin + "/api/home-practice" + query, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  expect((await h.http.handle(direct)).status).toBe(200);
  expect((await h.http.handle(new Request("https://evil.invalid/api/home-practice" + query, { headers: direct.headers }))).status).toBe(404);
  expect((await h.http.handle(new Request(direct.url + "#fragment", { headers: direct.headers }))).status).toBe(404);
  const malformed = setup();
  expect((await malformed.http.handle(malformed.request("/api/not-a-practice-route" + query))).status).toBe(404);
  expect((await malformed.http.handle(malformed.request("/api/home-practice" + query + "#fragment"))).status).toBe(404);
  expect(malformed.sessions.actor).not.toHaveBeenCalled(); expect(malformed.practice.list).not.toHaveBeenCalled();
});

test("cookie, exact query, method and rate limits remain enforced after canonicalization", async () => {
  const h = setup();
  expect((await h.http.handle(h.request(undefined, undefined, undefined, { cookie: "" }))).status).toBe(401);
  expect((await h.http.handle(h.request(undefined, undefined, undefined, { cookie: `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}` }))).status).toBe(401);
  expect((await h.http.handle(h.request("/api/home-practice" + query + `&caseId=${caseId}`))).status).toBe(400);
  expect((await h.http.handle(h.request("/api/home-practice" + query, "POST", {}))).status).toBe(400);
  expect((await h.http.handle(h.request("/api/home-practice" + query, "DELETE"))).status).toBe(404);
  h.limits.consume.mockResolvedValue({ count: 151, retryAfterMs: 1000 });
  expect((await h.http.handle(h.request())).status).toBe(429); expect(h.practice.list).not.toHaveBeenCalled();
});
