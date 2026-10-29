import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {bnaPreferencesSchemaPlan,BNA_PREFERENCES_MIGRATION} from "../../src/db/bna-preferences-schema-release.ts";
const manifest=JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];
const files=manifest.map(row=>({name:row.name,checksum:row.sha256,sql:readFileSync("migrations/"+row.name,"utf8")}));
it("preserves the accepted67-entry prefix and admits only0148 after exact0147",()=>{
 expect(createHash("sha256").update(JSON.stringify(manifest.slice(0,67))).digest("hex")).toBe("94fab901bd942ef1a55afb46c1105fe65955565f6012a26362334ee71160fa86");
 const index=files.findIndex(file=>file.name===BNA_PREFERENCES_MIGRATION.name);expect(index).toBe(67);
 const before=files.slice(0,index),complete=files.slice(0,index+1);
 expect(bnaPreferencesSchemaPlan(files,before,0).pending.map(file=>file.name)).toEqual([BNA_PREFERENCES_MIGRATION.name]);
 expect(bnaPreferencesSchemaPlan(files,complete,1).pending).toEqual([]);
 expect(()=>bnaPreferencesSchemaPlan(files,before,1)).toThrow();
 expect(()=>bnaPreferencesSchemaPlan(files,before.slice(0,-1),0)).toThrow();
 expect(()=>bnaPreferencesSchemaPlan(files.map(file=>file.name===BNA_PREFERENCES_MIGRATION.name?{...file,checksum:"0".repeat(64)}:file),before,0)).toThrow();
 const later={name:"0149_future.sql",checksum:"e".repeat(64),sql:"SELECT 1;"};
 expect(bnaPreferencesSchemaPlan([...files,later],[...files,later],1).pending).toEqual([]);
 expect(()=>bnaPreferencesSchemaPlan([...files,later],[...files,{...later,checksum:"a".repeat(64)}],1)).toThrow();
});
