import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(here, '../../..');

export function resolveRepoRoot(explicitRoot = process.env.LIFE_SKILLS_REPO) {
  return path.resolve(explicitRoot || defaultRepoRoot);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadState(explicitRoot) {
  const repoRoot = resolveRepoRoot(explicitRoot);
  const manifestDir = path.join(repoRoot, 'creative', 'manifests');
  const state = {
    repoRoot,
    manifestDir,
    assets: readJson(path.join(manifestDir, 'assets.json')),
    brand: readJson(path.join(manifestDir, 'brand.json')),
    copy: readJson(path.join(manifestDir, 'copy.json')),
    policy: readJson(path.join(manifestDir, 'production-policy.json')),
    websiteMasters: readJson(path.join(manifestDir, 'website-hero-masters.json')),
    monthlyQueue: readJson(path.join(manifestDir, 'monthly-creative-queue.json')),
  };
  assertCanonicalState(state);
  return state;
}

export function assertCanonicalState(state) {
  const required = ['assets', 'brand', 'copy', 'policy', 'websiteMasters', 'monthlyQueue'];
  for (const name of required) {
    if (!state[name] || typeof state[name] !== 'object') throw new Error(`Missing canonical creative manifest: ${name}`);
  }
  if (state.brand.authorityRule !== 'Operator reads these records at accepted commit; no tool-local brand fallback') {
    throw new Error('Creative brand manifest does not authorize canonical operator consumption');
  }
  if (state.websiteMasters.masters?.length !== 4) throw new Error('Expected four registered website hero masters');
}

export function findAsset(state, id) {
  return state.assets.assets.find((asset) => asset.id === id) || null;
}

export function findAdCopy(state, id) {
  return state.copy.ads.find((entry) => entry.id === id) || null;
}
