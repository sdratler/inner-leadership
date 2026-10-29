import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {owner305Hash} from "../../src/db/owner-305-schema-release.ts";
import {OWNER_305_LINK_MIGRATION,owner305LinkSchemaPlan} from "../../src/db/owner-305-link-schema-release.ts";
const baseline=(JSON.parse(readFileSync("migrations/manifest.json","utf8")) as {name:string;sha256:string}[]).map(file=>({name:file.name,checksum:file.sha256,sql:readFileSync("migrations/"+file.name,"utf8")}));
const sql=readFileSync("migrations/proposals/0143_ls_owner_305_inquiry_links.sql","utf8"),proposal={name:OWNER_305_LINK_MIGRATION.name,checksum:owner305Hash(sql),sql};
it("admits only the reviewed link migration immediately after the co-op baseline",()=>{
 const files=[...baseline,proposal];expect(proposal.checksum).toBe(OWNER_305_LINK_MIGRATION.sha256);
 expect(owner305LinkSchemaPlan(files,baseline,0).pending.map(file=>file.name)).toEqual([proposal.name]);
 expect(owner305LinkSchemaPlan(files,files,1).pending).toEqual([]);
 expect(()=>owner305LinkSchemaPlan(files,baseline.slice(0,-1),0)).toThrow();
 expect(()=>owner305LinkSchemaPlan(files,baseline,1)).toThrow();
 expect(()=>owner305LinkSchemaPlan([...baseline,{...proposal,checksum:"0".repeat(64)}],baseline,0)).toThrow();
});
