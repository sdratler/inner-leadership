export class OpenArtAdapter {
  constructor({ transport, queue, projectId }) {
    if (!transport?.quote || !transport?.submit || !transport?.status) throw new Error('OpenArt transport must implement quote, submit and status');
    if (!queue) throw new Error('QueueStore is required');
    if (!projectId) throw new Error('Exact OpenArt projectId is required');
    this.transport = transport;
    this.queue = queue;
    this.projectId = projectId;
  }

  normalizedSpec(spec) {
    return { ...spec, projectId: this.projectId, imageCount: 1 };
  }

  async prepare(spec, { claimant, creditCap }) {
    if (!Number.isFinite(creditCap) || creditCap < 0) throw new Error('A numeric image-credit cap is required');
    const normalized = this.normalizedSpec(spec);
    const claimed = this.queue.claim(normalized, claimant);
    if (!claimed.created) return claimed.job;
    const quote = await this.transport.quote(normalized);
    if (!Number.isFinite(quote.credits)) throw new Error('Provider quote did not include numeric credits');
    if (quote.credits > creditCap) {
      return this.queue.update(claimed.job.id, (job) => ({
        ...job,
        state: 'BLOCKED_CREDIT_CAP',
        quote,
        creditCap,
        providerReceipts: [...(job.providerReceipts || []), { kind: 'QUOTE', credits: quote.credits }],
      }));
    }
    return this.queue.update(claimed.job.id, (job) => ({
      ...job,
      state: 'QUOTED',
      quote,
      creditCap,
      providerReceipts: [...(job.providerReceipts || []), { kind: 'QUOTE', credits: quote.credits }],
    }));
  }

  async submit(jobId) {
    const job = this.queue.read().jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    if (job.state === 'SUBMISSION_UNKNOWN') throw new Error('Ambiguous submission must be reconciled; automatic resubmit is forbidden');
    if (job.state !== 'QUOTED') throw new Error(`Job is not ready to submit: ${job.state}`);
    this.queue.update(job.id, (current) => ({ ...current, state: 'SUBMITTING' }));
    try {
      const receipt = await this.transport.submit(job.spec);
      if (!receipt?.historyId) throw new Error('Provider did not return a historyId');
      return this.queue.update(job.id, (current) => ({
        ...current,
        state: 'SUBMITTED',
        historyId: receipt.historyId,
        newImageGenerations: 1,
        providerReceipts: [...(current.providerReceipts || []), { kind: 'SUBMIT', historyId: receipt.historyId }],
      }));
    } catch (error) {
      this.queue.update(job.id, (current) => ({ ...current, state: 'SUBMISSION_UNKNOWN', failure: String(error?.message || error) }));
      throw error;
    }
  }

  adoptExistingHistory(spec, { claimant, historyId }) {
    if (typeof historyId !== 'string' || !historyId.trim()) throw new Error('A saved historyId is required');
    const claimed = this.queue.claim(this.normalizedSpec(spec), claimant);
    if (claimed.job.historyId && claimed.job.historyId !== historyId) {
      throw new Error('Dedupe key is already bound to a different provider historyId');
    }
    if (claimed.job.historyId === historyId) return claimed.job;
    return this.queue.update(claimed.job.id, (current) => ({
      ...current,
      state: 'SUBMITTED',
      historyId,
      newImageGenerations: 0,
      providerReceipts: [...(current.providerReceipts || []), {
        kind: 'ADOPT_EXISTING_HISTORY',
        historyId,
        newImageGenerations: 0,
      }],
    }));
  }

  async resumeExisting(spec, options) {
    const job = this.adoptExistingHistory(spec, options);
    return this.resume(job.id);
  }

  async resume(jobId) {
    const job = this.queue.read().jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    if (!job.historyId) throw new Error('No historyId is available; reconcile provider history before retrying');
    const receipt = await this.transport.status(job.historyId);
    if (receipt.status !== 'COMPLETED') {
      return this.queue.update(job.id, (current) => ({
        ...current,
        providerStatus: receipt.status,
        providerReceipts: [...(current.providerReceipts || []), {
          kind: 'STATUS', historyId: current.historyId, status: receipt.status,
        }],
      }));
    }
    return this.queue.update(job.id, (current) => ({
      ...current,
      state: 'GENERATED',
      providerStatus: receipt.status,
      output: receipt.output,
      providerReceipts: [...(current.providerReceipts || []), {
        kind: 'STATUS', historyId: current.historyId, status: receipt.status, output: receipt.output,
      }],
    }));
  }
}
