import { it,expect } from "vitest";
import { planMigrations } from "../../src/db/migration-plan.ts";
import { migrate,type MigrationClient } from "../../src/db/migration-runner.ts";
const file={name:"0001_ls_foundation.sql",checksum:"a".repeat(64),sql:"SELECT 1;"};
it("plans only unapplied files",()=>expect(planMigrations([file],[{name:file.name,checksum:file.checksum}])).toEqual([]));
it("rejects changed and removed history",()=>{expect(()=>planMigrations([file],[{name:file.name,checksum:"b".repeat(64)}])).toThrow();expect(()=>planMigrations([],[{name:file.name,checksum:file.checksum}])).toThrow();});
it("does not run SQL when the migration lock is held",async()=>{await expect(migrate({query:async()=>({rows:[{locked:false}]})},[file],false)).rejects.toThrow("MIGRATION_LOCKED");});
it("rolls back a failed migration and unlocks",async()=>{
 const calls:string[]=[];
 const client:MigrationClient={query:async text=>{calls.push(text);if(text.includes("pg_try_advisory_lock"))return{rows:[{locked:true}]};if(text===file.sql)throw new Error("synthetic");return{rows:[]};}};
 await expect(migrate(client,[file],false)).rejects.toThrow("MIGRATION_FAILED");
 expect(calls).toContain("ROLLBACK");expect(calls.at(-1)).toContain("pg_advisory_unlock");expect(calls.some(text=>text.startsWith("INSERT INTO ls_control.migrations"))).toBe(false);
});
it("verify-only does not issue DDL or migration SQL",async()=>{
 const calls:string[]=[];const client:MigrationClient={query:async text=>{calls.push(text);if(text.includes("pg_try_advisory_lock"))return{rows:[{locked:true}]};if(text.startsWith("SELECT name"))return{rows:[{name:file.name,checksum:file.checksum}]};return{rows:[]};}};
 await expect(migrate(client,[file],true)).resolves.toEqual({applied:0,pending:0});expect(calls.some(text=>text.startsWith("CREATE")||text===file.sql)).toBe(false);
});
