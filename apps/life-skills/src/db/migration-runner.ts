import { planMigrations, type AppliedMigration, type Migration } from "./migration-plan.ts";
export interface MigrationClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
/** Append-only, one transaction per SQL migration, one shared advisory lock per DB. */
export async function migrate(client: MigrationClient, files: readonly Migration[], verifyOnly: boolean): Promise<{ applied: number; pending: number }> {
  planMigrations(files, []);
  const lock = await client.query("SELECT pg_try_advisory_lock(541931, 0) AS locked");
  if (lock.rows[0]?.locked !== true) throw new Error("MIGRATION_LOCKED");
  try {
    if (!verifyOnly) {
      await client.query("BEGIN");
      try {
        await client.query("CREATE SCHEMA IF NOT EXISTS ls_control");
        await client.query("CREATE TABLE IF NOT EXISTS ls_control.migrations (name text PRIMARY KEY, checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())");
        await client.query("COMMIT");
      } catch { await client.query("ROLLBACK"); throw new Error("MIGRATION_LEDGER_FAILED"); }
    }
    const history = await client.query("SELECT name, checksum FROM ls_control.migrations ORDER BY name");
    const applied: AppliedMigration[] = history.rows.map(row => {
      if (typeof row.name !== "string" || typeof row.checksum !== "string") throw new Error("MIGRATION_HISTORY_DIVERGED");
      return { name: row.name, checksum: row.checksum };
    });
    const pending = planMigrations(files, applied);
    if (verifyOnly) {
      if (pending.length) throw new Error("MIGRATIONS_PENDING");
      return { applied: 0, pending: 0 };
    }
    let count = 0;
    for (const file of pending) {
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query("INSERT INTO ls_control.migrations (name, checksum) VALUES ($1, $2)", [file.name, file.checksum]);
        await client.query("COMMIT"); count += 1;
      } catch { await client.query("ROLLBACK"); throw new Error("MIGRATION_FAILED"); }
    }
    return { applied: count, pending: 0 };
  } finally { await client.query("SELECT pg_advisory_unlock(541931, 0)"); }
}
