import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {bnaOptionalCalendarSchemaPlan,BNA_OPTIONAL_CALENDAR_MIGRATION,readBnaOptionalCalendarSchemaStage} from '../../src/db/bna-optional-calendar-schema-release.ts';
const manifest=JSON.parse(readFileSync('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
const files=manifest.map(m=>({name:m.name,checksum:m.sha256,sql:readFileSync('migrations/'+m.name,'utf8')}));
it('freezes the full accepted68 prefix and admits only exact0149 after0148',()=>{
 expect(files).toHaveLength(70);expect(manifest[68]).toEqual({name:BNA_OPTIONAL_CALENDAR_MIGRATION.name,sha256:BNA_OPTIONAL_CALENDAR_MIGRATION.sha256});
 expect(createHash('sha256').update(readFileSync('migrations/'+BNA_OPTIONAL_CALENDAR_MIGRATION.name)).digest('hex')).toBe(BNA_OPTIONAL_CALENDAR_MIGRATION.sha256);
 const before=files.slice(0,68);expect(bnaOptionalCalendarSchemaPlan(files,before,0).pending.map(m=>m.name)).toEqual([BNA_OPTIONAL_CALENDAR_MIGRATION.name]);
 expect(bnaOptionalCalendarSchemaPlan(files,files,1).pending).toEqual([]);
 expect(()=>bnaOptionalCalendarSchemaPlan(files,before,1)).toThrow();expect(()=>bnaOptionalCalendarSchemaPlan(files,before.slice(0,-1),0)).toThrow();
 const changed=files.map((f,i)=>i===0?{...f,checksum:'e'.repeat(64)}:f);
 expect(()=>bnaOptionalCalendarSchemaPlan(changed,changed.slice(0,68),0)).toThrow('BNA_OPTIONAL_CALENDAR_SCHEMA_PREFIX_MISMATCH');
 expect(()=>bnaOptionalCalendarSchemaPlan(files.map((f,i)=>i===68?{...f,checksum:'a'.repeat(64)}:f),before,0)).toThrow('BNA_OPTIONAL_CALENDAR_SCHEMA_SOURCE_MISMATCH');
 const future={name:'0151_future.sql',checksum:'e'.repeat(64),sql:'SELECT 1;'};expect(bnaOptionalCalendarSchemaPlan([...files,future],[...files,future],1).pending).toEqual([]);
});
it('rejects partial and orphan catalog states instead of guessing that a migration is absent',async()=>{
 const db=(messages:string|null,events:string|null,n=0)=>({query:async<T extends object>(sql:string)=>({rows:(sql.includes('to_regclass')?[{messages,events}]:[{n}]) as unknown as T[]})});
 expect(await readBnaOptionalCalendarSchemaStage(db(null,null))).toBe(0);
 await expect(readBnaOptionalCalendarSchemaStage(db(null,null,1))).rejects.toThrow('BNA_OPTIONAL_CALENDAR_SCHEMA_CATALOG_CONFLICT');
 await expect(readBnaOptionalCalendarSchemaStage(db('messages',null))).rejects.toThrow('BNA_OPTIONAL_CALENDAR_SCHEMA_CATALOG_CONFLICT');
 await expect(readBnaOptionalCalendarSchemaStage(db(null,'events'))).rejects.toThrow('BNA_OPTIONAL_CALENDAR_SCHEMA_CATALOG_CONFLICT');
});
it('binds the exact operator source inventory and keeps schema apply separate from optional activation',()=>{
 const script=readFileSync('scripts/release-bna-optional-calendar-schema.ts','utf8');
 const match=script.match(/const sources=\[([\s\S]*?)\] as const;/);expect(match).not.toBeNull();const sources=JSON.parse('['+match![1]+']') as string[];
 expect(new Set(sources).size).toBe(sources.length);
 for(const name of sources)expect(readFileSync(name).length,name).toBeGreaterThan(0);
 const expected=createHash('sha256').update(JSON.stringify(sources.map(name=>[name,createHash('sha256').update(readFileSync(name)).digest('hex')]))).digest('hex');
 expect(execFileSync(process.execPath,['--import','tsx','scripts/release-bna-optional-calendar-schema.ts','--source-digest'],{encoding:'utf8'}).trim()).toBe(expected);
 for(const text of ['LS_BNA_OPTIONAL_CALENDAR_ENABLED','LS_BNA_OPTIONAL_CALENDAR_SCHEMA_APPLY_APPROVED','baselineLedgerSha256','readBnaPreferencesSchemaStage','rejectUnauthorized:true','NODE_TLS_REJECT_UNAUTHORIZED','previousTablesUnchanged','archiveSha256','catalogSha256','--verify-only'])expect(script).toContain(text);
 expect(script).not.toMatch(/transport\.send|\.dispatch\(|bna_email_preference_events\s+SET|DROP TABLE|TRUNCATE TABLE/);
});
