import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadState, resolveRepoRoot, readJson } from './state.mjs';
import { QueueStore } from './queue-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runWatchdog({ configPath = null, now = new Date() } = {}) {
  const config = configPath ? readJson(path.resolve(configPath)) : {};
  const repoRoot = resolveRepoRoot(config.repoRoot);
  const state = loadState(repoRoot);
  const findings = [];
  const verifier = spawnSync(process.execPath, [path.join(repoRoot, 'creative/bin/verify-master-contract.mjs'), '--ready'], {
    cwd: repoRoot, encoding: 'utf8',
  });
  if (verifier.status !== 0) findings.push({ type: 'master_contract_failed', detail: (verifier.stderr || verifier.stdout).trim() });

  let repair = { changed: false, jobs: 0 };
  if (config.stateDir) {
    const queue = new QueueStore(config.stateDir, () => now);
    repair = queue.rebuildIndex();
    findings.push(...queue.findings(now));
  }

  if (config.deploymentReceiptPath) {
    const receipt = readJson(path.resolve(config.deploymentReceiptPath));
    if (receipt.sourceCommit && config.expectedSourceCommit && receipt.sourceCommit !== config.expectedSourceCommit) {
      findings.push({ type: 'source_deployment_divergence', expected: config.expectedSourceCommit, actual: receipt.sourceCommit });
    }
  }
  if (config.lastSuccessfulRunAt && config.maximumSilenceMinutes) {
    const silence = now.getTime() - new Date(config.lastSuccessfulRunAt).getTime();
    if (silence > config.maximumSilenceMinutes * 60_000) findings.push({ type: 'missed_heartbeat', silenceMs: silence });
  }

  const report = {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    ok: findings.length === 0,
    modelCalls: 0,
    providerCalls: 0,
    repairedDerivedQueueIndex: repair.changed,
    canonicalManifestDirectory: state.manifestDir,
    findings,
  };
  if (config.outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(config.outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(config.outputPath), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
