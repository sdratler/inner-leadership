#!/usr/bin/env node
import { resolve } from 'node:path';
import { compile } from '../lib/compile.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: creative-compile --composition FILE --assets FILE --copy FILE --brand FILE --out DIR [--mode review|production]');
  process.exit(0);
}
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
};
const mode = args.includes('--mode') ? value('--mode') : 'review';
if (!['review', 'production'].includes(mode)) throw new Error('Mode must be review or production');
const receipt = await compile({
  compositionPath: resolve(value('--composition')),
  assetManifestPath: resolve(value('--assets')),
  copyManifestPath: resolve(value('--copy')),
  brandManifestPath: resolve(value('--brand')),
  outputDir: resolve(value('--out')),
  mode
});
console.log(JSON.stringify(receipt));
