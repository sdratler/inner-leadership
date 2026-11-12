import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/lib/errors.ts';
import { asId } from '../../src/lib/ids.ts';
import { MAX_JSON_BYTES } from '../../src/lib/http/json.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import type { RateLimitStore } from '../../src/lib/security/rate-limit.ts';
import {
  FISHING_GROUP_PREPARATION_OWNER_PATH as path, fishingGroupPreparationOwnerHttp,
  type FishingGroupPreparationOwnerHttpDeps,
} from '../../src/lib/fishing-group-preparation-owner-http.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { opaqueToken, tokenDigest } from '../../src/features/identity/crypto.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { Actor, WorkspaceId } from '../../src/features/identity/types.ts';
import type { IdentityStore, SqlSession } from '../../src/features/identity/store.ts';
import {
  GROUP_PREPARATION_LIST_VERSION, GROUP_PREPARATION_VERSION, groupPreparationRecord,
} from '../../src/features/fishing-billing/group-preparation-contract.ts';
import { FishingGroupPreparationStore, type GroupPreparationOwnerAuthority } from '../../src/features/fishing-billing/group-preparation-store.ts';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';

vi.mock('server-only', () => ({}));
const origin = 'https://fishing-owner.example.invalid';
const now = new Date('2035-01-10T15:00:00.000Z'), expires = new Date('2036-01-01T00:00:00.000Z');
const clock = { now: () => new Date(now) };
const ring = { activeKeyId: 'fixture', keys: { fixture: Buffer.alloc(32, 22) } };
const integrityKey = 'synthetic-http-group-preparation-integrity-only';
const noNetwork = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); });
let engine: PGlite;
const binder: IdentityStore = { transaction: work => engine.transaction(tx => work({
  query: async <T extends object>(sql: string, args: readonly unknown[] = []) => (await tx.query<T>(sql, [...args])).rows,
})) };
// Only this owner grant and the rate-limit counter are substitutes. Native session resolution,
// fresh identity checks, encrypted draft/history operations and HTTP parsing execute their real code.
async function syntheticOwner(tx: SqlSession, scope: { workspaceId: string; accountId: string; programKey: string }) {
  const rows = await tx.query('SELECT 1 FROM synthetic_group_http.owner_grant WHERE workspace_id=$1 AND account_id=$2 FOR SHARE',
    [scope.workspaceId, scope.accountId]);
  return rows.length === 1 && scope.programKey === 'fishing_monthly_club';
}
const authority: GroupPreparationOwnerAuthority = { isCurrentOwner: syntheticOwner, canListPreparations: syntheticOwner };
const listQuery = '?kind=list&version=' + GROUP_PREPARATION_LIST_VERSION;

beforeAll(async () => {
  requirePgliteMemoryEnvironment(process.env); vi.stubGlobal('fetch', noNetwork);
  engine = new PGlite(); await engine.exec('CREATE SCHEMA ls_control');
  const manifest = JSON.parse(await readFile('migrations/manifest.json', 'utf8')) as { name: string; sha256: string }[];
  for (const name of ['0001_ls_foundation.sql', '0010_ls_identity_cases_20260906.sql', '0030_ls_calendar_attendance_20260907.sql', '0097_ls_demo_provenance.sql']) {
    const sql = await readFile('migrations/' + name, 'utf8');
    expect(createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')).toBe(manifest.find(m => m.name === name)?.sha256);
    await engine.exec(sql);
  }
  const fixture = await readFile('tests/fixtures/fishing-group-preparation-schema.sql', 'utf8');
  expect(createHash('sha256').update(fixture.replaceAll('\r\n', '\n')).digest('hex')).toBe('6bdf10db8f0ddd64e7adf42db2cebd46273f1140712671df965a6cba71528061');
  await engine.exec(fixture);
  await engine.exec('CREATE SCHEMA synthetic_group_http; CREATE TABLE synthetic_group_http.owner_grant ' +
    '(workspace_id uuid PRIMARY KEY, account_id uuid NOT NULL, FOREIGN KEY (workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id))');
}, 30000);
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); vi.restoreAllMocks(); });
afterAll(async () => { try { await engine?.close(); } finally { vi.unstubAllGlobals(); } });

async function session(workspaceId: WorkspaceId, role: Actor['role'] = 'practitioner') {
  const id = asId(randomUUID(), 'account'), personId = asId(randomUUID(), 'person'), token = opaqueToken();
  const digest = tokenDigest(token);
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)", [personId, workspaceId, now]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) " +
    "VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)", [id, workspaceId, role, digest, now]);
  await engine.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)', [workspaceId, id, personId]);
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
    [digest, workspaceId, id, now, expires]);
  return { id, token };
}
async function setup() {
  const ws = asId(randomUUID(), 'workspace');
  await engine.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)', [ws, now]);
  const owner = await session(ws);
  await engine.query('INSERT INTO synthetic_group_http.owner_grant VALUES($1,$2)', [ws, owner.id]);
  const config: IdentityConfig = { enabled: true, origin, workspaceId: ws, csrfKey: Buffer.alloc(32, 1),
    lookupKey: Buffer.alloc(32, 2), rateLimitKey: 'r'.repeat(32), keyring: ring, sessionSeconds: 3600 };
  const sessions = new IdentitySessions(binder, config, clock);
  const makeStore = (db = binder, grant: GroupPreparationOwnerAuthority | null = authority) =>
    new FishingGroupPreparationStore(db, ws, ring, integrityKey, grant, clock);
  const store = makeStore();
  const consume = vi.fn<RateLimitStore['consume']>(async () => ({ count: 1, retryAfterMs: 0 }));
  const deps: FishingGroupPreparationOwnerHttpDeps = { origin, actor: t => sessions.actor(t), csrf: t => sessions.csrf(t),
    limits: { consume }, rateLimitKey: config.rateLimitKey, store };
  const command = { version: GROUP_PREPARATION_VERSION, action: 'create' as const, groupId: randomUUID(),
    expectedRevision: 0 as const, operationId: randomUUID(), fields: { label: 'Synthetic owner draft', timeZone: 'America/New_York' } };
  function request(query = '', body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST', suffix = '') {
    return new Request(origin + path + suffix + query, {
      method, headers: { host: new URL(origin).host, 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https',
        cookie: SESSION_COOKIE + '=' + owner.token,
        ...(body === undefined ? {} : { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-csrf-token': sessions.csrf(owner.token) }),
        ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  }
  const call = (req: Request, supplied = deps) => fishingGroupPreparationOwnerHttp(req, async () => supplied);
  const recordQuery = (id = command.groupId, revision?: number) => '?kind=record&groupId=' + id + (revision === undefined ? '' : '&revision=' + revision);
  async function rows() {
    const heads = await engine.query('SELECT * FROM ls_fishing_billing.group_preparation_heads WHERE workspace_id=$1 ORDER BY group_id', [ws]);
    const versions = await engine.query('SELECT * FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1 ORDER BY group_id,revision', [ws]);
    return { heads: heads.rows, versions: versions.rows };
  }
  return { ws, owner, sessions, makeStore, store, deps, consume, command, request, call, recordQuery, rows };
}

describe('owner group preparation HTTP with isolated native storage', () => {
  it('creates, edits, cancels, reads and lists through real requests, preserving historical operation replay and reload', async () => {
    const s = await setup();
    const saved = await s.call(s.request('', s.command)), initial = (await saved.json()).data;
    expect(saved.status).toBe(200); expect(initial).toMatchObject({ kind: 'saved', replayed: false, record: { revision: 1, state: 'draft' } });
    expect(groupPreparationRecord.safeParse(initial.record).success).toBe(true);
    const edit = { ...s.command, action: 'edit', expectedRevision: 1, operationId: randomUUID(), fields: { label: 'Edited' } };
    expect((await s.call(s.request('', edit))).status).toBe(200);
    const replay = (await (await s.call(s.request('', s.command))).json()).data;
    expect(replay).toEqual({ ...initial, replayed: true });
    const cancel = { version: GROUP_PREPARATION_VERSION, action: 'cancel', groupId: s.command.groupId, expectedRevision: 2, operationId: randomUUID() };
    expect((await s.call(s.request('', cancel))).status).toBe(200);
    const before = await s.rows();
    const old = await s.call(s.request(s.recordQuery(s.command.groupId, 1)));
    expect((await old.json()).data).toEqual({ kind: 'record', record: initial.record });
    const current = await s.call(s.request(s.recordQuery()));
    expect((await current.json()).data.record).toMatchObject({ revision: 3, state: 'cancelled', fields: { label: 'Edited' } });
    const token = opaqueToken();
    await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
      [tokenDigest(token), s.ws, s.owner.id, now, expires]);
    await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [tokenDigest(s.owner.token), now]);
    const reopened = { ...s.deps, store: s.makeStore() };
    const page = await s.call(s.request(listQuery, undefined, { cookie: SESSION_COOKIE + '=' + token }), reopened);
    expect(page.status).toBe(200);
    expect((await page.json()).data).toMatchObject({ kind: 'list', page: { items: [{ groupId: s.command.groupId, state: 'cancelled' }], nextCursor: null } });
    expect(await s.rows()).toEqual(before);
  });

  it('passes opaque bounded pagination through HTTP and rejects a changed page size', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await s.call(s.request('', { ...s.command, groupId: randomUUID(), operationId: randomUUID() }));
    const first = await (await s.call(s.request(listQuery + '&limit=1'))).json();
    const cursor = first.data.page.nextCursor as string;
    const second = await (await s.call(s.request(listQuery + '&limit=1&cursor=' + encodeURIComponent(cursor)))).json();
    expect(second.data.page.items[0].groupId).not.toBe(first.data.page.items[0].groupId);
    expect((await s.call(s.request(listQuery + '&limit=2&cursor=' + encodeURIComponent(cursor)))).status).toBe(400);
  });

  it('requires exactly one well-formed session cookie before loading dependencies', async () => {
    const s = await setup(), load = vi.fn(async () => s.deps);
    for (const cookie of ['', 'wrong=abc', SESSION_COOKIE + '=short', SESSION_COOKIE + '=' + s.owner.token + '; ' + SESSION_COOKIE + '=' + s.owner.token,
      SESSION_COOKIE + '=' + s.owner.token + '; ' + SESSION_COOKIE + ' =broken', SESSION_COOKIE + '=' + s.owner.token + '; ' + SESSION_COOKIE]) {
      const result = await fishingGroupPreparationOwnerHttp(s.request(listQuery, undefined, { cookie }), load);
      expect(result.status).toBe(401);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('uses actual sessions and rejects nonowners, inactive, revoked and cross-workspace tokens', async () => {
    const s = await setup(), other = await setup(), parent = await session(s.ws, 'parent');
    await other.call(other.request('', other.command));
    expect((await s.call(s.request(s.recordQuery(other.command.groupId)))).status).toBe(404);
    for (const token of [parent.token, other.owner.token]) {
      const result = await s.call(s.request(listQuery, undefined, { cookie: SESSION_COOKIE + '=' + token }));
      expect(result.status).toBe(token === parent.token ? 403 : 401);
    }
    await engine.query('DELETE FROM synthetic_group_http.owner_grant WHERE workspace_id=$1', [s.ws]);
    expect((await s.call(s.request('', s.command))).status).toBe(403);
    await engine.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1", [s.owner.id]);
    expect((await s.call(s.request(listQuery))).status).toBe(401);
    await engine.query("UPDATE ls_identity.accounts SET state='active' WHERE id=$1", [s.owner.id]);
    await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [tokenDigest(s.owner.token), now]);
    expect((await s.call(s.request(listQuery))).status).toBe(401);
    expect(await s.rows()).toEqual({ heads: [], versions: [] });
  });

  it('rechecks native demo/session state after HTTP session resolution and requires explicit list and record authority', async () => {
    const s = await setup(); await s.call(s.request('', s.command));
    const missing = { ...s.deps, store: s.makeStore(binder, { isCurrentOwner: syntheticOwner }) };
    expect((await s.call(s.request(listQuery), missing)).status).toBe(503);
    const denied = { ...s.deps, store: s.makeStore(binder, { isCurrentOwner: async () => false, canListPreparations: syntheticOwner }) };
    expect((await s.call(s.request(s.recordQuery()), denied)).status).toBe(403);
    const marked = { ...s.deps, actor: async (token: string) => {
      const actor = await s.sessions.actor(token);
      await engine.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,'ls-owner-20350110',$2)", [s.ws, actor.id]);
      await engine.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,'ls-owner-20350110','http-test')", [s.ws, actor.id]);
      return actor;
    } };
    expect((await s.call(s.request(s.recordQuery()), marked)).status).toBe(403);
    const fresh = await setup();
    const revoked = { ...fresh.deps, actor: async (token: string) => {
      const actor = await fresh.sessions.actor(token);
      await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [tokenDigest(token), now]);
      return actor;
    } };
    expect((await fresh.call(fresh.request('', fresh.command), revoked)).status).toBe(401);
    expect(await fresh.rows()).toEqual({ heads: [], versions: [] });
  });

  it('enforces canonical paths, method, forwarding, mutation origin and session-bound CSRF', async () => {
    const s = await setup();
    for (const suffix of ['/extra', '/']) expect((await s.call(s.request(listQuery, undefined, {}, 'GET', suffix))).status).toBe(404);
    expect((await s.call(s.request(listQuery + '#fragment'))).status).toBe(404);
    expect((await s.call(s.request('', undefined, {}, 'DELETE'))).status).toBe(400);
    expect((await s.call(s.request(listQuery, undefined, { 'x-forwarded-host': 'other.example.invalid' }))).status).toBe(503);
    for (const headers of [{ origin: '' }, { origin: 'https://other.example.invalid' }, { 'sec-fetch-site': 'cross-site' }, { 'x-csrf-token': '' },
      { 'x-csrf-token': s.sessions.csrf(opaqueToken()) }]) {
      expect((await s.call(s.request('', s.command, headers))).status).toBe(403);
    }
    expect(await s.rows()).toEqual({ heads: [], versions: [] });
  });

  it('rejects duplicate, unknown, mixed and noncanonical query inputs before reading or saving', async () => {
    const s = await setup();
    for (const query of ['', '?kind=list', listQuery + '&limit=01', listQuery + '&limit=1e1', listQuery + '&limit=51',
      listQuery + '&kind=list', listQuery + '&version=' + GROUP_PREPARATION_LIST_VERSION, listQuery + '&groupId=' + s.command.groupId,
      listQuery + '&actor=owner', '?kind=record', s.recordQuery() + '&revision=0', s.recordQuery() + '&revision=01',
      s.recordQuery() + '&revision=2147483648', s.recordQuery() + '&cursor=abc', s.recordQuery() + '&groupId=' + s.command.groupId]) {
      expect((await s.call(s.request(query))).status).toBe(400);
    }
    expect((await s.call(s.request('?kind=list', s.command))).status).toBe(400);
    expect(await s.rows()).toEqual({ heads: [], versions: [] });
  });

  it('bounds real JSON bytes, media and command structure and rejects caller-supplied authority', async () => {
    const s = await setup();
    for (const command of [{ ...s.command, actorId: s.owner.id }, { ...s.command, isOwner: true }, { ...s.command, fields: { ...s.command.fields, state: 'confirmed' } }, '{bad']) {
      expect((await s.call(s.request('', command))).status).toBe(400);
    }
    expect((await s.call(s.request('', s.command, { 'content-type': 'text/plain' }))).status).toBe(415);
    const huge = JSON.stringify({ ...s.command, fields: { ...s.command.fields, label: 'א'.repeat(MAX_JSON_BYTES) } });
    expect((await s.call(s.request('', huge, { 'content-length': '1' }))).status).toBe(413);
    expect(await s.rows()).toEqual({ heads: [], versions: [] });
  });

  it.each(['CONFLICT', 'INVALID_REQUEST', 'FORBIDDEN'] as const)('reports HTTP uncertainty after an actual commit followed by driver %s', async code => {
    const s = await setup();
    const driver: IdentityStore = { async transaction(work) { await binder.transaction(work); throw new AppError(code); } };
    const failed = await s.call(s.request('', s.command), { ...s.deps, store: s.makeStore(driver) });
    const read = await s.call(s.request(s.recordQuery()));
    expect(read.status).toBe(200);
    expect((await read.json()).data.record).toMatchObject({ operationId: s.command.operationId, revision: 1 });
    const retry = await s.call(s.request('', s.command));
    expect((await retry.json()).data).toMatchObject({ kind: 'saved', replayed: true, record: { revision: 1 } });
    const rows = await s.rows(); expect(rows.heads).toHaveLength(1); expect(rows.versions).toHaveLength(1);
    expect(failed.status).toBe(503); expect(await failed.json()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });

  it('preserves definite pre-commit validation, access and stale-revision rejection', async () => {
    const s = await setup(); await s.call(s.request('', s.command));
    const before = await s.rows();
    const stale = { ...s.command, action: 'edit', expectedRevision: 2, operationId: randomUUID(), fields: { label: 'Stale' } };
    const result = await s.call(s.request('', stale));
    expect(result.status).toBe(409); expect((await result.json()).error.code).toBe('CONFLICT');
    expect((await s.call(s.request('', { ...s.command, expectedRevision: -1 }))).status).toBe(400);
    await engine.query('DELETE FROM synthetic_group_http.owner_grant WHERE workspace_id=$1', [s.ws]);
    expect((await s.call(s.request('', { ...stale, expectedRevision: 1 }))).status).toBe(403);
    expect(await s.rows()).toEqual(before);
  });

  it.each(['save', 'list'] as const)('withholds HTTP data on terminal owner denial during %s', async action => {
    const s = await setup();
    if (action === 'list') await s.call(s.request('', s.command));
    const before = await s.rows();
    let checks = 0;
    const grant: GroupPreparationOwnerAuthority = {
      isCurrentOwner: (tx, scope) => action === 'save' && ++checks === 2 ? Promise.resolve(false) : syntheticOwner(tx, scope),
      canListPreparations: (tx, scope) => action === 'list' && ++checks === 2 ? Promise.resolve(false) : syntheticOwner(tx, scope),
    };
    const req = action === 'save' ? s.request('', s.command) : s.request(listQuery);
    const response = await s.call(req, { ...s.deps, store: s.makeStore(binder, grant) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(checks).toBe(2); expect(await s.rows()).toEqual(before);
  });

  it.each(['invalid-return', 'serialization'] as const)('keeps a durable save uncertain on post-save %s failure', async fault => {
    const s = await setup();
    if (fault === 'serialization') vi.spyOn(Response, 'json').mockImplementationOnce(() => { throw new AppError('INVALID_REQUEST'); });
    const bad = { ...s.deps, store: { ...s.store,
      read: s.store.read.bind(s.store), list: s.store.list.bind(s.store),
      async save(actor: Actor, raw: unknown) {
        const saved = await s.store.save(actor, raw);
        if (fault === 'invalid-return') return { ...saved, record: { ...saved.record, groupId: randomUUID() } };
        return saved;
      },
    } };
    const result = await s.call(s.request('', s.command), bad);
    expect(result.status).toBe(503); expect((await result.json()).error.code).toBe('UNAVAILABLE');
    expect((await s.call(s.request(s.recordQuery()))).status).toBe(200);
    expect((await (await s.call(s.request('', s.command))).json()).data.replayed).toBe(true);
    expect((await s.rows()).versions).toHaveLength(1);
  });

  it('checks returned workspace and operation bindings before exposing any data', async () => {
    const s = await setup(), actor = await s.sessions.actor(s.owner.token);
    const saved = await s.store.save(actor, s.command), other = await setup();
    const poisoned = { ...s.deps, store: {
      save: s.store.save.bind(s.store), read: async () => ({ ...saved.record, workspaceId: other.ws }),
      list: async () => ({ version: GROUP_PREPARATION_LIST_VERSION, items: [{ ...saved.record, workspaceId: other.ws }], nextCursor: null }),
    } };
    expect((await s.call(s.request(s.recordQuery()), poisoned)).status).toBe(503);
    expect((await s.call(s.request(listQuery), poisoned)).status).toBe(503);
    const wrongOperation = { ...s.deps, store: { ...poisoned.store,
      save: async () => ({ ...saved, record: { ...saved.record, operationId: randomUUID() } }),
    } };
    expect((await s.call(s.request('', s.command), wrongOperation)).status).toBe(503);
  });

  it('returns private sanitized success and failure envelopes and enforces the per-owner rate limit', async () => {
    const s = await setup();
    for (const req of [s.request('', s.command), s.request('?kind=unknown')]) {
      const response = await s.call(req), body = await response.json();
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('vary')).toBe('Cookie');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    }
    s.consume.mockResolvedValue({ count: 61, retryAfterMs: 100 });
    const denied = await s.call(s.request(listQuery));
    expect(denied.status).toBe(429);
    const consumed = s.consume.mock.calls.at(-1)!;
    expect(consumed[0]).toMatch(/^[a-f0-9]{64}$/); expect(consumed[1]).toBe(60_000);
    const unavailable = await fishingGroupPreparationOwnerHttp(s.request(listQuery), async () => { throw Error('private SQL/session/cursor details'); });
    expect(unavailable.status).toBe(503);
    const failure = await unavailable.json();
    expect(Object.keys(failure).sort()).toEqual(['error', 'ok', 'requestId']);
    expect(failure.error).toEqual({ code: 'UNAVAILABLE' });
  });
});
