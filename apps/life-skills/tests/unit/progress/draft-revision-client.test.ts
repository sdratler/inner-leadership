import { expect, test } from 'vitest';
import { reconcileRevisionAttempt, sameNarrative, validNarrativeForSave, type RevisionAttempt, type RevisionReadback } from '../../../src/features/progress/draft-revision-client.ts';
const narrative = { taughtAndPractised: ['Synthetic'], parentReportedExamples: ['Synthetic attributed example'], practitionerObservations: [], usefulChanges: [], continuingDifficulty: [], uncertainty: 'Synthetic', nextAdjustment: 'Synthetic', informationLimits: 'Synthetic' };
const attempt: RevisionAttempt = { reviewId: 'synthetic-review', expectedRevision: 1, operationId: 'synthetic-operation', narrative };
const saved = { revision: 2, operationId: attempt.operationId, savedAt: '2026-09-29T10:00:00Z', authorAccountId: 'synthetic-owner', narrative };
const readback: RevisionReadback = { reviewId: attempt.reviewId, currentRevision: 2, state: 'draft', hasMore: false, nextBefore: null, revisions: [saved] };
test('missing operation receipt stays pending, not failed, even outside the visible history window', () => {
  expect(reconcileRevisionAttempt(attempt, { ...readback, revisions: [], hasMore: true, nextBefore: 400 })).toEqual({ state: 'pending' });
});
test('only exact persisted operation, next version and narrative confirm a saved revision', () => {
  expect(reconcileRevisionAttempt(attempt, readback)).toEqual({ state: 'recorded', saved });
  for (const change of [{ revision: 3 }, { savedAt: 'invalid' }, { narrative: { ...narrative, parentReportedExamples: [] } }]) {
    expect(() => reconcileRevisionAttempt(attempt, { ...readback, revisions: [{ ...saved, ...change }] })).toThrow('INVALID_REVISION_READBACK');
  }
});
test('a later head preserves proof of this operation without claiming it is the current saved draft', () => {
  expect(reconcileRevisionAttempt(attempt, { ...readback, currentRevision: 4, state: 'published' })).toEqual({ state: 'superseded', saved });
});
test('other report, duplicate operation receipts and regressed head cannot confirm a save', () => {
  for (const change of [{ reviewId: 'other' }, { revisions: [saved, saved] }, { currentRevision: 1 }]) {
    expect(() => reconcileRevisionAttempt(attempt, { ...readback, ...change })).toThrow('INVALID_REVISION_READBACK');
  }
});
test('narrative equality is independent of object property order, but preserves each attributed example and list order', () => {
  expect(sameNarrative(narrative, Object.fromEntries(Object.entries(narrative).reverse()) as typeof narrative)).toBe(true);
  expect(sameNarrative(narrative, { ...narrative, taughtAndPractised: ['Other'] })).toBe(false);
});
test('usable pre-submit limits retain the exact server line/count and ciphertext-byte bounds including Hebrew', () => {
 expect(validNarrativeForSave(narrative)).toBe(true);
 for(const change of [{taughtAndPractised:[]},{taughtAndPractised:['x'.repeat(501)]},{practitionerObservations:Array(31).fill('Synthetic')},{nextAdjustment:'x'.repeat(3001)},
  {parentReportedExamples:Array(30).fill('א'.repeat(1500)),practitionerObservations:Array(30).fill('א'.repeat(1500))}])expect(validNarrativeForSave({...narrative,...change})).toBe(false);
});
