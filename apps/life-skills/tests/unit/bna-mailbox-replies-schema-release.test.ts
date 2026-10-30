import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {bnaMailboxRepliesSchemaPlan,BNA_MAILBOX_REPLIES_MIGRATION,readBnaMailboxRepliesSchemaStage} from '../../src/db/bna-mailbox-replies-schema-release.ts';
const manifest=JSON.parse(readFileSync('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
const files=manifest.map(m=>({name:m.name,checksum:m.sha256,sql:readFileSync('migrations/'+m.name,'utf8')}));
it('freezes the entire accepted69 prefix and admits exact0150 after exact0149',()=>{
 expect(files).toHaveLength(70);expect(manifest[69]).toEqual({name:BNA_MAILBOX_REPLIES_MIGRATION.name,sha256:BNA_MAILBOX_REPLIES_MIGRATION.sha256});
 expect(createHash('sha256').update(readFileSync('migrations/'+BNA_MAILBOX_REPLIES_MIGRATION.name)).digest('hex')).toBe(BNA_MAILBOX_REPLIES_MIGRATION.sha256);
 const before=files.slice(0,69);expect(bnaMailboxRepliesSchemaPlan(files,before,0).pending.map(m=>m.name)).toEqual([BNA_MAILBOX_REPLIES_MIGRATION.name]);
 expect(bnaMailboxRepliesSchemaPlan(files,files,1).pending).toEqual([]);expect(()=>bnaMailboxRepliesSchemaPlan(files,before,1)).toThrow();
 expect(()=>bnaMailboxRepliesSchemaPlan(files,before.slice(0,-1),0)).toThrow();
 const changed=files.map((f,i)=>i===0?{...f,checksum:'e'.repeat(64)}:f);expect(()=>bnaMailboxRepliesSchemaPlan(changed,changed.slice(0,69),0)).toThrow('BNA_MAILBOX_REPLIES_SCHEMA_PREFIX_MISMATCH');
 expect(()=>bnaMailboxRepliesSchemaPlan(files.map((f,i)=>i===69?{...f,checksum:'a'.repeat(64)}:f),before,0)).toThrow('BNA_MAILBOX_REPLIES_SCHEMA_SOURCE_MISMATCH');
 const future={name:'0151_future.sql',checksum:'e'.repeat(64),sql:'SELECT 1;'};expect(bnaMailboxRepliesSchemaPlan([...files,future],[...files,future],1).pending).toEqual([]);
});
it('rejects every partial catalog and orphan function state',async()=>{
 const db=(receipts:string|null,reviews:string|null,monitor:string|null,n=0)=>({query:async<T extends object>(sql:string)=>({rows:(sql.includes('to_regclass')?[{receipts,reviews,monitor}]:[{n}]) as unknown as T[]})});
 expect(await readBnaMailboxRepliesSchemaStage(db(null,null,null))).toBe(0);
 await expect(readBnaMailboxRepliesSchemaStage(db(null,null,null,1))).rejects.toThrow('BNA_MAILBOX_REPLIES_SCHEMA_CATALOG_CONFLICT');
 for(const [a,b,c] of [[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1]])await expect(readBnaMailboxRepliesSchemaStage(db(a?'receipts':null,b?'reviews':null,c?'monitor':null))).rejects.toThrow('BNA_MAILBOX_REPLIES_SCHEMA_CATALOG_CONFLICT');
});
it('binds all reply/monitor/MIME sources, preserves predecessor controls, and separates schema apply from activation',()=>{
 const script=readFileSync('scripts/release-bna-mailbox-replies-schema.ts','utf8'),match=script.match(/const sources=\[([\s\S]*?)\] as const;/);expect(match).not.toBeNull();
 const sources=JSON.parse('['+match![1]+']') as string[];expect(new Set(sources).size).toBe(sources.length);for(const name of sources)expect(readFileSync(name).length,name).toBeGreaterThan(0);
 const expected=createHash('sha256').update(JSON.stringify(sources.map(name=>[name,createHash('sha256').update(readFileSync(name)).digest('hex')]))).digest('hex');
 expect(execFileSync(process.execPath,['--import','tsx','scripts/release-bna-mailbox-replies-schema.ts','--source-digest'],{encoding:'utf8'}).trim()).toBe(expected);
 for(const name of ['src/features/bna-communications/reply-monitor-admission.ts','src/features/bna-communications/reply-monitor-runtime.ts','scripts/bna-reply-monitor-worker.ts','src/providers/email/gmail.ts','src/db/bna-optional-calendar-schema-release.ts'])expect(sources).toContain(name);
 for(const text of ['LS_BNA_MAILBOX_REPLIES_ENABLED','LS_BNA_REPLY_MONITOR_ENABLED','LS_BNA_MAILBOX_REPLIES_SCHEMA_APPLY_APPROVED','baselineLedgerSha256','readBnaOptionalCalendarSchemaStage','rejectUnauthorized:true','NODE_TLS_REJECT_UNAUTHORIZED','previousTablesUnchanged','archiveSha256','catalogSha256','--verify-only','pg_try_advisory_lock(541940,8)'])expect(script).toContain(text);
 expect(script).not.toMatch(/transport\.send|\.dispatch\(|DROP TABLE|TRUNCATE TABLE|process\.env\.LS_BNA_OPTIONAL_CALENDAR_ENABLED/);
});
