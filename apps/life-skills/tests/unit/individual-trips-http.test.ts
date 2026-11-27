import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';
vi.mock('server-only', () => ({}));
import { asId } from '../../src/lib/ids.ts';
import { parseIdentityConfig } from '../../src/features/identity/config.ts';
import { blindEmail, opaqueToken, seal, tokenDigest } from '../../src/features/identity/crypto.ts';
import { IdentityAuthService } from '../../src/features/identity/auth-service.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import type { Actor } from '../../src/features/identity/types.ts';
import { IndividualTripStore } from '../../src/features/individual-trips/store.ts';
import { IndividualTripRegistrationService } from '../../src/features/individual-trips/registration-service.ts';
import { IndividualTripsHttp, tripCookie, type TripHttpDependencies } from '../../src/features/individual-trips/http.ts';
import type { TripState } from '../../src/features/individual-trips/contract.ts';

const db = new PGlite(), origin = 'https://fishing.example.invalid', workspace = asId(randomUUID(), 'workspace'), ownerId = asId(randomUUID(), 'account');
const config = parseIdentityConfig({ LS_IDENTITY_ENABLED: 'true', LS_APP_ORIGIN: origin, LS_IDENTITY_WORKSPACE_ID: workspace,
  LS_IDENTITY_DATA_KEYS: JSON.stringify({ synthetic: opaqueToken() }), LS_IDENTITY_ACTIVE_KEY_ID: 'synthetic', LS_IDENTITY_CSRF_KEY: opaqueToken(), LS_IDENTITY_LOOKUP_KEY: opaqueToken(), LS_IDENTITY_RATE_KEY: opaqueToken() });
let now = Date.now(); const clock = { now: () => new Date(now) };
const database: IdentityStore = { transaction: work => db.transaction(tx => work({ query: async <T extends object>(sql: string, values: readonly unknown[] = []) => (await tx.query<T>(sql, [...values])).rows })) };
const sessions = new IdentitySessions(database, config, clock), auth = new IdentityAuthService(database, config, clock);
const trips = new IndividualTripStore(database, config, { workspaceId: workspace, ownerAccountId: ownerId, origin }, clock);
const registration = new IndividualTripRegistrationService(database, config, clock);
// Only the outer owner-action seam is a fake. Native scope/read/session checks
// still execute before it; no Stripe, mail, HTTP server or provider is involved.
const ownerAction = vi.fn(async () => ({ syntheticBoundaryOnly: true }));
const deps: TripHttpDependencies = { config, trips, registration, sessions, auth, limits: new PostgresIdentityRateStore(database), capabilities: { stripeLookup: true, mailAdmission: true, ownerChat: true }, ownerAction };
const http = new IndividualTripsHttp(deps);
const network = vi.fn(async () => { throw Error('REAL_NETWORK_NOT_ADMITTED'); });
async function rows<T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) { return (await db.query<T>(sql, values)).rows; }
async function count(table: string) { return (await rows<{ n: number }>(`SELECT count(*)::integer AS n FROM ${table}`))[0]!.n; }
async function account(role: 'parent' | 'practitioner' | 'adult_client' = 'parent', id = asId(randomUUID(), 'account')) {
  const personId = asId(randomUUID(), 'person'), token = opaqueToken(), email = `${id}@example.invalid`;
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)", [personId, workspace, seal(JSON.stringify({ displayName: 'Synthetic identity' }), `person:${workspace}:${personId}`, config.keyring), clock.now()]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-unused-password-verifier',$6,$6)", [id, workspace, role, blindEmail(email, config.lookupKey), seal(email, `email:${workspace}:${id}`, config.keyring), clock.now()]);
  await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)', [workspace, id, personId]);
  await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)', [tokenDigest(token), workspace, id, clock.now(), new Date(now + 3600_000)]);
  return { token, actor: await sessions.actor(token), email };
}
function request(path: string, body?: unknown, credentials?: { token: string }, headers: Record<string, string> = {}) {
  const authenticated = credentials ? { Cookie: `__Host-ls-session=${credentials.token}`, 'X-CSRF-Token': sessions.csrf(credentials.token) } : {};
  return new Request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin' }), ...authenticated, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const profile = { guardianName: 'Synthetic Parent', phone: '+13055550123', pickupAreas: ['boca'], contactConsent: true, marketingConsent: false };
const enrollCommand = () => ({ type: 'household.create', operationId: randomUUID(), expectedRevision: 0, profile });
async function enroll(actor: Actor) { return trips.execute(actor, enrollCommand(), true); }
async function publicRequest(body: unknown, headers: Record<string, string> = {}) {
  const preauth = await auth.preauth();
  return request('/api/individual-trips/register', body, undefined, { Cookie: `__Host-ls-preauth=${preauth.token}`, 'X-CSRF-Token': preauth.csrf, ...headers });
}
const registrationInput = (email = `synthetic-${randomUUID()}@example.invalid`) => ({ operationId: randomUUID(), email, displayName: 'Synthetic Parent', locale: 'en', adultConfirmed: true });
type Body<T = unknown> = { ok: boolean; data?: T; error?: { code: string }; requestId: string };
async function body<T = unknown>(response: Response): Promise<Body<T>> { return await response.json() as Body<T>; }

beforeAll(async () => {
  requirePgliteMemoryEnvironment(process.env); vi.stubGlobal('fetch', network);
  await db.exec(await readFile(new URL('../../migrations/0010_ls_identity_cases_20260906.sql', import.meta.url), 'utf8'));
  const demo = await readFile(new URL('../../migrations/0097_ls_demo_provenance.sql', import.meta.url), 'utf8'); await db.exec(demo.slice(0, demo.indexOf('-- The calendar relay')));
  await db.exec(await readFile(new URL('../../src/features/individual-trips/schema.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../src/features/individual-trips/registration-schema.sql', import.meta.url), 'utf8'));
}, 25000);
beforeEach(async () => { now = Date.now(); ownerAction.mockClear(); await db.exec('TRUNCATE ls_identity.workspaces CASCADE; TRUNCATE ls_identity.rate_counters'); await db.query('INSERT INTO ls_identity.workspaces(id) VALUES($1)', [workspace]); });
afterAll(async () => { try { expect(network).not.toHaveBeenCalled(); await db.close(); } finally { vi.unstubAllGlobals(); } });

describe('individual trips HTTP native-session boundary', () => {
  it.each([undefined, '', '__Host-ls-session=short', '__Host-ls-session=' + 'a'.repeat(43) + '; __Host-ls-session=' + 'b'.repeat(43)])('denies absent, malformed or duplicate session cookie %s', async cookie => {
    const response = await http.handle(request('/api/individual-trips', undefined, undefined, cookie === undefined ? {} : { Cookie: cookie }));
    expect(response.status).toBe(401); expect((await body(response)).error?.code).toBe('UNAUTHENTICATED');
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(await count('ls_individual_trips.state')).toBe(0);
  });
  it('requires same-origin mutation and session CSRF before writing', async () => {
    const a = await account(), input = { command: enrollCommand(), adultConfirmed: true };
    for (const headers of [{ Origin: 'https://foreign.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-CSRF-Token': opaqueToken() }]) {
      const response = await http.handle(request('/api/individual-trips', input, a, headers)); expect(response.status).toBe(403);
    }
    const wrongUrl = await http.handle(new Request('https://foreign.invalid/api/individual-trips', { headers: { Cookie: `__Host-ls-session=${a.token}` } })); expect(wrongUrl.status).toBe(400);
    expect(await count('ls_individual_trips.memberships')).toBe(0); expect(ownerAction).not.toHaveBeenCalled();
  });
  it('requires explicit adultConfirmed for household enrollment and exposes only the enrolled parent household', async () => {
    const a = await account(), cmd = enrollCommand();
    const absent = await http.handle(request('/api/individual-trips', { command: cmd }, a)); expect(absent.status).toBe(403);
    const falseValue = await http.handle(request('/api/individual-trips', { command: cmd, adultConfirmed: false }, a)); expect(falseValue.status).toBe(400);
    const saved = await http.handle(request('/api/individual-trips', { command: cmd, adultConfirmed: true }, a)); expect(saved.status).toBe(200);
    const view = await http.handle(request('/api/individual-trips', undefined, a)), result = await body<{ role: string; state: TripState; capabilities: Record<string, boolean> }>(view);
    expect(view.status).toBe(200); expect(result.data?.role).toBe('parent'); expect(result.data?.state.households).toHaveLength(1);
    expect(result.data?.capabilities).toEqual({ stripeLookup: false, mailAdmission: false, ownerChat: false });
    expect(await count('ls_cases.case_guardians')).toBe(0); expect(await count('ls_cases.audience_accounts')).toBe(0);
  });
  it('rejects raw trusted payment/delivery commands and browser-supplied invoice identity/URL/money', async () => {
    const owner = await account('practitioner', ownerId), offerId = randomUUID();
    for (const command of [
      { type: 'payment.record_unknown', offerId },
      { type: 'delivery.record_unknown', offerId },
      { type: 'invoice.attach', offerId, invoiceId: 'in_synthetic123', url: 'https://invoice.stripe.com/i/synthetic', amountMinor: 15000,customerId:'cus_synthetic',customerEmailBlind:'a'.repeat(64) },
    ]) {
      const response = await http.handle(request('/api/individual-trips', { command: { operationId: randomUUID(), expectedRevision: 0, ...command } }, owner));
      expect(response.status).toBe(403); expect((await body(response)).error?.code).toBe('FORBIDDEN');
    }
    expect(await count('ls_individual_trips.operations')).toBe(0); expect(ownerAction).not.toHaveBeenCalled();
  });
  it('checks fresh native role and exact owner before the outer provider-action seam', async () => {
    const parent = await account(); await enroll(parent.actor);
    const ownerInput = { action: 'attach_invoice', operationId: randomUUID(), expectedRevision: 0, offerId: randomUUID(), invoiceId: 'in_synthetic123' };
    const denied = await http.handle(request('/api/individual-trips/owner-action', ownerInput, parent)); expect(denied.status).toBe(404); expect(ownerAction).not.toHaveBeenCalled();
    const owner = await account('practitioner', ownerId);
    const injected = await http.handle(request('/api/individual-trips/owner-action', { ...ownerInput, amountMinor: 1, url: 'https://foreign.invalid/pay' }, owner)); expect(injected.status).toBe(400); expect(ownerAction).not.toHaveBeenCalled();
    const allowed = await http.handle(request('/api/individual-trips/owner-action', ownerInput, owner)); expect(allowed.status).toBe(200); expect(ownerAction).toHaveBeenCalledTimes(1);
    const readback = await http.handle(request('/api/individual-trips', undefined, owner)); expect((await body<{ role: string; capabilities: Record<string, boolean> }>(readback)).data).toMatchObject({ role: 'owner', capabilities: { stripeLookup: true, mailAdmission: true, ownerChat: true } });
  });
  it('honors session and membership revocation on already-created HTTP sessions', async () => {
    const a = await account(); await enroll(a.actor);
    await db.query("UPDATE ls_individual_trips.memberships SET state='revoked',revoked_at=$2 WHERE account_id=$1", [a.actor.id, clock.now()]);
    const membership = await http.handle(request('/api/individual-trips', undefined, a)); expect(membership.status).toBe(404);
    await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE account_id=$1', [a.actor.id, clock.now()]);
    const session = await http.handle(request('/api/individual-trips', undefined, a)); expect(session.status).toBe(401);
  });
  it('preserves useful method/query/content boundaries and neutral failure responses', async () => {
    const owner = await account('practitioner', ownerId);
    const method = await http.handle(new Request(origin + '/api/individual-trips', { method: 'DELETE' })); expect(method.status).toBe(404);
    const query = await http.handle(request('/api/individual-trips?householdId=' + randomUUID(), undefined, owner)); expect(query.status).toBe(400);
    const content = await http.handle(new Request(origin + '/api/individual-trips', { method: 'POST', headers: { Origin: origin, Cookie: `__Host-ls-session=${owner.token}`, 'X-CSRF-Token': sessions.csrf(owner.token), 'Content-Type': 'text/plain' }, body: 'synthetic' }));
    expect(content.status).toBe(415); const result = await body(content); expect(Object.keys(result).sort()).toEqual(['error', 'ok', 'requestId']); expect(result.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(tripCookie(new Request(origin, { headers: { Cookie: 'other=synthetic' } }), '__Host-ls-session')).toBeUndefined();
  });
});

describe('free registration preauth and native limits', () => {
  it('requires real unexpired preauth and its matching CSRF, with no identity or household side effects on failure', async () => {
    const input = registrationInput();
    const absent = await http.handle(request('/api/individual-trips/register', input)); expect(absent.status).toBe(403);
    const forged = await http.handle(request('/api/individual-trips/register', input, undefined, { Cookie: `__Host-ls-preauth=${opaqueToken()}`, 'X-CSRF-Token': opaqueToken() })); expect(forged.status).toBe(403);
    const actual = await auth.preauth();
    await db.query('UPDATE ls_identity.preauth_sessions SET expires_at=$2 WHERE token_digest=$1', [tokenDigest(actual.token), new Date(now - 1000)]);
    const expired = await http.handle(request('/api/individual-trips/register', input, undefined, { Cookie: `__Host-ls-preauth=${actual.token}`, 'X-CSRF-Token': actual.csrf })); expect(expired.status).toBe(403);
    expect(await count('ls_identity.accounts')).toBe(0); expect(await count('ls_individual_trips.memberships')).toBe(0);
  });
  it('returns the identical accepted shape for new and existing email without granting access or a session', async () => {
    const existing = await account(), beforeSessions = await count('ls_identity.sessions');
    const first = await http.handle(await publicRequest(registrationInput())), second = await http.handle(await publicRequest(registrationInput(existing.email.toUpperCase())));
    expect(first.status).toBe(202); expect(second.status).toBe(202); expect((await body(first)).data).toEqual({ accepted: true }); expect((await body(second)).data).toEqual({ accepted: true });
    expect(await count('ls_identity.sessions')).toBe(beforeSessions); expect(await count('ls_individual_trips.memberships')).toBe(0); expect(await count('ls_cases.case_guardians')).toBe(0);
    expect(first.headers.get('set-cookie')).toBeNull(); expect(second.headers.get('set-cookie')).toBeNull();
  });
  it('requires adulthood and rejects injected identity/household claims before registration', async () => {
    const input = registrationInput();
    for (const candidate of [{ ...input, adultConfirmed: false }, { ...input, householdId: randomUUID() }, { ...input, role: 'practitioner' }, { ...input, personId: randomUUID() }]) {
      const response = await http.handle(await publicRequest(candidate)); expect(response.status).toBe(400);
    }
    expect(await count('ls_identity.accounts')).toBe(0); expect(await count('ls_identity.auth_mail_outbox')).toBe(0);
  });
  it('applies the same canonical-email limit to mixed-case known and unknown registration attempts', async () => {
    const email = 'synthetic-rate@example.invalid';
    for (let index = 0; index < 6; index++) {
      const input = registrationInput(index % 2 ? email.toUpperCase() : email);
      const response = await http.handle(await publicRequest(input)); expect(response.status).toBe(index < 5 ? 202 : 429);
    }
    expect(await count('ls_individual_trips.registration_receipts')).toBe(5); expect(await count('ls_identity.accounts')).toBe(1); expect(await count('ls_identity.auth_mail_outbox')).toBe(1);
    const counters = await rows<{ key_digest: string }>('SELECT key_digest FROM ls_identity.rate_counters'); expect(JSON.stringify(counters)).not.toContain(email);
  });
  it('enforces the shared public-registration cap even across distinct email addresses', async () => {
    for (let index = 0; index < 31; index++) {
      const response = await http.handle(await publicRequest(registrationInput())); expect(response.status).toBe(index < 30 ? 202 : 429);
    }
    expect(await count('ls_individual_trips.registration_receipts')).toBe(30); expect(await count('ls_individual_trips.memberships')).toBe(0);
  });
  it('fails closed if the rate backend is unavailable, without calling the registration service', async () => {
    const failing = new IndividualTripsHttp({ ...deps, limits: { consume: async () => { throw Error('synthetic limit backend outage'); } } });
    const response = await failing.handle(await publicRequest(registrationInput())); expect(response.status).toBe(503);
    expect((await body(response)).error?.code).toBe('UNAVAILABLE'); expect(await count('ls_identity.accounts')).toBe(0);
  });
});
