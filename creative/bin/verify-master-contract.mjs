#!/usr/bin/env node
/**
 * Read-only master publication gate. No network, rendering, generation or writes.
 * This verifies records and image bytes, not visual fidelity or whether a cited
 * owner message actually approves the image. That evidence still needs review.
 */
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MASTER_IDS = Object.freeze([
  'LS-HERO-MASTER-EN-MOBILE',
  'LS-HERO-MASTER-HE-MOBILE',
  'LS-HERO-MASTER-EN-DESKTOP',
  'LS-HERO-MASTER-HE-DESKTOP',
]);
export const BAKED_LAYERS = Object.freeze([
  'headline', 'service', 'age', 'photo', 'benefit_icons', 'benefit_labels',
  'shading', 'fade', 'cream', 'bottom_curve',
]);
export const LIVE_LAYERS = Object.freeze(['header', 'whatsapp']);
const LOCKS = Object.freeze([
  'allow_regeneration', 'allow_relayout', 'allow_recolor',
  'allow_reference_substitution',
]);
const STATUS = new Set([
  'MISSING', 'SOURCE_REFERENCE_ONLY', 'CANDIDATE', 'PENDING_OWNER_REVIEW',
  'OWNER_APPROVED_MASTER', 'SUPERSEDED', 'REJECTED',
]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function sameMembers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every(item => actual.includes(item));
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

/** Read PNG IHDR or JPEG SOF dimensions, without rewriting any image bytes. */
function dimensions(bytes) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(pngSignature)
      && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (sof.has(marker) && length >= 8) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), format: 'jpeg' };
      }
      offset += length;
    }
  }
  throw new Error('Asset must contain a readable PNG IHDR or JPEG SOF header');
}

async function verifyAsset(repoRoot, asset) {
  if (!isObject(asset)) throw new Error('Actual asset record is missing');
  if (typeof asset.path !== 'string' || !asset.path.trim()
      || path.isAbsolute(asset.path) || /^[A-Za-z]:/.test(asset.path)
      || asset.path.includes('\\')) {
    throw new Error('Asset path must be a nonempty repository-relative path');
  }
  const candidate = path.resolve(repoRoot, asset.path);
  if (!inside(repoRoot, candidate)) throw new Error('Asset path leaves repository');
  const resolved = await realpath(candidate);
  if (!inside(repoRoot, resolved)) throw new Error('Asset symlink leaves repository');
  if (!(await stat(resolved)).isFile()) throw new Error('Asset is not a regular file');
  if (!isSha(asset.sha256)) throw new Error('Asset requires an actual lowercase SHA256');
  if (!Number.isInteger(asset.width) || asset.width <= 0
      || !Number.isInteger(asset.height) || asset.height <= 0) {
    throw new Error('Asset requires positive integer width and height');
  }
  const bytes = await readFile(resolved);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) throw new Error('Asset SHA256 does not match actual file bytes');
  const measured = dimensions(bytes);
  if (measured.width !== asset.width || measured.height !== asset.height) {
    throw new Error('Asset dimensions do not match actual file header');
  }
  return { path: asset.path, sha256, width: measured.width, height: measured.height, format: measured.format, bytes: bytes.length };
}

function validBounds(value) {
  return isObject(value)
    && ['x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0
    && value.x + value.width <= 1 && value.y + value.height <= 1;
}

export async function validateMasterContract({
  repoRoot,
  manifestPath = 'creative/manifests/website-hero-masters.json',
  policyPath = 'creative/manifests/production-policy.json',
  ready = false,
}) {
  const result = {
    mode: ready ? 'ready' : 'inventory',
    ok: false,
    ready: false,
    ready_count: 0,
    required_count: MASTER_IDS.length,
    errors: [],
    warnings: [],
    masters: [],
    scope: 'Manifest, policy, bytes, dimensions, approval hash binding and normalized control bounds. Visual and owner-evidence review are separate.',
  };
  let root, manifest, policy;
  try {
    root = await realpath(repoRoot);
    [manifest, policy] = await Promise.all([
      readJson(path.resolve(root, manifestPath)),
      readJson(path.resolve(root, policyPath)),
    ]);
  } catch (error) {
    result.errors.push('Cannot read contract: ' + error.message);
    return result;
  }
  if (!isObject(policy.website)) {
    result.errors.push('Production policy requires website rules');
  } else {
    if (!sameMembers(policy.website.visible_live_layers, LIVE_LAYERS)) {
      result.errors.push('Policy visible_live_layers must contain only header and whatsapp');
    }
    if (!sameMembers(policy.website.baked_layers, BAKED_LAYERS)) {
      result.errors.push('Policy baked_layers must match the finished-image contract');
    }
  }
  if (!Array.isArray(manifest.masters)) {
    result.errors.push('Manifest masters must be an array');
    return result;
  }
  const byId = new Map();
  for (const entry of manifest.masters) {
    if (!isObject(entry) || !MASTER_IDS.includes(entry.id)) {
      result.errors.push('Unexpected or missing master ID: ' + String(entry?.id));
    } else if (byId.has(entry.id)) {
      result.errors.push('Duplicate master ID: ' + entry.id);
    } else {
      byId.set(entry.id, entry);
    }
  }
  for (const id of MASTER_IDS) {
    const entry = byId.get(id);
    const slot = { id, status: entry?.status ?? 'MISSING', ready: false, issues: [] };
    result.masters.push(slot);
    if (!entry || entry.status === 'MISSING') {
      result.warnings.push(id + ': no finished master registered');
      // Missing placeholders may not smuggle a supposedly approved asset.
      if (entry?.owner_approval || entry?.asset) {
        slot.issues.push('MISSING slot cannot contain an asset or owner approval');
        result.errors.push(id + ': ' + slot.issues[0]);
      }
      continue;
    }
    if (!STATUS.has(entry.status)) slot.issues.push('Unrecognized master status');
    if (entry.status !== 'OWNER_APPROVED_MASTER') {
      result.warnings.push(id + ': not owner-approved (' + entry.status + ')');
    }
    // Any supplied asset is checked even when the slot remains a candidate.
    if (entry.asset || entry.status === 'OWNER_APPROVED_MASTER') {
      try { slot.verified_asset = await verifyAsset(root, entry.asset); }
      catch (error) { slot.issues.push(error.message); }
    }
    if (entry.status === 'OWNER_APPROVED_MASTER') {
      if (!sameMembers(entry.baked_layers, BAKED_LAYERS)) {
        slot.issues.push('Required visual content must be baked into the approved master');
      }
      if (!sameMembers(entry.visible_live_layers, LIVE_LAYERS)) {
        slot.issues.push('Visible live layers may only be header and whatsapp');
      }
      for (const flag of LOCKS) {
        if (entry[flag] !== false) slot.issues.push(flag + ' must be false');
      }
      const approval = entry.owner_approval;
      if (!isObject(approval) || typeof approval.evidence !== 'string' || !approval.evidence.trim()
          || /^(pending|todo|unknown|unverified|tbd)$/i.test(approval.evidence.trim())) {
        slot.issues.push('Owner approval requires a concrete evidence reference');
      }
      if (!isObject(approval) || !isSha(approval.asset_sha256) || approval.asset_sha256 !== entry.asset?.sha256) {
        slot.issues.push('Owner approval must bind to the exact asset SHA256');
      }
      if (!validBounds(entry.controls?.whatsapp?.bounds)) {
        slot.issues.push('WhatsApp requires normalized x/y/width/height bounds within the entire master');
      }
      slot.ready = slot.issues.length === 0;
    }
    for (const issue of slot.issues) result.errors.push(id + ': ' + issue);
  }
  result.ready_count = result.masters.filter(master => master.ready).length;
  result.ready = result.errors.length === 0 && result.ready_count === MASTER_IDS.length;
  if (ready && !result.ready) {
    result.errors.push('Hero replacement is not ready: all four exact, owner-approved hero masters are required');
  }
  result.ok = result.errors.length === 0;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  let ready = false, modeSeen = false;
  let manifestPath, policyPath;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ready' || arg === '--inventory') {
      if (modeSeen) throw new Error('Choose --inventory or --ready once');
      ready = arg === '--ready';
      modeSeen = true;
    } else if (['--root', '--manifest', '--policy'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
      if (arg === '--root') repoRoot = path.resolve(value);
      if (arg === '--manifest') manifestPath = value;
      if (arg === '--policy') policyPath = value;
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  const report = await validateMasterContract({ repoRoot, manifestPath, policyPath, ready });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('Master contract validation failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
