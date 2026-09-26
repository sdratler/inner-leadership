import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestPath = new URL('../manifests/assets.json', import.meta.url);
const assetPath = new URL('../assets/ls-og-master-he-v1.png', import.meta.url);

test('approved Hebrew share master is archived byte-exactly', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const master = manifest.assets.find((asset) => asset.id === 'LS-OG-MASTER-HE');
  assert.ok(master, 'LS-OG-MASTER-HE is registered');
  assert.equal(master.approval.status, 'OWNER_APPROVED_MASTER');
  assert.equal(master.provenance.historyId, 'avJp5dVmQ57ZwWoxUzxF');
  assert.equal(master.provenance.resourceId, 'hJLsVPvmQEAidSZ05PYj');
  assert.equal(master.provenance.olderProvenanceOnlyHistoryId, '8mHVLTE0Kn9KRLNYPNhC');
  assert.equal(master.notAWebsiteHero, true);
  assert.equal(master.notAFullStaticAd, true);
  assert.equal(master.allowRegeneration, false);

  const bytes = await readFile(assetPath);
  assert.equal(bytes.length, master.asset.sizeBytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), master.asset.sha256);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(bytes.readUInt32BE(16), master.asset.width);
  assert.equal(bytes.readUInt32BE(20), master.asset.height);
});

test('organic copy remains review-only and full static ads remain distinct', async () => {
  const copy = JSON.parse(await readFile(new URL('../manifests/copy.json', import.meta.url), 'utf8'));
  assert.deepEqual(copy.organicReview.map((item) => item.id), [
    'ORG-REVIEW-20260913-C01',
    'ORG-REVIEW-20260913-C02',
    'ORG-REVIEW-20260913-C03'
  ]);
  assert.ok(copy.organicReview.every((item) => item.status === 'REVIEW' && item.publishAllowed === false));

  const policy = JSON.parse(await readFile(new URL('../manifests/production-policy.json', import.meta.url), 'utf8'));
  assert.equal(policy.shareCards.hebrewMasterId, 'LS-OG-MASTER-HE');
  assert.equal(policy.shareCards.fullStaticAdsRemainSeparate, true);
  assert.equal(policy.shareCards.automaticWhatsAppReplies, false);
  assert.equal(policy.shareCards.generationRequiredForReviewedOrganicReuse, false);
});
