import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IntentSchema } from '../src/contracts.mjs';
import { loadState } from '../src/state.mjs';
import { compileContract, assertCreativeContract } from '../src/compiler.mjs';
import { QueueStore } from '../src/queue-store.mjs';
import { OpenArtAdapter } from '../src/openart-adapter.mjs';
import { runWatchdog } from '../src/watchdog.mjs';

const state = loadState();
const websiteIntent = IntentSchema.parse(JSON.parse(
  fs.readFileSync(new URL('../examples/website-hero-approved-master.json', import.meta.url), 'utf8'),
));
const adIntent = IntentSchema.parse(JSON.parse(
  fs.readFileSync(new URL('../examples/c01-he-a-feed-proof.json', import.meta.url), 'utf8'),
));

const HERO_HASHES = {
  'LS-HERO-MASTER-EN-MOBILE': 'ee2924444efc3d21dda5186b3a1107c3fde935ce4c76ded75ae3458aa99c7a71',
  'LS-HERO-MASTER-HE-MOBILE': '56dc8fcbe99f16d723a8b07b41eda8ebb03eb27716829b8c786f27b82a3ddcbe',
  'LS-HERO-MASTER-EN-DESKTOP': '5c28d22d7b6b784eb6becb4cfabb7977c80a304b5bcaca93943564ed74394f50',
  'LS-HERO-MASTER-HE-DESKTOP': '74c7d3258770abdab5c146e1211c4cbd16e0738840d5c274390f9a707f8dd824',
};

test('operator consumes canonical creative manifests and has no tool-local brand authority', () => {
  assert.match(state.manifestDir, /creative[\\/]manifests$/);
  const configDir = new URL('../config/', import.meta.url);
  for (const name of ['life-skills-brand-kit.v1.json', 'asset-lock.v1.json', 'effect-policy.v1.json']) {
    assert.equal(fs.existsSync(new URL(name, configDir)), false);
  }
});

test('structured website plan uses zero model calls and exact approved masters', () => {
  const contract = compileContract(websiteIntent, state, { mode: 'plan', intentMethod: 'structured_local' });
  assertCreativeContract(contract);
  assert.equal(contract.intentResolution.modelCalls, 0);
  assert.equal(contract.rendering.type, 'exact_registered_raster_master');
  assert.deepEqual(contract.layering.visibleLiveLayers, ['header', 'whatsapp']);
  assert.equal(contract.exactAssets.masters.length, 4);
  assert.ok(contract.exactAssets.masters.every((master) => master.status === 'OWNER_APPROVED_MASTER'));
  assert.deepEqual(contract.effects, {
    generateImage: false,
    publish: false,
    spend: false,
    deploy: false,
    providerMutation: false,
    sendMessages: false,
    automaticWhatsAppReplies: false,
  });
});

test('four deployed website hero files preserve exact registered bytes and boundaries', () => {
  assert.deepEqual(new Set(state.websiteMasters.masters.map((master) => master.id)), new Set(Object.keys(HERO_HASHES)));
  for (const master of state.websiteMasters.masters) {
    const bytes = fs.readFileSync(path.join(state.repoRoot, master.asset.path));
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(master.asset.sha256, HERO_HASHES[master.id]);
    assert.equal(actual, HERO_HASHES[master.id]);
    assert.deepEqual(master.visible_live_layers, ['header', 'whatsapp']);
    assert.equal(master.allow_regeneration, false);
    assert.equal(master.allow_relayout, false);
    assert.equal(master.allow_recolor, false);
    assert.equal(master.allow_reference_substitution, false);
  }
});

test('full static-ad plan keeps its complete raster contract and fails closed', () => {
  const plan = compileContract(adIntent, state, { mode: 'plan', intentMethod: 'structured_local' });
  assert.equal(plan.creativeSurface, 'full_static_ad');
  assert.equal(plan.rendering.fullStaticAdMaster, true);
  assert.deepEqual(plan.rendering.requiredRasterLayers, [
    'approved photograph',
    'approved on-image copy',
    'approved logo',
    'service and age',
    'three labeled benefit icons',
    'baked visual WhatsApp CTA',
  ]);
  assert.match(plan.unresolved.join(' '), /No approved full static-ad master/i);
  assert.match(plan.unresolved.join(' '), /credit cap/i);
  assert.match(plan.unresolved.join(' '), /not approved for production/i);
  const execution = compileContract(adIntent, state, { mode: 'execute', intentMethod: 'structured_local' });
  assert.throws(() => assertCreativeContract(execution), /Ad execution blocked/);
});

test('simpler link-preview card is not promoted to a full static-ad master', () => {
  const intent = IntentSchema.parse({
    classification: 'execute_approved_intent',
    domain: 'ad_creative',
    creativeSurface: 'link_preview_card',
    summary: 'Resume the approved link-preview card.',
  });
  const plan = compileContract(intent, state, { mode: 'plan', intentMethod: 'structured_local' });
  assert.equal(plan.creativeSurface, 'link_preview_card');
  assert.equal(plan.rendering.fullStaticAdMaster, false);
  assert.match(plan.unresolved.join(' '), /No canonical link_preview_card master/i);
  assert.match(plan.validations.join(' '), /never.*full static-ad/i);
});

test('queue claims are deduplicated and derived-index repair is idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-queue-'));
  const queue = new QueueStore(directory, () => new Date('2026-09-11T12:00:00Z'));
  const spec = { master_sha256: 'a', photo_sha256: 'b', copy_sha256: 'c', locale: 'he', placement: 'feed' };
  const first = queue.claim(spec, 'test');
  const second = queue.claim(spec, 'other');
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  const raw = queue.read();
  raw.index = {};
  queue.write(raw);
  assert.deepEqual(queue.rebuildIndex(), { changed: true, jobs: 1 });
  assert.deepEqual(queue.rebuildIndex(), { changed: false, jobs: 1 });
});

test('queue claim fails closed while another process owns the ledger lock', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-lock-'));
  const queue = new QueueStore(directory);
  fs.writeFileSync(path.join(directory, 'jobs.lock'), 'held');
  assert.throws(() => queue.claim({ id: 'one' }, 'test'), /QUEUE_LOCKED/);
});

test('credit cap blocks submission and preserves the quote receipt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-cap-'));
  const queue = new QueueStore(directory);
  let submissions = 0;
  const adapter = new OpenArtAdapter({
    queue,
    projectId: 'synthetic-project',
    transport: {
      quote: async () => ({ credits: 41 }),
      submit: async () => { submissions += 1; return { historyId: 'should-not-run' }; },
      status: async () => ({ status: 'RUNNING' }),
    },
  });
  const job = await adapter.prepare({ id: 'over-cap' }, { claimant: 'test', creditCap: 40 });
  assert.equal(job.state, 'BLOCKED_CREDIT_CAP');
  assert.deepEqual(job.providerReceipts, [{ kind: 'QUOTE', credits: 41 }]);
  await assert.rejects(() => adapter.submit(job.id), /not ready to submit/);
  assert.equal(submissions, 0);
});

test('one-image submission saves quote, history and output receipts and deduplicates', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-receipt-'));
  const queue = new QueueStore(directory);
  let quotes = 0;
  let submissions = 0;
  let submittedSpec;
  const adapter = new OpenArtAdapter({
    queue,
    projectId: 'synthetic-project',
    transport: {
      quote: async () => { quotes += 1; return { credits: 20 }; },
      submit: async (spec) => { submissions += 1; submittedSpec = spec; return { historyId: 'saved-history' }; },
      status: async () => ({ status: 'COMPLETED', output: { assetId: 'saved-output' } }),
    },
  });
  const first = await adapter.prepare({ id: 'one-image', imageCount: 99 }, { claimant: 'test', creditCap: 20 });
  const duplicate = await adapter.prepare({ id: 'one-image', imageCount: 2 }, { claimant: 'other', creditCap: 20 });
  assert.equal(first.id, duplicate.id);
  assert.equal(quotes, 1);
  const submitted = await adapter.submit(first.id);
  assert.equal(submittedSpec.imageCount, 1);
  assert.equal(submissions, 1);
  assert.equal(submitted.historyId, 'saved-history');
  assert.equal(submitted.newImageGenerations, 1);
  const completed = await adapter.resume(first.id);
  assert.equal(completed.state, 'GENERATED');
  assert.deepEqual(completed.output, { assetId: 'saved-output' });
  assert.deepEqual(queue.read().jobs[0].providerReceipts.map((receipt) => receipt.kind), ['QUOTE', 'SUBMIT', 'STATUS']);
});

test('saved provider history resumes without quote, submit or a new generation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-resume-'));
  const queue = new QueueStore(directory);
  let quotes = 0;
  let submissions = 0;
  const adapter = new OpenArtAdapter({
    queue,
    projectId: 'synthetic-project',
    transport: {
      quote: async () => { quotes += 1; return { credits: 20 }; },
      submit: async () => { submissions += 1; return { historyId: 'new-history' }; },
      status: async (historyId) => ({ status: 'COMPLETED', output: { historyId } }),
    },
  });
  const completed = await adapter.resumeExisting(
    { id: 'approved-share-image', imageCount: 7 },
    { claimant: 'test', historyId: 'saved-share-history' },
  );
  assert.equal(quotes, 0);
  assert.equal(submissions, 0);
  assert.equal(completed.state, 'GENERATED');
  assert.equal(completed.newImageGenerations, 0);
  assert.equal(completed.spec.imageCount, 1);
  assert.deepEqual(completed.providerReceipts.map((receipt) => receipt.kind), ['ADOPT_EXISTING_HISTORY', 'STATUS']);
});

test('ambiguous provider submission is persisted and cannot be retried automatically', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-openart-'));
  const queue = new QueueStore(directory);
  const adapter = new OpenArtAdapter({
    queue,
    projectId: 'YNFWEmEe4mvjjbLz7KLc',
    transport: {
      quote: async () => ({ credits: 40 }),
      submit: async () => { throw new Error('timeout after request left host'); },
      status: async () => ({ status: 'RUNNING' }),
    },
  });
  const job = await adapter.prepare({ model: 'nano-banana-pro', mode: 'image2image' }, { claimant: 'test', creditCap: 40 });
  await assert.rejects(() => adapter.submit(job.id), /timeout/);
  assert.equal(queue.read().jobs[0].state, 'SUBMISSION_UNKNOWN');
  await assert.rejects(() => adapter.submit(job.id), /automatic resubmit is forbidden/);
});

test('watchdog healthy run is zero-model and synthetic exceptions persist', async () => {
  const healthy = await runWatchdog();
  assert.equal(healthy.ok, true);
  assert.equal(healthy.modelCalls, 0);
  assert.equal(healthy.providerCalls, 0);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-watchdog-'));
  const queue = new QueueStore(directory, () => new Date('2026-09-11T10:00:00Z'));
  queue.claim({ id: 'expired' }, 'test', 1);
  const receiptPath = path.join(directory, 'deployment.json');
  fs.writeFileSync(receiptPath, JSON.stringify({ sourceCommit: 'old' }));
  const outputPath = path.join(directory, 'watchdog-latest.json');
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    repoRoot: state.repoRoot,
    stateDir: directory,
    outputPath,
    deploymentReceiptPath: receiptPath,
    expectedSourceCommit: 'current',
    lastSuccessfulRunAt: '2026-09-10T00:00:00Z',
    maximumSilenceMinutes: 60,
  }));
  const report = await runWatchdog({ configPath, now: new Date('2026-09-11T11:00:00Z') });
  assert.equal(report.modelCalls, 0);
  assert.equal(report.ok, false);
  assert.deepEqual(new Set(report.findings.map((finding) => finding.type)), new Set([
    'expired_claim', 'source_deployment_divergence', 'missed_heartbeat',
  ]));
  assert.equal(fs.existsSync(outputPath), true);
});
