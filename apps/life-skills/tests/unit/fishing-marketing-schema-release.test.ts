import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {fishingMarketingSchemaPlan,FISHING_MARKETING_MIGRATION} from "../../src/db/fishing-marketing-schema-release.ts";
const files=(JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[]).map(f=>({name:f.name,checksum:f.sha256,sql:readFileSync("migrations/"+f.name,"utf8")}));
it("permits only0147 after the exact0146 history",()=>{
 const index=files.findIndex(f=>f.name===FISHING_MARKETING_MIGRATION.name),baseline=files.slice(0,index),complete=files.slice(0,index+1);
 expect(fishingMarketingSchemaPlan(files,baseline,0).pending.map(f=>f.name)).toEqual([FISHING_MARKETING_MIGRATION.name]);
 expect(fishingMarketingSchemaPlan(files,complete,1).pending).toEqual([]);
 expect(()=>fishingMarketingSchemaPlan(files,baseline.slice(0,-1),0)).toThrow();
 expect(()=>fishingMarketingSchemaPlan(files.map(f=>f.name===FISHING_MARKETING_MIGRATION.name?{...f,checksum:"0".repeat(64)}:f),baseline,0)).toThrow();
 expect(()=>fishingMarketingSchemaPlan(files,baseline,1)).toThrow();
});
