import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {owner305Hash} from "../../src/db/owner-305-schema-release.ts";
import {OWNER_305_LINK_MIGRATION,owner305LinkSchemaPlan} from "../../src/db/owner-305-link-schema-release.ts";
const inventory=(JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[]).map(file=>({name:file.name,checksum:file.sha256,sql:readFileSync("migrations/"+file.name,"utf8")}));
const baseline=inventory.filter(file=>file.name<OWNER_305_LINK_MIGRATION.name);
const sql=readFileSync("migrations/0143_ls_owner_305_inquiry_links.sql","utf8"),proposal={name:OWNER_305_LINK_MIGRATION.name,checksum:owner305Hash(sql),sql};
it("admits only the reviewed link migration immediately after the co-op baseline",()=>{
 const files=[...baseline,proposal];expect(proposal.checksum).toBe(OWNER_305_LINK_MIGRATION.sha256);
 expect(owner305LinkSchemaPlan(files,baseline,0).pending.map(file=>file.name)).toEqual([proposal.name]);
 expect(owner305LinkSchemaPlan(files,files,1).pending).toEqual([]);
 expect(()=>owner305LinkSchemaPlan(files,baseline.slice(0,-1),0)).toThrow();
 expect(()=>owner305LinkSchemaPlan(files,baseline,1)).toThrow();
 expect(()=>owner305LinkSchemaPlan([...baseline,{...proposal,checksum:"0".repeat(64)}],baseline,0)).toThrow();
});
it("verifies the link schema after a valid later migration without accepting divergent history",()=>{
 const later={name:"0145_example.sql",checksum:"a".repeat(64),sql:"SELECT 1;"};
 const files=[...inventory,later];
 expect(owner305LinkSchemaPlan(files,files,1).pending).toEqual([]);
 expect(()=>owner305LinkSchemaPlan(files,[...inventory,{...later,checksum:"b".repeat(64)}],1)).toThrow();
});
