import { it,expect } from "vitest";
import { planMigrations } from "../../src/db/migration-plan.ts";
import { migrate,type MigrationClient } from "../../src/db/migration-runner.ts";
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const inventory=()=> (JSON.parse(readFileSync('migrations/manifest.json','utf8')) as {name:string;sha256:string}[]).map(f=>({name:f.name,checksum:f.sha256,sql:readFileSync('migrations/'+f.name,'utf8')}));
it('supports every previously valid parent prefix and the original appended outbox history',()=>{
 const files=inventory();expect(files).toHaveLength(63);
 for(const n of [51,52,53,54,55,56,57,58,59,60,61,62])expect(planMigrations(files,files.slice(0,n))).toEqual(files.slice(n));
});
it('recognizes only the exact early outbox and resumes each partial deferred upgrade',()=>{
 const files=inventory(),outbox=files[54]!;
 for(const n of [51,52,53])expect(planMigrations(files,[...files.slice(0,n),outbox])).toEqual([...files.slice(n,54),...files.slice(55)]);
 const future={name:'0144_next.sql',checksum:'d'.repeat(64),sql:'select 1;'};
 expect(planMigrations([...files,future],[...files.slice(0,51),outbox])).toEqual([...files.slice(51,54),...files.slice(55),future]);
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

it('retains every pre-founder migration pin and adopts only the exact additive founder SQL',()=>{
 const entries=JSON.parse(readFileSync('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 expect(createHash('sha256').update(JSON.stringify(entries.slice(0,55))).digest('hex')).toBe('14c3d62442b8152997c957746e96682fc696aa1fac533034d30db0f1279b51c4');
 expect(entries[55]).toEqual({name:'0136_ls_academy_founder.sql',sha256:'6590a21e456f05c4956b097ce5cd3300fd2ebb2ae89e1d007bb2ece969b51ecf'});
 expect(entries[56]).toEqual({name:'0137_ls_academy_owner_notifications.sql',sha256:'b474d4f21eec0b39cb0796e9afac1226335108bc20dd334bf005c01aa775a506'});
 expect(entries[57]).toEqual({name:'0138_ls_academy_crm.sql',sha256:'0598f09b6653089664ffe8be283232fa2d7ea927989754d9c704ff3e09480fbf'});
 expect(entries[58]).toEqual({name:'0139_ls_bna_inquiries.sql',sha256:'91421da4a936986e9c33e4ccbe141c07f78cbaeca3f6d55bf0e34fd243e64da0'});
 expect(entries[59]).toEqual({name:'0140_ls_fishing_inquiry_followups.sql',sha256:'0d24071314c823f5754c1d5d5637fd18b33cb81d08c45f7a58e95d2bf4c45d46'});
 expect(entries[60]).toEqual({name:'0141_ls_owner_305_conversations.sql',sha256:'d4c5c6a4e98382c4059e97c6147eae378b0017fd61307df771b1bdbc68b29790'});
 for(const entry of entries)expect(createHash('sha256').update(readFileSync('migrations/'+entry.name)).digest('hex')).toBe(entry.sha256);
 const proposal=readFileSync('migrations/proposals/0136_ls_academy_founder.sql','utf8'),numbered=readFileSync('migrations/0136_ls_academy_founder.sql','utf8');
 expect(numbered.slice(numbered.indexOf('\n')).replaceAll('\r\n','\n')).toBe(proposal.slice(proposal.indexOf('\n')).replaceAll('\r\n','\n'));
});
