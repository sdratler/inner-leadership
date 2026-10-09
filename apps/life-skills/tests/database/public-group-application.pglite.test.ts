import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {groupApplicationNotice,type GroupApplicationCommand} from "../../src/features/group-application/contract.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import {asId} from "../../src/lib/ids.ts";

const db=new PGlite(),workspaceId=asId(randomUUID(),"workspace"),now=new Date("2029-01-01T12:00:00Z"),ring={activeKeyId:"test",keys:{test:Buffer.alloc(32,9)}},key="synthetic-public-group-application-digest-key";
const identity:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>(await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const service=new PublicGroupApplicationStore(identity,workspaceId,ring,key,{now:()=>now});
const actors:Actor[]=[];
function command(overrides:Partial<GroupApplicationCommand["fields"]>={}):GroupApplicationCommand{return {operationId:randomUUID(),fields:{parentName:"Synthetic Parent",parentPhone:"+15550003000",language:"en",childAge:10,town:"Synthetic town",schedulePreference:"evening",interestedInEveningGroup:true,screenAccess:"shared_device",screenTime:"1_to_2_hours",observations:{intrinsicMotivation:"sometimes_difficult"},parentPriorities:"Synthetic practical priorities only.",permission:{confirmed:true,version:groupApplicationNotice.version,language:"en"},...overrides}};}
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0131_ls_public_group_applications.sql"]){const sql=await readFile("migrations/"+name,"utf8"),manifest=JSON.parse(await readFile("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];expect(createHash("sha256").update(sql).digest("hex")).toBe(manifest.find(row=>row.name===name)?.sha256);await db.exec(sql);}
 await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,now]);
 for(const role of ["practitioner","parent"] as const){const id=randomUUID(),digest=id.replaceAll("-","").padEnd(64,"0");await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspaceId,now]);await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspaceId,role,digest,now]);await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspaceId,id]);await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspaceId,id,now,new Date(now.getTime()+86400000)]);actors.push({id,workspaceId,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:now.getTime()+86400000} as Actor);}
},20000);
afterAll(async()=>db.close());
it("encrypts one public application, reads it only as practitioner, and creates no CRM, case, payment or message side effect",async()=>{
 const before=await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases");const input=command(),saved=await service.submit(input);
 expect(saved).toMatchObject({saved:true,replayed:false,duplicate:false,item:{source:"public_group_application",state:"owner_review",fields:input.fields}});
 expect(await service.list(actors[0]!)).toContainEqual(saved.item);await expect(service.list(actors[1]!)).rejects.toMatchObject({code:"FORBIDDEN"});
 const stored=await db.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1",[saved.item.id]);expect(stored.rows[0]!.payload_ciphertext).not.toContain(input.fields.parentPhone);expect(stored.rows[0]!.payload_ciphertext).not.toContain(input.fields.parentName);
 expect((await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases")).rows).toEqual(before.rows);
 const names=(await db.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='ls_service_interest' ORDER BY table_name")).rows.map(row=>row.table_name);
 expect(names).toEqual(["inquiries","operations","public_application_operations","public_applications"]);
});
it("replays exact operations, deduplicates exact new operations and preserves changed submissions for the same contact",async()=>{
 const input=command({parentPhone:"+15550003001"}),first=await service.submit(input),replay=await service.submit(input);expect(replay).toMatchObject({replayed:true,duplicate:true,item:{id:first.item.id}});
 await expect(service.submit({...input,fields:{...input.fields,childAge:11}})).rejects.toMatchObject({code:"CONFLICT"});
 const duplicate=await service.submit({...input,operationId:randomUUID()});expect(duplicate).toMatchObject({replayed:false,duplicate:true,item:{id:first.item.id}});
 expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE application_id=$1",[first.item.id])).rows[0]!.n).toBe(1);
 const changed=await service.submit(command({parentPhone:input.fields.parentPhone,childAge:11}));expect(changed.item.id).not.toBe(first.item.id);
 expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1",[workspaceId])).rows[0]!.n).toBeGreaterThanOrEqual(3);
});
it("bounds repeated distinct submissions per contact and keeps append-only evidence",async()=>{
 const phone="+15550003999",saved=[];for(let i=0;i<4;i++)saved.push(await service.submit(command({parentPhone:phone,childAge:6+i})));
 await expect(service.submit(command({parentPhone:phone,childAge:12}))).rejects.toMatchObject({code:"RATE_LIMITED"});
 await expect(db.query("UPDATE ls_service_interest.public_applications SET notice_language='he' WHERE id=$1",[saved[0]!.item.id])).rejects.toThrow("public_group_application_append_only");
 await expect(db.query("DELETE FROM ls_service_interest.public_application_operations WHERE application_id=$1",[saved[0]!.item.id])).rejects.toThrow("public_group_application_append_only");
});
