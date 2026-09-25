import { describe, expect, it } from 'vitest';
import { demoAccountBatch, demoCaseBatch, demoRecordBatch, realCaseEffectAllowed } from '../../src/features/demo/provenance.ts';
import type { SqlSession } from '../../src/features/identity/store.ts';

function session(batchId: string | null): SqlSession {
  return { query: async <T extends object>() => batchId ? [{ batchId } as T] : [] };
}

describe('server-owned demo provenance', () => {
  it('blocks real external effects for a marked case regardless of its display name', async () => {
    expect(await demoCaseBatch(session('ls-owner-20260925'), 'workspace', 'case')).toBe('ls-owner-20260925');
    expect(await realCaseEffectAllowed(session('ls-owner-20260925'), 'workspace', 'case')).toBe(false);
  });

  it('does not turn an unmarked real case into demo from its name', async () => {
    expect(await realCaseEffectAllowed(session(null), 'workspace', 'case')).toBe(true);
    expect(await demoAccountBatch(session(null), 'workspace', 'account')).toBeNull();
  });

  it('identifies a marked non-contactable prospect by server-owned record key', async () => {
    const requested: unknown[][] = [];
    const tx: SqlSession = { query: async <T extends object>(_sql: string, values: readonly unknown[] = []) => {
      requested.push([...values]);
      return [{ batchId: 'ls-owner-20260925' }] as T[];
    } };
    expect(await demoRecordBatch(tx, 'workspace', 'prospect', 'LS-LEAD-demo')).toBe('ls-owner-20260925');
    expect(requested).toEqual([['workspace', 'prospect', 'LS-LEAD-demo']]);
  });

  it('fails closed when provenance cannot be read', async () => {
    const unavailable: SqlSession = { query: async () => { throw new Error('database unavailable'); } };
    await expect(realCaseEffectAllowed(unavailable, 'workspace', 'case')).rejects.toThrow('database unavailable');
  });
});
