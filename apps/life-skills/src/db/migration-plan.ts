export type Migration = Readonly<{ name: string; checksum: string; sql: string }>;
export type AppliedMigration = Readonly<{ name: string; checksum: string }>;
export function planMigrations(files: readonly Migration[], applied: readonly AppliedMigration[]): readonly Migration[] {
  const sorted = [...files].sort((a,b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  for (const file of sorted) {
    if (!/^\d{4}_[a-z][a-z0-9_]*\.sql$/.test(file.name) || seen.has(file.name) || !/^[a-f0-9]{64}$/.test(file.checksum) || !file.sql.trim()) throw new Error("INVALID_MIGRATION_SET");
    seen.add(file.name);
  }
  if (applied.length > sorted.length) throw new Error("MIGRATION_HISTORY_DIVERGED");
  for (const [index, item] of applied.entries()) {
    const expected = sorted[index];
    if (!expected || expected.name !== item.name || expected.checksum !== item.checksum) throw new Error("MIGRATION_HISTORY_DIVERGED");
  }
  return sorted.slice(applied.length);
}
