#!/usr/bin/env node
import fs from 'node:fs';
import { IntentSchema } from './contracts.mjs';
import { loadState } from './state.mjs';
import { compileContract, assertCreativeContract } from './compiler.mjs';
import { runWatchdog } from './watchdog.mjs';

function usage(message) {
  if (message) console.error(message);
  console.error([
    'Usage:',
    '  node src/cli.mjs plan --intent <intent.json|->',
    '  node src/cli.mjs interpret-plan "owner wording"',
    '  node src/cli.mjs execute --intent <intent.json|->',
    '  node src/cli.mjs watchdog [--config runtime.json]',
    '',
    'plan is local and makes zero model/provider calls. interpret-plan is the explicit metered interpretation path.',
  ].join('\n'));
  process.exit(2);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function readIntent(file) {
  if (!file) usage('Structured plan requires --intent.');
  const raw = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  return IntentSchema.parse(JSON.parse(raw));
}

const [command, ...args] = process.argv.slice(2);
if (!command) usage();

if (command === 'watchdog') {
  const report = await runWatchdog({ configPath: readOption(args, '--config') });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

let intent;
let method;
let mode;
if (command === 'plan' || command === 'execute') {
  intent = readIntent(readOption(args, '--intent'));
  method = 'structured_local';
  mode = command;
} else if (command === 'interpret-plan') {
  const raw = args.join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
  if (!raw) usage();
  const { resolveIntent } = await import('./intent-agent.mjs');
  intent = await resolveIntent(raw);
  method = 'model_interpretation';
  mode = 'plan';
} else {
  usage();
}

const state = loadState();
const contract = compileContract(intent, state, { mode, intentMethod: method });
assertCreativeContract(contract);
console.log(JSON.stringify({ intent, contract }, null, 2));

if (mode === 'execute') {
  const { executeWithCodex } = await import('./codex-executor.mjs');
  const output = await executeWithCodex(contract);
  console.log('\n--- CODEX CLOSEOUT ---\n');
  console.log(output);
}
