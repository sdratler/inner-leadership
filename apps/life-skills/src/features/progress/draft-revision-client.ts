import type { QualitativeNarrative } from './schema.ts';

export interface RevisionAttempt {
  reviewId: string; expectedRevision: number; operationId: string;
  narrative: QualitativeNarrative;
}
export interface SavedRevision {
  revision: number; operationId: string | null; savedAt: string;
  authorAccountId: string; narrative: QualitativeNarrative;
}
export interface RevisionReadback {
  reviewId: string; currentRevision: number; state: 'draft' | 'published';
  revisions: SavedRevision[]; hasMore: boolean; nextBefore: number | null;
}
export type RevisionOutcome = { state: 'pending' } |
  { state: 'recorded' | 'superseded'; saved: SavedRevision };

export function sameNarrative(a: QualitativeNarrative, b: QualitativeNarrative): boolean {
  const arrays = ['taughtAndPractised', 'parentReportedExamples', 'practitionerObservations', 'usefulChanges', 'continuingDifficulty'] as const;
  return arrays.every(key => Array.isArray(a[key]) && Array.isArray(b[key]) && a[key].length === b[key].length && a[key].every((v, i) => v === b[key][i])) &&
    a.uncertainty === b.uncertainty && a.nextAdjustment === b.nextAdjustment && a.informationLimits === b.informationLimits;
}

/** Mirror the existing narrative/AEAD bounds for usable pre-submit recovery.
 * Server validation remains authoritative; this does not relax any limit. */
export function validNarrativeForSave(narrative: QualitativeNarrative): boolean {
 const arrays = ['taughtAndPractised', 'parentReportedExamples', 'practitionerObservations', 'usefulChanges', 'continuingDifficulty'] as const;
 return narrative.taughtAndPractised.length > 0 && arrays.every(key => narrative[key].length <= 30 && narrative[key].every(value => value.length > 0 && value.length <= (key === 'taughtAndPractised' ? 500 : 1500))) &&
  [narrative.uncertainty, narrative.nextAdjustment, narrative.informationLimits].every(value => value.length > 0 && value.length <= 3000) &&
  new TextEncoder().encode(JSON.stringify(narrative)).length <= 65536;
}

/** A particular operation lookup is independent of the paginated history.
 * Missing receipt is pending, NEVER evidence that an uncertain write failed. */
export function reconcileRevisionAttempt(attempt: RevisionAttempt, readback: RevisionReadback): RevisionOutcome {
  if (readback.reviewId !== attempt.reviewId || !Number.isSafeInteger(readback.currentRevision) || readback.currentRevision < 1 ||
    !['draft', 'published'].includes(readback.state) || !Array.isArray(readback.revisions)) throw Error('INVALID_REVISION_READBACK');
  const matches = readback.revisions.filter(row => row.operationId === attempt.operationId);
  if (matches.length > 1) throw Error('INVALID_REVISION_READBACK');
  const saved = matches[0]; if (!saved) return { state: 'pending' };
  if (saved.revision !== attempt.expectedRevision + 1 || saved.revision > readback.currentRevision ||
    !Number.isFinite(Date.parse(saved.savedAt)) || !sameNarrative(saved.narrative, attempt.narrative)) throw Error('INVALID_REVISION_READBACK');
  return { state: saved.revision === readback.currentRevision ? 'recorded' : 'superseded', saved };
}
