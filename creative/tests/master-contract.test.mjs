import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateMasterContract, MASTER_IDS, BAKED_LAYERS, LIVE_LAYERS } from '../bin/verify-master-contract.mjs';

// Synthetic one-pixel PNG, never a production or owner-approved asset.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
const HASH = createHash('sha256').update(PNG).digest('hex');

async function fixture(t, { missing = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ls-master-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'creative/assets/masters'), { recursive: true });
  await mkdir(path.join(root, 'creative/manifests'), { recursive: true });
  await writeFile(path.join(root, 'creative/assets/masters/synthetic.png'), PNG);
  const manifest = {
    schema_version: 1,
    masters: MASTER_IDS.map(id => missing ? { id, status: 'MISSING' } : ({
      id,
      status: 'OWNER_APPROVED_MASTER',
      asset: { path: 'creative/assets/masters/synthetic.png', sha256: HASH, width: 1, height: 1 },
      owner_approval: { evidence: 'Synthetic test fixture approval only', asset_sha256: HASH },
      baked_layers: [...BAKED_LAYERS],
      visible_live_layers: [...LIVE_LAYERS],
      controls: { whatsapp: { bounds: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 } } },
      allow_regeneration: false,
      allow_relayout: false,
      allow_recolor: false,
      allow_reference_substitution: false,
    })),
  };
  const policy = { website: { baked_layers: [...BAKED_LAYERS], visible_live_layers: [...LIVE_LAYERS] } };
  async function save() {
    await writeFile(path.join(root, 'creative/manifests/website-hero-masters.json'), JSON.stringify(manifest));
    await writeFile(path.join(root, 'creative/manifests/production-policy.json'), JSON.stringify(policy));
  }
  await save();
  return { root, manifest, policy, save };
}

test('inventory truthfully reports missing masters without treating them as ready', async t => {
  const f = await fixture(t, { missing: true });
  const inventory = await validateMasterContract({ repoRoot: f.root });
  assert.equal(inventory.ok, true);
  assert.equal(inventory.ready, false);
  assert.equal(inventory.ready_count, 0);
  const gate = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(gate.ok, false);
  assert.match(gate.errors.join('\n'), /all four/);

  const cli = fileURLToPath(new URL('../bin/verify-master-contract.mjs', import.meta.url));
  const inventoryRun = spawnSync(process.execPath, [cli, '--inventory', '--root', f.root], { encoding: 'utf8' });
  const readyRun = spawnSync(process.execPath, [cli, '--ready', '--root', f.root], { encoding: 'utf8' });
  assert.equal(inventoryRun.status, 0);
  assert.equal(JSON.parse(inventoryRun.stdout).ready, false);
  assert.equal(readyRun.status, 1);
});

test('valid synthetic bytes, hash-bound evidence and controls satisfy the mechanical gate', async t => {
  const f = await fixture(t);
  const report = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.ready_count, 4);
  assert.equal(report.masters[0].verified_asset.sha256, HASH);
});

test('a promoted label and hash cannot replace a missing actual file', async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, 'creative/assets/masters/synthetic.png'));
  const report = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(report.ok, false);
  assert.equal(report.ready_count, 0);
  assert.match(report.errors.join('\n'), /ENOENT/);
});

test('approval requires evidence tied to the same asset hash', async t => {
  const f = await fixture(t);
  delete f.manifest.masters[0].owner_approval;
  f.manifest.masters[1].owner_approval.asset_sha256 = '0'.repeat(64);
  f.manifest.masters[2].owner_approval.evidence = 'PENDING';
  await f.save();
  const report = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /concrete evidence/);
  assert.match(report.errors.join('\n'), /exact asset SHA256/);
});

test('changed bytes and false image dimensions block promotion', async t => {
  const f = await fixture(t);
  f.manifest.masters[0].asset.sha256 = '0'.repeat(64);
  f.manifest.masters[0].owner_approval.asset_sha256 = '0'.repeat(64);
  f.manifest.masters[1].asset.width = 1080;
  await f.save();
  const report = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /SHA256 does not match actual/);
  assert.match(report.errors.join('\n'), /dimensions do not match/);
});

test('reconstructed live copy or permissive recoloring cannot pass', async t => {
  const f = await fixture(t);
  f.manifest.masters[0].visible_live_layers.push('headline');
  f.manifest.masters[1].baked_layers = f.manifest.masters[1].baked_layers.filter(x => x !== 'benefit_labels');
  f.manifest.masters[2].allow_recolor = true;
  f.policy.website.visible_live_layers.push('service');
  await f.save();
  const report = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /Visible live layers/);
  assert.match(report.errors.join('\n'), /must be baked/);
  assert.match(report.errors.join('\n'), /allow_recolor must be false/);
  assert.match(report.errors.join('\n'), /Policy visible_live_layers/);
});

test('invalid control bounds and duplicate logical IDs block readiness', async t => {
  const f = await fixture(t);
  f.manifest.masters[0].controls.whatsapp.bounds = { x: 0.5, y: 0.8, width: 0.8, height: 0.3 };
  f.manifest.masters.push(structuredClone(f.manifest.masters[1]));
  await f.save();
  const report = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /normalized/);
  assert.match(report.errors.join('\n'), /Duplicate master ID/);
});

test('an unapproved candidate never satisfies readiness', async t => {
  const f = await fixture(t);
  f.manifest.masters[0].status = 'PENDING_OWNER_REVIEW';
  delete f.manifest.masters[0].owner_approval;
  await f.save();
  const inventory = await validateMasterContract({ repoRoot: f.root });
  assert.equal(inventory.ok, true);
  assert.equal(inventory.ready, false);
  assert.equal(inventory.ready_count, 3);
  assert.equal((await validateMasterContract({ repoRoot: f.root, ready: true })).ok, false);
});

test('repository traversal and symlinks to outside assets are rejected', async t => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(), 'ls-outside-master-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const externalImage = path.join(outside, 'synthetic.png');
  await writeFile(externalImage, PNG);
  await symlink(externalImage, path.join(f.root, 'creative/assets/masters/outside.png'));
  f.manifest.masters[0].asset.path = 'creative/assets/masters/outside.png';
  f.manifest.masters[1].asset.path = path.relative(f.root, externalImage);
  await f.save();
  const report = await validateMasterContract({ repoRoot: f.root, ready: true });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /symlink leaves repository/);
  assert.match(report.errors.join('\n'), /path leaves repository/);
});
