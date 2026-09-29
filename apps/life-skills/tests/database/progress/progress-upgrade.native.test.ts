/** Genuine populated 27→28 upgrade in a new disposable loopback database.
 * No live DB, ledger resets, decrypted dump or historical row rewriting. */
import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { fixture, poolStore, safeTestUrl, type Fixture } from '../calendar/fixture.ts';
import { migrate, type MigrationClient } from '../../../src/db/migration-runner.ts';
import type { Migration } from '../../../src/db/migration-plan.ts';
import type { SqlSession } from '../../../src/features/identity/store.ts';
import { ProgressService } from '../../../src/features/progress/service.ts';
import { DatabaseAttendanceReader } from '../../../src/features/progress/sources.ts';
import { DatabaseParentReportReader } from '../../../src/features/updates/sources.ts';
import { HomePracticeService } from '../../../src/features/home-practice/service.ts';
import { UpdateService } from '../../../src/features/updates/service.ts';
import { systemClock } from '../../../src/features/identity/types.ts';
import type { IdentityConfig } from '../../../src/features/identity/config.ts';
import { progressReviewCatalogDigest, progressReviewIntegrity, PROGRESS_REVIEW_REVISIONS_MIGRATION } from '../../../src/db/progress-review-integrity.ts';

test('native populated27→28 backfills exact encrypted narratives/attribution and preserves published heads, references and old ledger', async () => {
 const cluster = new URL(safeTestUrl()); expect(['127.0.0.1', 'localhost', '[::1]']).toContain(cluster.hostname); expect(cluster.search).toBe(''); expect(cluster.hash).toBe('');
 const db = 'ls_calendar_test_progress_upgrade_' + randomBytes(8).toString('hex');
 if (!/^ls_calendar_test_progress_upgrade_[a-f0-9]{16}$/.test(db)) throw Error('PROGRESS_UPGRADE_DATABASE_NAME_INVALID');
 const adminUrl = new URL(cluster); adminUrl.pathname = '/postgres'; const testUrl = new URL(cluster); testUrl.pathname = '/' + db;
 const admin = new pg.Pool({ connectionString: adminUrl.toString(), ssl: false, max: 1 }), pool = new pg.Pool({ connectionString: testUrl.toString(), ssl: false, max: 1 });
 let created = false, f: Fixture | undefined, client: pg.PoolClient | undefined;
 try {
  await admin.query(`CREATE DATABASE "${db}"`); created = true;
  const manifest = JSON.parse(readFileSync(new URL('../../../migrations/manifest.json', import.meta.url), 'utf8')) as { name: string; sha256: string }[];
  const files: Migration[] = manifest.map(entry => { const bytes = readFileSync(new URL(`../../../migrations/${entry.name}`, import.meta.url)); expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256); return { name: entry.name, checksum: entry.sha256, sql: bytes.toString('utf8') }; });
  expect(files).toHaveLength(28); expect(files.at(-1)).toMatchObject({ name: PROGRESS_REVIEW_REVISIONS_MIGRATION.name, checksum: PROGRESS_REVIEW_REVISIONS_MIGRATION.sha256 });
  client = await pool.connect();
  const adapter: MigrationClient = { query: async (sql, values) => await client!.query(sql, values ? [...values] : undefined) };
  const tx: SqlSession = { query: async <R extends object>(sql: string, values: readonly unknown[] = []) => (await client!.query<R>(sql, [...values])).rows };
  expect(await migrate(adapter, files.slice(0, -1), false)).toEqual({ applied: 27, pending: 0 });
  vi.stubEnv('TEST_DATABASE_URL', testUrl.toString()); vi.stubEnv('LS_CALENDAR_TEST_ALLOW', 'true'); f = await fixture();
  const store = poolStore(f.pool), config: IdentityConfig = { enabled: true, origin: 'https://synthetic.example.invalid', workspaceId: f.workspaceId, csrfKey: randomBytes(32), lookupKey: randomBytes(32), rateLimitKey: randomUUID(), keyring: f.keyring, sessionSeconds: 3600 };
  const practice = new HomePracticeService(store, config, systemClock), updates = new UpdateService(store, config, systemClock, practice, practice);
  const service = new ProgressService(store, config, systemClock, new DatabaseAttendanceReader(store), new DatabaseParentReportReader(store), practice);
  const draft = await practice.createDraft(f.practitioner.actor, { caseId: f.first.id, audienceId: f.first.audienceId, templateKey: 'W01', templateVersion: 'synthetic-upgrade-v1', instructions: 'Synthetic retained source', startsOn: f.at(-24).slice(0, 10), endsOn: null }, randomUUID());
  await practice.publish(f.practitioner.actor, draft.assignmentId, draft.versionId, randomUUID());
  const report = await updates.submitParentReport(f.parent.actor, { caseId: f.first.id, audienceId: f.first.audienceId, practiceVersionId: draft.versionId, body: 'Synthetic retained attributed report', idempotencyKey: randomUUID() }, randomUUID());
  const narrative = { taughtAndPractised: ['Synthetic retained teaching'], parentReportedExamples: ['Synthetic retained attributed example'], practitionerObservations: ['Synthetic approved narrative, not private notes'], usefulChanges: [], continuingDifficulty: [], uncertainty: 'Synthetic uncertainty', nextAdjustment: 'Synthetic next', informationLimits: 'Synthetic selected parent source only' };
  const start = f.at(-72).slice(0, 10), end = new Date(Date.parse(start + 'T00:00:00Z') + 28 * 86400000).toISOString().slice(0, 10);
  const input = { caseId: f.first.id, audienceId: f.first.audienceId, periodStart: start, periodEnd: end, assignmentVersionIds: [draft.versionId], parentReportIds: [report.id], narrative };
  const first = await service.createReview(f.practitioner.actor, input, randomUUID());
  const second = await service.createReview(f.practitioner.actor, { ...input, periodStart: end, periodEnd: new Date(Date.parse(end + 'T00:00:00Z') + 28 * 86400000).toISOString().slice(0, 10) }, randomUUID());
  // Model an existing 0050-published row using its real pre-upgrade SQL contract.
  await f.pool.query("UPDATE ls_progress.qualitative_reviews SET state='published',published_by_account_id=$3,published_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2", [f.workspaceId, second.reviewId, f.practitioner.actor.id]);
  // Backfill must retain attribution even when its historical author is no
  // longer active; future writes must still require fresh active authority.
  await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
  const snapshot = async () => {
   const result: Record<string, unknown> = {};
   for (const table of ['qualitative_reviews', 'review_practice_versions', 'review_parent_reports', 'feature_history']) {
    const projection = table === 'qualitative_reviews' ? "to_jsonb(t)-'revision'" : 'to_jsonb(t)';
    result[table] = (await client!.query(`SELECT ${projection} AS row FROM ls_progress.${table} t WHERE workspace_id=$1 ORDER BY (${projection})::text`, [f!.workspaceId])).rows;
   }
   return result;
  };
  const before = await snapshot(), oldLedger = (await client.query('SELECT * FROM ls_control.migrations ORDER BY name')).rows;
  const baselineDigest = await progressReviewCatalogDigest(tx), baseline = await progressReviewIntegrity(tx, files);
  expect(await migrate(adapter, files, false)).toEqual({ applied: 1, pending: 0 });
  const revisedDigest = await progressReviewCatalogDigest(tx), revised = await progressReviewIntegrity(tx, files);
  console.log(JSON.stringify({ progressBaselineCatalogSha256: baselineDigest, progressRevisedCatalogSha256: revisedDigest }));
  expect(await snapshot()).toEqual(before);
  expect((await client.query('SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name', [PROGRESS_REVIEW_REVISIONS_MIGRATION.name])).rows).toEqual(oldLedger);
  expect(await migrate(adapter, files, false)).toEqual({ applied: 0, pending: 0 }); expect(await migrate(adapter, files, true)).toEqual({ applied: 0, pending: 0 });
  expect(baseline).toEqual({ baselineCatalog: true, revisedCatalog: false, publishedGuards: true, revisionGuards: false, foreignKeys: true, permissions: true, referencesSound: true });
  expect(revised).toEqual({ ...baseline, baselineCatalog: false, revisedCatalog: true, revisionGuards: true });
  const versions = (await client.query('SELECT review_id,revision,narrative_ciphertext,author_account_id,saved_at FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 ORDER BY review_id', [f.workspaceId])).rows;
  expect(versions).toHaveLength(2);
  for (const row of versions) {
   const head = (await client.query('SELECT narrative_ciphertext,created_by_account_id,created_at FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2', [f.workspaceId, row.review_id])).rows[0];
   expect(row).toMatchObject({ revision: 1, narrative_ciphertext: head.narrative_ciphertext, author_account_id: head.created_by_account_id, saved_at: head.created_at });
   expect(row.narrative_ciphertext).not.toContain('Synthetic');
  }
  await f.pool.query("UPDATE ls_identity.accounts SET state='active' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
  const changed = { reviewId: first.reviewId, expectedRevision: 1, operationId: randomUUID(), narrative: { ...narrative, nextAdjustment: 'Synthetic incremental revision' } };
  expect(await service.reviseReview(f.practitioner.actor, changed, randomUUID())).toMatchObject({ revision: 2, replayed: false });
  await expect(service.reviseReview(f.practitioner.actor, { ...changed, reviewId: second.reviewId }, randomUUID())).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await service.listReviews(f.parent.actor, f.first.id))).toEqual([expect.objectContaining({ id: second.reviewId, state: 'published', narrative })]);
  const referenceSnapshot = await snapshot(); expect(referenceSnapshot.review_practice_versions).toEqual(before.review_practice_versions); expect(referenceSnapshot.review_parent_reports).toEqual(before.review_parent_reports);
  expect(await progressReviewIntegrity(tx, files)).toEqual(revised);
 } finally {
  vi.unstubAllEnvs(); await f?.pool.end(); client?.release(); await pool.end(); if (created) await admin.query(`DROP DATABASE "${db}"`); await admin.end();
 }
}, 30_000);
