import "server-only";
import { database } from "../../db/client.ts";
import {bindStatement} from './sql-binding.ts';
export {bindStatement} from './sql-binding.ts';
import type { IdentityStore } from "./store.ts";
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
