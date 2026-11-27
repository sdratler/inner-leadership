import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';
import { asId } from '../../src/lib/ids.ts';
import { IdentityAuthService } from '../../src/features/identity/auth-service.ts';
import { parseIdentityConfig } from '../../src/features/identity/config.ts';
import { opaqueToken, seal, tokenDigest, unseal } from '../../src/features/identity/crypto.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import { IndividualTripRegistrationService, INDIVIDUAL_TRIP_REGISTRATION_VERSION } from '../../src/features/individual-trips/registration-service.ts';
import { deliverRegistrationMail, scheduleRegistrationDelivery, type RegistrationMailAdmission, type RegistrationTransportFactory } from '../../src/features/individual-trips/registration-mail.ts';

// Real SQL, adult-subject constraints, crypto, activation and auth dispatcher in
// an ephemeral in-memory engine. No DSN, server, email or provider test exists.
const db = new PGlite(), workspace = asId(randomUUID(), 'workspace');
const origin = 'https://fishing.example.invalid', target = 'postgresql://synthetic.invalid/never-connected';
const config = parseIdentityConfig({ LS_IDENTITY_ENABLED: 'true', LS_APP_ORIGIN: origin, LS_IDENTITY_WORKSPACE_ID: workspace,
  LS_IDENTITY_DATA_KEYS: JSON.stringify({ synthetic: opaqueToken() }), LS_IDENTITY_ACTIVE_KEY_ID: 'synthetic',
  LS_IDENTITY_CSRF_KEY: opaqueToken(), LS_IDENTITY_LOOKUP_KEY: opaqueToken(), LS_IDENTITY_RATE_KEY: opaqueToken() });
let now = Date.now();
const clock = { now: () => new Date(now) }, network = vi.fn(async () => { throw Error('REAL_NETWORK_NOT_ADMITTED'); });
const store: IdentityStore = {
  transaction: work => db.transaction(tx => work({ query: async <T extends object>(sql: string, values: readonly unknown[] = []) =>
    (await tx.query<T>(sql, [...values])).rows })),
  bindDatabaseTarget: expected => expected === target ? store : null,
};
const service = new IndividualTripRegistrationService(store, config, clock), runtime = { store, config, clock };
const admission: RegistrationMailAdmission = { purpose: INDIVIDUAL_TRIP_REGISTRATION_VERSION, workspaceId: workspace, origin, databaseUrl: target };
const mailEnv = { LS_DATABASE_URL: target, LS_INDIVIDUAL_TRIPS_ENABLED: 'true', LS_INDIVIDUAL_TRIPS_WORKSPACE_ID: workspace, LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ENABLED: 'true',
  LS_AUTH_EMAIL_ENABLED: 'true', LS_AUTH_EMAIL_PROVIDER: 'gmail', LS_AUTH_GOOGLE_CLIENT_ID: 'synthetic-client',
  LS_AUTH_GOOGLE_CLIENT_SECRET: 'synthetic-secret', LS_AUTH_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh',
  LS_AUTH_EMAIL_FROM: 'office@bneineviimacademy.org' };
const input = (email = `synthetic-${randomUUID()}@example.invalid`) => ({ operationId: randomUUID(), email, displayName: 'Synthetic Parent', locale: 'en' as const, adultConfirmed: true as const });
async function rows<T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) { return (await db.query<T>(sql, values)).rows; }
async function receipt(requestId: string) { return (await rows<{ outbox_id: string | null; account_id: string | null; delivery_state: string }>(
  'SELECT outbox_id,account_id,delivery_state FROM ls_individual_trips.registration_receipts WHERE request_id=$1', [requestId]))[0]!; }
async function count(table: string) { return (await rows<{ n: number }>('SELECT count(*)::integer AS n FROM ' + table))[0]!.n; }
function sender(effect: (message: Parameters<ReturnType<RegistrationTransportFactory>['send']>[0]) => Promise<{ providerId: string }>): RegistrationTransportFactory {
  return beforeSend => ({ nonIdempotent: true, send: async message => { beforeSend(message); return effect(message); } });
}
async function invite() { const command = input(), requestId = randomUUID(); await service.register(command, requestId); return { command, requestId, saved: await receipt(requestId) }; }

beforeAll(async () => {
  requirePgliteMemoryEnvironment(process.env); vi.stubGlobal('fetch', network);
  await db.exec(await readFile(new URL('../../migrations/0010_ls_identity_cases_20260906.sql', import.meta.url), 'utf8'));
  const demo = await readFile(new URL('../../migrations/0097_ls_demo_provenance.sql', import.meta.url), 'utf8');
  await db.exec(demo.slice(0, demo.indexOf('-- The calendar relay')));
  await db.exec(await readFile(new URL('../../src/features/individual-trips/registration-schema.sql', import.meta.url), 'utf8'));
}, 25000);
beforeEach(async () => { now = Date.now(); await db.exec('TRUNCATE ls_identity.workspaces CASCADE'); await db.query('INSERT INTO ls_identity.workspaces(id) VALUES($1)', [workspace]); });
afterAll(async () => { try { expect(network).not.toHaveBeenCalled(); await db.close(); } finally { vi.unstubAllGlobals(); } });

describe('free Fishing adult identity registration', () => {
  it('creates only an invited adult parent with encrypted details and one existing invite-token/outbox pair', async () => {
    const command = input(), requestId = randomUUID();
    const response = await service.register(command, requestId), saved = await receipt(requestId);
    expect(response).toEqual({ accepted: true });
    const [account] = await rows<{ id: string; state: string; role: string; password_hash: string | null; email_verified_at: Date | null; email_ciphertext: string; profile_ciphertext: string; kind: string }>(
      `SELECT a.*,p.profile_ciphertext,p.kind FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.account_id=a.id
       JOIN ls_identity.people p ON p.id=s.person_id WHERE a.id=$1`, [saved.account_id]);
    expect(account).toMatchObject({ state: 'invited', role: 'parent', kind: 'adult', password_hash: null, email_verified_at: null });
    expect(JSON.stringify(account)).not.toContain(command.email); expect(JSON.stringify(account)).not.toContain(command.displayName);
    expect(saved).toMatchObject({ delivery_state: 'queued' });
    expect(await count('ls_identity.auth_tokens')).toBe(1); expect(await count('ls_identity.auth_mail_outbox')).toBe(1);
    for (const table of ['ls_identity.sessions', 'ls_cases.families', 'ls_cases.family_members', 'ls_cases.cases', 'ls_cases.case_guardians', 'ls_cases.audience_accounts']) expect(await count(table)).toBe(0);
    const auth = new IdentityAuthService(store, config, clock), preauth = await auth.preauth();
    await expect(auth.login(command.email, 'synthetic password', preauth.token, randomUUID())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('activates through existing consumePasswordToken and still requires ordinary fresh login', async () => {
    const { command, saved } = await invite();
    const [outbox] = await rows<{ payload_ciphertext: string }>('SELECT payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE id=$1', [saved.outbox_id]);
    const payload = JSON.parse(unseal(outbox!.payload_ciphertext, `auth-mail:${workspace}:${saved.outbox_id}`, config.keyring));
    const auth = new IdentityAuthService(store, config, clock);
    await auth.consumePasswordToken('invite', payload.token, 'synthetic password', randomUUID());
    expect(await count('ls_identity.sessions')).toBe(0); expect(await count('ls_cases.case_guardians')).toBe(0);
    await expect(auth.consumePasswordToken('invite', payload.token, 'another password', randomUUID())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const preauth = await auth.preauth();
    expect(await auth.login(command.email, 'synthetic password', preauth.token, randomUUID())).toHaveProperty('token');
    expect(await count('ls_identity.sessions')).toBe(1);
  });

  it('renews only an expired program-owned invite, preserves identity details, and still requires activation then ordinary login', async () => {
    const original = await invite(), before = await rows('SELECT * FROM ls_identity.accounts'), people = await rows('SELECT * FROM ls_identity.people');
    const oldMail = (await rows<{ token_digest: string }>('SELECT token_digest FROM ls_identity.auth_mail_outbox WHERE id=$1', [original.saved.outbox_id]))[0]!;
    now += 24 * 3600_000;
    const renewal = { ...input(original.command.email), displayName: 'Changed caller name must not replace identity', locale: 'he' as const }, requestId = randomUUID();
    expect(await service.register(renewal, requestId)).toEqual({ accepted: true });
    const saved = await receipt(requestId);
    expect(saved).toMatchObject({ account_id: original.saved.account_id, delivery_state: 'queued' });
    expect(saved.outbox_id).not.toBe(original.saved.outbox_id);
    expect(await rows('SELECT * FROM ls_identity.accounts')).toEqual(before); expect(await rows('SELECT * FROM ls_identity.people')).toEqual(people);
    expect(await count('ls_identity.accounts')).toBe(1); expect(await count('ls_identity.auth_tokens')).toBe(2);
    expect((await rows<{ revoked_at: Date | null }>('SELECT revoked_at FROM ls_identity.auth_tokens WHERE token_digest=$1', [oldMail.token_digest]))[0]!.revoked_at).not.toBeNull();
    const outbox = (await rows<{ payload_ciphertext: string; token_digest: string }>('SELECT payload_ciphertext,token_digest FROM ls_identity.auth_mail_outbox WHERE id=$1', [saved.outbox_id]))[0]!;
    expect(outbox.token_digest).not.toBe(oldMail.token_digest);
    const token = JSON.parse(unseal(outbox.payload_ciphertext, `auth-mail:${workspace}:${saved.outbox_id}`, config.keyring)).token;
    const auth = new IdentityAuthService(store, config, clock);
    await auth.consumePasswordToken('invite', token, 'renewed synthetic password', randomUUID());
    expect(await count('ls_identity.sessions')).toBe(0);
    const preauth = await auth.preauth();
    expect(await auth.login(original.command.email, 'renewed synthetic password', preauth.token, randomUUID())).toHaveProperty('token');
    for (const table of ['ls_cases.families', 'ls_cases.family_members', 'ls_cases.cases', 'ls_cases.case_guardians', 'ls_cases.audience_accounts']) expect(await count(table)).toBe(0);
  });

  it('keeps expiry recovery bound to its new operation/request and does not replace its now-live token on replay or a second signup', async () => {
    const original = await invite(); now += 24 * 3600_000;
    const renewal = input(original.command.email), requestId = randomUUID();
    await service.register(renewal, requestId);
    const saved = await receipt(requestId), tokens = await rows('SELECT * FROM ls_identity.auth_tokens ORDER BY token_digest');
    const replayRequest = randomUUID(); expect(await service.register(renewal, replayRequest)).toEqual({ accepted: true });
    expect(await receipt(replayRequest)).toBeUndefined(); expect(await receipt(requestId)).toEqual(saved);
    const nextRequest = randomUUID(); expect(await service.register(input(original.command.email), nextRequest)).toEqual({ accepted: true });
    expect(await receipt(nextRequest)).toEqual({ account_id: null, outbox_id: null, delivery_state: 'suppressed' });
    expect(await rows('SELECT * FROM ls_identity.auth_tokens ORDER BY token_digest')).toEqual(tokens);
    const messages: unknown[] = [], provider = sender(async message => { messages.push(message); return { providerId: 'synthetic-renewal-id' }; });
    expect(await deliverRegistrationMail(runtime, requestId, mailEnv, admission, provider)).toBe('sent');
    expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({ idempotencyKey: `ls-auth-${saved.outbox_id}`, to: original.command.email });
    expect(await deliverRegistrationMail(runtime, replayRequest, mailEnv, admission, provider)).toBe('suppressed');
    expect(await deliverRegistrationMail(runtime, nextRequest, mailEnv, admission, provider)).toBe('suppressed'); expect(messages).toHaveLength(1);
  });

  it('can recover another expiry while preserving original program provenance and all prior receipt bytes', async () => {
    const original = await invite(); now += 24 * 3600_000;
    const secondId = randomUUID(); await service.register(input(original.command.email), secondId);
    const previous = await rows('SELECT * FROM ls_individual_trips.registration_receipts ORDER BY created_at');
    now += 24 * 3600_000;
    const thirdId = randomUUID(); await service.register(input(original.command.email), thirdId);
    expect(await count('ls_identity.accounts')).toBe(1); expect(await count('ls_identity.auth_tokens')).toBe(3);
    expect((await receipt(thirdId)).account_id).toBe(original.saved.account_id);
    expect(await rows('SELECT * FROM ls_individual_trips.registration_receipts WHERE request_id<>$1 ORDER BY created_at', [thirdId])).toEqual(previous);
  });

  it('leaves an expired invited parent without exact program creation proof untouched', async () => {
    const original = await invite();
    await db.query('DELETE FROM ls_individual_trips.registration_receipts WHERE request_id=$1', [original.requestId]);
    now += 24 * 3600_000;
    const tokens = await rows('SELECT * FROM ls_identity.auth_tokens'), mail = await rows('SELECT * FROM ls_identity.auth_mail_outbox'), requestId = randomUUID();
    expect(await service.register(input(original.command.email), requestId)).toEqual({ accepted: true });
    expect(await receipt(requestId)).toEqual({ account_id: null, outbox_id: null, delivery_state: 'suppressed' });
    expect(await rows('SELECT * FROM ls_identity.auth_tokens')).toEqual(tokens); expect(await rows('SELECT * FROM ls_identity.auth_mail_outbox')).toEqual(mail);
  });

  it.each(['used_at', 'revoked_at'] as const)('does not undo a program-owned invite whose %s authority was recorded', async authority => {
    const original = await invite(); now += 24 * 3600_000;
    // The SQL identifier is a fixed test table value, never caller input.
    await db.query(`UPDATE ls_identity.auth_tokens SET ${authority}=$1`, [clock.now()]);
    const tokens = await rows('SELECT * FROM ls_identity.auth_tokens'), mail = await rows('SELECT * FROM ls_identity.auth_mail_outbox'), requestId = randomUUID();
    expect(await service.register(input(original.command.email), requestId)).toEqual({ accepted: true });
    expect(await receipt(requestId)).toEqual({ account_id: null, outbox_id: null, delivery_state: 'suppressed' });
    expect(await rows('SELECT * FROM ls_identity.auth_tokens')).toEqual(tokens); expect(await rows('SELECT * FROM ls_identity.auth_mail_outbox')).toEqual(mail);
  });

  it.each(['live', 'used', 'revoked'] as const)('does not replace a later %s invitation even when an older owned invite is expired and unused', async state => {
    const original = await invite(); now += 24 * 3600_000;
    await db.query(`INSERT INTO ls_identity.auth_tokens(token_digest,workspace_id,account_id,purpose,created_at,expires_at,used_at,revoked_at)
      VALUES($1,$2,$3,'invite',$4,$5,$6,$7)`, [tokenDigest(opaqueToken()), workspace, original.saved.account_id, clock.now(), new Date(now + 3600_000),
      state === 'used' ? clock.now() : null, state === 'revoked' ? clock.now() : null]);
    const tokens = await rows('SELECT * FROM ls_identity.auth_tokens ORDER BY token_digest'), requestId = randomUUID();
    expect(await service.register(input(original.command.email), requestId)).toEqual({ accepted: true });
    expect(await receipt(requestId)).toEqual({ account_id: null, outbox_id: null, delivery_state: 'suppressed' });
    expect(await rows('SELECT * FROM ls_identity.auth_tokens ORDER BY token_digest')).toEqual(tokens); expect(await count('ls_identity.auth_mail_outbox')).toBe(1);
  });

  it('requires the receipt outbox token to belong to the same account rather than an unrelated expired invite', async () => {
    const original = await invite(), other = await invite();
    const otherToken = (await rows<{ token_digest: string }>('SELECT token_digest FROM ls_identity.auth_mail_outbox WHERE id=$1', [other.saved.outbox_id]))[0]!.token_digest;
    await db.query('UPDATE ls_identity.auth_mail_outbox SET token_digest=$2 WHERE id=$1', [original.saved.outbox_id, otherToken]);
    now += 24 * 3600_000;
    const requestId = randomUUID(); await service.register(input(original.command.email), requestId);
    expect(await receipt(requestId)).toEqual({ account_id: null, outbox_id: null, delivery_state: 'suppressed' });
    expect(await count('ls_identity.auth_tokens')).toBe(2);
  });

  it.each(['active', 'invited', 'revoked', 'wrong_role'] as const)('keeps %s identities/tokens unchanged and returns the same accepted response', async variant => {
    const { command, saved } = await invite();
    if (variant !== 'invited') await db.query(`UPDATE ls_identity.accounts SET state=$2,password_hash=$3,email_verified_at=$4,role=$5 WHERE id=$1`,
      [saved.account_id, variant === 'wrong_role' ? 'active' : variant, variant === 'active' || variant === 'wrong_role' ? 'synthetic-not-login-hash' : null,
        variant === 'active' || variant === 'wrong_role' ? clock.now() : null, variant === 'wrong_role' ? 'adult_client' : 'parent']);
    const before = await rows('SELECT * FROM ls_identity.accounts'), tokens = await rows('SELECT * FROM ls_identity.auth_tokens'), oldMail = await rows('SELECT * FROM ls_identity.auth_mail_outbox');
    const requestId = randomUUID();
    expect(await service.register({ ...input(command.email.toUpperCase()), displayName: 'Different Entered Name', locale: 'he' }, requestId)).toEqual({ accepted: true });
    expect(await rows('SELECT * FROM ls_identity.accounts')).toEqual(before); expect(await rows('SELECT * FROM ls_identity.auth_tokens')).toEqual(tokens);
    expect(await rows('SELECT * FROM ls_identity.auth_mail_outbox')).toEqual(oldMail);
    expect(await receipt(requestId)).toEqual({ account_id: null, outbox_id: null, delivery_state: 'suppressed' });
  });

  it('replays a stable operation without creating mail, refreshing expiry or rebinding a new request ID', async () => {
    const { command, saved, requestId } = await invite(), nextRequest = randomUUID();
    const before = await rows('SELECT * FROM ls_identity.auth_tokens'); now += 60_000;
    expect(await service.register(command, nextRequest)).toEqual({ accepted: true });
    expect(await count('ls_individual_trips.registration_receipts')).toBe(1); expect(await count('ls_identity.auth_mail_outbox')).toBe(1);
    expect(await rows('SELECT * FROM ls_identity.auth_tokens')).toEqual(before); expect(await receipt(requestId)).toEqual(saved);
    expect(await receipt(nextRequest)).toBeUndefined();
    await expect(service.register({ ...command, email: 'different@example.invalid' }, randomUUID())).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('serializes repeated operations in PGlite without duplicate identities (not an MVCC concurrency proof)', async () => {
    const command = input(); await Promise.all(Array.from({ length: 4 }, () => service.register(command, randomUUID())));
    expect(await count('ls_identity.accounts')).toBe(1); expect(await count('ls_identity.auth_mail_outbox')).toBe(1);
  });

  it('rejects missing adult confirmation, injected identity fields and invalid names before creating anything', async () => {
    for (const command of [{ ...input(), adultConfirmed: false }, { ...input(), personId: randomUUID() }, { ...input(), displayName: 'Injected\nName' }])
      await expect(service.register(command as never, randomUUID())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await count('ls_identity.accounts')).toBe(0);
    const { saved } = await invite(), minor = randomUUID();
    await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor',$3,$4)", [minor, workspace, seal('{}', 'synthetic', config.keyring), clock.now()]);
    await expect(db.query('UPDATE ls_identity.account_subjects SET person_id=$2 WHERE account_id=$1', [saved.account_id, minor])).rejects.toThrow('IDENTITY_ADULT_SUBJECT_REQUIRED');
  });

  it('cannot gain a prior private case/family/audience from matching an entered email', async () => {
    const prior = await invite();
    // A genuine prior parent can already have private grants; register is not
    // allowed to inspect, replace, or add to them by matching its email.
    const ids = Array.from({ length: 7 }, () => randomUUID()), [owner, ownerPerson, child, client, family, caseId, audience] = ids;
    await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3),($4,$2,'minor','synthetic',$3)", [ownerPerson, workspace, clock.now(), child]);
    await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,created_at,updated_at) VALUES($1,$2,'practitioner','invited','en',$3,'synthetic',$4,$4)", [owner, workspace, randomBytes(32).toString('hex'), clock.now()]);
    await db.query('INSERT INTO ls_identity.account_subjects VALUES($1,$2,$3)', [workspace, owner, ownerPerson]);
    await db.query("INSERT INTO ls_cases.families VALUES($1,$2,'private',$3)", [family, workspace, clock.now()]);
    await db.query("INSERT INTO ls_cases.clients VALUES($1,$2,$3,$4)", [client, workspace, child, clock.now()]);
    await db.query("INSERT INTO ls_cases.cases VALUES($1,$2,$3,$4,$5,'active',$6,$6)", [caseId, workspace, client, family, owner, clock.now()]);
    await db.query("INSERT INTO ls_cases.case_guardians VALUES($1,$2,$3,$4,NULL)", [workspace, caseId, prior.saved.account_id, clock.now()]);
    await db.query("INSERT INTO ls_cases.audiences VALUES($1,$2,$3,'private',true,$4)", [audience, workspace, caseId, clock.now()]);
    await db.query('INSERT INTO ls_cases.audience_accounts VALUES($1,$2,$3,$4,$5,NULL)', [workspace, caseId, audience, prior.saved.account_id, clock.now()]);
    const before = await rows('SELECT * FROM ls_cases.case_guardians'), audienceBefore = await rows('SELECT * FROM ls_cases.audience_accounts');
    now += 24 * 3600_000;
    await service.register(input(prior.command.email), randomUUID()); await service.register(input(), randomUUID());
    expect(await rows('SELECT * FROM ls_cases.case_guardians')).toEqual(before);
    expect(await rows('SELECT * FROM ls_cases.audience_accounts')).toEqual(audienceBefore); expect(await count('ls_cases.family_members')).toBe(0);
  });
});

describe('request-bound registration invitation delivery', () => {
  it('delivers only the accepted request exact invite; unrelated and replay requests remain untouched', async () => {
    const first = await invite(), second = await invite(), messages: unknown[] = [];
    const provider = sender(async message => { messages.push(message); return { providerId: 'synthetic-gmail-id' }; });
    expect(await deliverRegistrationMail(runtime, first.requestId, mailEnv, admission, provider)).toBe('sent');
    expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({ to: first.command.email, idempotencyKey: `ls-auth-${first.saved.outbox_id}` });
    expect(messages[0]).toHaveProperty('text', expect.stringContaining('/en/login?mode=invite&next=%2Fen%2Ftrips#token='));
    const activationLine = (messages[0] as { text: string }).text.split('\n').find(line => line.startsWith(origin + '/en/login'))!;
    expect(new URL(activationLine).searchParams.get('next')).toBe('/en/trips');
    expect(await receipt(second.requestId)).toMatchObject({ delivery_state: 'queued' });
    expect((await rows('SELECT state FROM ls_identity.auth_mail_outbox WHERE id=$1', [second.saved.outbox_id]))[0]).toEqual({ state: 'queued' });
    expect(await deliverRegistrationMail(runtime, first.requestId, mailEnv, admission, provider)).toBe('sent'); expect(messages).toHaveLength(1);
    const replayRequest = randomUUID(); await service.register(first.command, replayRequest);
    expect(await deliverRegistrationMail(runtime, replayRequest, mailEnv, admission, provider)).toBe('suppressed'); expect(messages).toHaveLength(1);
  });

  it('keeps a Hebrew activation link and its post-login return inside the Hebrew Fishing workspace', async () => {
    const requestId = randomUUID(); await service.register({ ...input(), locale: 'he' }, requestId);
    const messages: { text: string }[] = [];
    expect(await deliverRegistrationMail(runtime, requestId, mailEnv, admission, sender(async message => { messages.push(message); return { providerId: 'synthetic-he-invite' }; }))).toBe('sent');
    const line = messages[0]!.text.split('\n').find(value => value.startsWith(origin + '/he/login'))!, link = new URL(line);
    expect(link.pathname).toBe('/he/login'); expect(link.searchParams.get('mode')).toBe('invite'); expect(link.searchParams.get('next')).toBe('/he/trips');
  });

  it('does not send without explicit admission, feature gates and exact driver target binding', async () => {
    const { requestId } = await invite(), provider = vi.fn(sender(async () => ({ providerId: 'never' })));
    for (const [environment, grant, selectedRuntime] of [
      [mailEnv, null, runtime], [{ ...mailEnv, LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ENABLED: 'false' }, admission, runtime],
      [{ ...mailEnv, LS_DATABASE_URL: target + '-other' }, admission, runtime],
      [mailEnv, { ...admission, workspaceId: asId(randomUUID(), 'workspace') }, runtime],
      [mailEnv, admission, { ...runtime, store: { transaction: store.transaction } }],
    ] as const) expect(await deliverRegistrationMail(selectedRuntime, requestId, environment, grant, provider)).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled(); expect(await receipt(requestId)).toMatchObject({ delivery_state: 'queued' });
  });

  it('suppresses existing identities and rejects revoked/expired invite eligibility without provider calls', async () => {
    const first = await invite(), existingId = randomUUID(); await service.register(input(first.command.email), existingId);
    const effect = vi.fn(async () => ({ providerId: 'never' }));
    expect(await deliverRegistrationMail(runtime, existingId, mailEnv, admission, sender(effect))).toBe('suppressed');
    await db.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1", [first.saved.account_id]);
    expect(await deliverRegistrationMail(runtime, first.requestId, mailEnv, admission, sender(effect))).toBe('canceled');
    const expired = await invite(); now += 24 * 3600_000;
    expect(await deliverRegistrationMail(runtime, expired.requestId, mailEnv, admission, sender(effect))).toBe('canceled'); expect(effect).not.toHaveBeenCalled();
  });

  it('records uncertain provider acceptance as terminal unknown and never resends it', async () => {
    const { requestId } = await invite(), effect = vi.fn(async () => { throw new Error('synthetic timeout after possible acceptance'); });
    expect(await deliverRegistrationMail(runtime, requestId, mailEnv, admission, sender(effect))).toBe('unknown');
    expect(await receipt(requestId)).toMatchObject({ delivery_state: 'unknown' });
    expect(await deliverRegistrationMail(runtime, requestId, mailEnv, admission, sender(effect))).toBe('unknown'); expect(effect).toHaveBeenCalledTimes(1);
  });

  it('keeps pre-send failures terminal and never retries an old outbox', async () => {
    const { requestId } = await invite(); let calls = 0;
    const provider: RegistrationTransportFactory = () => ({ send: async () => { calls++; throw new Error('synthetic OAuth failure before message send'); } });
    expect(await deliverRegistrationMail(runtime, requestId, mailEnv, admission, provider)).toBe('failed');
    expect(await deliverRegistrationMail(runtime, requestId, mailEnv, admission, provider)).toBe('failed'); expect(calls).toBe(1);
  });

  it('persists an admitted sender-configuration failure without falsely marking sent or calling a transport', async () => {
    const { requestId } = await invite(), provider = vi.fn(sender(async () => ({ providerId: 'never' })));
    expect(await deliverRegistrationMail(runtime, requestId, { ...mailEnv, LS_AUTH_GOOGLE_CLIENT_SECRET: undefined }, admission, provider)).toBe('failed');
    expect(await receipt(requestId)).toMatchObject({ delivery_state: 'failed' }); expect(provider).not.toHaveBeenCalled();
  });

  it('schedules only the canonical accepted POST; GET and unrelated route/status cannot schedule', async () => {
    const { requestId } = await invite(), scheduled: (() => Promise<void>)[] = [];
    const response = () => Response.json({ ok: true, data: { accepted: true }, requestId }, { status: 202 });
    for (const [url, method, status] of [[origin + '/api/individual-trips/register', 'GET', 202], [origin + '/api/identity/reset/request', 'POST', 202],
      [origin + '/api/individual-trips/register', 'POST', 400], ['https://wrong.example.invalid/api/individual-trips/register', 'POST', 202]] as const)
      await scheduleRegistrationDelivery(new Request(url, { method }), new Response(response().body, { status }), runtime, mailEnv, cb => scheduled.push(cb), admission);
    expect(scheduled).toHaveLength(0);
    await scheduleRegistrationDelivery(new Request(origin + '/api/individual-trips/register', { method: 'POST' }), response(), runtime, mailEnv, cb => scheduled.push(cb), admission);
    expect(scheduled).toHaveLength(1); // Deliberately do not execute a real provider callback.
  });
});
