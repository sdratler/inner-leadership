import {afterAll,beforeAll,expect,test,vi} from "vitest";
import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture,safeTestUrl} from "../calendar/fixture.ts";
import pg from "pg";
import {seal} from "../../../src/features/identity/crypto.ts";
import {NativeCrmStore} from "../../../src/features/contact-ops/server/native-store.ts";

const fixtures:Fixture[]=[];
beforeAll(async()=>{
 const pool=new pg.Pool({connectionString:safeTestUrl(),max:1});
 try{
  // Explicit disposable fixture migrated by the retained manifest runner only.
  // Production operator admission and live recovery remain separate gates.
  const existence=await pool.query("SELECT to_regclass('ls_contact_ops.fishing_lead_revisions') AS revisions");
  if(existence.rows[0].revisions===null)throw Error("FISHING_SCHEMA_RUN_APPROVED_REGISTRY_FIRST");
  const bytes=await readFile(new URL("../../../migrations/0133_ls_fishing_lead_memberships.sql",import.meta.url));
  const ledger=await pool.query("SELECT checksum FROM ls_control.migrations WHERE name='0133_ls_fishing_lead_memberships.sql'");
  expect(ledger.rows).toEqual([{checksum:createHash('sha256').update(bytes).digest('hex')}]);
 }finally{await pool.end();}
});
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
async function setup(){
 const f=await fixture();fixtures.push(f);const personId=randomUUID();
 await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",
  [personId,f.workspaceId,seal(JSON.stringify({displayName:"Synthetic ordinary adult"}),`person:${f.workspaceId}:${personId}`,f.keyring),new Date()]);
 const crm=new NativeCrmStore(poolStore(f.pool),f.keyring,"synthetic-fishing-schema-integrity-20261014");
 await crm.create(f.practitioner.actor,{personId,stage:"Prospect",nextAction:"Preserve existing action",followUpDate:"2026-10-30",
  notes:"Preserve synthetic notes",legacyIds:[],doNotContact:true},"synthetic-profile:"+randomUUID());
 const program="sunday_fishing_academy",payload=seal(JSON.stringify({fixture:"schema-only"}),"synthetic-fishing-schema",f.keyring);
 const revision=(version:number,state="active",previous:number|null=version===1?null:version-1,workspace:string=f.workspaceId)=>
  f.pool.query(`INSERT INTO ls_contact_ops.fishing_lead_revisions
   (workspace_id,program_key,person_id,version,previous_version,state,recorded_by,payload_ciphertext)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[workspace,program,personId,version,previous,state,f.practitioner.actor.id,payload]);
 return {f,personId,program,payload,revision,crm};
}
test("candidate native schema retains consecutive Add/Remove/Restore revisions and original CRM",async()=>{
 const s=await setup(),before=await s.crm.read(s.f.practitioner.actor,s.personId);
 await s.revision(1);await s.revision(2,"removed");await s.revision(3);
 const rows=await s.f.pool.query("SELECT version,state FROM ls_contact_ops.fishing_lead_revisions WHERE workspace_id=$1 ORDER BY version",[s.f.workspaceId]);
 expect(rows.rows).toEqual([{version:1,state:"active"},{version:2,state:"removed"},{version:3,state:"active"}]);
 expect(await s.crm.read(s.f.practitioner.actor,s.personId)).toEqual(before);
});
test("NULL predecessor cannot escape a successor check",async()=>{
 const s=await setup();await s.revision(1);await expect(s.revision(2,"removed",null)).rejects.toMatchObject({code:"23514"});
});
test("gaps and duplicate successor/root versions deny",async()=>{
 const s=await setup();await s.revision(1);
 await expect(s.revision(3,"removed")).rejects.toMatchObject({code:"23503"});
 await expect(s.revision(1)).rejects.toMatchObject({code:"23505"});
});
test("a root tombstone and foreign-workspace person deny",async()=>{
 const s=await setup();await expect(s.revision(1,"removed")).rejects.toMatchObject({code:"23514"});
 await expect(s.revision(1,"active",null,randomUUID())).rejects.toMatchObject({code:"23503"});
});
test("stored native revisions cannot be edited or deleted",async()=>{
 const s=await setup();await s.revision(1);
 await expect(s.f.pool.query("UPDATE ls_contact_ops.fishing_lead_revisions SET state='removed' WHERE workspace_id=$1",[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
 await expect(s.f.pool.query("DELETE FROM ls_contact_ops.fishing_lead_revisions WHERE workspace_id=$1",[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
});
test("projection must reference exact native generation/state and agree with desired presence",async()=>{
 const s=await setup();await s.revision(1);await s.revision(2,"removed");
 const insert=(state:string,desired:boolean,generation=2)=>s.f.pool.query(`INSERT INTO ls_contact_ops.fishing_label_projection
  (workspace_id,program_key,person_id,generation,membership_state,desired_present,status,payload_ciphertext)
  VALUES($1,$2,$3,$4,$5,$6,'unconfigured',$7)`,[s.f.workspaceId,s.program,s.personId,generation,state,desired,s.payload]);
 await expect(insert("removed",true)).rejects.toMatchObject({code:"23514"});
 await expect(insert("active",true)).rejects.toMatchObject({code:"23503"});
 await expect(insert("removed",false,3)).rejects.toMatchObject({code:"23503"});
 await insert("removed",false);
});
test("immutable operation receipt remains attached to its historical revision",async()=>{
 const s=await setup();await s.revision(1);const operationId=randomUUID();
 await s.f.pool.query(`INSERT INTO ls_contact_ops.fishing_lead_operations
  (workspace_id,operation_id,actor_account_id,authority_epoch,program_key,person_id,result_version,payload_digest,result_ciphertext)
  VALUES($1,$2,$3,3,$4,$5,1,$6,$7)`,[s.f.workspaceId,operationId,s.f.practitioner.actor.id,s.program,s.personId,"a".repeat(64),s.payload]);
 await s.revision(2,"removed");
 await expect(s.f.pool.query("UPDATE ls_contact_ops.fishing_lead_operations SET result_version=2 WHERE workspace_id=$1",[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
 await expect(s.f.pool.query("DELETE FROM ls_contact_ops.fishing_lead_operations WHERE workspace_id=$1",[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
 expect((await s.f.pool.query("SELECT result_version FROM ls_contact_ops.fishing_lead_operations WHERE workspace_id=$1",[s.f.workspaceId])).rows).toEqual([{result_version:1}]);
});
test("native tables grant no PUBLIC privileges",async()=>{
 const s=await setup();const rows=await s.f.pool.query(`SELECT count(*)::int AS privileges FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace,
  LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE n.nspname='ls_contact_ops' AND c.relname IN ('fishing_lead_revisions','fishing_lead_operations','fishing_label_projection') AND a.grantee=0`);
 expect(rows.rows[0].privileges).toBe(0);
});
