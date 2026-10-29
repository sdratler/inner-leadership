import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {bnaLeadSchemaPlan,BNA_LEAD_SCHEMA_MIGRATIONS} from "../../src/db/bna-lead-schema-release.ts";

const entries=JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];
const files=entries.map(entry=>({name:entry.name,checksum:entry.sha256,sql:readFileSync("migrations/"+entry.name,"utf8")}));
it("admits only the exact 0137 prefix followed by 0138 and 0139",()=>{
 const first=files.findIndex(file=>file.name===BNA_LEAD_SCHEMA_MIGRATIONS[0].name);
 const last=files.findIndex(file=>file.name===BNA_LEAD_SCHEMA_MIGRATIONS[1].name);
 const baseline=files.slice(0,first).map(file=>({name:file.name,checksum:file.checksum}));
 expect(bnaLeadSchemaPlan(files,baseline,0).pending.map(file=>file.name)).toEqual(BNA_LEAD_SCHEMA_MIGRATIONS.map(file=>file.name));
 expect(bnaLeadSchemaPlan(files,files.slice(0,last+1).map(file=>({name:file.name,checksum:file.checksum})),1).pending).toEqual([]);
 expect(()=>bnaLeadSchemaPlan(files,baseline,1)).toThrow("BNA_LEAD_SCHEMA_LEDGER_STATE_CONFLICT");
 expect(()=>bnaLeadSchemaPlan(files,baseline.slice(0,-1),0)).toThrow("BNA_LEAD_SCHEMA_LEDGER_STATE_CONFLICT");
 expect(()=>bnaLeadSchemaPlan(files.map(file=>file.name===BNA_LEAD_SCHEMA_MIGRATIONS[1].name?{...file,checksum:"a".repeat(64)}:file),baseline,0)).toThrow("BNA_LEAD_SCHEMA_SOURCE_MISMATCH");
});
