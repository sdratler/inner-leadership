import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function dedupeKey(spec) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(spec))).digest('hex');
}

export class QueueStore {
  constructor(stateDir, clock = () => new Date()) {
    if (!stateDir) throw new Error('A private operator state directory is required');
    this.stateDir = path.resolve(stateDir);
    this.file = path.join(this.stateDir, 'jobs.json');
    this.lockFile = path.join(this.stateDir, 'jobs.lock');
    this.clock = clock;
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  read() {
    if (!fs.existsSync(this.file)) return { schemaVersion: 1, jobs: [], index: {} };
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  write(state) {
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  withLock(action) {
    let descriptor;
    try {
      descriptor = fs.openSync(this.lockFile, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('QUEUE_LOCKED: another operator process owns the claim ledger');
      throw error;
    }
    try {
      return action();
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(this.lockFile);
    }
  }

  rebuildIndex() {
    return this.withLock(() => {
      const state = this.read();
      const index = Object.fromEntries(state.jobs.map((job, position) => [job.dedupeKey, position]));
      const changed = JSON.stringify(index) !== JSON.stringify(state.index || {});
      if (changed) this.write({ ...state, index });
      return { changed, jobs: state.jobs.length };
    });
  }

  claim(spec, claimant, leaseMs = 15 * 60 * 1000) {
    return this.withLock(() => {
      const state = this.read();
      const key = dedupeKey(spec);
      const existing = state.jobs.find((job) => job.dedupeKey === key);
      if (existing) return { created: false, job: existing };
      const now = this.clock();
      const job = {
        id: crypto.randomUUID(),
        dedupeKey: key,
        state: 'CLAIMED',
        claimant,
        claimedAt: now.toISOString(),
        claimExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        spec: stable(spec),
        quote: null,
        creditCap: null,
        historyId: null,
        output: null,
        failure: null,
      };
      state.jobs.push(job);
      state.index = { ...(state.index || {}), [key]: state.jobs.length - 1 };
      this.write(state);
      return { created: true, job };
    });
  }

  update(id, updater) {
    return this.withLock(() => {
      const state = this.read();
      const index = state.jobs.findIndex((job) => job.id === id);
      if (index === -1) throw new Error(`Unknown job: ${id}`);
      state.jobs[index] = updater({ ...state.jobs[index] });
      state.index = Object.fromEntries(state.jobs.map((job, position) => [job.dedupeKey, position]));
      this.write(state);
      return state.jobs[index];
    });
  }

  findings(now = this.clock()) {
    const jobs = this.read().jobs;
    return jobs.flatMap((job) => {
      const findings = [];
      if (job.state === 'CLAIMED' && new Date(job.claimExpiresAt) < now) findings.push({ type: 'expired_claim', jobId: job.id });
      if (job.state === 'SUBMISSION_UNKNOWN') findings.push({ type: 'ambiguous_submission', jobId: job.id });
      if (job.state === 'SUBMITTED' && !job.historyId) findings.push({ type: 'missing_provider_receipt', jobId: job.id });
      return findings;
    });
  }
}
