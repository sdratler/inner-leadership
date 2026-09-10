import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function resolveAssetPath(manifestPath, assetRoot, relativePath) {
  return resolve(dirname(manifestPath), assetRoot, relativePath);
}

export async function inspectPng(path) {
  const bytes = await readFile(path);
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`ASSET_NOT_PNG:${path}`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  const modes = { 0: 'L', 2: 'RGB', 3: 'P', 4: 'LA', 6: 'RGBA' };
  return { bytes, width, height, colorMode: modes[colorType] ?? `PNG_COLOR_${colorType}`, hasAlpha: colorType === 4 || colorType === 6 };
}
