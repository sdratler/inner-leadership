import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {BnaInquiryStore} from "../../src/features/bna-inquiry/store.ts";
import {BNA_INQUIRY_NOTICE,bnaInquiryFieldsSchema} from "../../src/features/bna-inquiry/contract.ts";
import {asId} from "../../src/lib/ids.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";

const db=new PGlite(),ring={activeKeyId:"synthetic",keys:{synthetic:Buffer.alloc(32,7)}};
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const now=new Date("2026-10-28T12:00:00Z"),workspace=asId(randomUUID(),"workspace"),owner=randomUUID();
const store=new BnaInquiryStore(adapter,workspace,ring,"synthetic-bna-private-digest-key",owner,{now:()=>now});
const fields=bnaInquiryFieldsSchema.parse({name:"Synthetic Parent",contactChannel:"email",contact:"parent@example.invalid",
 language:"en",townOrZip:"Jerusalem",childAges:[9],permission:{confirmed:true,version:BNA_INQUIRY_NOTICE.version,language:"en"}});
const account=async(id:string,role:"practitioner"|"parent")=>{
 const digest=id.replaceAll("-","").padEnd(64,"0");
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspace,role,digest,now]);
 await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspace,id]);
 await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspace,id,now,new Date("2035-01-01")]);
 return {id,workspaceId:workspace,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:new Date("2035-01-01").getTime()} as Actor;
};
let ownerActor:Actor,otherActor:Actor;
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");
 for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql",
  "0131_ls_public_group_applications.sql","0139_ls_bna_inquiries.sql"])
  await db.exec(await readFile("migrations/"+name,"utf8"));
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspace,now]);
 ownerActor=await account(owner,"practitioner");otherActor=await account(randomUUID(),"parent");
},30000);
afterAll(async()=>db.close());
it("saves a BNA inquiry in the existing DB, replays exactly, and gives one owner durable follow-up readback",async()=>{
 const operationId=randomUUID(),saved=await store.submit({operationId,fields,attribution:{source:"bna_site"}});
 expect(saved).toMatchObject({saved:true,replayed:false});
 expect(await store.submit({operationId,fields,attribution:{source:"bna_site"}})).toEqual({...saved,replayed:true});
 await expect(store.submit({operationId,fields,attribution:{source:"different"}})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await store.list(ownerActor)).items).toHaveLength(1);
 await expect(store.list(otherActor)).rejects.toMatchObject({code:"NOT_FOUND"});
 const detail=await store.read(ownerActor,saved.reference);
 expect(detail).toMatchObject({program:"bna_torah_mornings",fields,followup:{version:1,status:"new",nextAction:"Review inquiry"}});
 const command={operationId:randomUUID(),inquiryId:saved.reference,expectedVersion:1,status:"waiting" as const,note:"Called parent; waiting for preferred time",nextAction:"Call again",dueDate:"2026-11-02",waitingCondition:"Parent availability"};
 expect(await store.followup(ownerActor,command)).toMatchObject({version:2,status:"waiting",replayed:false});
 expect(await store.followup(ownerActor,command)).toMatchObject({version:2,status:"waiting",replayed:true});
 await expect(store.followup(ownerActor,{...command,operationId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
 const read=await store.read(ownerActor,saved.reference);
 expect(read.followup).toMatchObject({version:2,note:command.note,nextAction:command.nextAction});
 expect(read.history.map(event=>event.version)).toEqual([2,1]);
 expect((await db.query("SELECT count(*)::int AS n FROM ls_service_interest.bna_inquiries")).rows).toEqual([{n:1}]);
 await expect(db.query("DELETE FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1",[workspace])).rejects.toThrow();
});
it("a new operation never reveals prior exact-content submissions through a reused reference",async()=>{
 const first=await store.submit({operationId:randomUUID(),fields,attribution:{source:"bna_site"}});
 const second=await store.submit({operationId:randomUUID(),fields,attribution:{source:"bna_site"}});
 expect(first.reference).not.toBe(second.reference);
 expect(first.replayed).toBe(false);expect(second.replayed).toBe(false);
});
