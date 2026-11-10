import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ runtime: vi.fn(), actor: vi.fn(), transaction: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/features/identity/runtime.ts', () => ({ identityRuntime: calls.runtime }));
import { GET, POST } from '../../src/app/api/private/fishing-inquiry-family-proposals/route.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import { opaqueToken } from '../../src/features/identity/crypto.ts';
import { AppError } from '../../src/lib/errors.ts';

const path = 'https://fishing-owner.example.invalid/api/private/fishing-inquiry-family-proposals';
const token = opaqueToken();
const transport = { host: 'fishing-owner.example.invalid', 'x-forwarded-host': 'fishing-owner.example.invalid', 'x-forwarded-proto': 'https' };
beforeEach(() => {
  vi.stubEnv('LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID', '00000000-0000-4000-8000-000000000002');
  for (const call of Object.values(calls)) call.mockReset();
  calls.runtime.mockResolvedValue({
    config: { origin: 'https://fishing-owner.example.invalid', workspaceId: '00000000-0000-4000-8000-000000000001', keyring: {}, lookupKey: Buffer.alloc(32, 1), rateLimitKey: 'synthetic' },
    services: { sessions: { actor: calls.actor }, limits: {} }, store: { transaction: calls.transaction }, clock: {},
  });
});
afterEach(() => { vi.unstubAllEnvs(); expect(calls.transaction).not.toHaveBeenCalled(); });

it('the actual route rejects missing, malformed and ambiguous cookies before initializing native dependencies', async () => {
  for (const cookie of ['', SESSION_COOKIE + '=not-a-token', `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`]) {
    const response = await GET(new Request(path, { headers: { ...transport, cookie } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  }
  expect(calls.runtime).not.toHaveBeenCalled();
});

it.each(['parent', 'child', 'adult_client'] as const)('the route refuses %s before any native data access', async role => {
  calls.actor.mockResolvedValueOnce({ role, state: 'active' });
  const response = await POST(new Request(path, { method: 'POST', headers: { ...transport, cookie: SESSION_COOKIE + '=' + token } }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(calls.actor).toHaveBeenCalledExactlyOnceWith(token);
});

it('a revoked session remains denied after native composition', async () => {
  calls.actor.mockRejectedValueOnce(new AppError('UNAUTHENTICATED'));
  const response = await GET(new Request(path, { headers: { ...transport, cookie: SESSION_COOKIE + '=' + token } }));
  expect(response.status).toBe(401);
});

it('a native initialization outage remains unavailable, never a successful empty response', async () => {
  calls.runtime.mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const response = await GET(new Request(path, { headers: { ...transport, cookie: SESSION_COOKIE + '=' + token } }));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  expect(calls.actor).not.toHaveBeenCalled();
});
