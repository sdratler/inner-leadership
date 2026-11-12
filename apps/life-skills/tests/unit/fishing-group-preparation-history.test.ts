import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planMigrations, type AppliedMigration, type Migration } from '../../src/db/migration-plan.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(readFileSync('migrations/manifest.json', 'utf8')) as { name: string; sha256: string }[];
const files: Migration[] = manifest.map(entry => ({
  name: entry.name, checksum: entry.sha256, sql: readFileSync('migrations/' + entry.name, 'utf8'),
}));
const history = (indexes: number[]): AppliedMigration[] => indexes.map(index => ({ name: files[index]!.name, checksum: files[index]!.checksum }));
// Histories are synthetic. Every source file and pin is the actual repository inventory.
const prefix = (length: number) => Array.from({ length }, (_, index) => index);

describe('exact selective owner draft migration history', () => {
  it.each([67, 68, 69, 70])('keeps the real held BNA remainder before and after153 at prefix%i', length => {
    const before = history([...prefix(length), 70, 71]);
    const after = history([...prefix(length), 70, 71, 72]);
    expect(planMigrations(files, before)).toEqual([...files.slice(length, 70), files[72]]);
    expect(planMigrations(files, after)).toEqual(files.slice(length, 70));
  });

  it('retains every ordinary prefix and previous selective151-only history', () => {
    expect(files).toHaveLength(73);
    for (const length of [67, 68, 69, 70, 71, 72, 73]) {
      expect(planMigrations(files, history(prefix(length)))).toEqual(files.slice(length));
    }
    expect(planMigrations(files, history([...prefix(67), 70]))).toEqual([...files.slice(67, 70), ...files.slice(71)]);
  });

  it('leaves a valid declared but uninstalled future migration pending without recognizing its selective installation', () => {
    const sql = 'SELECT 1;', future = { name: '0154_future.sql', sql, checksum: hash(sql) };
    const installed = history([...prefix(67), 70, 71, 72]);
    expect(planMigrations([...files, future], installed)).toEqual([...files.slice(67, 70), future]);
    expect(() => planMigrations([...files, future], [...installed, { name: future.name, checksum: future.checksum }]))
      .toThrow('MIGRATION_HISTORY_DIVERGED');
    // A fully contiguous history remains governed by the unchanged general prefix logic.
    expect(planMigrations([...files, future], [...history(prefix(73)), future])).toEqual([]);
  });

  it('rejects missing, forged, duplicated, reordered or gapped applied records', () => {
    const base = prefix(67), exact = history([...base, 70, 71, 72]);
    const wrong153 = { ...exact.at(-1)!, checksum: '0'.repeat(64) };
    const malformed = [
      history([...base, 71, 72]), history([...base, 70, 72]), history([...base, 70, 72, 71]),
      history([...base, 70, 70, 71, 72]), history([...base, 70, 71, 72, 72]),
      history([...prefix(66), 70, 71, 72]), history([...base, 68, 70, 71, 72]),
      [...exact.slice(0, -1), wrong153], [...exact.slice(0, -1), { ...wrong153, name: '0153_unknown.sql' }],
      [{ ...exact[0]!, checksum: 'f'.repeat(64) }, ...exact.slice(1)],
    ];
    for (const installed of malformed) {
      expect(() => planMigrations(files, installed)).toThrow('MIGRATION_HISTORY_DIVERGED');
    }
  });

  it('authenticates known prior72 and153 SQL bytes as well as metadata', () => {
    const installed = history([...prefix(67), 70, 71, 72]);
    const changed: Migration[][] = [files.slice(0, 72), files.map((file, index) => index === 72 ? { ...file, name: '0153_unknown.sql' } : file)];
    for (const index of [0, 66, 67, 68, 69, 70, 71, 72]) {
      const sql = files[index]!.sql + '\n-- synthetic drift';
      changed.push(files.map((file, n) => n === index ? { ...file, sql } : file));
      changed.push(files.map((file, n) => n === index ? { ...file, sql, checksum: hash(sql) } : file));
      changed.push(files.map((file, n) => n === index ? { ...file, checksum: '0'.repeat(64) } : file));
    }
    for (const source of changed) {
      expect(() => planMigrations(source, installed)).toThrow('MIGRATION_HISTORY_DIVERGED');
    }
    const unknown = { name: '0148_ls_unknown.sql', sql: 'SELECT 1;', checksum: hash('SELECT 1;') };
    expect(() => planMigrations([...files, unknown], installed)).toThrow('MIGRATION_HISTORY_DIVERGED');
  });
});
