import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {GroupInterestStore} from "../../src/features/group-interest/store.ts";
import {interestNotice,type InterestCommand} from "../../src/features/group-interest/contract.ts";
import {GroupPlacementStore} from "../../src/features/group-placement/store.ts";
import {groupPlacementHttp} from "../../src/features/group-placement/http.ts";
import {seal} from "../../src/features/identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../../src/features/identity/store.ts";
import type {Actor} from "../../src/features/identity/types.ts";

const db=new PGlite(),now=new Date("2029-02-01T12:00:00Z"),ring={activeKeyId:"test",keys:{test:Buffer.alloc(32,7)}},key="synthetic-group-placement-key-material";
const store:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
 const result=await tx.query<T>(sql,[...values]);return result.rows;
}} as SqlSession))};
const interestStore=new GroupInterestStore(store,ring,key,{now:()=>now}),placementStore=new GroupPlacementStore(store,ring,key,{now:()=>now});
const actors:Actor[]=[],members:{familyId:string;personId:string;workspaceId:string}[]=[];
let inquirySequence=0;
function inquiry(serviceType:InterestCommand["fields"]["serviceType"]="group"):InterestCommand{const sequence=++inquirySequence;return {operationId:randomUUID(),fields:{serviceType,
 parentName:`Synthetic Parent ${sequence}`,parentPhone:`+1555000${String(sequence).padStart(4,"0")}`,language:"en",childLabel:`Synthetic Child ${sequence}`,childAge:10,area:"",availability:"",groupPreference:"",
 permission:{confirmed:true,version:interestNotice.version,language:"en",source:"written"}}};}

beforeAll(async()=>{
 await db.exec("CREATE SCHEMA ls_control");for(const name of ["0001_ls_foundation.sql","0010_ls_identity_cases_20260906.sql","0124_ls_group_interest.sql","0127_ls_service_interests.sql","0128_ls_draft_group_placements.sql","0129_ls_proposed_placement_moves.sql"]){
  const sql=await readFile("migrations/"+name,"utf8"),manifest=JSON.parse(await readFile("migrations/manifest.json","utf8")) as {name:string;sha256:string}[];
  expect(createHash("sha256").update(sql).digest("hex")).toBe(manifest.find(row=>row.name===name)?.sha256);await db.exec(sql);
 }
 for(const role of ["practitioner","parent","practitioner"] as const){const id=randomUUID(),workspaceId=role==="parent"?actors[0]!.workspaceId:randomUUID();
  if(role!=="parent")await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,now]);
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspaceId,now]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspaceId,role,id.replaceAll("-","").padEnd(64,"0"),now]);
  await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)",[workspaceId,id]);
  const digest=id.replaceAll("-","").padEnd(64,"0");await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[digest,workspaceId,id,now,new Date(now.getTime()+86400000)]);
  actors.push({id,workspaceId,personId:id,role,state:"active",locale:"en",sessionDigest:digest,expiresAt:now.getTime()+86400000} as Actor);
 }
 for(const actor of [actors[0]!,actors[2]!]){const familyId=randomUUID(),personId=randomUUID();
  await db.query("INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)",[familyId,actor.workspaceId,seal("Synthetic family",`family:${actor.workspaceId}:${familyId}`,ring),now]);
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor',$3,$4)",[personId,actor.workspaceId,seal(JSON.stringify({displayName:"Synthetic child"}),`person:${actor.workspaceId}:${personId}`,ring),now]);
  await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[actor.workspaceId,familyId,personId]);members.push({familyId,personId,workspaceId:actor.workspaceId});
 }
},20000);
afterAll(async()=>{await db.close();});

async function serviceInterest(actor=actors[0]!,serviceType:"group"|"tutoring"="group"){
 const source=await interestStore.create(actor,inquiry(serviceType));return interestStore.createServiceInterest(actor,{action:"record_service_interest",operationId:randomUUID(),inquiryId:source.item.id,
  familyId:members[actor===actors[0]?0:1]!.familyId,personId:members[actor===actors[0]?0:1]!.personId,serviceType});
}

it("creates an encrypted draft group, saves and reopens only unset administrative planning",async()=>{
 const before=(await db.query("SELECT (SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_cases.engagements) AS engagements,(SELECT count(*) FROM ls_identity.accounts) AS accounts")).rows;
 const input={action:"create_draft_group" as const,operationId:randomUUID(),label:"Synthetic north group"},saved=await placementStore.createDraftGroup(actors[0]!,input);
 expect(saved).toMatchObject({saved:true,replayed:false,item:{state:"draft_group",label:input.label}});
 expect((await placementStore.list(actors[0]!)).draftGroups).toContainEqual(saved.item);
 const stored=await db.query<{label_ciphertext:string}>("SELECT label_ciphertext FROM ls_group_admin.draft_groups WHERE id=$1",[saved.item.id]);expect(stored.rows[0]!.label_ciphertext).not.toContain(input.label);
 const columns=(await db.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='ls_group_admin' AND table_name='draft_groups' ORDER BY ordinal_position")).rows.map(row=>row.column_name);
 expect(columns).toEqual(["workspace_id","id","label_ciphertext","recorded_by","request_digest","created_at"]);
 expect((await db.query("SELECT (SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_cases.engagements) AS engagements,(SELECT count(*) FROM ls_identity.accounts) AS accounts")).rows).toEqual(before);
});

it("proposes one exact GROUP interest, reads it back, and keeps all states separate",async()=>{
 const actor=actors[0]!,group=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"Synthetic proposal group"}),interest=await serviceInterest();
 const saved=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:group.item.id,serviceInterestId:interest.item.id});
 expect(saved).toMatchObject({saved:true,replayed:false,duplicate:false,item:{state:"proposed_placement",draftGroupId:group.item.id,serviceInterestId:interest.item.id,
  familyId:interest.item.familyId,personId:interest.item.personId}});
 const reopened=await placementStore.list(actor);expect(reopened.proposedPlacements).toContainEqual(saved.item);expect(reopened.eligibleGroupInterests).toContainEqual(expect.objectContaining({id:interest.item.id,state:"service_interest",serviceType:"group"}));
 expect((await db.query("SELECT state FROM ls_cases.engagements WHERE workspace_id=$1",[actor.workspaceId])).rows).toEqual([]);
 const names=(await db.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='ls_group_admin' ORDER BY table_name")).rows.map(row=>row.table_name);
 expect(names).toEqual(["draft_group_operations","draft_groups","proposed_placement_move_operations","proposed_placement_moves","proposed_placement_operations","proposed_placements"]);
 expect(names.some(name=>/trial|enrollment|schedule|attendance|payment|message/.test(name))).toBe(false);
});

it("replays exact operations, conflicts on changed payloads, and deduplicates the same group/interest proposal",async()=>{
 const actor=actors[0]!,draftInput={action:"create_draft_group" as const,operationId:randomUUID(),label:"Replay draft"},group=await placementStore.createDraftGroup(actor,draftInput);
 const replay=await Promise.all(Array.from({length:4},()=>placementStore.createDraftGroup(actor,draftInput)));expect(replay.every(row=>row.replayed&&row.item.id===group.item.id)).toBe(true);
 await expect(placementStore.createDraftGroup(actor,{...draftInput,label:"Changed"})).rejects.toMatchObject({code:"CONFLICT"});
 const interest=await serviceInterest(),input={action:"propose_group_placement" as const,operationId:randomUUID(),draftGroupId:group.item.id,serviceInterestId:interest.item.id},first=await placementStore.proposePlacement(actor,input);
 const placementReplay=await Promise.all(Array.from({length:4},()=>placementStore.proposePlacement(actor,input)));expect(placementReplay.every(row=>row.replayed&&row.item.id===first.item.id)).toBe(true);
 await expect(placementStore.proposePlacement(actor,{...input,draftGroupId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
 const duplicate=await placementStore.proposePlacement(actor,{...input,operationId:randomUUID()});expect(duplicate).toMatchObject({replayed:false,duplicate:true,item:{id:first.item.id}});
 expect((await db.query("SELECT count(*)::int AS count FROM ls_group_admin.proposed_placements WHERE draft_group_id=$1 AND service_interest_id=$2",[group.item.id,interest.item.id])).rows).toEqual([{count:1}]);
});

it("moves only a current proposal into unused groups and preserves immutable A→B→C history",async()=>{
 const actor=actors[0]!,before=(await db.query("SELECT (SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_cases.engagements) AS engagements,(SELECT count(*) FROM ls_identity.accounts) AS accounts")).rows;
 const groups=[];for(const label of ["Move A","Move B","Move C"]){groups.push(await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label}));}
 const interest=await serviceInterest(),source=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:groups[0]!.item.id,serviceInterestId:interest.item.id});
 const firstInput={action:"move_group_placement" as const,operationId:randomUUID(),sourceProposedPlacementId:source.item.id,destinationDraftGroupId:groups[1]!.item.id};
 const first=await placementStore.movePlacement(actor,firstInput);expect(first).toMatchObject({saved:true,replayed:false,item:{draftGroupId:groups[1]!.item.id,serviceInterestId:interest.item.id,proposalStatus:"current",movedFromProposalId:source.item.id},movement:{sourceProposedPlacementId:source.item.id,destinationProposedPlacementId:first.item.id}});
 const replay=await placementStore.movePlacement(actor,firstInput);expect(replay).toMatchObject({saved:true,replayed:true,item:{id:first.item.id},movement:{id:first.movement.id}});
 await expect(placementStore.movePlacement(actor,{...firstInput,destinationDraftGroupId:groups[2]!.item.id})).rejects.toMatchObject({code:"CONFLICT"});
 await expect(placementStore.movePlacement(actor,{...firstInput,operationId:randomUUID(),destinationDraftGroupId:groups[2]!.item.id})).rejects.toMatchObject({code:"CONFLICT"});
 const second=await placementStore.movePlacement(actor,{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:first.item.id,destinationDraftGroupId:groups[2]!.item.id});
 expect(second).toMatchObject({saved:true,replayed:false,item:{draftGroupId:groups[2]!.item.id,proposalStatus:"current",movedFromProposalId:first.item.id}});
 const failedCounts=await db.query<{moves:number;operations:number}>("SELECT (SELECT count(*)::int FROM ls_group_admin.proposed_placement_moves WHERE service_interest_id=$1) AS moves,(SELECT count(*)::int FROM ls_group_admin.proposed_placement_move_operations WHERE workspace_id=$2) AS operations",[interest.item.id,actor.workspaceId]);
 await expect(placementStore.movePlacement(actor,{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:second.item.id,destinationDraftGroupId:groups[0]!.item.id})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await db.query<{moves:number;operations:number}>("SELECT (SELECT count(*)::int FROM ls_group_admin.proposed_placement_moves WHERE service_interest_id=$1) AS moves,(SELECT count(*)::int FROM ls_group_admin.proposed_placement_move_operations WHERE workspace_id=$2) AS operations",[interest.item.id,actor.workspaceId])).rows).toEqual(failedCounts.rows);
 const listed=await placementStore.list(actor),chain=listed.proposedPlacements.filter(row=>row.serviceInterestId===interest.item.id);
 expect(chain).toHaveLength(3);expect(chain.find(row=>row.id===source.item.id)).toMatchObject({proposalStatus:"moved",movedFromProposalId:null,movedToProposalId:first.item.id});
 expect(chain.find(row=>row.id===first.item.id)).toMatchObject({proposalStatus:"moved",movedFromProposalId:source.item.id,movedToProposalId:second.item.id});
 expect(chain.find(row=>row.id===second.item.id)).toMatchObject({proposalStatus:"current",movedFromProposalId:first.item.id,movedToProposalId:null});
 expect(listed.proposalMovements.filter(row=>row.serviceInterestId===interest.item.id).map(row=>[row.sourceProposedPlacementId,row.destinationProposedPlacementId])).toEqual([[source.item.id,first.item.id],[first.item.id,second.item.id]]);
 await expect(db.query("UPDATE ls_group_admin.proposed_placement_moves SET recorded_by=$1 WHERE workspace_id=$2 AND id=$3",[actors[1]!.id,actor.workspaceId,first.movement.id])).rejects.toThrow();
 await expect(db.query("DELETE FROM ls_group_admin.proposed_placement_move_operations WHERE workspace_id=$1 AND proposed_placement_move_id=$2",[actor.workspaceId,first.movement.id])).rejects.toThrow();
 expect((await db.query("SELECT (SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_cases.engagements) AS engagements,(SELECT count(*) FROM ls_identity.accounts) AS accounts")).rows).toEqual(before);
});

it("preserves ordinary proposal reuse in both proposal/move serialization orders",async()=>{
 const actor=actors[0]!;
 const firstInterest=await serviceInterest(),firstA=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"Ordinary first A"}),firstB=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"Ordinary first B"});
 const firstSource=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:firstA.item.id,serviceInterestId:firstInterest.item.id});
 const ordinaryFirst=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:firstB.item.id,serviceInterestId:firstInterest.item.id});expect(ordinaryFirst.duplicate).toBe(false);
 const movementCount=(await db.query<{count:number}>("SELECT count(*)::int AS count FROM ls_group_admin.proposed_placement_moves WHERE workspace_id=$1",[actor.workspaceId])).rows[0]!.count;
 await expect(placementStore.movePlacement(actor,{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:firstSource.item.id,destinationDraftGroupId:firstB.item.id})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await db.query<{count:number}>("SELECT count(*)::int AS count FROM ls_group_admin.proposed_placement_moves WHERE workspace_id=$1",[actor.workspaceId])).rows[0]!.count).toBe(movementCount);

 const secondInterest=await serviceInterest(),secondA=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"Move first A"}),secondB=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"Move first B"});
 const secondSource=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:secondA.item.id,serviceInterestId:secondInterest.item.id});
 const moveFirst=await placementStore.movePlacement(actor,{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:secondSource.item.id,destinationDraftGroupId:secondB.item.id});
 const ordinaryAfter=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:secondB.item.id,serviceInterestId:secondInterest.item.id});
 expect(ordinaryAfter).toMatchObject({saved:true,replayed:false,duplicate:true,item:{id:moveFirst.item.id}});
 expect((await db.query<{count:number}>("SELECT count(*)::int AS count FROM ls_group_admin.proposed_placements WHERE workspace_id=$1 AND draft_group_id=$2 AND service_interest_id=$3",[actor.workspaceId,secondB.item.id,secondInterest.item.id])).rows).toEqual([{count:1}]);
});

it("rejects tutoring and cross-workspace identities at store and database boundaries",async()=>{
 const actor=actors[0]!,group=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"Boundary group"}),tutoring=await serviceInterest(actor,"tutoring"),other=await serviceInterest(actors[2]!,"group");
 await expect(placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:group.item.id,serviceInterestId:tutoring.item.id})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:group.item.id,serviceInterestId:other.item.id})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(db.query(`INSERT INTO ls_group_admin.proposed_placements(workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id,recorded_by,request_digest,created_at)
  VALUES($1,$2,$3,$4,'group',$5,$6,$7,$8,$9)`,[actor.workspaceId,randomUUID(),group.item.id,tutoring.item.id,tutoring.item.familyId,tutoring.item.personId,actor.id,"a".repeat(64),now])).rejects.toThrow();
 expect((await placementStore.list(actor)).proposedPlacements.filter(row=>row.draftGroupId===group.item.id)).toEqual([]);
});

it("keeps provenance immutable and denies parent, revoked and cross-workspace actors",async()=>{
 const actor=actors[0]!,group=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"Immutable group"}),interest=await serviceInterest(),placement=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:group.item.id,serviceInterestId:interest.item.id});
 await expect(db.query("UPDATE ls_group_admin.draft_groups SET recorded_by=$1 WHERE workspace_id=$2 AND id=$3",[actors[1]!.id,actor.workspaceId,group.item.id])).rejects.toThrow();
 await expect(db.query("DELETE FROM ls_group_admin.proposed_placements WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,placement.item.id])).rejects.toThrow();
 await expect(placementStore.list(actors[1]!)).rejects.toMatchObject({code:"FORBIDDEN"});await expect(placementStore.movePlacement(actors[1]!,{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:placement.item.id,destinationDraftGroupId:randomUUID()})).rejects.toMatchObject({code:"FORBIDDEN"});expect((await placementStore.list(actors[2]!)).draftGroups).toEqual([]);
 await expect(placementStore.movePlacement(actors[2]!,{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:placement.item.id,destinationDraftGroupId:randomUUID()})).rejects.toMatchObject({code:"UNAVAILABLE"});
 await db.query("UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1",[actors[2]!.sessionDigest,now]);await expect(placementStore.createDraftGroup(actors[2]!,{action:"create_draft_group",operationId:randomUUID(),label:"Denied"})).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});

it("HTTP stays default-off and enforces role, origin, CSRF and persisted readback",async()=>{
 const token="c".repeat(43),csrf="d".repeat(43),origin="https://synthetic.example.invalid",url=origin+"/api/private/group-placement";
 const load=async()=>({enabled:true,origin,actor:async()=>actors[0]!,csrf:()=>csrf,store:placementStore});
 const headers={cookie:"__Host-ls-session="+token,origin,"content-type":"application/json","x-forwarded-proto":"https","x-forwarded-host":"synthetic.example.invalid"};
 expect((await groupPlacementHttp(new Request(url),async()=>({...await load(),enabled:false}))).status).toBe(404);
 const payload={action:"create_draft_group",operationId:randomUUID(),label:"HTTP synthetic"};
 expect((await groupPlacementHttp(new Request(url,{method:"POST",headers,body:JSON.stringify(payload)}),load)).status).toBe(403);
 expect((await groupPlacementHttp(new Request(url,{method:"POST",headers:{...headers,origin:"https://attacker.invalid","x-csrf-token":csrf},body:JSON.stringify(payload)}),load)).status).toBe(403);
 const saved=await groupPlacementHttp(new Request(url,{method:"POST",headers:{...headers,"x-csrf-token":csrf},body:JSON.stringify(payload)}),load);expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({ok:true,data:{saved:true,item:{state:"draft_group",label:"HTTP synthetic"}}});
 const read=await groupPlacementHttp(new Request(url,{headers}),load);expect(read.headers.get("cache-control")).toBe("private, no-store");expect(await read.json()).toMatchObject({ok:true,data:{draftGroups:expect.arrayContaining([expect.objectContaining({label:"HTTP synthetic"})])}});
});

it("HTTP dispatches an idempotent proposal move without broadening effects",async()=>{
 const actor=actors[0]!,token="e".repeat(43),csrf="f".repeat(43),origin="https://synthetic.example.invalid",url=origin+"/api/private/group-placement",
  load=async()=>({enabled:true,origin,actor:async()=>actor,csrf:()=>csrf,store:placementStore}),headers={cookie:"__Host-ls-session="+token,origin,"content-type":"application/json","x-forwarded-proto":"https","x-forwarded-host":"synthetic.example.invalid","x-csrf-token":csrf};
 const sourceGroup=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"HTTP move source"}),destinationGroup=await placementStore.createDraftGroup(actor,{action:"create_draft_group",operationId:randomUUID(),label:"HTTP move destination"}),interest=await serviceInterest(),source=await placementStore.proposePlacement(actor,{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:sourceGroup.item.id,serviceInterestId:interest.item.id});
 const command={action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:source.item.id,destinationDraftGroupId:destinationGroup.item.id};
 const first=await groupPlacementHttp(new Request(url,{method:"POST",headers,body:JSON.stringify(command)}),load);expect(first.status).toBe(200);const body=await first.json();expect(body).toMatchObject({ok:true,data:{saved:true,replayed:false,item:{draftGroupId:destinationGroup.item.id},movement:{sourceProposedPlacementId:source.item.id}}});
 const replay=await groupPlacementHttp(new Request(url,{method:"POST",headers,body:JSON.stringify(command)}),load);expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,item:{id:body.data.item.id},movement:{id:body.data.movement.id}}});
 const changed=await groupPlacementHttp(new Request(url,{method:"POST",headers,body:JSON.stringify({...command,destinationDraftGroupId:randomUUID()})}),load);expect(changed.status).toBe(409);
});
