import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { z } from "zod";
import { isLoopback, parseEnvironment, validateDatabaseUrl } from "../src/lib/env/schema.ts";
import { migrate } from "../src/db/migration-runner.ts";
import type { Migration } from "../src/db/migration-plan.ts";
const manifestSchema = z.array(z.strictObject({ name: z.string().regex(/^\d{4}_[a-z][a-z0-9_]*\.sql$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1);
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--verify-only") || args.length > 1) throw new Error("INVALID_MIGRATION_ARGUMENTS");
  const env = parseEnvironment(process.env);
  if (!env.LS_MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_NOT_CONFIGURED");
  const target = validateDatabaseUrl(env.LS_MIGRATION_DATABASE_URL, env.LS_DATABASE_TLS);
  // This foundation packet grants only disposable, loopback integration migrations.
  if (!isLoopback(target.hostname) || !/_(test|dev)$/.test(target.pathname)) throw new Error("MIGRATION_TARGET_NOT_AUTHORIZED");
  const root = new URL("../migrations/", import.meta.url);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(new URL("manifest.json", root), "utf8")));
  const actual = (await readdir(fileURLToPath(root))).filter(name => name.endsWith(".sql")).sort();
  const expected = manifest.map(item => item.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("MIGRATION_INVENTORY_MISMATCH");
  const files: Migration[] = [];
  for (const entry of manifest) {
    const bytes = await readFile(new URL(entry.name, root));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("MIGRATION_CHECKSUM_MISMATCH");
    files.push({ name: entry.name, checksum: entry.sha256, sql: bytes.toString("utf8") });
  }
  const pool = new Pool({ connectionString: env.LS_MIGRATION_DATABASE_URL,
    ssl: env.LS_DATABASE_TLS === "disable" ? false : { rejectUnauthorized: true, ...(env.LS_DATABASE_CA ? { ca: env.LS_DATABASE_CA } : {}) },
    max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000,
  });
  try {
    const client = await pool.connect();
    try {
      const result = await migrate({ query: (text, values) => client.query(text, values ? [...values] : undefined) }, files, args.includes("--verify-only"));
      process.stdout.write(JSON.stringify({ code: "MIGRATION_OK", ...result }) + "\n");
    } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch(() => { process.stderr.write("MIGRATION_BLOCKED_OR_FAILED\n"); process.exitCode = 1; });
