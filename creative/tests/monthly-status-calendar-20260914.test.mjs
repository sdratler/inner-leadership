import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('../manifests/monthly-status-calendar-20260914.json', import.meta.url));
const raw = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(raw);

const candidateSequences = [1, 3, 4, 5, 6, 7, 8, 9, 10];
const holidaySequences = [6, 7, 11, 12, 18, 19];

test('monthly intake reports the exact incomplete evidence without claiming approval', () => {
  assert.equal(manifest.id, 'LS-MONTH-20260914');
  assert.equal(manifest.status, 'REVIEW_INTAKE_INCOMPLETE');
  assert.deepEqual(manifest.counts, {
    requestedFlyers: 30,
    receivedFiles: 9,
    missingFiles: 21,
    exactVersionApprovals: 0,
    productionEligibleFiles: 0,
    scheduledPosts: 0,
    publishedPosts: 0,
  });
  assert.equal(manifest.ownership.duplicateGenerationAllowed, false);
  assert.equal(manifest.ownership.generationPerformedByThisLane, false);
});

test('all thirty dated slots are unique, continuous and retain editable Hebrew headlines', () => {
  assert.equal(manifest.items.length, 30);
  assert.deepEqual(manifest.items.map(item => item.sequence), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(new Set(manifest.items.map(item => item.slot)).size, 30);
  assert.equal(new Set(manifest.items.map(item => item.assetId)).size, 30);
  assert.equal(new Set(manifest.items.map(item => item.date)).size, 30);
  assert.ok(manifest.items.every(item => /^LS-MONTH-20260914-\d{2}$/.test(item.assetId)));
  assert.ok(manifest.items.every(item => typeof item.headline === 'string' && item.headline.length > 4));
});

test('only the nine read-back candidates have file receipts and each fails the production dimensions gate', () => {
  const candidates = manifest.items.filter(item => item.file);
  const missing = manifest.items.filter(item => !item.file);
  assert.deepEqual(candidates.map(item => item.sequence), candidateSequences);
  assert.equal(missing.length, 21);
  assert.ok(candidates.every(item => item.file.width === 941 && item.file.height === 1672));
  assert.ok(candidates.every(item => /^[a-f0-9]{64}$/.test(item.file.sha256)));
  assert.ok(candidates.every(item => item.assetState === 'REVIEW_CANDIDATE_WRONG_DIMENSIONS_UNAPPROVED'));
  assert.ok(missing.every(item => item.assetState === 'MISSING'));
  assert.deepEqual([manifest.assetRequirements.width, manifest.assetRequirements.height], [1080, 1920]);
});

test('no item is exact-version approved, production eligible, scheduled or published', () => {
  assert.ok(manifest.items.every(item => item.exactVersionApproved === false));
  assert.ok(manifest.items.every(item => item.approvalEvidence === null));
  assert.equal(manifest.schedule.activationAuthorized, false);
  assert.equal(manifest.schedule.publicationEnabled, false);
  assert.equal(manifest.schedule.providerMutationPerformed, false);
  assert.ok(manifest.schedule.channels.every(channel => channel.providerHealth === 'DEFERRED_UNTIL_OWNER_CALENDAR_APPROVAL'));
});

test('holiday rules skip exactly six dates with no backfill', () => {
  const holidayItems = manifest.items.filter(item => item.holiday);
  assert.deepEqual(holidayItems.map(item => item.sequence), holidaySequences);
  assert.ok(holidayItems.every(item => item.disposition === 'SKIP'));
  assert.deepEqual(holidayItems.map(item => item.date), manifest.schedule.holidayPolicy.dates);
  assert.equal(manifest.schedule.holidayPolicy.action, 'SKIP');
  assert.equal(manifest.schedule.holidayPolicy.backfill, false);
});

test('calendar timing, dedupe and owner-approved effect boundaries are fail-closed', () => {
  assert.equal(manifest.schedule.localTime, '20:00');
  assert.equal(manifest.schedule.timeZone, 'Asia/Jerusalem');
  assert.equal(manifest.schedule.deduplication.mode, 'ATOMIC');
  assert.equal(manifest.schedule.deduplication.unknownDeliveryAutoRetry, false);
  assert.equal(manifest.schedule.channels.find(channel => channel.id === 'whatsapp_status').automaticReplies, false);
  assert.equal(manifest.caption.source, 'CODEX_PROPOSED_NOT_GRAPHICS_IMPORTED');
  assert.equal(manifest.caption.graphicsWindowReturnedCaptionSet, false);
  assert.equal(manifest.caption.ownerApproved, false);
});

test('the public manifest contains no private image bytes, local paths or Drive file IDs', () => {
  assert.equal(manifest.publicSafety.identifiableImageBinariesInGit, false);
  assert.equal(manifest.publicSafety.driveFileIdsInGit, false);
  assert.doesNotMatch(raw, /drive\.google\.com\/file\/d\//i);
  assert.doesNotMatch(raw, /[A-Z]:\\Users\\/i);
  assert.doesNotMatch(raw, /(?:^|\/)Users\//i);
  assert.doesNotMatch(raw, /"(?:driveFileId|fileId|providerToken|apiKey)"\s*:/i);
});
