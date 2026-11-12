import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {planMigrations,type Migration} from '../../src/db/migration-plan.ts';
import {INQUIRY_EMAIL_CONTROL_MIGRATIONS} from '../../src/db/inquiry-email-control-history.ts';
const root=new URL('../../migrations/',import.meta.url);
const files=(JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as {name:string;sha256:string}[]).map(x=>({name:x.name,checksum:x.sha256,sql:readFileSync(new URL(x.name,root),'utf8')}));
const history=(indexes:number[])=>indexes.map(i=>({name:files[i]!.name,checksum:files[i]!.checksum}));
const prefix=Array.from({length:67},(_,i)=>i);
it('keeps normal ordered prefixes and recognizes only exact selective Fishing schema history',()=>{
 expect(files).toHaveLength(73);expect(files.slice(70,72).map(x=>({name:x.name,sha256:x.checksum}))).toEqual(INQUIRY_EMAIL_CONTROL_MIGRATIONS);
 expect(files[72]!.name).toBe('0153_ls_fishing_group_preparations.sql');
 expect(planMigrations(files,history([...prefix,70])).map(x=>x.name)).toEqual([files[67]!.name,files[68]!.name,files[69]!.name,files[71]!.name,files[72]!.name]);
 expect(planMigrations(files,history([...prefix,70,71])).map(x=>x.name)).toEqual([...files.slice(67,70),files[72]!].map(x=>x.name));
 expect(planMigrations(files,history([...prefix,67,70,71])).map(x=>x.name)).toEqual([...files.slice(68,70),files[72]!].map(x=>x.name));
 expect(planMigrations(files,history([...prefix,67,68,69,70,71]))).toEqual([files[72]]);
 expect(planMigrations(files,history([...prefix,67,68,69,70,71,72]))).toEqual([]);
});
it('refuses unrelated gaps, forged history, frozen deferred SQL drift and new SQL drift',()=>{
 for(const indices of [[...prefix,71],[...prefix.slice(0,-1),70,71],[...prefix,68,70,71],[...prefix,70,71,71]])expect(()=>planMigrations(files,history(indices))).toThrow('MIGRATION_HISTORY_DIVERGED');
 const selected=history([...prefix,70,71]);
 expect(()=>planMigrations(files,[...selected.slice(0,-1),{...selected.at(-1)!,checksum:'0'.repeat(64)}])).toThrow('MIGRATION_HISTORY_DIVERGED');
 for(const index of [66,67,68,69,70,71]){
  const changed:Migration[]=files.map((x,i)=>i===index?{...x,sql:x.sql+'\n-- changed'}:x);
  expect(()=>planMigrations(changed,selected)).toThrow('MIGRATION_HISTORY_DIVERGED');
 }
});
