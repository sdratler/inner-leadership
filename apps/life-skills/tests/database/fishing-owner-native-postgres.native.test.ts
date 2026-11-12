import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { academyTestDatabase, academyWorkspace } from './academy-free-registration-fixture.ts';
import { poolStore } from './calendar/fixture.ts';
import { migrate } from '../../src/db/migration-runner.ts';
import { AppError } from '../../src/lib/errors.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import { opaqueToken, tokenDigest } from '../../src/features/identity/crypto.ts';
import { systemClock } from '../../src/features/identity/types.ts';
import type { IdentityStore, SqlSession } from '../../src/features/identity/store.ts';
import { ContactCutoverStore } from '../../src/features/contact-ops/server/cutover-store.ts';
import { AcademyCrmStore } from '../../src/features/contact-ops/server/academy-crm-store.ts';
import { PublicGroupApplicationStore } from '../../src/features/group-application/store.ts';
import { currentTrip390Fields } from '../fixtures/trip390-current.ts';
import { GROUP_PREPARATION_VERSION } from '../../src/features/fishing-billing/group-preparation-contract.ts';
import { NATIVE_FAMILY_VERSION, nativeFamilyCreateCommandSchema } from '../../src/features/fishing-billing/native-family-contract-v1.ts';
import { PROGRAM_SOURCE_V3, programSourceCommandV3Schema } from '../../src/features/fishing-billing/program-source-contract-v3.ts';
import { ownerLocationPlanningSource } from '../../src/features/fishing-billing/owner-location-planning-source.ts';
import { composeFishingGroupPreparationOwnerRuntime } from '../../src/lib/fishing-group-preparation-owner-runtime.ts';
import { fishingGroupPreparationOwnerHttp } from '../../src/lib/fishing-group-preparation-owner-http.ts';
import { composeFishingInquiryFamilyProposalOwnerRuntime } from '../../src/lib/fishing-billing-inquiry-family-proposal-runtime.ts';
import { fishingInquiryFamilyProposalOwnerHttp } from '../../src/lib/fishing-billing-inquiry-family-proposal-owner-http.ts';
import { composeFishingProgramSourceOwnerRuntime } from '../../src/lib/fishing-program-source-owner-runtime.ts';
import { fishingProgramSourceOwnerHttp } from '../../src/lib/fishing-program-source-owner-http.ts';

vi.mock('server-only', () => ({}));
// Use the existing nonce-owned, loopback-only PostgreSQL fixture and production
// Drizzle/binding/row normalization. No new CI service, secret or runtime target.
let database: Awaited<ReturnType<typeof academyTestDatabase>>;
const noNetwork = vi.fn<typeof fetch>(async () => { throw Error('OWNER_NATIVE_PG_NO_PROVIDER_NETWORK'); });
beforeAll(async () => {
  vi.stubGlobal('fetch', noNetwork);
  database = await academyTestDatabase('before_founder');
  const end = database.inventory.findIndex(item => item.name === '0138_ls_academy_crm.sql');
  if (end < 0) throw Error('OWNER_NATIVE_PG_SCHEMA_PREFIX_MISSING');
  const client = await database.pool.connect();
  try { await migrate({ query: (sql, values) => client.query(sql, values ? [...values] : undefined) }, database.inventory.slice(0, end + 1), false); }
  finally { client.release(); }
  // Exact existing disposable DDL snapshots. These do not register or admit a
  // production migration; the ordinary migration suite tests that separately.
  for (const file of [
    'tests/fixtures/fishing-billing.sql',
    'migrations/proposals/UNNUMBERED_ls_fishing_inquiry_family_proposals.sql',
    'migrations/proposals/UNNUMBERED_ls_fishing_billing_guest_v3.sql',
    'migrations/0153_ls_fishing_group_preparations.sql',
    'migrations/proposals/UNNUMBERED_ls_fishing_program_source_v3.sql',
  ]) await database.pool.query(await readFile(new URL('../../' + file, import.meta.url), 'utf8'));
});
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); });
afterAll(async () => { try { await database?.close(); } finally { vi.unstubAllGlobals(); } });

const familyPath = '/api/private/fishing-inquiry-family-proposals';
const programPath = '/api/private/fishing-program-sources';
async function fixture() {
  const f = await academyWorkspace(database.pool), store = poolStore(database.pool);
  const config = f.runtime.config, key = config.lookupKey.toString('hex');
  const actor = await f.runtime.sessions.actor(f.owner.token);
  await new ContactCutoverStore(store, f.ring, key, systemClock).initializeAcademy(actor, {
    operationId: randomUUID(), expectedEpoch: 0, observedNativeWritesSinceSwitch: 0,
    decisionId: 'ACADEMY-ONLY-CRM-20261028-01', evidence: {
      retiredSourcesFence: 'a'.repeat(64), retiredSchedulesFence: 'b'.repeat(64),
      retainedAcademyRecords: 'c'.repeat(64), queueReconciliation: 'd'.repeat(64), restorePlan: 'e'.repeat(64),
    },
  });
  const applications = new PublicGroupApplicationStore(store, f.workspace, f.ring, key, systemClock);
  const fields = { ...currentTrip390Fields(), email: 'synthetic-' + randomUUID() + '@example.invalid', postalCode: '03301', children: [
    { id: randomUUID(), name: 'SYNTHETIC PG One', ageYears: 11, experience: 'new' as const },
    { id: randomUUID(), name: 'SYNTHETIC PG Two', ageYears: 13, experience: 'some' as const },
  ] };
  const saved = await applications.submit({ operationId: randomUUID(), fields });
  const crm = new AcademyCrmStore(store, f.ring, key, systemClock), preview = await crm.previewInquiry(actor, saved.item.id, 1);
  await crm.execute(actor, { action: 'from_inquiry', operationId: randomUUID(), expectedEpoch: 1,
    sourceApplicationId: saved.item.id, sourceDigest: preview.sourceDigest,
    fields: { stage: 'SYNTHETIC', notes: '', nextAction: null, followUpDate: null } });
  const base = { config, clock: systemClock, store,
    services: { sessions: f.runtime.sessions, limits: f.runtime.limits } };
  const env = { LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID: actor.id };
  function request(path: string, body?: unknown, token = f.owner.token) {
    const host = new URL(config.origin).host;
    return new Request(config.origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', origin: config.origin,
        'sec-fetch-site': 'same-origin', cookie: SESSION_COOKIE + '=' + token,
        'x-csrf-token': f.runtime.sessions.csrf(token), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const family = (body?: unknown, token?: string, binder: IdentityStore = store) => fishingInquiryFamilyProposalOwnerHttp(
    request(familyPath + (body === undefined ? '?' + new URLSearchParams({ kind: 'source', reference: saved.item.id }) : ''), body, token),
    async () => composeFishingInquiryFamilyProposalOwnerRuntime({ ...base, store: binder }, env));
  const groupId = randomUUID();
  const group = await fishingGroupPreparationOwnerHttp(request('/api/private/fishing-group-preparations', {
    version: GROUP_PREPARATION_VERSION, action: 'create', operationId: randomUUID(), expectedRevision: 0, groupId,
    fields: { label: 'SYNTHETIC PostgreSQL owner group', timeZone: 'America/New_York' },
  }), async () => composeFishingGroupPreparationOwnerRuntime(base, env));
  expect(group.status).toBe(200);
  const initial = await family(); expect(initial.status).toBe(200);
  const context = (await initial.json()).data;
  const command = nativeFamilyCreateCommandSchema.parse({ version: NATIVE_FAMILY_VERSION, operationId: randomUUID(),
    reference: saved.item.id, expectedEpoch: context.expectedEpoch, expectedSourceDigest: context.sourceDigest,
    ownerReviewedMapping: true, familyId: randomUUID(), familyLabel: 'SYNTHETIC PostgreSQL family',
    children: fields.children.map(child => ({ applicationChildId: child.id, nativeChildId: randomUUID() })),
  });
  const program = (body?: unknown, token?: string) => fishingProgramSourceOwnerHttp(
    request(programPath + (body === undefined ? '?' + new URLSearchParams({ groupId }) : ''), body, token),
    async () => composeFishingProgramSourceOwnerRuntime(base, env));
  async function groupCommand(expectedRevision: number, location: string) {
    const operationId = randomUUID();
    return programSourceCommandV3Schema.parse({ version: PROGRAM_SOURCE_V3, kind: 'group', groupId, id: groupId,
      operationId, expectedRevision, fields: { state: 'forming', location,
        venueSource: await ownerLocationPlanningSource({ workspaceId: f.workspace, ownerAccountId: actor.id, groupId, operationId, location }) } });
  }
  async function freshOwnerToken() {
    const token = opaqueToken();
    await database.pool.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,now(),now()+interval \'1 hour\')', [tokenDigest(token), f.workspace, actor.id]);
    return token;
  }
  return { ...f, store, actor, applications, saved, fields, command, family, program, groupCommand, freshOwnerToken };
}

it('actual PostgreSQL preserves the original two-child family after a typed post-COMMIT failure and fresh-session replay', async () => {
  const f = await fixture(); let lost = false;
  const afterCommit: IdentityStore = { async transaction(work) {
    let created = false;
    const result = await f.store.transaction(tx => work({ async query<T extends object>(sql: string, values: readonly unknown[] = []) {
      const rows = await tx.query<T>(sql, values);
      if (sql.includes('INSERT INTO ls_fishing_billing.commands') && values.includes('native_family_create')) created = true;
      return rows;
    } } as SqlSession));
    if (created && !lost) { lost = true; throw new AppError('FORBIDDEN'); }
    return result;
  } };
  const response = await f.family({ action: 'create_native_family', command: f.command }, undefined, afterCommit);
  expect(lost).toBe(true); expect(response.status).toBe(503);
  expect((await response.json()).ok).toBe(false);
  const token = await f.freshOwnerToken();
  const replay = await f.family({ action: 'create_native_family', command: f.command }, token);
  expect(replay.status).toBe(200); expect((await replay.json()).data).toMatchObject({ kind: 'native_family_created', replayed: true,
    record: { command: { selection: { familyId: f.command.familyId } } } });
  const read = await f.family(undefined, token); expect(read.status).toBe(200);
  const source = (await read.json()).data;
  expect(source.association).toMatchObject({ state: 'proposed', guardianVerified: false, recipientVerified: false, financialAcceptance: false, outboundEligible: false });
  expect(source.association.command.selection.children).toEqual(f.command.children);
  expect(source.children.map((child: { id: string }) => child.id).sort()).toEqual(f.fields.children.map(child => child.id).sort());
  expect((await f.applications.readForOwner(await f.runtime.sessions.actor(token), f.saved.item.id)).fields).toEqual(f.saved.item.fields);
  const counts = await database.pool.query(`SELECT
    (SELECT count(*)::int FROM ls_cases.families WHERE workspace_id=$1) AS families,
    (SELECT count(*)::int FROM ls_identity.people WHERE workspace_id=$1 AND kind='minor') AS minors,
    (SELECT count(*)::int FROM ls_identity.accounts WHERE workspace_id=$1) AS accounts,
    (SELECT count(*)::int FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND action='native_family_create') AS journals,
    (SELECT count(*)::int FROM ls_fishing_billing.obligations WHERE workspace_id=$1) AS obligations`, [f.workspace]);
  expect(counts.rows).toEqual([{ families: 1, minors: 2, accounts: 2, journals: 1, obligations: 0 }]);
});

it('actual PostgreSQL permits only one native family when two owner tabs propose distinct mappings for the same saved request', async () => {
  const f = await fixture();
  const competing = nativeFamilyCreateCommandSchema.parse({ ...f.command, operationId: randomUUID(), familyId: randomUUID(),
    children: f.command.children.map(child => ({ applicationChildId: child.applicationChildId, nativeChildId: randomUUID() })) });
  const responses = await Promise.all([f.command, competing].map(command => f.family({ action: 'create_native_family', command })));
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  const outcomes = await Promise.all(responses.map(response => response.json()));
  expect(outcomes.map(result => result.data.kind).sort()).toEqual(['native_family_created', 'native_family_rejected']);
  expect(outcomes.find(result => result.data.kind === 'native_family_rejected').data.code).toBe('CONFLICT');
  const counts = await database.pool.query(`SELECT
    (SELECT count(*)::int FROM ls_cases.families WHERE workspace_id=$1) AS families,
    (SELECT count(*)::int FROM ls_identity.people WHERE workspace_id=$1 AND kind='minor') AS minors,
    (SELECT count(*)::int FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1) AS proposals,
    (SELECT count(*)::int FROM ls_fishing_billing.commands WHERE workspace_id=$1) AS journals`, [f.workspace]);
  expect(counts.rows).toEqual([{ families: 1, minors: 2, proposals: 1, journals: 1 }]);
});

it('actual PostgreSQL serializes competing owner schedule revisions and permits correction only with the actual new revision', async () => {
  const f = await fixture();
  const initial = await f.groupCommand(0, 'SYNTHETIC initial owner planning note');
  expect((await f.program(initial)).status).toBe(200);
  const commands = await Promise.all([f.groupCommand(1, 'SYNTHETIC concurrent planning A'), f.groupCommand(1, 'SYNTHETIC concurrent planning B')]);
  const responses = await Promise.all(commands.map(command => f.program(command)));
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  const outcomes = await Promise.all(responses.map(response => response.json()));
  expect(outcomes.map(result => result.data.kind).sort()).toEqual(['recorded_source', 'rejected_source']);
  const rejected = outcomes.find(result => result.data.kind === 'rejected_source');
  expect(rejected.data.code).toBe('CONFLICT');
  const head = await f.program(); expect(head.status).toBe(200);
  expect((await head.json()).data.group.record.revision).toBe(2);
  const corrected = await f.groupCommand(2, 'SYNTHETIC corrected current revision');
  const saved = await f.program(corrected); expect(saved.status).toBe(200);
  expect((await saved.json()).data).toMatchObject({ kind: 'recorded_source', replayed: false, record: { revision: 3 } });
  const count = await database.pool.query('SELECT count(*)::int AS versions FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1', [f.workspace]);
  expect(count.rows).toEqual([{ versions: 3 }]);
});
