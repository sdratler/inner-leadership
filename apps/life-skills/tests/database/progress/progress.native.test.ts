/** Real SQL/HTTP boundary on the existing disposable, loopback-only fixture.
 * Fixture sessions test authorization; ordinary browser login is a separate gate.
 */
import { afterEach, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture, poolStore, type Fixture } from '../calendar/fixture.ts';
import { systemClock } from '../../../src/features/identity/types.ts';
import type { IdentityConfig } from '../../../src/features/identity/config.ts';
import { IdentitySessions } from '../../../src/features/identity/session-adapter.ts';
import { PostgresIdentityRateStore } from '../../../src/features/identity/rate-store.ts';
import { durableAuditSink } from '../../../src/features/identity/history.ts';
import { SESSION_COOKIE } from '../../../src/lib/security/session.ts';
import { ProgressHttp } from '../../../src/features/progress/http.ts';
import { ProgressService, type QualitativeReviewId } from '../../../src/features/progress/service.ts';
import { DatabaseAttendanceReader } from '../../../src/features/progress/sources.ts';
import { DatabaseParentReportReader } from '../../../src/features/updates/sources.ts';
import { HomePracticeService } from '../../../src/features/home-practice/service.ts';
import { UpdateService } from '../../../src/features/updates/service.ts';

const opened: Fixture[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.pool.end())); });
const narrative = {
  taughtAndPractised: ['Synthetic pause and ask'], parentReportedExamples: [],
  practitionerObservations: ['Synthetic shared practice only'], usefulChanges: [],
  continuingDifficulty: ['Synthetic transitions'], uncertainty: 'One synthetic period',
  nextAdjustment: 'Repeat the synthetic prompt', informationLimits: 'No parent source was selected',
};
const endOfPeriod = (start: string) => new Date(Date.parse(start + 'T00:00:00Z') + 28 * 86400000).toISOString().slice(0, 10);
async function setup() {
  const f = await fixture(); opened.push(f);
  const config: IdentityConfig = { enabled: true, origin: 'https://synthetic.example.invalid', workspaceId: f.workspaceId,
    csrfKey: randomBytes(32), lookupKey: randomBytes(32), rateLimitKey: randomUUID(), keyring: f.keyring, sessionSeconds: 3600 };
  const store = poolStore(f.pool), practice = new HomePracticeService(store, config, systemClock);
  const progress = new ProgressService(store, config, systemClock, new DatabaseAttendanceReader(store), new DatabaseParentReportReader(store), practice);
  const sessions = new IdentitySessions(store, config, systemClock);
  const http = new ProgressHttp({ config, sessions, clock: systemClock, limits: new PostgresIdentityRateStore(store), audit: durableAuditSink(store) }, progress);
  const periodStart = f.at(-72).slice(0, 10);
  const input = { caseId: f.first.id, audienceId: f.first.audienceId, periodStart, periodEnd: endOfPeriod(periodStart),
    assignmentVersionIds: [] as string[], parentReportIds: [] as string[], narrative };
  function request(method: 'GET' | 'POST', path: string, body?: unknown, token: string | null = f.practitioner.token, csrf = true) {
    const headers = new Headers();
    if (token) headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
    if (method === 'POST') {
      headers.set('Origin', config.origin); headers.set('Content-Type', 'application/json');
      if (token && csrf) headers.set('X-CSRF-Token', sessions.csrf(token));
    }
    return http.handle(new Request(config.origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  }
  async function snapshot() {
    const [reviews, references, history] = await Promise.all([
      f.pool.query('SELECT id,case_id,audience_id,period_start::text,period_end::text,attended_session_count,narrative_ciphertext,state,published_at FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 ORDER BY id', [f.workspaceId]),
      f.pool.query(`SELECT 'practice' AS kind,review_id,version_id::text AS source FROM ls_progress.review_practice_versions WHERE workspace_id=$1
        UNION ALL SELECT 'parent',review_id,report_id::text FROM ls_progress.review_parent_reports WHERE workspace_id=$1 ORDER BY kind,review_id,source`, [f.workspaceId]),
      f.pool.query('SELECT id,action FROM ls_progress.feature_history WHERE workspace_id=$1 ORDER BY id', [f.workspaceId]),
    ]);
    return { reviews: reviews.rows, references: references.rows, history: history.rows };
  }
  return { f, config, store, practice, progress, input, request, snapshot };
}

test('native duplicate HTTP 409 leaves trusted attendance, encrypted narrative, references and draft history unchanged', async () => {
  const h = await setup(), { f, input } = h;
  const startsAt = f.at(-48), appointment = await f.seed(startsAt);
  await f.service.recordAttendance(f.practitioner.actor, appointment, randomUUID(), { state: 'present', arrivedAt: startsAt, expectedVersion: 0, correctionReason: null });
  const draft = await h.practice.createDraft(f.practitioner.actor, { caseId: f.first.id, audienceId: f.first.audienceId, templateKey: 'W01', templateVersion: 'Program2.1',
    instructions: 'Synthetic pause practice', startsOn: input.periodStart, endsOn: input.periodEnd }, randomUUID());
  const version = await h.practice.publish(f.practitioner.actor, draft.assignmentId, draft.versionId, randomUUID());
  const updates = new UpdateService(h.store, h.config, systemClock, h.practice, h.practice);
  const report = await updates.submitParentReport(f.parent.actor, { caseId: f.first.id, audienceId: f.first.audienceId, practiceVersionId: version.versionId,
    body: 'Synthetic parent source to preserve', idempotencyKey: randomUUID() }, randomUUID());
  const sourced = { ...input, assignmentVersionIds: [version.versionId], parentReportIds: [report.id],
    narrative: { ...narrative, parentReportedExamples: ['Synthetic example from the selected parent report'], informationLimits: 'Synthetic attributed source, not independently witnessed' } };
  const first = await h.request('POST', '/api/progress/reviews', sourced);
  expect(first.status).toBe(201); expect(first.headers.get('cache-control')).toBe('private, no-store');
  const saved = await first.json(); expect(saved.data.attendedSessionCount).toBe(1);
  const before = await h.snapshot(); expect(before.references).toHaveLength(2); expect(before.history).toHaveLength(1);
  expect(before.reviews[0].narrative_ciphertext).not.toContain('Synthetic');
  const duplicate = await h.request('POST', '/api/progress/reviews', { ...sourced, narrative: { ...sourced.narrative, nextAdjustment: 'Synthetic unsaved replacement' } });
  expect(duplicate.status).toBe(409); expect(await duplicate.json()).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  expect(duplicate.headers.get('cache-control')).toBe('private, no-store');
  expect(await h.snapshot()).toEqual(before);
  const readback = await h.progress.listReviews(f.practitioner.actor, f.first.id);
  expect(readback).toHaveLength(1); expect(readback[0]).toMatchObject({ id: saved.data.reviewId, attendedSessionCount: 1, narrative: sourced.narrative });
}, 30_000);

test('concurrent native requests produce exactly one draft and one confirmed conflict', async () => {
  const h = await setup();
  const responses = await Promise.all([
    h.request('POST', '/api/progress/reviews', h.input),
    h.request('POST', '/api/progress/reviews', { ...h.input, narrative: { ...narrative, nextAdjustment: 'Other synthetic contender' } }),
  ]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  const bodies = await Promise.all(responses.map(r => r.json()));
  expect(bodies.filter(b => b.ok)).toHaveLength(1); expect(bodies.filter(b => b.error?.code === 'CONFLICT')).toHaveLength(1);
  const snapshot = await h.snapshot(); expect(snapshot.reviews).toHaveLength(1); expect(snapshot.history).toHaveLength(1); expect(snapshot.references).toEqual([]);
});

test('a duplicate never modifies a published report or exposes private evidence to its authorized family', async () => {
  const h = await setup(), { f } = h;
  const created = await h.request('POST', '/api/progress/reviews', h.input);
  expect(created.status).toBe(201); const saved = await created.json();
  const unpublished = await h.request('GET', `/api/progress/reviews?caseId=${f.first.id}`, undefined, f.parent.token);
  expect(unpublished.status).toBe(200); expect((await unpublished.json()).data).toEqual([]);
  const published = await h.request('POST', '/api/progress/reviews/publish', { reviewId: saved.data.reviewId as QualitativeReviewId });
  expect(published.status).toBe(200); const before = await h.snapshot(); expect(before.history).toHaveLength(2);
  const duplicate = await h.request('POST', '/api/progress/reviews', { ...h.input, narrative: { ...narrative, practitionerObservations: ['Unsaved replacement'] } });
  expect(duplicate.status).toBe(409); expect(await h.snapshot()).toEqual(before);
  const family = await h.request('GET', `/api/progress/reviews?caseId=${f.first.id}`, undefined, f.parent.token);
  expect(family.status).toBe(200); const readback = (await family.json()).data;
  expect(readback).toHaveLength(1); expect(readback[0]).toMatchObject({ id: saved.data.reviewId, state: 'published', narrative });
  expect(readback[0]).not.toHaveProperty('scores'); expect(readback[0]).not.toHaveProperty('transcript'); expect(readback[0]).not.toHaveProperty('analysis');
});

test('existing authorization, exact audience, CSRF, source-honesty and fresh session gates precede duplicate disclosure', async () => {
  const h = await setup(), { f } = h;
  expect((await h.request('POST', '/api/progress/reviews', h.input)).status).toBe(201);
  expect((await h.request('POST', '/api/progress/reviews', h.input, null)).status).toBe(401);
  expect((await h.request('POST', '/api/progress/reviews', h.input, f.parent.token)).status).toBe(403);
  expect((await h.request('POST', '/api/progress/reviews', h.input, f.practitioner.token, false)).status).toBe(403);
  expect((await h.request('POST', '/api/progress/reviews', { ...h.input, audienceId: f.second.audienceId })).status).toBe(404);
  expect((await h.request('GET', `/api/progress/reviews?caseId=${f.first.id}`, undefined, f.outsider.token)).status).toBe(404);
  expect((await h.request('GET', `/api/progress/reviews?caseId=${f.second.id}`, undefined, f.parent.token)).status).toBe(404);
  expect((await h.request('POST', '/api/progress/reviews', { ...h.input, periodEnd: h.input.periodStart })).status).toBe(400);
  expect((await h.request('POST', '/api/progress/reviews', { ...h.input, narrative: { ...narrative, parentReportedExamples: ['Unattributed synthetic claim'] } })).status).toBe(400);
  await f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND token_digest=$2', [f.workspaceId, f.practitioner.actor.sessionDigest]);
  expect((await h.request('POST', '/api/progress/reviews', h.input)).status).toBe(401);
  const snapshot = await h.snapshot(); expect(snapshot.reviews).toHaveLength(1); expect(snapshot.history).toHaveLength(1);
  const audit = await f.pool.query("SELECT count(*)::integer AS count FROM ls_identity.foundation_audit WHERE workspace_id=$1 AND kind='access_denied'", [f.workspaceId]);
  expect(audit.rows[0].count).toBeGreaterThanOrEqual(4);
});

test('the original unique constraint remains and distinct authorized cases or periods still create separate drafts', async () => {
  const h = await setup(), { f } = h;
  expect((await h.request('POST', '/api/progress/reviews', h.input)).status).toBe(201);
  expect((await h.request('POST', '/api/progress/reviews', { ...h.input, caseId: f.second.id, audienceId: f.second.audienceId })).status).toBe(201);
  const nextStart = h.input.periodEnd;
  expect((await h.request('POST', '/api/progress/reviews', { ...h.input, periodStart: nextStart, periodEnd: endOfPeriod(nextStart) })).status).toBe(201);
  const snapshot = await h.snapshot(); expect(snapshot.reviews).toHaveLength(3); expect(snapshot.history).toHaveLength(3);
  const constraints = await f.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='ls_progress.qualitative_reviews'::regclass AND conname='qualitative_reviews_workspace_id_case_id_period_start_key'");
  expect(constraints.rows).toEqual([{ definition: 'UNIQUE (workspace_id, case_id, period_start)' }]);
});
