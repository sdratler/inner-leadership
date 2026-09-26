import { describe, expect, test, vi } from 'vitest';
import { PaymentsStore } from '../../src/features/payments/store.ts';
import { AppError } from '../../src/lib/errors.ts';

function fixture(marked: boolean) {
  const store = new PaymentsStore({} as never, {} as never, {} as never);
  vi.spyOn(store, 'requireCase').mockResolvedValue({ kind: 'minor' } as never);
  const queries: string[] = [];
  const context = {
    workspace: '8bf3cad7-9a39-4204-9c8a-7ad45f709403',
    tx: { query: async <T extends object>(sql: string): Promise<T[]> => {
      queries.push(sql);
      if (sql.includes('FROM ls_demo.cases')) return (marked ? [{ batchId: 'ls-owner-20260925' }] : []) as T[];
      throw new Error('unexpected query');
    } },
  } as never;
  return { store, context, queries };
}

describe('demo payment boundary', () => {
  test('blocks all write operations on a marked case before any financial command', async () => {
    const { store, context, queries } = fixture(true);
    await expect(store.requireMinorCase(context, 'ec055ed1-00bb-41a8-a76e-f287ea2f81f1' as never, 'write')).rejects.toBeInstanceOf(AppError);
    expect(queries).toHaveLength(1);
  });

  test('keeps ordinary authorized reads and unmarked writes available', async () => {
    const marked = fixture(true);
    await expect(storeRead(marked)).resolves.toBeUndefined();
    expect(marked.queries).toHaveLength(0);
    const real = fixture(false);
    await expect(real.store.requireMinorCase(real.context, 'ec055ed1-00bb-41a8-a76e-f287ea2f81f1' as never, 'write')).resolves.toBeUndefined();
  });
});

function storeRead(f: ReturnType<typeof fixture>) {
  return f.store.requireMinorCase(f.context, 'ec055ed1-00bb-41a8-a76e-f287ea2f81f1' as never, 'read');
}
