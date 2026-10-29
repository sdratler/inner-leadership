import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {BNA_EMAIL_MIGRATION,bnaEmailSchemaPlan,readBnaEmailSchemaStage} from "../../src/db/bna-email-schema-release.ts";
import type {Owner305ReleaseQuery} from "../../src/db/owner-305-schema-release.ts";
const files=(JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[]).map(file=>({name:file.name,checksum:file.sha256,sql:readFileSync("migrations/"+file.name,"utf8")}));
it("admits only the checksum-bound0146 after the complete0145 ledger and rejects schema/ledger disagreement",()=>{
 const index=files.findIndex(file=>file.name===BNA_EMAIL_MIGRATION.name),baseline=files.slice(0,index);
 expect(index).toBe(65);expect(bnaEmailSchemaPlan(files,baseline,0).pending.map(file=>file.name)).toEqual([BNA_EMAIL_MIGRATION.name]);
 expect(bnaEmailSchemaPlan(files,files,1).pending).toEqual([]);
 for(const [history,stage] of [[baseline,1],[files,0],[baseline.slice(0,-1),0]] as const)expect(()=>bnaEmailSchemaPlan(files,history,stage)).toThrow();
 for(const changed of [files.filter(file=>file.name!==BNA_EMAIL_MIGRATION.name),files.map((file,n)=>n===index-1?{...file,checksum:"0".repeat(64)}:file),files.map(file=>file.name===BNA_EMAIL_MIGRATION.name?{...file,checksum:"0".repeat(64)}:file)])expect(()=>bnaEmailSchemaPlan(changed,baseline,0)).toThrow();
});
it("rejects partial and orphaned native catalogs rather than treating them as a fresh baseline",async()=>{
 const fake=(relations:object,orphan=0)=>({query:async(sql:string)=>({rows:sql.startsWith("SELECT count")?[{n:orphan}]:[relations]})}) as Owner305ReleaseQuery;
 const absent={messages:null,delivery:null,events:null,programIndex:null};
 expect(await readBnaEmailSchemaStage(fake(absent))).toBe(0);
 await expect(readBnaEmailSchemaStage(fake(absent,1))).rejects.toThrow("BNA_EMAIL_SCHEMA_CATALOG_CONFLICT");
 await expect(readBnaEmailSchemaStage(fake({...absent,messages:"ls_service_interest.bna_email_messages"}))).rejects.toThrow("BNA_EMAIL_SCHEMA_CATALOG_CONFLICT");
});
