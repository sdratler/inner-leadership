import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/features/identity/runtime.ts', () => ({ identityRuntime: async () => mocks.identity }));
import { parseIdentityConfig } from '../../src/features/identity/config.ts';
import { opaqueToken } from '../../src/features/identity/crypto.ts';
import { asId } from '../../src/lib/ids.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import { deliverTripOperationalMail, TRIP_OPERATIONAL_MAIL_VERSION } from '../../src/features/individual-trips/operational-mail.ts';
import { IndividualTripRegistrationService, INDIVIDUAL_TRIP_REGISTRATION_VERSION } from '../../src/features/individual-trips/registration-service.ts';
import { deliverRegistrationMail } from '../../src/features/individual-trips/registration-mail.ts';
import { tripProviderConfiguration, TRIP_INVOICE_LOOKUP_PURPOSE, TRIP_PROVIDER_ENV } from '../../src/features/individual-trips/provider-config.ts';
import { individualTripsRuntime } from '../../src/features/individual-trips/runtime.ts';
import { initialTripState } from '../../src/features/individual-trips/engine.ts';
import { tripDatabase } from '../fixtures/individual-trips-database.ts';
import { IndividualTripStore } from '../../src/features/individual-trips/store.ts';
import type { AuthEmailMessage } from '../../src/providers/email/transport.ts';

const workspace = asId(randomUUID(), 'workspace'), owner = asId(randomUUID(), 'account'), origin = 'https://fishing.example.invalid';
const target = 'postgresql://synthetic.invalid/no-connection', ca = 'synthetic CA only', sha = (value: string) => createHash('sha256').update(value).digest('hex');
const config = parseIdentityConfig({ LS_IDENTITY_ENABLED: 'true', LS_IDENTITY_WORKSPACE_ID: workspace, LS_APP_ORIGIN: origin,
  LS_IDENTITY_CSRF_KEY: opaqueToken(), LS_IDENTITY_LOOKUP_KEY: opaqueToken(), LS_IDENTITY_RATE_KEY: opaqueToken(),
  LS_IDENTITY_DATA_KEYS: JSON.stringify({ synthetic: opaqueToken() }), LS_IDENTITY_ACTIVE_KEY_ID: 'synthetic' });
const tripConfig = { workspaceId: workspace, ownerAccountId: owner, origin }, network = vi.fn(async () => { throw new Error('REAL_NETWORK_NOT_ADMITTED'); });
const native: IdentityStore = { transaction: async () => { throw new Error('REAL_SQL_NOT_ADMITTED'); } };
const bind = vi.fn((url: string, hash: string) => url === target && hash === sha(ca) ? native : null);
const store: IdentityStore = { transaction: native.transaction, bindFishingDatabaseTarget: bind };
const identity = { store, config };
const common = () => ({ workspaceId: workspace, ownerAccountId: owner, origin, databaseEnv: 'LS_DATABASE_URL', databaseSha256: sha(target),
  caEnv: 'LS_DATABASE_CA', databaseCaSha256: sha(ca), tlsMode: 'verify-full' });
const mailPin = (purpose: string) => ({ ...common(), purpose, provider: 'gmail', sender: 'office@bneineviimacademy.org' });
const invoicePin = () => ({ ...common(), purpose: TRIP_INVOICE_LOOKUP_PURPOSE, provider: 'stripe', accountId: 'acct_SYNTHETIC', livemode: true,
  restrictedKeyEnv: 'LS_INDIVIDUAL_TRIPS_STRIPE_RESTRICTED_KEY' });
const environment = (): Record<string, string | undefined> => ({ LS_APP_ORIGIN: origin, LS_INDIVIDUAL_TRIPS_ENABLED: 'true',
  LS_INDIVIDUAL_TRIPS_WORKSPACE_ID: workspace, LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID: owner, LS_DATABASE_URL: target, LS_DATABASE_TLS: 'verify-full', LS_DATABASE_CA: ca,
  LS_AUTH_EMAIL_ENABLED: 'true', LS_AUTH_EMAIL_PROVIDER: 'gmail', LS_AUTH_EMAIL_FROM: 'office@bneineviimacademy.org',
  LS_AUTH_GOOGLE_CLIENT_ID: 'synthetic-client', LS_AUTH_GOOGLE_CLIENT_SECRET: 'synthetic-secret', LS_AUTH_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh',
  LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ENABLED: 'true', LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ADMISSION_JSON: JSON.stringify(mailPin(INDIVIDUAL_TRIP_REGISTRATION_VERSION)),
  LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ENABLED: 'true', LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ADMISSION_JSON: JSON.stringify(mailPin(TRIP_OPERATIONAL_MAIL_VERSION)),
  LS_INDIVIDUAL_TRIPS_INVOICE_LOOKUP_ENABLED: 'true', LS_INDIVIDUAL_TRIPS_INVOICE_LOOKUP_ADMISSION_JSON: JSON.stringify(invoicePin()),
  LS_INDIVIDUAL_TRIPS_STRIPE_RESTRICTED_KEY: 'rk_live_SYNTHETIC' });
beforeEach(() => { bind.mockClear(); network.mockClear(); vi.stubGlobal('fetch', network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent purpose-specific Fishing release configuration', () => {
  it('does not infer effect authority from existing credentials or feature flags alone', () => {
    const env = environment();
    for (const keys of Object.values(TRIP_PROVIDER_ENV)) delete env[keys.admission];
    const result = tripProviderConfiguration(identity, tripConfig, env);
    expect(result.registrationAdmission).toBeNull(); expect(result.operationalAdmission).toBeNull(); expect(result.invoiceProvider).toBeNull(); expect(result.effectStore).toBeNull();
    expect(bind).not.toHaveBeenCalled();
  });
  it('pins the native original target and returns independent mail admissions without SQL or provider work', () => {
    const result = tripProviderConfiguration(identity, tripConfig, environment());
    expect(result.availability).toEqual({ registration: 'configured', operational: 'configured', invoice: 'configured' });
    expect(result.registrationAdmission).toEqual({ purpose: INDIVIDUAL_TRIP_REGISTRATION_VERSION, workspaceId: workspace, origin, databaseUrl: target });
    expect(result.operationalAdmission?.purpose).toBe(TRIP_OPERATIONAL_MAIL_VERSION); expect(result.invoiceProvider).not.toBeNull();
    expect(bind).toHaveBeenCalledWith(target, sha(ca)); expect(result.effectStore?.bindDatabaseTarget?.(target)).toBe(result.effectStore);
  });
  it('a bad operational admission does not disable registration or read-only invoice lookup', () => {
    const env = environment(); env.LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ADMISSION_JSON = '{malformed';
    const result = tripProviderConfiguration(identity, tripConfig, env);
    expect(result.availability).toEqual({ registration: 'configured', operational: 'unavailable', invoice: 'configured' });
    expect(result.operationalAdmission).toBeNull(); expect(result.registrationAdmission).not.toBeNull(); expect(result.invoiceProvider).not.toBeNull();
  });
  it('mail configuration failure does not change the separately admitted invoice port', () => {
    const env = environment(); env.LS_AUTH_EMAIL_FROM = 'wrong@example.invalid';
    const result = tripProviderConfiguration(identity, tripConfig, env);
    expect(result.registrationAdmission).toBeNull(); expect(result.operationalAdmission).toBeNull(); expect(result.invoiceProvider).not.toBeNull();
  });
  it.each([
    { workspaceId: randomUUID() }, { ownerAccountId: randomUUID() }, { origin: 'https://wrong.example.invalid' }, { databaseSha256: '0'.repeat(64) },
    { databaseCaSha256: '0'.repeat(64) }, { tlsMode: 'disable' }, { databaseEnv: 'DATABASE_URL' }, { caEnv: 'OTHER_CA' },
    { purpose: TRIP_OPERATIONAL_MAIL_VERSION }, { sender: 'wrong@example.invalid' }, { provider: 'resend' }, { extraAuthority: true },
  ])('rejects mismatched registration release pins: %j', override => {
    const env = environment(); env.LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ADMISSION_JSON = JSON.stringify({ ...mailPin(INDIVIDUAL_TRIP_REGISTRATION_VERSION), ...override });
    const result = tripProviderConfiguration(identity, tripConfig, env);
    expect(result.registrationAdmission).toBeNull(); expect(result.operationalAdmission).not.toBeNull();
  });
  it('rejects TLS weakening, CA drift and unproven original driver provenance', () => {
    for (const override of [{ LS_DATABASE_TLS: 'disable' }, { LS_DATABASE_CA: 'different synthetic CA' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }]) {
      const result = tripProviderConfiguration(identity, tripConfig, { ...environment(), ...override }); expect(result.effectStore).toBeNull();
      expect(result.registrationAdmission).toBeNull(); expect(result.operationalAdmission).toBeNull(); expect(result.invoiceProvider).toBeNull();
    }
    expect(tripProviderConfiguration({ config, store: native }, tripConfig, environment()).effectStore).toBeNull();
  });
  it('retains a bound store and refuses later target/CA drift instead of retargeting it', () => {
    const env = environment(), result = tripProviderConfiguration(identity, tripConfig, env), fixed = result.effectStore!;
    env.LS_DATABASE_URL = target + '-other'; expect(fixed.bindDatabaseTarget?.(env.LS_DATABASE_URL)).toBeNull();
    env.LS_DATABASE_URL = target; env.LS_DATABASE_CA = 'different synthetic CA'; expect(fixed.bindDatabaseTarget?.(target)).toBeNull();
  });
  it.each(['rk_test_SYNTHETIC', 'sk_live_SYNTHETIC', '', undefined])('never substitutes a test or full-scope key for the dedicated live restricted lookup reference', key => {
    const env = environment(); env.LS_INDIVIDUAL_TRIPS_STRIPE_RESTRICTED_KEY = key; env.LS_STRIPE_TEST_SECRET_KEY = 'rk_test_SYNTHETIC';
    const result = tripProviderConfiguration(identity, tripConfig, env);
    expect(result.invoiceProvider).toBeNull(); expect(result.registrationAdmission).not.toBeNull(); expect(result.operationalAdmission).not.toBeNull();
  });
  it('refuses an invoice admission requesting test mode or an alternate credential reference', () => {
    for (const override of [{ livemode: false }, { restrictedKeyEnv: 'LS_STRIPE_TEST_SECRET_KEY' }]) {
      const env = environment(); env.LS_INDIVIDUAL_TRIPS_INVOICE_LOOKUP_ADMISSION_JSON = JSON.stringify({ ...invoicePin(), ...override });
      expect(tripProviderConfiguration(identity, tripConfig, env).invoiceProvider).toBeNull();
    }
  });
  it('live lookup still verifies the exact Stripe account and never POSTs or creates an invoice', async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('GET'); return Response.json({ id: 'acct_WRONG', object: 'account' });
    }) as unknown as typeof fetch;
    const provider = tripProviderConfiguration(identity, tripConfig, environment(), request).invoiceProvider!;
    await expect(provider.lookup('in_SYNTHETIC')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('disables a previously configured invoice adapter after its enable flag is revoked', async () => {
    const env = environment(), provider = tripProviderConfiguration(identity, tripConfig, env).invoiceProvider!;
    env.LS_INDIVIDUAL_TRIPS_INVOICE_LOOKUP_ENABLED = 'false'; await expect(provider.lookup('in_SYNTHETIC')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('the production capability wrapper feeds both real request-bound mail services through synthetic original-driver proof', async () => {
    const fx = await tripDatabase();
    try {
      await fx.db.exec(await readFile(new URL('../../src/features/individual-trips/mail-schema.sql', import.meta.url), 'utf8'));
      const env: Record<string, string | undefined> = { ...environment(), LS_INDIVIDUAL_TRIPS_WORKSPACE_ID: fx.workspace, LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID: fx.owner.actor.id };
      const pins = { ...common(), workspaceId: fx.workspace, ownerAccountId: fx.owner.actor.id, origin: fx.origin };
      env.LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ADMISSION_JSON = JSON.stringify({ ...pins, purpose: INDIVIDUAL_TRIP_REGISTRATION_VERSION, provider: 'gmail', sender: 'office@bneineviimacademy.org' });
      env.LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ADMISSION_JSON = JSON.stringify({ ...pins, purpose: TRIP_OPERATIONAL_MAIL_VERSION, provider: 'gmail', sender: 'office@bneineviimacademy.org' });
      env.LS_INDIVIDUAL_TRIPS_INVOICE_LOOKUP_ENABLED = 'false';
      // PGlite has no TLS or DSN. Only this synthetic capability proof is mocked;
      // native SQL, identity/outbox crypto and both mail services are actual.
      const original: IdentityStore = { transaction: fx.store.transaction, bindFishingDatabaseTarget: (url, caDigest) => url === target && caDigest === sha(ca) ? fx.store : null };
      const prepared = tripProviderConfiguration({ config: fx.config, store: original }, fx.tripConfig, env), effectStore = prepared.effectStore!;
      const requestId = randomUUID(), recipient = 'new-synthetic@example.invalid', messages: AuthEmailMessage[] = [];
      await new IndividualTripRegistrationService(effectStore, fx.config, fx.clock).register({ operationId: randomUUID(), displayName: 'Synthetic New Parent',
        email: recipient, locale: 'en', adultConfirmed: true }, requestId);
      expect(await deliverRegistrationMail({ store: effectStore, config: fx.config, clock: fx.clock }, requestId, env, prepared.registrationAdmission,
        before => ({ nonIdempotent: true, send: async message => { before(message); messages.push(message); return { providerId: 'synthetic-registration-accepted' }; } }))).toBe('sent');
      expect(messages[0]!.to).toBe(recipient); expect(messages[0]!.text).toContain('/en/login?mode=invite&next=%2Fen%2Ftrips#token=');
      const trips = new IndividualTripStore(effectStore, fx.config, fx.tripConfig, fx.clock, { queueMail: true });
      await trips.execute(fx.parent.actor, { type: 'household.create', operationId: randomUUID(), expectedRevision: 0,
        profile: { guardianName: 'Synthetic Existing Parent', phone: '', pickupAreas: [], contactConsent: true, marketingConsent: false } }, true);
      let state = await trips.read(fx.parent.actor);
      const child = await trips.execute(fx.parent.actor, { type: 'child.save', operationId: randomUUID(), expectedRevision: state.revision,
        child: { name: 'Synthetic Child', age: 11, mediaUse: false, fishingExperience: '', ownsRod: false } });
      state = await trips.read(fx.parent.actor);
      const operationId = randomUUID();
      await trips.execute(fx.parent.actor, { type: 'availability.save', operationId, expectedRevision: state.revision, childId: child.id!, selection: 'any',
        options: [{ date: '2026-12-06', kind: 'local', pickupAreas: [] }], note: '' });
      const outcome = await deliverTripOperationalMail({ store: effectStore, identity: fx.config, tripConfig: fx.tripConfig, clock: fx.clock, trips, actor: fx.parent.actor },
        operationId, env, prepared.operationalAdmission, before => ({ nonIdempotent: true, send: async message => { await before(message); messages.push(message); return { providerId: 'synthetic-operational-accepted' }; } }));
      expect(outcome).toEqual([expect.objectContaining({ state: 'sent' })]); expect(messages[1]!.to).toBe(fx.parent.email); expect(messages).toHaveLength(2);
    } finally { await fx.db.close(); }
  }, 25000);
});

it('production runtime mounts configured capabilities independently and retains the original identity services', async () => {
  const env = environment(); env.LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ADMISSION_JSON = '{}';
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const original = { ...identity, clock: { now: () => new Date() }, services: { sessions: { actor: async () => ({ id: owner, workspaceId: workspace, role: 'practitioner' }) },
    auth: {}, limits: { consume: async () => ({ count: 1, retryAfterMs: 1000 }) } } };
  mocks.identity = original;
  const runtime = await individualTripsRuntime();
  expect(runtime.identity.services).toBe(original.services); expect(runtime.identity.config).toBe(config); expect(runtime.identity.store).not.toBe(store);
  expect(runtime.registrationAdmission).not.toBeNull(); expect(runtime.operationalAdmission).toBeNull();
  vi.spyOn(runtime.trips, 'read').mockResolvedValue(initialTripState());
  const response = await runtime.http.handle(new Request(origin + '/api/individual-trips', { headers: { Cookie: '__Host-ls-session=' + opaqueToken() } }));
  expect(response.status).toBe(200);
  expect((await response.json()).data.capabilities).toMatchObject({ stripeLookup: true, mailAdmission: false });
});
