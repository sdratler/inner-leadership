import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.deepEqual(contract.effects, { generateImage: false, publish: false, spend: false, deploy: false, providerMutation: false });
});

test('ad planning reports canonical blockers and execute fails closed', () => {
  const plan = compileContract(adIntent, state, { mode: 'plan', intentMethod: 'structured_local' });
  assert.match(plan.unresolved.join(' '), /credit cap/i);
  assert.match(plan.unresolved.join(' '), /not approved for production/i);
  const execution = compileContract(adIntent, state, { mode: 'execute', intentMethod: 'structured_local' });
  assert.throws(() => assertCreativeContract(execution), /Ad execution blocked/);
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
