import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {bnaCoopSchemaPlan,BNA_COOP_MIGRATION} from "../../src/db/bna-coop-schema-release.ts";
const files=(JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[]).map(f=>({name:f.name,checksum:f.sha256,sql:readFileSync("migrations/"+f.name,"utf8")}));
it("admits only the exact co-op migration after the 0141 ledger",()=>{
 expect(bnaCoopSchemaPlan(files,files.slice(0,-1),0).pending.map(f=>f.name)).toEqual([BNA_COOP_MIGRATION.name]);
 expect(bnaCoopSchemaPlan(files,files,1).pending).toEqual([]);
 expect(()=>bnaCoopSchemaPlan(files,files.slice(0,-2),0)).toThrow();
 expect(()=>bnaCoopSchemaPlan(files.map(f=>f.name===BNA_COOP_MIGRATION.name?{...f,checksum:"0".repeat(64)}:f),files.slice(0,-1),0)).toThrow();
 expect(()=>bnaCoopSchemaPlan(files,files.slice(0,-1),1)).toThrow();
});
