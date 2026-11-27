import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mail = vi.hoisted(() => ({ messages: [] as import('../../src/providers/email/transport.ts').AuthEmailMessage[], displayNames: [] as string[] }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/providers/email/gmail.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/providers/email/gmail.ts')>();
  return { ...actual, GmailAuthTransport: class {
    private before: ((message: import('../../src/providers/email/transport.ts').AuthEmailMessage) => void | Promise<void>) | undefined;
    constructor(...args: unknown[]) { this.before = args[3] as typeof this.before; mail.displayNames.push(String(args[2])); }
    async send(message: import('../../src/providers/email/transport.ts').AuthEmailMessage) {
      await this.before?.(message); mail.messages.push(message); return { providerId: 'synthetic-reset-accepted' };
    }
  } };
});
import { tripDatabase } from '../fixtures/individual-trips-database.ts';
import { IdentityHttp } from '../../src/features/identity/http.ts';
import { IdentityAuthService } from '../../src/features/identity/auth-service.ts';
import { IdentityAccountService } from '../../src/features/identity/account-service.ts';
import { IdentityPreferenceService } from '../../src/features/identity/preferences.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import { durableAuditSink } from '../../src/features/identity/history.ts';
import { CaseService } from '../../src/features/cases/service.ts';
import { takeAuthTokenFragment } from '../../src/features/identity/client.ts';
import { loginReturnDestination } from '../../src/features/identity/login-return.ts';
import { scheduleResetDelivery } from '../../src/providers/email/reset-delivery.ts';

// Actual identity HTTP, SQL, one-request outbox dispatch, token consumption and
// fresh login, in a nonce-owned memory database. Gmail is a synthetic boundary.
const network = vi.fn(async () => { throw new Error('REAL_NETWORK_NOT_ADMITTED'); });
beforeEach(() => { mail.messages = []; mail.displayNames = []; network.mockClear(); vi.stubGlobal('fetch', network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
it.each(['en', 'he'] as const)('%s Fishing reset runs through native preauth → request → one mail → reset → fresh login and bounded return', async locale => {
  const fx = await tripDatabase();
  try {
    const auth = new IdentityAuthService(fx.store, fx.config, fx.clock), sessions = new IdentitySessions(fx.store, fx.config, fx.clock);
    const http = new IdentityHttp(fx.config, fx.clock, { auth, sessions, accounts: new IdentityAccountService(fx.store, fx.config, fx.clock),
      preferences: new IdentityPreferenceService(fx.store, fx.config, fx.clock), cases: new CaseService(fx.store, fx.config, fx.clock),
      limits: new PostgresIdentityRateStore(fx.store), audit: durableAuditSink(fx.store) });
    async function preauth() {
      const response = await http.handle(new Request(fx.origin + '/api/identity/csrf'));
      expect(response.status).toBe(200);
      const body = await response.json(), cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      expect(cookie).toMatch(/^__Host-ls-preauth=/); expect(response.headers.get('set-cookie')).toContain('Secure');
      return { cookie, csrf: body.data.csrfToken as string };
    }
    const first = await preauth(), resetRequest = new Request(fx.origin + '/api/identity/reset/request', { method: 'POST',
      headers: { Origin: fx.origin, Cookie: first.cookie, 'X-CSRF-Token': first.csrf, 'Content-Type': 'application/json', 'X-LS-Locale': locale, 'X-LS-Auth-Context': 'fishing-trips' }, body: JSON.stringify({ email: fx.parent.email }) });
    const accepted = await http.handle(resetRequest), acceptedBody = await accepted.clone().json();
    expect(accepted.status).toBe(202); expect(acceptedBody.data).toEqual({ accepted: true });
    const unrelatedRequest = randomUUID(); await auth.requestReset(fx.parent.email, unrelatedRequest);
    let callback: (() => Promise<void>) | undefined;
    await scheduleResetDelivery(resetRequest, accepted, { store: fx.store, config: fx.config, clock: fx.clock }, {
      LS_AUTH_EMAIL_ENABLED: 'true', LS_AUTH_EMAIL_PROVIDER: 'gmail', LS_AUTH_EMAIL_FROM: 'office@bneineviimacademy.org',
      LS_AUTH_GOOGLE_CLIENT_ID: 'synthetic-client', LS_AUTH_GOOGLE_CLIENT_SECRET: 'synthetic-secret', LS_AUTH_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh',
      LS_INDIVIDUAL_TRIPS_ENABLED: 'true', LS_INDIVIDUAL_TRIPS_WORKSPACE_ID: fx.workspace,
    }, action => { callback = action; });
    expect(mail.messages).toHaveLength(0); await callback!();
    expect(mail.messages).toHaveLength(1); expect(mail.messages[0]!.to).toBe(fx.parent.email); expect(mail.displayNames).toEqual(['JLFA Office']);
    expect((await fx.db.query<{ processed_at: Date | null }>('SELECT processed_at FROM ls_identity.reset_requests WHERE request_id=$1', [unrelatedRequest])).rows[0]!.processed_at).toBeNull();
    const link = new URL(mail.messages[0]!.text.split('\n').find(line => line.startsWith(fx.origin + '/'))!);
    expect(link.pathname).toBe(`/${locale}/login`); expect(link.searchParams.get('mode')).toBe('reset');
    const capturedNext = link.searchParams.get('next'); expect(capturedNext).toBe(`/${locale}/trips`);
    expect(link.searchParams.has('token')).toBe(false);
    const replace = vi.fn(), token = takeAuthTokenFragment({ pathname: link.pathname, hash: link.hash }, { replaceState: replace });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(replace).toHaveBeenCalledWith(null, '', `/${locale}/login`);
    const completePreauth = await preauth();
    const complete = await http.handle(new Request(fx.origin + '/api/identity/reset/complete', { method: 'POST',
      headers: { Origin: fx.origin, Cookie: completePreauth.cookie + '; __Host-ls-session=' + fx.parent.token, 'X-CSRF-Token': completePreauth.csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'synthetic reset password' }) }));
    expect(complete.status).toBe(200); expect((await complete.json()).data.signInRequired).toBe(true);
    expect(complete.headers.get('set-cookie')).toContain('__Host-ls-session=;');
    expect((await http.handle(new Request(fx.origin + '/api/identity/session', { headers: { Cookie: '__Host-ls-session=' + fx.parent.token } }))).status).toBe(401);
    const loginPreauth = await preauth();
    const login = await http.handle(new Request(fx.origin + '/api/identity/login', { method: 'POST', headers: {
      Origin: fx.origin, Cookie: loginPreauth.cookie, 'X-CSRF-Token': loginPreauth.csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fx.parent.email, password: 'synthetic reset password' }) }));
    expect(login.status).toBe(200);
    const sessionToken = /__Host-ls-session=([A-Za-z0-9_-]{43})/.exec(login.headers.get('set-cookie')!)![1]!;
    expect(sessionToken).not.toBe(fx.parent.token);
    const session = await http.handle(new Request(fx.origin + '/api/identity/session', { headers: { Cookie: '__Host-ls-session=' + sessionToken } }));
    const current = (await session.json()).data; expect(current.role).toBe('parent');
    expect(loginReturnDestination(locale, current.role, capturedNext)).toBe(`/${locale}/trips`);
    expect(loginReturnDestination(locale, current.role, `/${locale}/trips/owner`)).not.toBe(`/${locale}/trips/owner`);
    // Reset/login grants no Fishing household and cannot create case access.
    await expect(fx.trips.read(await sessions.actor(sessionToken))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await fx.db.query<{ n: number }>('SELECT count(*)::integer AS n FROM ls_cases.case_guardians')).rows[0]!.n).toBe(0);
    await callback!(); expect(mail.messages).toHaveLength(1);
  } finally { await fx.db.close(); }
}, 25000);
