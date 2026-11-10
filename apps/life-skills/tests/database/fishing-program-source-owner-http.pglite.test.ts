import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { initializeProgramSchema, nativeProgramFixture, programClock, programNow, programRing } from '../fixtures/fishing-native-program-v3.ts';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import { opaqueToken, tokenDigest } from '../../src/features/identity/crypto.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import { AppError } from '../../src/lib/errors.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import type { GroupPreparationIdentityRuntime } from '../../src/lib/fishing-group-preparation-owner-runtime.ts';
import { fishingProgramSourceOwnerHttp } from '../../src/lib/fishing-program-source-owner-http.ts';
import { composeFishingProgramSourceOwnerRuntime } from '../../src/lib/fishing-program-source-owner-runtime.ts';
import { PROGRAM_SOURCE_OWNER_PATH, programSourceGroupDataV3Schema } from '../../src/features/fishing-billing/program-source-owner-contract-v3.ts';
import { PROGRAM_SOURCE_V3, programSourceCommandV3Schema } from '../../src/features/fishing-billing/program-source-contract-v3.ts';
import { GET, POST } from '../../src/app/api/private/fishing-program-sources/route.ts';

vi.mock('server-only', () => ({}));
let resolved: GroupPreparationIdentityRuntime;
vi.mock('../../src/features/identity/runtime.ts', () => ({ identityRuntime: async () => resolved }));
let engine: PGlite;
const lookupKey = Buffer.alloc(32, 9), origin = 'https://fishing-owner.example.invalid';
const noNetwork = vi.fn(async () => { throw Error('NETWORK_FORBIDDEN'); });
beforeAll(async () => { requirePgliteMemoryEnvironment(process.env); vi.stubGlobal('fetch', noNetwork); engine = new PGlite(); await initializeProgramSchema(engine); }, 20000);
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
afterAll(async () => { try { await engine?.close(); } finally { vi.unstubAllGlobals(); } });

async function fixture() { return nativeProgramFixture(engine, lookupKey.toString('hex')); }
async function harness(f: Awaited<ReturnType<typeof fixture>>, options: { account?: typeof f.owner; env?: Record<string, string | undefined>; store?: IdentityStore } = {}) {
  const actor = options.account ?? f.owner, token = opaqueToken(), config = { enabled: true, workspaceId: f.workspace, origin, keyring: programRing, lookupKey, csrfKey: Buffer.alloc(32, 2), rateLimitKey: 'synthetic-rate-key-for-owner-tests', sessionSeconds: 3600 };
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)', [tokenDigest(token), f.workspace, actor.id, programNow, new Date('2036-01-01T00:00:00Z')]);
  const sessions = new IdentitySessions(f.db, config, programClock);
  const runtime: GroupPreparationIdentityRuntime = { config, clock: programClock, store: options.store ?? f.db, services: { sessions, limits: new PostgresIdentityRateStore(f.db) } };
  const env = options.env ?? { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: f.owner.id };
  function request(body?: unknown, query?: string, headers: Record<string, string> = {}) {
    const host = new URL(origin).host;
    return new Request(origin + PROGRAM_SOURCE_OWNER_PATH + (query ?? ''), { method: query ? 'GET' : 'POST',
      headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', cookie: `${SESSION_COOKIE}=${token}`, origin, 'sec-fetch-site': 'same-origin', 'x-csrf-token': sessions.csrf(token), 'content-type': 'application/json', ...headers },
      ...(query ? {} : { body: JSON.stringify(body) }) });
  }
  return { token, runtime, request, call: (body?: unknown, query?: string, headers?: Record<string, string>) => fishingProgramSourceOwnerHttp(request(body, query, headers), async () => composeFishingProgramSourceOwnerRuntime(runtime, env)) };
}
async function count(f: Awaited<ReturnType<typeof fixture>>) {
  return (await engine.query<{ n: number }>('SELECT count(*)::int AS n FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1', [f.workspace])).rows[0]!.n;
}
it('native owner program HTTP mounts real scheduling and sibling progression, then reloads through a new real session', async () => {
  const f = await fixture(), h = await harness(f); resolved = h.runtime; vi.stubEnv('LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID', f.owner.id);
  const commands = [f.group(), f.lesson(randomUUID(), 1, '2035-01-31T21:30:00Z'), f.progression(0, '2035-01-31T00:00:00Z'), f.progression(1, '2035-01-31T00:00:00Z')];
  for (const command of commands) { const response = await POST(h.request(command)); expect(response.status).toBe(200); expect((await response.json()).data).toMatchObject({ kind: 'recorded_source', replayed: false, record: { recordedBy: f.owner.id, command } }); }
  const fresh = await harness(f); resolved = fresh.runtime;
  const response = await GET(fresh.request(undefined, '?groupId=' + f.groupId)); expect(response.status).toBe(200);
  const data = programSourceGroupDataV3Schema.parse((await response.json()).data);
  expect(data.classification).toBe('scheduling_facts_only'); expect(data.group.record.command.fields).toMatchObject({ state: 'forming' });
  expect(data.lessons).toHaveLength(1); expect(data.progressions.map(p => p.record.command.id).sort()).toEqual(f.family.command.selection.children.map(c => c.nativeChildId).sort());
  expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(response.headers.get('Vary')).toBe('Cookie'); expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  expect((await engine.query('SELECT line_id FROM ls_fishing_billing.obligations WHERE workspace_id=$1', [f.workspace])).rows).toEqual([]);
  expect((await engine.query('SELECT id FROM ls_fishing_billing.reminders WHERE workspace_id=$1', [f.workspace])).rows).toEqual([]);
});
it.each(['parent', 'wrong-owner', 'missing-binding', 'revoked'] as const)('native owner program HTTP denies %s before native schedule changes', async kind => {
  const f = await fixture(), h = await harness(f, { ...(kind === 'parent' ? { account: f.parent } : {}), ...(kind === 'wrong-owner' ? { env: { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: randomUUID() } } : {}), ...(kind === 'missing-binding' ? { env: {} } : {}) });
  if (kind === 'revoked') await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [tokenDigest(h.token), programNow]);
  const response = await h.call(f.group()); expect(response.status).toBe(kind === 'missing-binding' ? 503 : kind === 'revoked' ? 401 : 403); expect(await count(f)).toBe(0);
});
it('native owner program HTTP rejects cross-site mutation, bad CSRF and ambiguous selectors without a schedule write', async () => {
  const f = await fixture(), h = await harness(f);
  for (const headers of [{ origin: 'https://outside.example.invalid' }, { 'x-csrf-token': 'bad' }, { 'sec-fetch-site': 'cross-site' }]) expect((await h.call(f.group(), undefined, headers)).status).toBe(403);
  for (const query of ['?groupId=' + f.groupId + '&groupId=' + f.groupId, '?groupId=' + f.groupId + '&workspaceId=' + f.workspace]) expect((await h.call(undefined, query)).status).toBe(400);
  expect((await h.call({ ...f.group(), seatConfirmed: true })).status).toBe(400); expect(await count(f)).toBe(0);
});
it('native owner program HTTP keeps a lost committed result unknown and replays the exact operation after later revisions', async () => {
  const f = await fixture(), command = f.group(); let lost = true;
  const uncertain: IdentityStore = { transaction: async work => { let wrote = false; const result = await f.db.transaction(tx => work({ query: async <T extends object>(sql: string, values: readonly unknown[] = []) => { const rows = await tx.query<T>(sql, values); if (sql.startsWith('INSERT INTO ls_fishing_billing.program_source_versions')) wrote = true; return rows; } })); if (wrote && lost) { lost = false; throw new AppError('CONFLICT'); } return result; } };
  const first = await harness(f, { store: uncertain }), response = await first.call(command); expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('UNAVAILABLE'); expect(await count(f)).toBe(1);
  const fresh = await harness(f), edit = { ...command, operationId: randomUUID(), expectedRevision: 1, fields: { ...(command.fields as object), state: 'cancelled' } };
  expect((await fresh.call(edit)).status).toBe(200);
  const retry = await fresh.call(command); expect(retry.status).toBe(200); expect((await retry.json()).data).toMatchObject({ replayed: true, record: { revision: 1, command } }); expect(await count(f)).toBe(2);
  const current = await fresh.call(undefined, '?groupId=' + f.groupId); expect(current.status).toBe(200); expect((await current.json()).data.group.record).toMatchObject({ revision: 2, command: { fields: { state: 'cancelled' } } });
});
it('native owner program HTTP exposes only correlated native-known CAS/overlap rejection and permits a fresh corrected edit', async () => {
  const f = await fixture(), h = await harness(f), original = f.group();
  expect((await h.call(original)).status).toBe(200);
  const stale = { ...original, operationId: randomUUID() }, response = await h.call(stale); expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ kind: 'rejected_source', workspaceId: f.workspace, actorId: f.owner.id, command: stale, code: 'CONFLICT' }); expect(await count(f)).toBe(1);
  const lesson = f.lesson(randomUUID(), 1, '2035-01-31T21:30:00Z'); expect((await h.call(lesson)).status).toBe(200);
  const overlap = f.lesson(randomUUID(), 2, '2035-01-31T22:00:00Z'), rejected = await h.call(overlap);
  expect(rejected.status).toBe(200); expect((await rejected.json()).data).toMatchObject({ kind: 'rejected_source', command: overlap, code: 'CONFLICT' }); expect(await count(f)).toBe(2);
  const corrected = { ...overlap, operationId: randomUUID(), fields: { ...(overlap.fields as object), startsAt: '2035-02-07T21:30:00Z', endsAt: '2035-02-07T22:30:00Z' } };
  expect((await h.call(corrected)).status).toBe(200); expect(await count(f)).toBe(3);
});
it('native owner program HTTP refuses a rejection token whose owner correlation does not match the actual request', async () => {
  const f = await fixture(), other = await fixture(), h = await harness(f), command = programSourceCommandV3Schema.parse(f.group());
  const deps = composeFishingProgramSourceOwnerRuntime(h.runtime, { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: f.owner.id });
  deps.store.recordOutcome = async () => ({ version: PROGRAM_SOURCE_V3, workspaceId: other.workspace, actorId: other.owner.id, command, state: 'rejected', code: 'CONFLICT' });
  const response = await fishingProgramSourceOwnerHttp(h.request(command), async () => deps);
  expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('UNAVAILABLE'); expect(await count(f)).toBe(0);
});
