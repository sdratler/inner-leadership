import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {inbound305SchemaPlan,INBOUND_305_MIGRATION} from "../../src/db/owner-305-inbound-schema-release.ts";
const files=(JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[]).map(f=>({name:f.name,checksum:f.sha256,sql:readFileSync("migrations/"+f.name,"utf8")}));
it("permits only 0145 after the exact accepted 0144 history",()=>{
 const index=files.findIndex(file=>file.name===INBOUND_305_MIGRATION.name),baseline=files.slice(0,index);
 expect(inbound305SchemaPlan(files,baseline,0).pending.map(f=>f.name)).toEqual([INBOUND_305_MIGRATION.name]);
 expect(inbound305SchemaPlan(files,files,1).pending).toEqual([]);
 expect(()=>inbound305SchemaPlan(files,baseline.slice(0,-1),0)).toThrow();
 expect(()=>inbound305SchemaPlan(files.map(f=>f.name===INBOUND_305_MIGRATION.name?{...f,checksum:"0".repeat(64)}:f),baseline,0)).toThrow();
 expect(()=>inbound305SchemaPlan(files,baseline,1)).toThrow();
});
