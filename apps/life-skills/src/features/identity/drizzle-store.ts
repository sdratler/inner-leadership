import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { database } from "../../db/client.ts";
import { AppError } from "../../lib/errors.ts";
import type { IdentityStore } from "./store.ts";
/** Convert only developer-owned $n SQL to bound parameters. Identifiers are never user input. */
export function bindStatement(text: string, values: readonly unknown[]): SQL {
  const query = sql.empty(); let offset = 0; const used = new Set<number>();
  for (const match of text.matchAll(/\$(\d+)/g)) {
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= values.length) throw new AppError("INTERNAL");
    query.append(sql.raw(text.slice(offset, match.index))); query.append(sql`${values[index]}`);
    offset = match.index! + match[0].length; used.add(index);
  }
  query.append(sql.raw(text.slice(offset)));
  if (used.size !== values.length) throw new AppError("INTERNAL");
  return query;
}
export const drizzleIdentityStore: IdentityStore = {
  async transaction(work) {
    return database().transaction(async tx => work({
      async query<T extends object>(text: string, values: readonly unknown[] = []) {
        const result = await tx.execute(bindStatement(text, values));
        return result.rows as T[];
      },
    }));
  },
};
