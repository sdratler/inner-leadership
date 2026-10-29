import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {OWNER_305_MIGRATION,owner305SchemaPlan} from "../../src/db/owner-305-schema-release.ts";

const entries=JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];
const files=entries.map(row=>({name:row.name,checksum:row.sha256,sql:readFileSync("migrations/"+row.name,"utf8")}));
it("releases 0141 only after the exact 0140 ledger and rejects a changed migration",()=>{
 const index=files.findIndex(file=>file.name===OWNER_305_MIGRATION.name);expect(index).toBeGreaterThan(0);
 const baseline=files.slice(0,index).map(file=>({name:file.name,checksum:file.checksum}));
 const through305=files.slice(0,index+1).map(file=>({name:file.name,checksum:file.checksum}));
 expect(owner305SchemaPlan(files,baseline,0).pending.map(file=>file.name)).toEqual([OWNER_305_MIGRATION.name]);
 expect(owner305SchemaPlan(files,through305,1).pending).toEqual([]);

 expect(()=>owner305SchemaPlan(files,baseline.slice(0,-1),0)).toThrow("OWNER_305_SCHEMA_LEDGER_STATE_CONFLICT");
 expect(()=>owner305SchemaPlan(files,baseline,1)).toThrow("OWNER_305_SCHEMA_LEDGER_STATE_CONFLICT");
 expect(()=>owner305SchemaPlan(files.map(file=>file.name===OWNER_305_MIGRATION.name?{...file,checksum:"a".repeat(64)}:file),baseline,0)).toThrow("OWNER_305_SCHEMA_SOURCE_MISMATCH");
});
