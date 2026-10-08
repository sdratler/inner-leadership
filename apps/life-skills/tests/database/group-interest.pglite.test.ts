import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {GroupInterestStore} from "../../src/features/group-interest/store.ts";
import {interestNotice,type InterestCommand} from "../../src/features/group-interest/contract.ts";
import {groupInterestHttp} from "../../src/features/group-interest/http.ts";
import {seal} from "../../src/features/identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";
const db=new PGlite(),now=new Date("2029-01-01T12:00:00Z");
const ring={activeKeyId:"test",keys:{test:Buffer.alloc(32,4)}};
const key="synthetic-only-group-interest-key-material";
const store:IdentityStore={transaction:work=>db.transaction(tx=>work({
 query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{const result=await tx.query<T>(sql,[...values]);return result.rows;}
} as SqlSession))};
const service=new GroupInterestStore(store,ring,key,{now:()=>now});
const actors:Actor[]=[];
const verified:{familyId:string;familyLabel:string;personId:string;personLabel:string;workspaceId:string}[]=[];
function command(overrides:Partial<InterestCommand["fields"]>={}):InterestCommand{return {operationId:randomUUID(),fields:{
 serviceType:"group",parentName:"Synthetic Parent",parentPhone:"+15550001000",language:"en",
 childLabel:"Synthetic Child",childAge:10,area:"Synthetic area",availability:"Sunday afternoon",groupPreference:"Small activity group",
 permission:{confirmed:true,version:interestNotice.version,language:"en",source:"spoken"},...overrides
}};}
const promote=(inquiryId:string,member=verified[0]!,serviceType:"group"|"tutoring"="group",operationId=randomUUID())=>({
 action:"record_service_interest" as const,operationId,inquiryId,familyId:member.familyId,personId:member.personId,serviceType,
});
beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");
 for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql"])await db.exec(await readFile("migrations/"+name,"utf8"));
 const migrations=await Promise.all(["0124_ls_group_interest.sql","0127_ls_service_interests.sql"].map(async name=>({name,sql:await readFile("migrations/"+name,"utf8")})));
 const manifest=JSON.parse(await readFile("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];
 for(const migration of migrations){expect(createHash("sha256").update(migration.sql).digest("hex")).toBe(manifest.find(row=>row.name===migration.name)?.sha256);await db.exec(migration.sql);}
 for(const role of ["practitioner","parent","practitioner"] as const){
  const id=randomUUID(),workspaceId=role==="parent"?actors[0]!.workspaceId:randomUUID();
  if(role!=="parent")await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,now]);
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspaceId,now]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspaceId,role,id.replaceAll("-","").padEnd(64,"0"),now]);
  await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspaceId,id]);
  const digest=id.replaceAll("-","").padEnd(64,"0");
  await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspaceId,id,now,new Date(now.getTime()+86400000)]);
  actors.push({id,workspaceId,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:now.getTime()+86400000} as Actor);
 }
 for(const [workspaceId,count] of [[actors[0]!.workspaceId,2],[actors[2]!.workspaceId,1]] as const){
  const familyId=randomUUID(),familyLabel=workspaceId===actors[0]!.workspaceId?"Synthetic verified family":"Other workspace family";
  await db.query("INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)",
   [familyId,workspaceId,seal(familyLabel,`family:${workspaceId}:${familyId}`,ring),now]);
  for(let index=0;index<count;index++){
   const personId=randomUUID(),personLabel=`Synthetic verified child ${verified.length+1}`;
   await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor',$3,$4)",
    [personId,workspaceId,seal(JSON.stringify({displayName:personLabel}),`person:${workspaceId}:${personId}`,ring),now]);
   await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspaceId,familyId,personId]);
   verified.push({familyId,familyLabel,personId,personLabel,workspaceId});
  }
 }
 await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'parent')",
  [actors[0]!.workspaceId,verified[0]!.familyId,actors[0]!.personId]);
},20000);
afterAll(async()=>{await db.close();});
it("saves exact native inquiry, encrypted, reads back and creates no identity/clinical/billing side effect",async()=>{
 const before=await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_identity.accounts) AS accounts,(SELECT count(*) FROM ls_cases.cases) AS cases");
 const input=command(),result=await service.create(actors[0]!,input);
 expect(result).toMatchObject({saved:true,replayed:false,duplicate:false,item:{state:"interest",source:"owner_entered",fields:input.fields}});
 expect((await service.list(actors[0]!)).items).toContainEqual(result.item);
 const stored=await db.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_service_interest.inquiries WHERE id=$1",[result.item.id]);
 expect(stored.rows[0]!.payload_ciphertext).not.toContain(input.fields.parentPhone);
 expect(stored.rows[0]!.payload_ciphertext).not.toContain(input.fields.childLabel);
 const after=await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_identity.accounts) AS accounts,(SELECT count(*) FROM ls_cases.cases) AS cases");
 expect(after.rows).toEqual(before.rows);
 expect(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='ls_service_interest'")).toMatchObject({rows:expect.arrayContaining([{table_name:"inquiries"},{table_name:"operations"}])});
});
it("replays exact operations, binds changed payloads, and deduplicates identical submissions with new operation IDs",async()=>{
 const actor=actors[0]!,input=command({childLabel:"Retry synthetic"}),first=await service.create(actor,input);
 const results=await Promise.all(Array.from({length:5},()=>service.create(actor,input)));
 expect(results.every(r=>r.replayed&&r.item.id===first.item.id)).toBe(true);
 await expect(service.create(actor,{...input,fields:{...input.fields,childAge:11}})).rejects.toMatchObject({code:"CONFLICT"});
 const duplicate={...input,operationId:randomUUID()},next=await service.create(actor,duplicate);
 expect(next).toMatchObject({duplicate:true,replayed:false,item:{id:first.item.id}});
 await expect(service.create(actor,{...duplicate,fields:{...input.fields,parentName:"Changed"}})).rejects.toMatchObject({code:"CONFLICT"});
});
it("database constraints bind every replay receipt to the referenced inquiry digest",async()=>{
 const actor=actors[0]!,first=await service.create(actor,command({childLabel:"Digest A"})),second=await service.create(actor,command({childLabel:"Digest B"}));
 const rows=await db.query<{id:string;request_digest:string}>("SELECT id,request_digest FROM ls_service_interest.inquiries WHERE id=ANY($1::uuid[]) ORDER BY id",[[first.item.id,second.item.id]]);
 const a=rows.rows.find(row=>row.id===first.item.id)!,b=rows.rows.find(row=>row.id===second.item.id)!;
 await expect(db.query(`INSERT INTO ls_service_interest.operations(workspace_id,operation_id,recorded_by,request_digest,inquiry_id)
  VALUES($1,$2,$3,$4,$5)`,[actor.workspaceId,randomUUID(),actor.id,b.request_digest,a.id])).rejects.toThrow();
});
it("denies parent role, cross-workspace disclosure and revoked sessions",async()=>{
 await expect(service.list(actors[1]!)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(service.create(actors[1]!,command())).rejects.toMatchObject({code:"FORBIDDEN"});
 expect((await service.list(actors[2]!)).items).toEqual([]);
 const changedWorkspace={...actors[0]!,workspaceId:actors[2]!.workspaceId};
 await expect(service.list(changedWorkspace)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 await db.query("UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1",[actors[2]!.sessionDigest,now]);
 await expect(service.create(actors[2]!,command())).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
it("requires current narrow permission and rejects clinical/payment/identity fields",async()=>{
 const actor=actors[0]!,input=command();
 for(const fields of [{...input.fields,permission:{...input.fields.permission,confirmed:false}},
  {...input.fields,permission:{...input.fields.permission,version:"stale"}},
  {...input.fields,clinicalHistory:"must not be accepted"},{...input.fields,price:550},
  {...input.fields,caseId:randomUUID()},{...input.fields,childAge:18},{...input.fields,parentPhone:"0501234567"}]){
  await expect(service.create(actor,{...input,fields} as InterestCommand)).rejects.toMatchObject({code:"INVALID_REQUEST"});
 }
});
it("records separate group and tutoring interests for explicitly selected verified children and reopens them",async()=>{
 const actor=actors[0]!,groupInquiry=await service.create(actor,command({serviceType:"group",childLabel:"Inquiry label is not identity"})),
  tutoringInquiry=await service.create(actor,command({serviceType:"tutoring",childLabel:"Another non-identity label"}));
 const before=await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.families) AS families,(SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_cases.engagements) AS engagements");
 const group=await service.createServiceInterest(actor,promote(groupInquiry.item.id,verified[0]!,"group"));
 const tutoring=await service.createServiceInterest(actor,promote(tutoringInquiry.item.id,verified[1]!,"tutoring"));
 expect(group).toMatchObject({saved:true,replayed:false,duplicate:false,item:{state:"service_interest",serviceType:"group",
  familyId:verified[0]!.familyId,personId:verified[0]!.personId,personLabel:verified[0]!.personLabel}});
 expect(tutoring.item).toMatchObject({serviceType:"tutoring",familyId:verified[1]!.familyId,personId:verified[1]!.personId});
 const reopened=await service.list(actor);expect(reopened.members).toEqual(expect.arrayContaining(verified.slice(0,2).map(({familyId,familyLabel,personId,personLabel})=>({familyId,familyLabel,personId,personLabel}))));
 expect(reopened.serviceInterests).toEqual(expect.arrayContaining([group.item,tutoring.item]));
 expect((await db.query("SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.families) AS families,(SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_cases.engagements) AS engagements")).rows).toEqual(before.rows);
});
it("requires two explicit operations for a both inquiry and never creates a combined service row",async()=>{
 const actor=actors[0]!,inquiry=await service.create(actor,command({serviceType:"group_and_tutoring",childLabel:"Both explicit actions"}));
 const group=await service.createServiceInterest(actor,promote(inquiry.item.id,verified[0]!,"group"));
 expect((await service.list(actor)).serviceInterests.filter(row=>row.sourceInquiryId===inquiry.item.id)).toEqual([group.item]);
 const tutoring=await service.createServiceInterest(actor,promote(inquiry.item.id,verified[0]!,"tutoring"));
 expect(tutoring.item.id).not.toBe(group.item.id);
 expect((await service.list(actor)).serviceInterests.filter(row=>row.sourceInquiryId===inquiry.item.id).map(row=>row.serviceType).sort()).toEqual(["group","tutoring"]);
 expect(await db.query("SELECT service_type FROM ls_service_interest.service_interests WHERE source_inquiry_id=$1 ORDER BY service_type",[inquiry.item.id])).toMatchObject({rows:[{service_type:"group"},{service_type:"tutoring"}]});
});
it("rejects identity inference, wrong workspace, adult membership and a service the inquiry did not permit",async()=>{
 const actor=actors[0]!,inquiry=await service.create(actor,command({serviceType:"group",parentPhone:"+15550009999",childLabel:verified[2]!.personLabel}));
 await expect(service.createServiceInterest(actor,promote(inquiry.item.id,verified[0]!,"tutoring"))).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(service.createServiceInterest(actor,promote(inquiry.item.id,verified[2]!,"group"))).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(service.createServiceInterest(actor,{...promote(inquiry.item.id,verified[0]!,"group"),familyId:verified[1]!.familyId,personId:actors[0]!.personId!})).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await service.list(actor)).serviceInterests.filter(row=>row.sourceInquiryId===inquiry.item.id)).toEqual([]);
});
it("replays one exact promotion, conflicts on changed identity and deduplicates a new exact operation",async()=>{
 const actor=actors[0]!,inquiry=await service.create(actor,command({serviceType:"group",childLabel:"Replay promotion"})),input=promote(inquiry.item.id,verified[0]!,"group"),first=await service.createServiceInterest(actor,input);
 const replay=await Promise.all(Array.from({length:4},()=>service.createServiceInterest(actor,input)));expect(replay.every(row=>row.replayed&&row.item.id===first.item.id)).toBe(true);
 await expect(service.createServiceInterest(actor,{...input,personId:verified[1]!.personId})).rejects.toMatchObject({code:"CONFLICT"});
 const duplicate=await service.createServiceInterest(actor,{...input,operationId:randomUUID()});expect(duplicate).toMatchObject({replayed:false,duplicate:true,item:{id:first.item.id}});
 expect((await db.query("SELECT count(*)::int AS count FROM ls_service_interest.service_interests WHERE source_inquiry_id=$1",[inquiry.item.id])).rows).toEqual([{count:1}]);
});
it("keeps service-interest provenance immutable and creates none of the dependent group/service effects",async()=>{
 const actor=actors[0]!,inquiry=await service.create(actor,command({serviceType:"group",childLabel:"Immutable provenance"})),saved=await service.createServiceInterest(actor,promote(inquiry.item.id,verified[0]!,"group"));
 await expect(db.query("UPDATE ls_service_interest.service_interests SET service_type='tutoring' WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,saved.item.id])).rejects.toThrow();
 await expect(db.query("DELETE FROM ls_service_interest.service_interest_operations WHERE workspace_id=$1 AND service_interest_id=$2",[actor.workspaceId,saved.item.id])).rejects.toThrow();
 await expect(db.query("UPDATE ls_cases.family_members SET role='guardian' WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3",[actor.workspaceId,saved.item.familyId,saved.item.personId])).rejects.toThrow();
 await expect(db.query("UPDATE ls_identity.people SET kind='adult' WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,saved.item.personId])).rejects.toThrow();
 expect(await db.query("SELECT member_role,person_kind FROM ls_service_interest.service_interests WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,saved.item.id])).toMatchObject({rows:[{member_role:"child",person_kind:"minor"}]});
 const names=(await db.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='ls_service_interest' ORDER BY table_name")).rows.map(row=>row.table_name);
 expect(names).toEqual(["inquiries","operations","service_interest_operations","service_interests"]);
 expect(names.some(name=>/placement|enrollment|billing|schedule|attendance|message/.test(name))).toBe(false);
});
it("HTTP is disabled by default, protects role/origin/CSRF, and returns persisted native readback",async()=>{
 const token="a".repeat(43),csrf="b".repeat(43),origin="https://synthetic.example.invalid";
 const load=async()=>({enabled:true,origin,actor:async()=>actors[0]!,csrf:()=>csrf,store:service});
 const url=origin+"/api/private/group-interest",headers={cookie:"__Host-ls-session="+token,origin,"content-type":"application/json","x-forwarded-proto":"https","x-forwarded-host":"synthetic.example.invalid"};
 const payload=JSON.stringify(command({serviceType:"group_and_tutoring",childLabel:"HTTP synthetic"}));
 expect((await groupInterestHttp(new Request(url),async()=>({...await load(),enabled:false}))).status).toBe(404);
 expect((await groupInterestHttp(new Request(url,{method:"POST",headers,body:payload}),load)).status).toBe(403);
 expect((await groupInterestHttp(new Request(url,{method:"POST",headers:{...headers,origin:"https://attacker.invalid","x-csrf-token":csrf},body:payload}),load)).status).toBe(403);
 const saved=await groupInterestHttp(new Request(url,{method:"POST",headers:{...headers,"x-csrf-token":csrf},body:payload}),load);
 const savedBody=await saved.json();expect(saved.status).toBe(200);expect(savedBody).toMatchObject({ok:true,data:{saved:true,item:{fields:{serviceType:"group_and_tutoring"}}}});
 const read=await groupInterestHttp(new Request(url,{headers}),load);expect(read.headers.get("cache-control")).toBe("private, no-store");
 const readBody=await read.json();expect(readBody).toMatchObject({ok:true,data:{notice:interestNotice,members:expect.arrayContaining([expect.objectContaining({personId:verified[0]!.personId})]),items:expect.arrayContaining([expect.objectContaining({fields:expect.objectContaining({childLabel:"HTTP synthetic"})})])}});
 const promotion=promote(savedBody.data.item.id,verified[0]!,"group"),promoted=await groupInterestHttp(new Request(url,{method:"POST",headers:{...headers,"x-csrf-token":csrf},body:JSON.stringify(promotion)}),load);
 expect(promoted.status).toBe(200);expect(await promoted.json()).toMatchObject({ok:true,data:{saved:true,item:{sourceInquiryId:savedBody.data.item.id,personId:verified[0]!.personId,serviceType:"group"}}});
 const after=await groupInterestHttp(new Request(url,{headers}),load);expect(await after.json()).toMatchObject({ok:true,data:{serviceInterests:expect.arrayContaining([expect.objectContaining({sourceInquiryId:savedBody.data.item.id})])}});
});
