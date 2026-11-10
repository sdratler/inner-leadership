import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/lib/errors.ts';
import { asId } from '../../src/lib/ids.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import { fishingGroupPreparationOwnerHttp, FISHING_GROUP_PREPARATION_OWNER_PATH as path } from '../../src/lib/fishing-group-preparation-owner-http.ts';
import { composeFishingGroupPreparationOwnerRuntime, type GroupPreparationIdentityRuntime } from '../../src/lib/fishing-group-preparation-owner-runtime.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import { opaqueToken, tokenDigest } from '../../src/features/identity/crypto.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import { GROUP_PREPARATION_LIST_VERSION, GROUP_PREPARATION_VERSION } from '../../src/features/fishing-billing/group-preparation-contract.ts';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';

vi.mock('server-only', () => ({}));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const name = '0153_ls_fishing_group_preparations.sql';
const origin = 'https://fishing-owner.example.invalid', now = new Date('2035-01-10T15:00:00.000Z');
const expires = new Date('2036-01-01T00:00:00Z'), clock = { now: () => new Date(now) };
const noNetwork = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); });
let engine: PGlite, sql: string, native: GroupPreparationIdentityRuntime;
const ws = asId(randomUUID(), 'workspace'), owner = asId(randomUUID(), 'account'), person = asId(randomUUID(), 'person');
const token = opaqueToken(), env = { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: owner };
const binder: IdentityStore = { transaction: work => engine.transaction(tx => work({
  query: async <T extends object>(text: string, args: readonly unknown[] = []) => (await tx.query<T>(text, [...args])).rows,
})) };
const command = () => ({ version: GROUP_PREPARATION_VERSION, action: 'create' as const, groupId: randomUUID(),
  operationId: randomUUID(), expectedRevision: 0 as const, fields: { label: 'Synthetic registered draft', timeZone: 'America/New_York' } });
function request(query = '', body?: unknown, session = token) {
  return new Request(origin + path + query, { method: body === undefined ? 'GET' : 'POST',
    headers: { host: new URL(origin).host, 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https',
      cookie: SESSION_COOKIE + '=' + session,
      ...(body === undefined ? {} : { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
        'x-csrf-token': native.services.sessions.csrf(session) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const call = (req: Request, runtime = native) => fishingGroupPreparationOwnerHttp(req, async () => composeFishingGroupPreparationOwnerRuntime(runtime, env));
const read = (id: string, revision?: number) => '?kind=record&groupId=' + id + (revision === undefined ? '' : '&revision=' + revision);

beforeAll(async () => {
  requirePgliteMemoryEnvironment(process.env); vi.stubGlobal('fetch', noNetwork);
  const manifest = JSON.parse(await readFile('migrations/manifest.json', 'utf8')) as { name: string; sha256: string }[];
  expect(manifest).toHaveLength(73);
  expect(hash(JSON.stringify(manifest.slice(0,72)))).toBe('e09c4a9d43608609aaf83ca391168b60d4d7604a816c9744e50d73371134d3af');
  sql = (await readFile('migrations/' + name, 'utf8')).replaceAll('\r\n', '\n');
  expect(manifest[72]).toEqual({ name, sha256: hash(sql) });
  expect(hash(sql)).toBe('8e7613ef09f06228dcb49dd89d806fc3947abce298ce1bc1263bbaf4d15f3079');
  const fixture = (await readFile('tests/fixtures/fishing-group-preparation-schema.sql', 'utf8')).replaceAll('\r\n', '\n');
  expect(hash(fixture)).toBe('6bdf10db8f0ddd64e7adf42db2cebd46273f1140712671df965a6cba71528061');
  expect(sql.slice(sql.indexOf('\n'))).toBe(fixture.slice(fixture.indexOf('\n')));

  engine = new PGlite(); await engine.exec('CREATE SCHEMA ls_control');
  for (const dependency of ['0001_ls_foundation.sql', '0010_ls_identity_cases_20260906.sql', '0030_ls_calendar_attendance_20260907.sql', '0097_ls_demo_provenance.sql']) {
    const text = (await readFile('migrations/' + dependency, 'utf8')).replaceAll('\r\n', '\n');
    expect(hash(text)).toBe(manifest.find(m => m.name === dependency)?.sha256);
    await engine.exec(text);
  }
  await engine.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)', [ws, now]);
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)", [person, ws, now]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) " +
    "VALUES($1,$2,'practitioner','active','en',$3,'SYNTHETIC',$4,'SYNTHETIC',$4,$4)", [owner, ws, tokenDigest(token), now]);
  await engine.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)', [ws, owner, person]);
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
    [tokenDigest(token), ws, owner, now, expires]);
  const config: IdentityConfig = { enabled: true, origin, workspaceId: ws, csrfKey: Buffer.alloc(32, 1), lookupKey: Buffer.alloc(32, 2),
    rateLimitKey: 'r'.repeat(32), keyring: { activeKeyId: 'fixture', keys: { fixture: Buffer.alloc(32, 22) } }, sessionSeconds: 3600 };
  native = { config, store: binder, clock, services: { sessions: new IdentitySessions(binder, config, clock), limits: new PostgresIdentityRateStore(binder) } };
}, 30000);
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); });
afterAll(async () => { try { await engine?.close(); } finally { vi.unstubAllGlobals(); } });

describe('registered153 owner preparation storage', () => {
  it('fails without storage, then uses actual manifest-pinned SQL through the configured owner runtime', async () => {
    const cmd = command();
    expect((await call(request('', cmd))).status).toBe(503);
    expect((await engine.query("SELECT to_regclass('ls_fishing_billing.group_preparation_heads') AS table")).rows).toEqual([{ table: null }]);
    // Only this disposable test installs the registered source. Runtime composition never bootstraps it.
    await engine.exec(sql);
    const created = await call(request('', cmd)), initial = (await created.json()).data.record;
    expect(created.status).toBe(200);
    expect(initial).toMatchObject({ classification: 'preparation_only_not_authority', fields: {
      period: null, firstClassAt: null, firstClassLocalDate: null, venueSource: null, proposedCapacity: null,
    } });
    expect((await (await call(request('', cmd))).json()).data).toMatchObject({ replayed: true, record: { revision: 1 } });
    const edit = { ...cmd, action: 'edit', expectedRevision: 1, operationId: randomUUID(), fields: { label: 'Edited synthetic' } };
    expect((await call(request('', edit))).status).toBe(200);
    const cancel = { version: GROUP_PREPARATION_VERSION, action: 'cancel', groupId: cmd.groupId, expectedRevision: 2, operationId: randomUUID() };
    expect((await call(request('', cancel))).status).toBe(200);
    expect((await (await call(request(read(cmd.groupId,1)))).json()).data.record).toEqual(initial);
    expect((await (await call(request('', cmd))).json()).data).toMatchObject({ replayed: true, record: { revision: 1 } });
    const fresh = opaqueToken();
    await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
      [tokenDigest(fresh), ws, owner, now, expires]);
    const listed = await call(request('?kind=list&version=' + GROUP_PREPARATION_LIST_VERSION, undefined, fresh));
    expect(listed.status).toBe(200);
    expect((await listed.json()).data.page.items).toMatchObject([{ groupId: cmd.groupId, revision: 3, state: 'cancelled' }]);
    const stored = await engine.query('SELECT revision,payload_ciphertext FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1', [ws]);
    expect(stored.rows).toHaveLength(3); expect(JSON.stringify(stored.rows)).not.toContain('Synthetic registered draft');
  });

  it('enforces actual immutable history, forward-only heads and complete previous-revision linkage', async () => {
    const cmd = command(); expect((await call(request('', cmd))).status).toBe(200);
    await expect(engine.query('UPDATE ls_fishing_billing.group_preparation_versions SET payload_ciphertext=payload_ciphertext WHERE workspace_id=$1', [ws]))
      .rejects.toThrow('GROUP_PREPARATION_HISTORY_IMMUTABLE');
    await expect(engine.query('DELETE FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1', [ws]))
      .rejects.toThrow('GROUP_PREPARATION_HISTORY_IMMUTABLE');
    await expect(engine.exec('TRUNCATE ls_fishing_billing.group_preparation_heads')).rejects.toThrow('GROUP_PREPARATION_HISTORY_IMMUTABLE');
    await expect(engine.query('UPDATE ls_fishing_billing.group_preparation_heads SET revision=revision+2 WHERE workspace_id=$1 AND group_id=$2', [ws, cmd.groupId]))
      .rejects.toThrow('GROUP_PREPARATION_HEAD_CONFLICT');
    await expect(engine.query('INSERT INTO ls_fishing_billing.group_preparation_versions ' +
      '(workspace_id,group_id,revision,contract_version,program_key,state,action,operation_id,created_by,created_at,recorded_by,recorded_at,request_digest,record_digest,previous_digest,payload_ciphertext) ' +
      "SELECT workspace_id,group_id,revision+2,contract_version,program_key,'draft','edit',$3,created_by,created_at,recorded_by,recorded_at,request_digest,record_digest,record_digest,payload_ciphertext " +
      'FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1 AND group_id=$2', [ws, cmd.groupId, randomUUID()]))
      .rejects.toThrow(/foreign key/i);
    expect((await (await call(request(read(cmd.groupId)))).json()).data.record.revision).toBe(1);
  });

  it('recovers a durably saved registered-schema operation after a typed post-commit failure', async () => {
    const cmd = command();
    const uncertain: IdentityStore = { async transaction(work) {
      let wrote = false;
      const result = await binder.transaction(tx => work({ async query<T extends object>(text: string, args?: readonly unknown[]) {
        if (text.startsWith('INSERT INTO ls_fishing_billing.group_preparation_versions ')) wrote = true;
        return tx.query<T>(text, args);
      } }));
      if (wrote) throw new AppError('CONFLICT');
      return result;
    } };
    const failed = await call(request('', cmd), { ...native, store: uncertain });
    const found = await call(request(read(cmd.groupId)));
    expect(found.status).toBe(200); expect((await found.json()).data.record.operationId).toBe(cmd.operationId);
    expect((await (await call(request('', cmd))).json()).data).toMatchObject({ replayed: true, record: { revision: 1 } });
    const stored = await engine.query('SELECT revision FROM ls_fishing_billing.group_preparation_versions WHERE workspace_id=$1 AND group_id=$2', [ws, cmd.groupId]);
    expect(stored.rows).toEqual([{ revision: 1 }]);
    expect(failed.status).toBe(503); expect((await failed.json()).error.code).toBe('UNAVAILABLE');
  });
});
