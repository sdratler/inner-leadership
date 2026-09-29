import {afterAll,expect,test} from "vitest";
import {fixture,type Fixture} from "../calendar/fixture.ts";
import {contactOutboundProjectionIntegrity} from "../../../src/db/contact-outbound-projection-integrity.ts";

const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});

test("exact private outbound ledger catalog, index, references and ACL are read back",async()=>{
 const f=await fixture();fixtures.push(f);
 const tx={query:async <R extends object>(sql:string,values:readonly unknown[]=[])=>
  (await f.pool.query<R>(sql,[...values])).rows};
 expect(await contactOutboundProjectionIntegrity(tx)).toEqual({objectsAbsent:false,table:true,
  schemaCatalog:true,foreignKeys:true,pendingIndex:true,permissions:true,referencesSound:true});
});

test("missing ledger is distinguishable from a valid applied schema",async()=>{
 const f=await fixture();fixtures.push(f);
 const client=await f.pool.connect();
 try{
  await client.query("BEGIN");await client.query("DROP TABLE ls_contact_ops.outbound_projections");
  const integrity=await contactOutboundProjectionIntegrity({query:async <R extends object>(sql:string,values:readonly unknown[]=[])=>
   (await client.query<R>(sql,[...values])).rows});
  expect(integrity.objectsAbsent).toBe(true);expect(integrity.table).toBe(false);expect(integrity.schemaCatalog).toBe(false);
 }finally{await client.query("ROLLBACK");client.release();}
});

test("an unreviewed pending-index or ACL change fails the exact readback",async()=>{
 const f=await fixture();fixtures.push(f);
 const client=await f.pool.connect();
 try{
  await client.query("BEGIN");await client.query("DROP INDEX ls_contact_ops.outbound_projections_pending");
  const integrity=await contactOutboundProjectionIntegrity({query:async <R extends object>(sql:string,values:readonly unknown[]=[])=>
   (await client.query<R>(sql,[...values])).rows});
  expect(integrity.pendingIndex).toBe(false);
 }finally{await client.query("ROLLBACK");client.release();}
});
