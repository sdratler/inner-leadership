/** Native SQL and real identity/HTTPS/CSRF boundary; synthetic records only. */
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
import { ProgressService } from '../../../src/features/progress/service.ts';
import { DatabaseAttendanceReader } from '../../../src/features/progress/sources.ts';
import { DatabaseParentReportReader } from '../../../src/features/updates/sources.ts';
import { HomePracticeService } from '../../../src/features/home-practice/service.ts';
import { readFileSync } from 'node:fs';
import { progressReviewIntegrity } from '../../../src/db/progress-review-integrity.ts';
import type { Migration } from '../../../src/db/migration-plan.ts';
import { UpdateService } from '../../../src/features/updates/service.ts';

const opened: Fixture[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.pool.end())); });
const narrative = { taughtAndPractised: ['Synthetic practice'], parentReportedExamples: [],
  practitionerObservations: ['Synthetic shared narrative, not private scores'], usefulChanges: [],
  continuingDifficulty: [], uncertainty: 'Synthetic uncertainty', nextAdjustment: 'Synthetic next step',
  informationLimits: 'Synthetic evidence only' };
async function setup() {
  const f = await fixture(); opened.push(f);
  const config: IdentityConfig = { enabled: true, origin: 'https://synthetic.example.invalid', workspaceId: f.workspaceId,
    csrfKey: randomBytes(32), lookupKey: randomBytes(32), rateLimitKey: randomUUID(), keyring: f.keyring, sessionSeconds: 3600 };
  const store = poolStore(f.pool), practice = new HomePracticeService(store, config, systemClock);
  const progress = new ProgressService(store, config, systemClock, new DatabaseAttendanceReader(store), new DatabaseParentReportReader(store), practice);
  const sessions = new IdentitySessions(store, config, systemClock);
  const http = new ProgressHttp({ config, sessions, clock: systemClock, limits: new PostgresIdentityRateStore(store), audit: durableAuditSink(store) }, progress);
  function request(method: 'GET' | 'POST', path: string, body?: unknown, token: string | null = f.practitioner.token, csrf = true, origin = config.origin) {
    const headers = new Headers(); if (token) headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
    if (method === 'POST') { headers.set('Origin', origin); headers.set('Content-Type', 'application/json'); if (token && csrf) headers.set('X-CSRF-Token', sessions.csrf(token)); }
    return http.handle(new Request(config.origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  }
  const periodStart = f.at(-72).slice(0, 10), periodEnd = new Date(Date.parse(periodStart + 'T00:00:00Z') + 28 * 86400000).toISOString().slice(0, 10);
  const created = await request('POST', '/api/progress/reviews', { caseId: f.first.id, audienceId: f.first.audienceId, periodStart, periodEnd, assignmentVersionIds: [], parentReportIds: [], narrative });
  expect(created.status).toBe(201); const saved = (await created.json()).data;
  const revision = (next = 'Synthetic revised step', expectedRevision = 1, operationId = randomUUID()) => ({ reviewId: saved.reviewId, expectedRevision, operationId, narrative: { ...narrative, nextAdjustment: next } });
  const history = (query = '') => request('GET', `/api/progress/reviews/revisions?reviewId=${saved.reviewId}${query}`);
  return { f, request, saved, revision, history, progress, practice, store, config, periodStart, periodEnd };
}

test('native same-report revision persists encrypted immutable history and exact replay without duplicate events', async () => {
  const h = await setup(), input = h.revision();
  const revised = await h.request('POST', '/api/progress/reviews/revise', input);
  expect(revised.status).toBe(201); expect(revised.headers.get('cache-control')).toBe('private, no-store');
  expect((await revised.json()).data).toMatchObject({ reviewId: h.saved.reviewId, revision: 2, operationId: input.operationId, replayed: false });
  const replay = await h.request('POST', '/api/progress/reviews/revise', input);
  expect(replay.status).toBe(200); expect((await replay.json()).data).toMatchObject({ revision: 2, replayed: true });
  const changedReplay = await h.request('POST', '/api/progress/reviews/revise', { ...input, narrative: { ...input.narrative, nextAdjustment: 'Changed replay must not write' } });
  expect(changedReplay.status).toBe(409);
  const read = await h.history(); expect(read.status).toBe(200);
  expect((await read.json()).data).toMatchObject({ currentRevision: 2, state: 'draft', hasMore: false, revisions: [
    { revision: 2, operationId: input.operationId, narrative: input.narrative }, { revision: 1, operationId: null, narrative },
  ] });
  const rows = await h.f.pool.query('SELECT revision,narrative_ciphertext FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 AND review_id=$2 ORDER BY revision', [h.f.workspaceId, h.saved.reviewId]);
  expect(rows.rows).toHaveLength(2); expect(rows.rows.every(row => !row.narrative_ciphertext.includes('Synthetic'))).toBe(true);
  await expect(h.f.pool.query('UPDATE ls_progress.qualitative_review_revisions SET narrative_ciphertext=$3 WHERE workspace_id=$1 AND review_id=$2', [h.f.workspaceId, h.saved.reviewId, 'tampered'])).rejects.toMatchObject({ code: '23514' });
  await expect(h.f.pool.query('DELETE FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 AND review_id=$2', [h.f.workspaceId, h.saved.reviewId])).rejects.toMatchObject({ code: '23514' });
  const events = await h.f.pool.query('SELECT action FROM ls_progress.feature_history WHERE workspace_id=$1 ORDER BY occurred_at,id', [h.f.workspaceId]);
  expect(events.rows.map(row => row.action)).toEqual(['qualitative_review_drafted', 'qualitative_review_revised']);
});

test('native SQL rejects owner bypasses, uncommitted/orphan history, changed head identity and non-practitioner authors', async()=>{
 const h=await setup(),client=await h.f.pool.connect();
 await expect(h.f.pool.query("UPDATE ls_progress.qualitative_reviews SET narrative_ciphertext='tampered' WHERE workspace_id=$1 AND id=$2",[h.f.workspaceId,h.saved.reviewId])).rejects.toMatchObject({code:'23514'});
 await expect(h.f.pool.query('UPDATE ls_progress.qualitative_reviews SET period_start=period_start+1,period_end=period_end+1 WHERE workspace_id=$1 AND id=$2',[h.f.workspaceId,h.saved.reviewId])).rejects.toMatchObject({code:'23514'});
 const insert=`INSERT INTO ls_progress.qualitative_review_revisions(workspace_id,review_id,revision,narrative_ciphertext,author_account_id,saved_at,operation_id,request_digest) SELECT workspace_id,id,2,narrative_ciphertext,$3,clock_timestamp(),$4,$5 FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2`;
 await expect(h.f.pool.query(insert,[h.f.workspaceId,h.saved.reviewId,h.f.parent.actor.id,randomUUID(),'a'.repeat(64)])).rejects.toMatchObject({code:'23514'});
 await expect(h.f.pool.query(insert,[h.f.workspaceId,h.saved.reviewId,h.f.practitioner.actor.id,randomUUID(),null])).rejects.toMatchObject({code:'23514'});
 try{
  await client.query('BEGIN');await client.query(insert,[h.f.workspaceId,h.saved.reviewId,h.f.practitioner.actor.id,randomUUID(),'b'.repeat(64)]);
  await expect(client.query('COMMIT')).rejects.toMatchObject({code:'23514'});
 }finally{await client.query('ROLLBACK');client.release();}
 const count=await h.f.pool.query('SELECT count(*)::integer AS count FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 AND review_id=$2',[h.f.workspaceId,h.saved.reviewId]);
 expect(count.rows[0].count).toBe(1);
});

test('native private history is bounded and an old exact operation remains recoverable outside the latest100 window',async()=>{
 const h=await setup(),first=h.revision('Synthetic oldest saved revision');
 expect((await h.request('POST','/api/progress/reviews/revise',first)).status).toBe(201);
 for(let expectedRevision=2;expectedRevision<=102;expectedRevision++)expect((await h.request('POST','/api/progress/reviews/revise',h.revision(`Synthetic saved revision ${expectedRevision+1}`,expectedRevision))).status).toBe(201);
 const latest=(await (await h.history()).json()).data;
 expect(latest).toMatchObject({currentRevision:103,hasMore:true,nextBefore:4});expect(latest.revisions).toHaveLength(100);expect(latest.revisions[0].revision).toBe(103);
 const earlier=(await (await h.history('&before=4')).json()).data;
 expect(earlier).toMatchObject({hasMore:false,nextBefore:null});expect(earlier.revisions.map((r:{revision:number})=>r.revision)).toEqual([3,2,1]);
 const exact=(await (await h.history('&operationId='+first.operationId)).json()).data;
 expect(exact.revisions).toHaveLength(1);expect(exact.revisions[0]).toMatchObject({revision:2,operationId:first.operationId,narrative:first.narrative});
 const replay=await h.request('POST','/api/progress/reviews/revise',first);expect(replay.status).toBe(200);expect((await replay.json()).data).toMatchObject({revision:2,replayed:true});
 expect((await h.request('GET',`/api/progress/reviews/revisions?reviewId=${h.saved.reviewId}&before=4&operationId=${first.operationId}`)).status).toBe(400);
},30000);

test('native revisions preserve attributed sources and reject a fresh reporter-grant revocation before any replacement',async()=>{
 const h=await setup(),f=h.f;
 const draft=await h.practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:'W01',templateVersion:'synthetic-revision-v1',instructions:'Synthetic source practice',startsOn:h.periodStart,endsOn:null},randomUUID());
 await h.practice.publish(f.practitioner.actor,draft.assignmentId,draft.versionId,randomUUID());
 const updates=new UpdateService(h.store,h.config,systemClock,h.practice,h.practice),source=await updates.submitParentReport(f.parent.actor,{caseId:f.first.id,audienceId:f.first.audienceId,practiceVersionId:draft.versionId,body:'Synthetic retained parent note',idempotencyKey:randomUUID()},randomUUID());
 const start=h.periodEnd,end=new Date(Date.parse(start+'T00:00:00Z')+28*86400000).toISOString().slice(0,10);
 const attributed={...narrative,parentReportedExamples:['Synthetic attributed source'],informationLimits:'Synthetic parent report, not independently witnessed'};
 const created=await h.progress.createReview(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,periodStart:start,periodEnd:end,assignmentVersionIds:[draft.versionId],parentReportIds:[source.id],narrative:attributed},randomUUID());
 const input={reviewId:created.reviewId,expectedRevision:1,operationId:randomUUID(),narrative:{...attributed,nextAdjustment:'Synthetic source-preserving revision'}};
 await h.progress.reviseReview(f.practitioner.actor,input,randomUUID());
 const before=await f.pool.query('SELECT to_jsonb(t) AS row FROM ls_progress.review_parent_reports t WHERE workspace_id=$1 AND review_id=$2',[f.workspaceId,created.reviewId]);
 const readback=(await h.progress.listReviews(f.practitioner.actor,f.first.id)).find(r=>r.id===created.reviewId)!;
 expect(readback).toMatchObject({revision:2,narrative:input.narrative,assignmentVersionIds:[draft.versionId],parentReports:[{reportId:source.id,authorAccountId:f.parent.actor.id}]});
 await f.pool.query('UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND audience_id=$2 AND account_id=$3',[f.workspaceId,f.first.audienceId,f.parent.actor.id]);
 await expect(h.progress.reviseReview(f.practitioner.actor,{...input,expectedRevision:2,operationId:randomUUID()},randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await f.pool.query('SELECT to_jsonb(t) AS row FROM ls_progress.review_parent_reports t WHERE workspace_id=$1 AND review_id=$2',[f.workspaceId,created.reviewId])).rows).toEqual(before.rows);
 expect((await f.pool.query('SELECT revision FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2',[f.workspaceId,created.reviewId])).rows).toEqual([{revision:2}]);
});

test('native read-only integrity proof detects changed functions, disabled FK triggers, indexes, unexpected grants and missing revisions',async()=>{
 const h=await setup(),manifest=JSON.parse(readFileSync(new URL('../../../migrations/manifest.json',import.meta.url),'utf8')) as {name:string;sha256:string}[];
 const files:Migration[]=manifest.map(entry=>({name:entry.name,checksum:entry.sha256,sql:readFileSync(new URL('../../../migrations/'+entry.name,import.meta.url),'utf8')}));
 const client=await h.f.pool.connect(),tx={query:async <R extends object>(sql:string,values:readonly unknown[]=[]) => (await client.query<R>(sql,[...values])).rows};
 const good={baselineCatalog:false,revisedCatalog:true,publishedGuards:true,revisionGuards:true,foreignKeys:true,permissions:true,referencesSound:true};
 try{
  expect(await progressReviewIntegrity(tx,files)).toEqual(good);
  for(const [sql,key] of [
   ["CREATE OR REPLACE FUNCTION ls_progress.check_review_head_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;",'revisionGuards'],
   ['ALTER TABLE ls_progress.qualitative_review_revisions DISABLE TRIGGER ALL','revisedCatalog'],
   ['CREATE INDEX synthetic_unreviewed_progress_index ON ls_progress.qualitative_reviews(state)','revisedCatalog'],
   ['GRANT SELECT ON ls_progress.qualitative_review_revisions TO PUBLIC','permissions'],
   ['GRANT EXECUTE ON FUNCTION ls_progress.check_review_head_revision() TO PUBLIC','revisionGuards'],
  ] as const){
   await client.query('BEGIN');try{await client.query(sql);expect((await progressReviewIntegrity(tx,files))[key]).toBe(false);}finally{await client.query('ROLLBACK');}
   expect(await progressReviewIntegrity(tx,files)).toEqual(good);
  }
  await client.query('BEGIN');try{
   await client.query('ALTER TABLE ls_progress.qualitative_review_revisions DISABLE TRIGGER ALL');
   await client.query('DELETE FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 AND review_id=$2',[h.f.workspaceId,h.saved.reviewId]);
   await client.query('ALTER TABLE ls_progress.qualitative_review_revisions ENABLE TRIGGER ALL');
   expect((await progressReviewIntegrity(tx,files)).referencesSound).toBe(false);
  }finally{await client.query('ROLLBACK');}
  expect(await progressReviewIntegrity(tx,files)).toEqual(good);
 }finally{client.release();}
});

test('native concurrent revisions preserve the loser text and stale publication cannot publish unseen edits', async () => {
  const h = await setup(), a = h.revision('Synthetic contender A'), b = h.revision('Synthetic contender B');
  const responses = await Promise.all([h.request('POST', '/api/progress/reviews/revise', a), h.request('POST', '/api/progress/reviews/revise', b)]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  expect((await h.request('POST', '/api/progress/reviews/publish', { reviewId: h.saved.reviewId, expectedRevision: 1 })).status).toBe(409);
  // Legacy callers may publish untouched v1 only, never an unseen newer revision.
  expect((await h.request('POST', '/api/progress/reviews/publish', { reviewId: h.saved.reviewId })).status).toBe(409);
  expect((await h.request('POST', '/api/progress/reviews/publish', { reviewId: h.saved.reviewId, expectedRevision: 2 })).status).toBe(200);
  expect((await h.request('POST', '/api/progress/reviews/revise', h.revision('Cannot change published', 2))).status).toBe(409);
  const family = await h.request('GET', `/api/progress/reviews?caseId=${h.f.first.id}`, undefined, h.f.parent.token);
  expect(family.status).toBe(200); const published = (await family.json()).data;
  expect(published).toHaveLength(1); expect(published[0]).toMatchObject({ id: h.saved.reviewId, revision: 2, state: 'published' });
  expect(published[0]).not.toHaveProperty('revisions'); expect(published[0]).not.toHaveProperty('scores');
  const histories = await h.f.pool.query('SELECT count(*)::integer AS count FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 AND review_id=$2', [h.f.workspaceId, h.saved.reviewId]);
  expect(histories.rows[0].count).toBe(2);
});

test('native publication rechecks the exact revision after the real attendance read, not only before it',async()=>{
 const h=await setup(),realAttendance=new DatabaseAttendanceReader(h.store);
 let counted!:()=>void,release!:()=>void;
 const observed=new Promise<void>(done=>{counted=done;}),hold=new Promise<void>(done=>{release=done;});
 const publisher=new ProgressService(h.store,h.config,systemClock,{async countActuallyAttended(scope,input){const count=await realAttendance.countActuallyAttended(scope,input);counted();await hold;return count;}},new DatabaseParentReportReader(h.store),h.practice);
 const pending=publisher.publishReview(h.f.practitioner.actor,h.saved.reviewId,randomUUID(),1);
 await observed;
 try{expect(await h.progress.reviseReview(h.f.practitioner.actor,h.revision(),randomUUID())).toMatchObject({revision:2});}finally{release();}
 await expect(pending).rejects.toMatchObject({code:'CONFLICT'});
 const stored=await h.f.pool.query('SELECT revision,state,published_at FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2',[h.f.workspaceId,h.saved.reviewId]);
 expect(stored.rows).toEqual([{revision:2,state:'draft',published_at:null}]);
 expect(await h.progress.listReviews(h.f.parent.actor,h.f.first.id)).toEqual([]);
});

test('native revision/readback boundaries reject family, outsider, stale session, wrong audience, origin and CSRF', async () => {
  const h = await setup(), input = h.revision();
  expect((await h.request('POST', '/api/progress/reviews/revise', input, null)).status).toBe(401);
  for (const token of [h.f.parent.token, h.f.outsider.token]) {
    expect((await h.request('POST', '/api/progress/reviews/revise', input, token)).status).toBe(403);
    expect((await h.request('GET', `/api/progress/reviews/revisions?reviewId=${h.saved.reviewId}`, undefined, token)).status).toBe(403);
  }
  expect((await h.request('POST', '/api/progress/reviews/revise', input, h.f.practitioner.token, false)).status).toBe(403);
  expect((await h.request('POST', '/api/progress/reviews/revise', input, h.f.practitioner.token, true, 'https://wrong.example.invalid')).status).toBe(403);
  expect((await h.request('POST', '/api/progress/reviews/revise', { ...input, narrative: { ...input.narrative, parentReportedExamples: ['Unattributed source'] } })).status).toBe(400);
  expect((await h.request('POST', '/api/progress/reviews/revise', { ...input, caseId: h.f.second.id })).status).toBe(400);
  expect((await h.history('&before=1&before=2')).status).toBe(400);
  await h.f.pool.query('UPDATE ls_cases.audiences SET published=false WHERE workspace_id=$1 AND id=$2', [h.f.workspaceId, h.f.first.audienceId]);
  expect((await h.request('POST', '/api/progress/reviews/revise', input)).status).toBe(404);
  expect((await h.history()).status).toBe(404);
  await h.f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND token_digest=$2', [h.f.workspaceId, h.f.practitioner.actor.sessionDigest]);
  expect((await h.request('POST', '/api/progress/reviews/revise', input)).status).toBe(401);
  const rows = await h.f.pool.query('SELECT revision FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2', [h.f.workspaceId, h.saved.reviewId]);
  expect(rows.rows).toEqual([{ revision: 1 }]);
});
