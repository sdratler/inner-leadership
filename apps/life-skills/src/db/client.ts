import "server-only";
import {createHash} from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { SQL } from "drizzle-orm";
import { serverEnvironment } from "../lib/env/server.ts";
import { normalizeDatabaseRows, type DatabaseField } from "../features/integration/normalize-database-result.ts";
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
  // Capture the actual original pool options, never a later environment read.
  const boundTarget=Object.freeze({digest:createHash("sha256").update(pool.options.connectionString??"").digest("hex"),tlsDisabled:pool.options.ssl===false});
  // No SQL, connection-string or exception-object logging.
  pool.on("error", () => { instance = undefined; void pool.end().catch(() => undefined); });
  const raw = drizzle(pool, { schema });
  const db = {
    transaction<T>(work: (tx: { execute(statement: SQL): Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>): Promise<T> {
      return raw.transaction(async tx => work({
        async execute(statement) {
          const result = await tx.execute(statement) as unknown as {
            rows: Record<string, unknown>[];
            fields: DatabaseField[];
          };
          return { ...result, rows: normalizeDatabaseRows(result.rows, result.fields) };
        },
      }));
    },
  };
  return { db, boundTarget, close: () => pool.end() };
}
/** Lazy: rendering/build/liveness do not connect to a database. */
export function database() { instance ??= createDatabase(); return instance.db; }
/** Fixed target provenance for an explicitly admitted local rehearsal. No SQL,
 * pool reset/repoint, raw URL return or rewriting of a cached pool's binding. */
export function databaseBoundToTarget(expectedUrl:string){
  if(!instance){
    const current=serverEnvironment();
    if(current.LS_DATABASE_URL!==expectedUrl||current.LS_DATABASE_TLS!=="disable")return null;
    instance=createDatabase();
  }
  return instance.boundTarget.tlsDisabled&&instance.boundTarget.digest===createHash("sha256").update(expectedUrl).digest("hex")?instance.db:null;
}
export async function closeDatabase() { const old = instance; instance = undefined; if (old) await old.close(); }
