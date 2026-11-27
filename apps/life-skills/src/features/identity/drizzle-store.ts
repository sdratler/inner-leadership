import "server-only";
import { database,databaseBoundToTarget,databaseBoundToFishingTarget } from "../../db/client.ts";
import {bindStatement} from './sql-binding.ts';
export {bindStatement} from './sql-binding.ts';
import type { IdentityStore,SqlSession } from "./store.ts";
export const drizzleIdentityStore: IdentityStore = {
  bindFishingDatabaseTarget(expectedUrl,expectedCaSha256){
    const bound=databaseBoundToFishingTarget(expectedUrl,expectedCaSha256);if(!bound)return null;
    return Object.freeze({transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{
      return bound.transaction(async tx=>work({async query<R extends object>(text:string,values:readonly unknown[]=[]){
        const result=await tx.execute(bindStatement(text,values));return result.rows as R[];
      }}));
    }});
  },
  bindDatabaseTarget(expectedUrl){
    const bound=databaseBoundToTarget(expectedUrl);if(!bound)return null;
    // Keep this exact driver/pool. Later env/cache changes never retarget it.
    return Object.freeze({transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{
      return bound.transaction(async tx=>work({async query<R extends object>(text:string,values:readonly unknown[]=[]){
        const result=await tx.execute(bindStatement(text,values));return result.rows as R[];
      }}));
    }});
  },
  async transaction(work) {
    return database().transaction(async tx => work({
      async query<T extends object>(text: string, values: readonly unknown[] = []) {
        const result = await tx.execute(bindStatement(text, values));
        return result.rows as T[];
      },
    }));
  },
};
