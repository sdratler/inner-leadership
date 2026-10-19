import { it,expect } from "vitest";
import { planMigrations } from "../../src/db/migration-plan.ts";
import { migrate,type MigrationClient } from "../../src/db/migration-runner.ts";
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const inventory=()=> (JSON.parse(readFileSync('migrations/manifest.json','utf8')) as {name:string;sha256:string}[]).map(f=>({name:f.name,checksum:f.sha256,sql:readFileSync('migrations/'+f.name,'utf8')}));
it('supports every previously valid parent prefix and the original appended outbox history',()=>{
 const files=inventory();expect(files).toHaveLength(55);
 for(const n of [51,52,53,54,55])expect(planMigrations(files,files.slice(0,n))).toEqual(files.slice(n));
});
it('recognizes only the exact early outbox and resumes each partial deferred upgrade',()=>{
 const files=inventory(),outbox=files[54]!;
 for(const n of [51,52,53])expect(planMigrations(files,[...files.slice(0,n),outbox])).toEqual(files.slice(n,54));
 const future={name:'0136_next.sql',checksum:'d'.repeat(64),sql:'select 1;'};
 expect(planMigrations([...files,future],[...files.slice(0,51),outbox])).toEqual([...files.slice(51,54),future]);
 expect(planMigrations([...files.slice(0,51),outbox],files.slice(0,51))).toEqual([outbox]);
});
it('does not hide unknown, duplicated, reordered, changed or gapped early-outbox history',()=>{
 const files=inventory(),base=files.slice(0,51),outbox=files[54]!,early=[...base,outbox];
 const invalid=[early.slice(1),[...base,base[0]!,outbox],[...base,{name:'0134_unknown.sql',checksum:'e'.repeat(64)},outbox],[...base,files[52]!,outbox],[...base,{...outbox,checksum:'e'.repeat(64)}],[...base.slice(0,50),outbox],[...base,outbox,files[51]!]];
 for(const history of invalid)expect(()=>planMigrations(files,history)).toThrow('MIGRATION_HISTORY_DIVERGED');
 for(const index of [51,52,53,54])for(const change of [{checksum:'e'.repeat(64)},{sql:'select 1;'}])expect(()=>planMigrations(files.map((f,i)=>i===index?{...f,...change}:f),early)).toThrow('MIGRATION_HISTORY_DIVERGED');
 const unknown={name:'0132_ls_unreviewed.sql',checksum:createHash('sha256').update('select 1;').digest('hex'),sql:'select 1;'};
 expect(()=>planMigrations([...files,unknown],early)).toThrow('MIGRATION_HISTORY_DIVERGED');
});
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
