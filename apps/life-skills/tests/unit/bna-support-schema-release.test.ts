import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {bnaSupportSchemaPlan,BNA_SUPPORT_MIGRATION,readBnaSupportSchemaStage} from "../../src/db/bna-support-schema-release.ts";
import {readBnaCoopSchemaStage} from "../../src/db/bna-coop-schema-release.ts";
import type {Owner305ReleaseQuery} from "../../src/db/owner-305-schema-release.ts";
const files=(JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[]).map(file=>({name:file.name,checksum:file.sha256,sql:readFileSync("migrations/"+file.name,"utf8")}));
it("admits only support0144 after the exact0143 ledger and rejects drift or schema/ledger disagreement",()=>{
 const index=files.findIndex(file=>file.name===BNA_SUPPORT_MIGRATION.name),baseline=files.slice(0,index);
 expect(bnaSupportSchemaPlan(files,baseline,0).pending.map(file=>file.name)).toEqual([BNA_SUPPORT_MIGRATION.name]);
 expect(bnaSupportSchemaPlan(files,files,1).pending).toEqual([]);
 for(const [history,stage] of [[baseline,1],[files,0],[baseline.slice(0,-1),0]] as const)expect(()=>bnaSupportSchemaPlan(files,history,stage)).toThrow();
 for(const changed of [files.filter(file=>file.name!==BNA_SUPPORT_MIGRATION.name),files.map((file,n)=>n===index-1?{...file,checksum:"0".repeat(64)}:file),files.map(file=>file.name===BNA_SUPPORT_MIGRATION.name?{...file,checksum:"0".repeat(64)}:file)])expect(()=>bnaSupportSchemaPlan(changed,baseline,0)).toThrow();
 const later={name:"0148_future.sql",checksum:"e".repeat(64),sql:"select 1;"};expect(bnaSupportSchemaPlan([...files,later],[...files,later],1).pending).toEqual([]);
 expect(()=>bnaSupportSchemaPlan([...files,later],[...files,{...later,checksum:"f".repeat(64)}],1)).toThrow();
});
const definition="CHECK ((program_key = ANY (ARRAY['bna_torah_mornings'::text, 'bna_learning_coop'::text, 'bna_support_interest'::text])))";
function db(def:string,validated=true,checksum?:string):Owner305ReleaseQuery{return {query:async(sql:string)=>({rows:sql.startsWith("SELECT checksum")?(checksum?[{checksum}]:[]):[{definition:def,validated}]})} as Owner305ReleaseQuery;}
it("requires an exact validated support constraint and a recorded0144 before treating co-op as upgraded",async()=>{
 expect(await readBnaSupportSchemaStage(db(definition))).toBe(1);
 await expect(readBnaSupportSchemaStage(db(definition,false))).rejects.toThrow();
 await expect(readBnaSupportSchemaStage(db(definition.replace("bna_support_interest","anything")))).rejects.toThrow();
 await expect(readBnaCoopSchemaStage(db(definition))).rejects.toThrow();
 await expect(readBnaCoopSchemaStage(db(definition,true,"0".repeat(64)))).rejects.toThrow();
 expect(await readBnaCoopSchemaStage(db(definition,true,BNA_SUPPORT_MIGRATION.sha256))).toBe(1);
});
