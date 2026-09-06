import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { migrate } from "../../src/db/migration-runner.ts";
import { isLoopback } from "../../src/lib/env/schema.ts";
const raw=process.env.LS_TEST_DATABASE_URL;
if(!raw) throw new Error("LS_TEST_DATABASE_URL_REQUIRED_FOR_DB_TESTS");
const target=new URL(raw);
if(!isLoopback(target.hostname)||!target.pathname.endsWith("_test")||target.search)throw new Error("DISPOSABLE_LOOPBACK_TEST_DATABASE_REQUIRED");
const pool=new Pool({connectionString:raw,ssl:false,max:1,connectionTimeoutMillis:5000});
const sql=await readFile(new URL("../../migrations/0001_ls_foundation.sql",import.meta.url),"utf8");
const files=[{name:"0001_ls_foundation.sql",checksum:createHash("sha256").update(sql).digest("hex"),sql}];
describe("disposable PostgreSQL integration",()=>{
 beforeAll(async()=>{const result=await pool.query("SELECT to_regnamespace('ls_control') AS schema");if(result.rows[0]?.schema)throw new Error("FRESH_EMPTY_TEST_DATABASE_REQUIRED");});
 afterAll(async()=>{await pool.end();});
 it("applies once, repeats safely, verifies and detects drift",async()=>{
  const client=await pool.connect();
  const adapter={query:(text:string,values?:readonly unknown[])=>client.query(text,values?[...values]:undefined)};
  try{
   expect(await migrate(adapter,files,false)).toEqual({applied:1,pending:0});
   expect(await migrate(adapter,files,false)).toEqual({applied:0,pending:0});
   expect(await migrate(adapter,files,true)).toEqual({applied:0,pending:0});
   const meta=await client.query("SELECT value FROM ls_control.foundation_metadata WHERE key='foundation_version'");expect(meta.rows[0]?.value).toBe("1");
   await expect(migrate(adapter,[{...files[0]!,checksum:"f".repeat(64)}],true)).rejects.toThrow("MIGRATION_HISTORY_DIVERGED");
  }finally{client.release();}
 });
});
