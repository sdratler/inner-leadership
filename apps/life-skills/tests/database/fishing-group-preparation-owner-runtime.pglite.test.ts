import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/lib/errors.ts';
import { asId } from '../../src/lib/ids.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import { fishingGroupPreparationOwnerHttp, FISHING_GROUP_PREPARATION_OWNER_PATH as path } from '../../src/lib/fishing-group-preparation-owner-http.ts';
import {
  composeFishingGroupPreparationOwnerRuntime, configuredGroupPreparationOwnerAuthority, type GroupPreparationIdentityRuntime,
} from '../../src/lib/fishing-group-preparation-owner-runtime.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import { opaqueToken, tokenDigest } from '../../src/features/identity/crypto.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { Actor, WorkspaceId } from '../../src/features/identity/types.ts';
import type { IdentityStore, SqlSession } from '../../src/features/identity/store.ts';
import { GROUP_PREPARATION_LIST_VERSION, GROUP_PREPARATION_PROGRAM, GROUP_PREPARATION_VERSION } from '../../src/features/fishing-billing/group-preparation-contract.ts';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';
import { GET, POST, dynamic, runtime as routeRuntime } from '../../src/app/api/private/fishing-group-preparations/route.ts';

vi.mock('server-only', () => ({}));
// Resolve a native runtime backed by the isolated database, without loading production env/driver.
// No owner authority, session resolver, store, CSRF or rate counter is replaced.
let resolvedRuntime: GroupPreparationIdentityRuntime;
const resolveRuntime = vi.fn(async () => resolvedRuntime);
vi.mock('../../src/features/identity/runtime.ts', () => ({ identityRuntime: () => resolveRuntime() }));

const origin = 'https://fishing-owner.example.invalid', now = new Date('2035-01-10T15:00:00.000Z');
const expires = new Date('2036-01-01T00:00:00Z'), clock = { now: () => new Date(now) };
const ring = { activeKeyId: 'fixture', keys: { fixture: Buffer.alloc(32, 22) } };
const noNetwork = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); });
let engine: PGlite;
const binder: IdentityStore = { transaction: work => engine.transaction(tx => work({
  query: async <T extends object>(sql: string, args: readonly unknown[] = []) => (await tx.query<T>(sql, [...args])).rows,
})) };

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
}, 30000);
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { try { await engine?.close(); } finally { vi.unstubAllGlobals(); } });

async function account(ws: WorkspaceId, role: Actor['role'] = 'practitioner') {
  const id = asId(randomUUID(), 'account'), person = asId(randomUUID(), 'person'), token = opaqueToken();
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)", [person, ws, now]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) " +
    "VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)", [id, ws, role, tokenDigest(token), now]);
  await engine.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)', [ws, id, person]);
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
    [tokenDigest(token), ws, id, now, expires]);
  return { id, token };
}
async function setup() {
  const ws = asId(randomUUID(), 'workspace');
  await engine.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)', [ws, now]);
  const owner = await account(ws);
  const config: IdentityConfig = { enabled: true, origin, workspaceId: ws, csrfKey: Buffer.alloc(32, 1), lookupKey: Buffer.alloc(32, 2),
    rateLimitKey: 'r'.repeat(32), keyring: ring, sessionSeconds: 3600 };
  const sessions = new IdentitySessions(binder, config, clock);
  const native: GroupPreparationIdentityRuntime = { config, store: binder, clock, services: { sessions, limits: new PostgresIdentityRateStore(binder) } };
  const env = { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: owner.id, LS_PROVIDER_INDEX_ENABLED: 'false' };
  const dependencies = (r = native, settings: Readonly<Record<string, string | undefined>> = env) =>
    composeFishingGroupPreparationOwnerRuntime(r, settings);
  const command = { version: GROUP_PREPARATION_VERSION, action: 'create' as const, groupId: randomUUID(),
    expectedRevision: 0 as const, operationId: randomUUID(), fields: { label: 'Synthetic configured owner draft', timeZone: 'America/New_York' } };
  const list = '?kind=list&version=' + GROUP_PREPARATION_LIST_VERSION;
  const read = (revision?: number) => '?kind=record&groupId=' + command.groupId + (revision === undefined ? '' : '&revision=' + revision);
  function request(query = '', body?: unknown, token = owner.token) {
    return new Request(origin + path + query, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: new URL(origin).host, 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https',
        cookie: SESSION_COOKIE + '=' + token,
        ...(body === undefined ? {} : { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-csrf-token': sessions.csrf(token) }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const call = (req: Request, r = native, settings: Readonly<Record<string, string | undefined>> = env) =>
    fishingGroupPreparationOwnerHttp(req, async () => dependencies(r, settings));
  async function rows() {
    const heads = await engine.query('SELECT * FROM ls_fishing_billing.group_preparation_heads WHERE workspace_id=$1 ORDER BY group_id', [ws]);
    const versions = await engine.query('SELECT * FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1 ORDER BY group_id,revision', [ws]);
    return { heads: heads.rows, versions: versions.rows };
  }
  return { ws, owner, config, sessions, native, env, dependencies, command, list, read, request, call, rows };
}

describe('configured owner group preparation runtime', () => {
  it('executes the thin Next GET/POST bridge through configured authority, real sessions, encryption and native rate SQL', async () => {
    const s = await setup(); resolvedRuntime = s.native;
    vi.stubEnv('LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID', s.owner.id);
    expect(routeRuntime).toBe('nodejs'); expect(dynamic).toBe('force-dynamic');
    const response = await POST(s.request('', s.command)), original = (await response.json()).data;
    expect(response.status).toBe(200); expect(original).toMatchObject({ replayed: false, record: { revision: 1, state: 'draft' } });
    const change = { ...s.command, action: 'edit', expectedRevision: 1, operationId: randomUUID(), fields: { label: 'Edited' } };
    expect((await POST(s.request('', change))).status).toBe(200);
    expect((await (await POST(s.request('', s.command))).json()).data).toEqual({ ...original, replayed: true });
    const cancel = { version: GROUP_PREPARATION_VERSION, action: 'cancel', expectedRevision: 2, groupId: s.command.groupId, operationId: randomUUID() };
    expect((await POST(s.request('', cancel))).status).toBe(200);
    const before = await s.rows();
    expect((await (await GET(s.request(s.read(1)))).json()).data.record).toEqual(original.record);
    expect((await (await GET(s.request(s.read()))).json()).data.record).toMatchObject({ state: 'cancelled', revision: 3, fields: { label: 'Edited' } });
    const token = opaqueToken();
    await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
      [tokenDigest(token), s.ws, s.owner.id, now, expires]);
    await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [tokenDigest(s.owner.token), now]);
    expect((await GET(s.request(s.list))).status).toBe(401);
    const page = await GET(s.request(s.list, undefined, token));
    expect(page.status).toBe(200);
    expect((await page.json()).data.page.items).toMatchObject([{ groupId: s.command.groupId, state: 'cancelled' }]);
    expect(await s.rows()).toEqual(before);
    const counter = await engine.query<{ count: number }>('SELECT count FROM ls_identity.rate_counters');
    expect(counter.rows).toEqual([{ count: 7 }]);
    expect(s.native.services.limits).toBeInstanceOf(PostgresIdentityRateStore);
    expect(resolveRuntime).toHaveBeenCalled();
  });

  it('fails closed on invalid server owner/workspace bindings and keeps a composed binding frozen', async () => {
    const s = await setup();
    for (const ownerId of [undefined, '', ' owner ', s.owner.id + ' ', 'AA000000-0000-4000-8000-000000000000']) {
      const response = await s.call(s.request('', s.command), s.native, { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: ownerId });
      expect(response.status).toBe(503);
    }
    const badRuntime = { ...s.native, config: { ...s.config, workspaceId: 'invalid' as WorkspaceId } };
    expect((await s.call(s.request('', s.command), badRuntime)).status).toBe(503);
    const unknownOwner = { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: randomUUID() };
    expect((await s.call(s.request('', s.command), s.native, unknownOwner)).status).toBe(403);
    const otherWorkspace = { ...s.native, config: { ...s.config, workspaceId: asId(randomUUID(), 'workspace') } };
    expect((await s.call(s.request('', s.command), otherWorkspace)).status).toBe(403);
    const settings: Record<string, string | undefined> = { ...s.env };
    const composed = s.dependencies(s.native, settings);
    settings.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID = randomUUID();
    expect((await fishingGroupPreparationOwnerHttp(s.request('', s.command), async () => composed)).status).toBe(200);
    expect((await s.call(s.request(s.read()), s.native, settings)).status).toBe(403);
    expect((await s.rows()).versions).toHaveLength(1);
  });

  it('denies a real other practitioner after role succession, parents and foreign workspaces', async () => {
    const s = await setup(), other = await setup(), parent = await account(s.ws, 'parent');
    expect((await s.call(s.request(s.list, undefined, parent.token))).status).toBe(403);
    expect((await s.call(s.request(s.list, undefined, other.owner.token))).status).toBe(401);
    await engine.query("UPDATE ls_identity.accounts SET role='adult_client' WHERE id=$1", [s.owner.id]);
    // The real identity schema allows one practitioner in a workspace at a time.
    const successor = await account(s.ws);
    expect((await s.call(s.request('', s.command, successor.token))).status).toBe(403);
    expect(await s.rows()).toEqual({ heads: [], versions: [] });
  });

  it.each(['revoked', 'disabled', 'demoted', 'demo'] as const)('rejects configured owner after actual %s state change', async state => {
    const s = await setup();
    if (state === 'revoked') await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1', [tokenDigest(s.owner.token), now]);
    if (state === 'disabled') await engine.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1", [s.owner.id]);
    if (state === 'demoted') await engine.query("UPDATE ls_identity.accounts SET role='adult_client' WHERE id=$1", [s.owner.id]);
    if (state === 'demo') {
      await engine.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,'ls-owner-20350110',$2)", [s.ws, s.owner.id]);
      await engine.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,'ls-owner-20350110','runtime-test')", [s.ws, s.owner.id]);
    }
    expect((await s.call(s.request('', s.command))).status).toBe(state === 'revoked' || state === 'disabled' ? 401 : 403);
    expect(await s.rows()).toEqual({ heads: [], versions: [] });
  });

  it('pins actual owner evidence inside the provided transaction and validates explicit list and group scope', async () => {
    const s = await setup(), owner = configuredGroupPreparationOwnerAuthority(s.config, s.env);
    const group = { workspaceId: s.ws, accountId: s.owner.id, programKey: GROUP_PREPARATION_PROGRAM, action: 'create' as const, groupId: s.command.groupId };
    await binder.transaction(async tx => {
      const calls: { sql: string; args: readonly unknown[] | undefined }[] = [];
      const supplied: SqlSession = { query<T extends object>(sql: string, args?: readonly unknown[]) {
        calls.push({ sql, args }); return tx.query<T>(sql, args);
      } };
      expect(await owner.isCurrentOwner(supplied, group)).toBe(true);
      expect(calls[0]?.sql).toContain('FOR UPDATE OF a');
      expect(calls[0]?.args).toEqual([s.ws, s.owner.id]);
      expect(await owner.canListPreparations!(supplied, { ...group, action: 'list', groupId: null })).toBe(true);
      for (const patch of [{ accountId: randomUUID() }, { workspaceId: randomUUID() }, { programKey: 'another_program' }, { groupId: null }, { action: 'list' }]) {
        const malformed = { ...group, ...patch } as unknown as Parameters<typeof owner.isCurrentOwner>[1];
        expect(await owner.isCurrentOwner(supplied, malformed)).toBe(false);
      }
      const wrongList = { ...group, action: 'list' } as unknown as Parameters<NonNullable<typeof owner.canListPreparations>>[1];
      expect(await owner.canListPreparations!(supplied, wrongList)).toBe(false);
    });
  });

  it('rolls back a pending save when actual configured-owner evidence changes at the terminal authority SQL', async () => {
    const s = await setup(); let checks = 0;
    const wrapped: IdentityStore = { transaction: work => binder.transaction(tx => work({
      async query<T extends object>(sql: string, args?: readonly unknown[]) {
        if (sql.startsWith('SELECT a.id FROM ls_identity.accounts a WHERE') && ++checks === 2) {
          await tx.query("UPDATE ls_identity.accounts SET role='adult_client' WHERE workspace_id=$1 AND id=$2", [s.ws, s.owner.id]);
        }
        return tx.query<T>(sql, args);
      },
    })) };
    const result = await s.call(s.request('', s.command), { ...s.native, store: wrapped });
    expect(result.status).toBe(403); expect(checks).toBe(2);
    expect(await s.rows()).toEqual({ heads: [], versions: [] });
    expect((await s.sessions.actor(s.owner.token)).role).toBe('practitioner');
    expect((await s.call(s.request('', s.command))).status).toBe(200);
  });

  it.each(['CONFLICT', 'FORBIDDEN', 'INVALID_REQUEST'] as const)('recovers a real committed save after %s through the composed runtime', async code => {
    const s = await setup();
    const wrapped: IdentityStore = { async transaction(work) {
      let wrote = false;
      const result = await binder.transaction(tx => work({
        async query<T extends object>(sql: string, args?: readonly unknown[]) {
          if (sql.startsWith('INSERT INTO ls_fishing_billing.group_preparation_versions ')) wrote = true;
          return tx.query<T>(sql, args);
        },
      }));
      if (wrote) throw new AppError(code);
      return result;
    } };
    const failed = await s.call(s.request('', s.command), { ...s.native, store: wrapped });
    const read = await s.call(s.request(s.read()));
    expect(read.status).toBe(200); expect((await read.json()).data.record.operationId).toBe(s.command.operationId);
    const replay = await s.call(s.request('', s.command));
    expect((await replay.json()).data).toMatchObject({ replayed: true, record: { revision: 1 } });
    expect((await s.rows()).versions).toHaveLength(1);
    expect(failed.status).toBe(503); expect((await failed.json()).error.code).toBe('UNAVAILABLE');
  });

  it('enforces the real database rate counter without creating duplicate saved revisions', async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) expect((await s.call(s.request('', s.command))).status).toBe(200);
    expect((await s.call(s.request('', s.command))).status).toBe(429);
    const counter = await engine.query<{ count: number }>('SELECT count FROM ls_identity.rate_counters ORDER BY count DESC LIMIT 1');
    expect(counter.rows[0]?.count).toBe(21);
    expect((await s.rows()).versions).toHaveLength(1);
  });

  it('reports unavailable storage without bootstrapping a missing table in the isolated fixture', async () => {
    const s = await setup();
    await engine.exec('ALTER TABLE ls_fishing_billing.group_preparation_heads RENAME TO synthetic_unavailable_heads');
    try {
      const response = await s.call(s.request(s.list));
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('UNAVAILABLE');
      const tables = await engine.query<{ absent: boolean }>("SELECT to_regclass('ls_fishing_billing.group_preparation_heads') IS NULL AS absent");
      expect(tables.rows).toEqual([{ absent: true }]);
    } finally {
      await engine.exec('ALTER TABLE ls_fishing_billing.synthetic_unavailable_heads RENAME TO group_preparation_heads');
    }
    expect((await s.call(s.request(s.list))).status).toBe(200);
  });
});
