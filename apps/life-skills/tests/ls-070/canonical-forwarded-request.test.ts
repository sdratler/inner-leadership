import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy.ts";
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

describe('LS-070 preserves the accepted standalone identity preview boundary', () => {
  const origin = 'https://localhost:3003';
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LS_APP_MODE', 'foundation_preview');
    vi.stubEnv('LS_APP_ORIGIN', origin);
    vi.stubEnv('LS_IDENTITY_ENABLED', 'true');
    vi.stubEnv('LS_PRIVATE_APP_ENABLED', undefined);
    vi.stubEnv('LS_DATABASE_URL', undefined);
    vi.stubEnv('LS_MIGRATION_DATABASE_URL', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());
  function request(path: string) {
    return new NextRequest(origin + path, { headers: { host: 'localhost:3003', origin } });
  }

  it.each([undefined, 'false'])('forwards the existing identity preview when the full private app is %s', privateFlag => {
    vi.stubEnv('LS_PRIVATE_APP_ENABLED', privateFlag);
    const incoming = request('/api/identity/csrf');
    const response = proxy(incoming);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    const forwarded = new Headers(incoming.headers);
    for (const [name, value] of response.headers) {
      if (name.startsWith('x-middleware-request-')) forwarded.set(name.slice('x-middleware-request-'.length), value);
    }
    expect(forwarded.get('x-forwarded-proto')).toBe('https');
    expect(forwarded.get('x-forwarded-host')).toBe('localhost:3003');
    expect(canonicalForwardedRequest(new Request(incoming.url, { headers: forwarded }), origin).url).toBe(incoming.url);
    // Forwarding is not authentication; the untouched identity runtime still
    // requires its own enabled flag, HTTPS config, origin/CSRF and valid credentials.
  });

  it('keeps identity closed under foundation_locked without the explicit private-app flag', () => {
    vi.stubEnv('LS_APP_MODE', 'foundation_locked');
    const response = proxy(request('/api/identity/csrf'));
    expect(response.status).toBe(503);
    expect(response.headers.has('x-middleware-next')).toBe(false);
  });

  it.each(['/api/private/probe', '/api/calendar/appointments', '/api/payments/overview',
    '/api/updates', '/api/home-practice', '/he/app/calendar', '/en/family/schedule'])
  ('does not let standalone identity preview open another private surface: %s', path => {
    const response = proxy(request(path));
    expect(response.status).toBe(503);
    expect(response.headers.has('x-middleware-next')).toBe(false);
  });

  it.each(['/api/identity/csrf', '/api/calendar/appointments', '/he/app/calendar'])
  ('preserves explicit private-app access through the proxy under foundation_locked: %s', path => {
    vi.stubEnv('LS_APP_MODE', 'foundation_locked');
    vi.stubEnv('LS_PRIVATE_APP_ENABLED', 'true');
    const response = proxy(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('retains the environment prohibition on non-loopback foundation preview', () => {
    vi.stubEnv('LS_APP_ORIGIN', 'https://not-loopback.example.invalid');
    expect(proxy(request('/api/identity/csrf')).status).toBe(503);
  });
});
