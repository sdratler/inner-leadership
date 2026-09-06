import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { serverEnvironment } from "../lib/env/server.ts";
import * as schema from "./schema.ts";
let instance: ReturnType<typeof createDatabase> | undefined;
function createDatabase() {
  const env = serverEnvironment();
  if (!env.LS_DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  const pool = new Pool({
    connectionString: env.LS_DATABASE_URL,
    ssl: env.LS_DATABASE_TLS === "disable" ? false : { rejectUnauthorized: true, ...(env.LS_DATABASE_CA ? { ca: env.LS_DATABASE_CA } : {}) },
    max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
  });
  // No SQL, connection-string or exception-object logging.
  pool.on("error", () => { instance = undefined; void pool.end().catch(() => undefined); });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
/** Lazy: rendering/build/liveness do not connect to a database. */
export function database() { instance ??= createDatabase(); return instance.db; }
export async function closeDatabase() { const old = instance; instance = undefined; if (old) await old.close(); }
