import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';
vi.mock('server-only', () => ({}));
import { asId } from '../../src/lib/ids.ts';
import { parseIdentityConfig } from '../../src/features/identity/config.ts';
import { blindEmail, opaqueToken, seal, tokenDigest, unseal } from '../../src/features/identity/crypto.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import type { Actor } from '../../src/features/identity/types.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import { IndividualTripStore } from '../../src/features/individual-trips/store.ts';
import type { TripCommand, TripReply } from '../../src/features/individual-trips/contract.ts';

// A new in-memory SQL database, never a supplied URL or a production connection.
const db = new PGlite(), workspace = asId(randomUUID(), 'workspace'), ownerId = asId(randomUUID(), 'account');
const config = parseIdentityConfig({ LS_IDENTITY_ENABLED: 'true', LS_APP_ORIGIN: 'https://fishing.example.invalid', LS_IDENTITY_WORKSPACE_ID: workspace,
  LS_IDENTITY_DATA_KEYS: JSON.stringify({ synthetic: opaqueToken() }), LS_IDENTITY_ACTIVE_KEY_ID: 'synthetic', LS_IDENTITY_CSRF_KEY: opaqueToken(), LS_IDENTITY_LOOKUP_KEY: opaqueToken(), LS_IDENTITY_RATE_KEY: opaqueToken() });
const tripConfig = { workspaceId: workspace, ownerAccountId: ownerId, origin: config.origin };
let now = Date.now(); const clock = { now: () => new Date(now) };
const database: IdentityStore = { transaction: work => db.transaction(tx => work({ query: async <T extends object>(sql: string, values: readonly unknown[] = []) => (await tx.query<T>(sql, [...values])).rows })) };
const instance = () => new IndividualTripStore(database, config, tripConfig, clock);
const sessions = new IdentitySessions(database, config, clock);
const profile = (name = 'Synthetic Parent') => ({ guardianName: name, phone: '+13055550123', pickupAreas: ['boca'], contactConsent: true, marketingConsent: false });
const command = (type: string, expectedRevision: number, fields: Record<string, unknown> = {}) => ({ type, operationId: randomUUID(), expectedRevision, ...fields });
async function rows<T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) { return (await db.query<T>(sql, values)).rows; }
async function count(table: string) { return (await rows<{ n: number }>(`SELECT count(*)::integer AS n FROM ${table}`))[0]!.n; }
async function account(role: 'parent' | 'practitioner' | 'adult_client' = 'parent', id = asId(randomUUID(), 'account'), ownWorkspace = workspace) {
  const personId = asId(randomUUID(), 'person'), token = opaqueToken();
  await db.query('INSERT INTO ls_identity.workspaces(id) VALUES($1) ON CONFLICT DO NOTHING', [ownWorkspace]);
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)", [personId, ownWorkspace, seal(JSON.stringify({ displayName: 'Synthetic identity' }), `person:${ownWorkspace}:${personId}`, config.keyring), clock.now()]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-unused-password-verifier',$6,$6)", [id, ownWorkspace, role, blindEmail(`${id}@example.invalid`, config.lookupKey), seal(`${id}@example.invalid`, `email:${ownWorkspace}:${id}`, config.keyring), clock.now()]);
  await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)', [ownWorkspace, id, personId]);
  await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)', [tokenDigest(token), ownWorkspace, id, clock.now(), new Date(now + 3600_000)]);
  const actor: Actor = ownWorkspace === workspace ? await sessions.actor(token) : { id, workspaceId: ownWorkspace, personId, role, state: 'active', locale: 'en', sessionDigest: tokenDigest(token), expiresAt: now + 3600_000 };
  return { actor, token };
}
async function enroll(actor: Actor, name = 'Synthetic Parent'): Promise<TripReply> { return instance().execute(actor, command('household.create', 0, { profile: profile(name) }), true); }
async function child(actor: Actor, name = 'Synthetic child') {
  const state = await instance().read(actor);
  return instance().execute(actor, command('child.save', state.revision, { child: { name, age: 10, mediaUse: false, fishingExperience: 'Synthetic beginner', ownsRod: false } }));
}

beforeAll(async () => {
  requirePgliteMemoryEnvironment(process.env);
  await db.exec(await readFile(new URL('../../migrations/0010_ls_identity_cases_20260906.sql', import.meta.url), 'utf8'));
  const demo = await readFile(new URL('../../migrations/0097_ls_demo_provenance.sql', import.meta.url), 'utf8');
  await db.exec(demo.slice(0, demo.indexOf('-- The calendar relay')));
  await db.exec(await readFile(new URL('../../src/features/individual-trips/schema.sql', import.meta.url), 'utf8'));
}, 25000);
beforeEach(async () => { now = Date.now(); await db.exec('TRUNCATE ls_identity.workspaces CASCADE'); await db.query('INSERT INTO ls_identity.workspaces(id) VALUES($1)', [workspace]); });
afterAll(async () => { await db.close(); });

describe('individual trips native household state', () => {
  it('requires explicit enrollment and creates a fresh program household without attaching an administrative family', async () => {
    const parent = await account(), unrelatedFamily = randomUUID();
    await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)', [unrelatedFamily, workspace, 'synthetic encrypted historical label', clock.now()]);
    await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'parent')", [workspace, unrelatedFamily, parent.actor.personId]);
    await expect(instance().read(parent.actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const cmd = command('household.create', 0, { profile: profile() });
    await expect(instance().execute(parent.actor, cmd)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await count('ls_individual_trips.memberships')).toBe(0);
    const saved = await instance().execute(parent.actor, cmd, true);
    expect(saved.householdId).not.toBe(unrelatedFamily); expect(await count('ls_individual_trips.memberships')).toBe(1);
    expect(await count('ls_cases.families')).toBe(1); expect(await count('ls_cases.family_members')).toBe(1);
    for (const table of ['ls_cases.cases', 'ls_cases.case_guardians', 'ls_cases.audience_accounts']) expect(await count(table)).toBe(0);
    const reloaded = await instance().read(parent.actor);
    expect(reloaded.households[0]).toMatchObject({ id: saved.householdId, ownerAccountId: parent.actor.id, profile: profile() });
  });
  it('persists through new service instances and returns only each household with its own revision', async () => {
    const a = await account(), b = await account(); await enroll(a.actor, 'Synthetic A'); await enroll(b.actor, 'Synthetic B');
    const aChild = await child(a.actor, 'Synthetic child A'), bChild = await child(b.actor, 'Synthetic child B');
    const aRead = await instance().read(a.actor), bRead = await instance().read(b.actor);
    expect(aRead.households).toHaveLength(1); expect(bRead.households).toHaveLength(1); expect(aRead.revision).toBe(aRead.households[0]!.revision);
    expect(JSON.stringify(aRead)).not.toContain('Synthetic B'); expect(JSON.stringify(aRead)).not.toContain(bChild.id); expect(JSON.stringify(bRead)).not.toContain(aChild.id);
    await expect(instance().execute(a.actor, command('child.save', aRead.revision, { childId: bChild.id, child: { name: 'Wrong household', age: 10, mediaUse: false, fishingExperience: '', ownsRod: false } }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const owner = await account('practitioner', ownerId);
    expect((await instance().read(owner.actor)).households).toHaveLength(2);
  });
  it('denies wrong role/workspace and refuses a captured actor role instead of granting owner powers', async () => {
    const a = await account(); await enroll(a.actor);
    const foreign = await account('parent', asId(randomUUID(), 'account'), asId(randomUUID(), 'workspace'));
    await expect(instance().read(foreign.actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const adult = await account('adult_client'); await expect(instance().read(adult.actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const view = await instance().read(a.actor);
    await expect(instance().execute({ ...a.actor, role: 'practitioner' }, command('prices.update', view.revision, { local: { firstMinor: 15000, siblingMinor: 10000 }, keys: { firstMinor: 30000, siblingMinor: 25000 } }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await instance().read(a.actor)).revision).toBe(view.revision);
  });
  it.each(['membership', 'session', 'account', 'expiry'] as const)('rechecks %s revocation before reads, writes and operation replay', async kind => {
    const a = await account(), cmd = command('household.create', 0, { profile: profile() });
    await instance().execute(a.actor, cmd, true);
    if (kind === 'membership') await db.query("UPDATE ls_individual_trips.memberships SET state='revoked',revoked_at=$2 WHERE account_id=$1", [a.actor.id, clock.now()]);
    if (kind === 'session') await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE account_id=$1', [a.actor.id, clock.now()]);
    if (kind === 'account') await db.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1", [a.actor.id]);
    if (kind === 'expiry') await db.query('UPDATE ls_identity.sessions SET created_at=$2,expires_at=$3 WHERE account_id=$1', [a.actor.id, new Date(now - 7200_000), new Date(now - 1000)]);
    await expect(instance().read(a.actor)).rejects.toMatchObject({ code: kind === 'membership' ? 'NOT_FOUND' : 'UNAUTHENTICATED' });
    await expect(instance().execute(a.actor, cmd, true)).rejects.toMatchObject({ code: kind === 'membership' ? 'NOT_FOUND' : 'UNAUTHENTICATED' });
    expect(await count('ls_individual_trips.operations')).toBe(1);
  });
  it('replays exact operations once and rejects mismatched payload, stale revision and another actor’s operation ID', async () => {
    const a = await account(), b = await account(), cmd = command('household.create', 0, { profile: profile() });
    const first = await instance().execute(a.actor, cmd, true);
    const repeated = await instance().execute(a.actor, cmd, true);
    expect(repeated).toEqual({ ...first, replayed: true }); expect(await count('ls_individual_trips.operations')).toBe(1);
    await expect(instance().execute(a.actor, { ...cmd, profile: profile('Changed payload') }, true)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(instance().execute(b.actor, cmd, true)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(instance().execute(a.actor, command('household.update', 0, { profile: profile() }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await count('ls_individual_trips.memberships')).toBe(1);
  });
  it('serializes repeated PGlite operations without double membership; not a PostgreSQL MVCC race claim', async () => {
    const a = await account(), cmd = command('household.create', 0, { profile: profile() });
    const results = await Promise.all(Array.from({ length: 3 }, () => instance().execute(a.actor, cmd, true)));
    expect(new Set(results.map(row => row.householdId)).size).toBe(1); expect(await count('ls_individual_trips.memberships')).toBe(1); expect(await count('ls_individual_trips.operations')).toBe(1);
  });
  it('round-trips chunked Unicode state larger than 64 KiB without weakening shared encryption bounds', async () => {
    const a = await account(); await enroll(a.actor); const added = await child(a.actor), note = '漢🙂'.repeat(600);
    let revision = added.revision;
    for (let index = 0; index < 19; index++) revision = (await instance().execute(a.actor, command('availability.save', revision, { childId: added.id, selection: 'any', options: [{ date: '2026-12-06', kind: 'local', pickupAreas: ['boca'] }], note }))).revision;
    const reloaded = await instance().read(a.actor);
    expect(Buffer.byteLength(JSON.stringify(reloaded), 'utf8')).toBeGreaterThan(65_536);
    expect(reloaded.households[0]!.availability).toHaveLength(19); expect(reloaded.households[0]!.availability.every(row => row.note === note)).toBe(true);
    const chunks = await rows<{ payload_ciphertext: string }>('SELECT payload_ciphertext FROM ls_individual_trips.state_chunks'); expect(chunks.length).toBeGreaterThan(1);
    expect(JSON.stringify(chunks)).not.toContain('漢'); expect(JSON.stringify(chunks)).not.toContain('Synthetic Parent');
    const [manifestRow] = await rows<{ revision: number; payload_ciphertext: string }>('SELECT revision,payload_ciphertext FROM ls_individual_trips.state');
    const manifest = JSON.parse(unseal(manifestRow!.payload_ciphertext, `individual-trips:${workspace}:${manifestRow!.revision}`, config.keyring)) as { format: string; count: number };
    expect(manifest).toMatchObject({ format: 'encrypted-chunks-v1', count: chunks.length });
  });
  it.each(['ciphertext', 'missing_chunk', 'digest', 'wrong_chunk_aad'] as const)('fails neutrally for %s tampering without empty-state fallback', async kind => {
    const a = await account(); await enroll(a.actor);
    const [row] = await rows<{ revision: number; payload_ciphertext: string }>('SELECT revision,payload_ciphertext FROM ls_individual_trips.state');
    if (kind === 'ciphertext') await db.query("UPDATE ls_individual_trips.state SET payload_ciphertext='broken' WHERE workspace_id=$1", [workspace]);
    if (kind === 'missing_chunk') await db.query('DELETE FROM ls_individual_trips.state_chunks WHERE workspace_id=$1', [workspace]);
    if (kind === 'digest') {
      const manifest = JSON.parse(unseal(row!.payload_ciphertext, `individual-trips:${workspace}:${row!.revision}`, config.keyring)) as Record<string, unknown>;
      await db.query('UPDATE ls_individual_trips.state SET payload_ciphertext=$2 WHERE workspace_id=$1', [workspace, seal(JSON.stringify({ ...manifest, sha256: '0'.repeat(64) }), `individual-trips:${workspace}:${row!.revision}`, config.keyring)]);
    }
    if (kind === 'wrong_chunk_aad') await db.query('UPDATE ls_individual_trips.state_chunks SET payload_ciphertext=$2 WHERE workspace_id=$1', [workspace, seal(Buffer.from('synthetic').toString('base64'), `trip-chunk:${workspace}:${row!.revision}:999`, config.keyring)]);
    await expect(instance().read(a.actor)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(instance().execute(a.actor, command('household.update', 1, { profile: profile('Must not overwrite corruption') }))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await count('ls_individual_trips.operations')).toBe(1);
  });
  it('rejects browser use of internal payment/deadline commands at the native store boundary', async () => {
    const owner = await account('practitioner', ownerId);
    const raw = command('payment.record_unknown', 0, { offerId: randomUUID() }) as TripCommand;
    await expect(instance().execute(owner.actor, raw)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await count('ls_individual_trips.state')).toBe(0);
  });
});
