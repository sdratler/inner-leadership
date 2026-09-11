import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.resolve(here, '../config');

export function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'));
}

export function loadState() {
  return {
    brand: loadJson('life-skills-brand-kit.v1.json'),
    assets: loadJson('asset-lock.v1.json'),
    policy: loadJson('effect-policy.v1.json'),
  };
}
