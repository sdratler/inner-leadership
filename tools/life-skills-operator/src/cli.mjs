#!/usr/bin/env node
import fs from 'node:fs';
import { resolveIntent } from './intent-agent.mjs';
import { loadState } from './state.mjs';
import { compileContract, assertCreativeContract } from './compiler.mjs';
import { executeWithCodex } from './codex-executor.mjs';

function usage() {
  console.error('Usage: node src/cli.mjs <plan|execute> "owner ramble"');
  process.exit(2);
}

const [mode, ...parts] = process.argv.slice(2);
if (!['plan', 'execute'].includes(mode)) usage();
const raw = parts.join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
if (!raw) usage();

const state = loadState();
const intent = await resolveIntent(raw);
const contract = compileContract(intent, state, mode);
assertCreativeContract(contract);

console.log(JSON.stringify({ intent, contract }, null, 2));

if (mode === 'execute') {
  const output = await executeWithCodex(contract);
  console.log('\n--- CODEX CLOSEOUT ---\n');
  console.log(output);
}
