import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('../manifests/monthly-status-calendar-20260914.json', import.meta.url));
const raw = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(raw);
const holidaySequences = [6, 7, 11, 12, 18, 19];

test('manifest reconciles the current thirty-concept intake without claiming missing exports', () => {
  assert.equal(manifest.id, 'LS-MONTH-20260914');
  assert.equal(manifest.authority.handoffVersion, '6.5');
  assert.deepEqual(manifest.counts, {
    requestedFlyers: 30,
    receivedConcepts: 16,
    missingConcepts: 14,
    exactVersionApprovals: 6,
    verifiedStatusExports: 6,
    verifiedFacebookFeedExports: 0,
    publishedConcepts: 1,
    publishedEvents: 2,
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

test('received and missing concepts match the read-back state', () => {
  const received = manifest.items.filter(item => item.sequence <= 16);
  const missing = manifest.items.filter(item => item.sequence >= 17);
  assert.equal(received.length, manifest.counts.receivedConcepts);
  assert.equal(missing.length, manifest.counts.missingConcepts);
  assert.ok(received.every(item => item.sourceFile || item.file));
  assert.ok(missing.every(item => !item.sourceFile && !item.file));
  assert.ok(missing.every(item => item.assetState === 'MISSING'));
});

test('only six exact versions have verified status exports and none has a verified feed export', () => {
  const approved = manifest.items.filter(item => item.exactVersionApproved);
  assert.deepEqual(approved.map(item => item.sequence), [1, 3, 5, 6, 7, 16]);
  assert.ok(approved.every(item => item.statusExport?.width === 1080 && item.statusExport?.height === 1920));
  assert.ok(approved.every(item => /^[a-f0-9]{64}$/.test(item.statusExport.sha256)));
  assert.ok(manifest.items.every(item => item.facebookFeedExport == null));
  assert.deepEqual([manifest.assetRequirements.status.width, manifest.assetRequirements.status.height], [1080, 1920]);
  assert.deepEqual([manifest.assetRequirements.facebookFeed.width, manifest.assetRequirements.facebookFeed.height], [1080, 1350]);
});

test('holiday rules skip exactly six dates with no backfill', () => {
  const holidayItems = manifest.items.filter(item => item.holiday);
  assert.deepEqual(holidayItems.map(item => item.sequence), holidaySequences);
  assert.ok(holidayItems.every(item => item.disposition === 'SKIP'));
  assert.deepEqual(holidayItems.map(item => item.date), manifest.schedule.holidayPolicy.dates);
  assert.equal(manifest.schedule.holidayPolicy.action, 'SKIP');
  assert.equal(manifest.schedule.holidayPolicy.backfill, false);
});

test('WhatsApp is active independently while Facebook unattended publishing remains fail-closed', () => {
  const whatsapp = manifest.schedule.channels.find(channel => channel.id === 'whatsapp_status');
  const facebook = manifest.schedule.channels.find(channel => channel.id === 'facebook_page');
  assert.equal(manifest.schedule.localTime, '20:00');
  assert.equal(manifest.schedule.timeZone, 'Asia/Jerusalem');
  assert.equal(manifest.schedule.deduplication.mode, 'ATOMIC');
  assert.equal(manifest.schedule.deduplication.unknownDeliveryAutoRetry, false);
  assert.equal(whatsapp.publicationEnabled, true);
  assert.equal(whatsapp.automaticReplies, false);
  assert.equal(facebook.publicationEnabled, false);
  assert.match(facebook.providerHealth, /OAUTH_CODE_200/);
  assert.equal(manifest.schedule.firstNaturalScheduledRun.receiptStatus, 'PENDING_NOT_YET_DUE');
});

test('provider receipts prove two one-off events without inventing the missing Facebook permalink', () => {
  assert.equal(manifest.schedule.receipts.length, 2);
  assert.deepEqual(manifest.schedule.receipts.map(receipt => receipt.channel), ['whatsapp_status', 'facebook_page']);
  assert.equal(manifest.schedule.receipts[1].providerPostId, '122110504053449454');
  assert.equal(manifest.schedule.receipts[1].permalinkStatus, 'PENDING_EXACT_READBACK');
});

test('the public manifest contains no private image bytes, local paths, Drive IDs or secrets', () => {
  assert.equal(manifest.publicSafety.identifiableImageBinariesInGit, false);
  assert.equal(manifest.publicSafety.driveFileIdsInGit, false);
  assert.doesNotMatch(raw, /drive\.google\.com\/file\/d\//i);
  assert.doesNotMatch(raw, /[A-Z]:\\Users\\/i);
  assert.doesNotMatch(raw, /(?:^|\/)Users\//i);
  assert.doesNotMatch(raw, /(?:secret|token|apiKey)\s*[=:]/i);
  assert.doesNotMatch(raw, /"(?:driveFileId|fileId|providerToken|apiKey)"\s*:/i);
});
