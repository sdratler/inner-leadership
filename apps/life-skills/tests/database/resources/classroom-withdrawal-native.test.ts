/** Disposable loopback PG. All approvals, curriculum and merchant fixtures are
 * synthetic; this is not a real family withdrawal or provider test. */
import {randomUUID} from "node:crypto";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import type {Actor} from "../../../src/features/identity/types.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {programFixture,type ProgramFixture} from "../fishing/native-program-fixture.ts";
import {ClassroomWithdrawalNativeStore} from "../../../src/features/resources/classroom-withdrawal-native-store.ts";
import {classroomWithdrawalVersion} from "../../../src/features/resources/classroom-withdrawal-contract.ts";
import {FishingLessonNativeStore} from "../../../src/features/resources/fishing-lesson-native-store.ts";
import {FishingLessonJourney} from "../../../src/features/resources/fishing-lesson-journey.ts";
const fixtures:ProgramFixture[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function setup(){
 const f=await programFixture({confirmation:{kind:"all_native_dues_paid"},readableRm101:"SYNTHETIC_ONLY"});fixtures.push(f);await f.createPlan();
 const a=await f.family(),b=await f.family();
 for(const family of [a,b]){const purchase=await f.prepare(family);await f.settle(purchase);await f.enroll(purchase);
  await f.pool.query(`INSERT INTO ls_education.educational_assignments(workspace_id,learner_id,module_id,version,active,assigned_by) VALUES($1,$2,'RM-101','synthetic-lesson-v1',true,$3)`,[f.workspaceId,family.learnerId,f.owner.id]);
  for(const [actor,permissions]of [[family.parent,["submit","read_learner","read_parent"]],[f.owner,["observe","publish_parent_summary","read_teacher"]]]as const)
   await f.pool.query(`INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,'RM-101','synthetic-lesson-v1',true,$4::text[],$5)`,[f.workspaceId,actor.id,family.learnerId,permissions,f.owner.id]);
 }
 const selected={stageId:f.ref.stageId,householdId:a.householdId};
 const store=(actor:Actor=f.owner,db:IdentityStore=f.db)=>new ClassroomWithdrawalNativeStore(db,f.ring,actor,f.program);
 const reference=(family=a)=>({learnerId:family.learnerId,moduleId:"RM-101",version:"synthetic-lesson-v1"});
 const journey=(actor:Actor=a.parent)=>new FishingLessonJourney(new FishingLessonNativeStore(f.db,f.ring,actor),()=>new Date());
 const command=async()=>({...selected,version:classroomWithdrawalVersion,operationId:randomUUID(),expectedScopeSha256:(await store().review(selected)).scopeSha256});
 const effects=async()=>((await f.pool.query(`SELECT (SELECT count(*)::int FROM ls_education.access_revocations WHERE workspace_id=$1) AS revocations,(SELECT count(*)::int FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND action='classroom.family.withdraw') AS withdrawals`,[f.workspaceId])).rows[0]);
 return {f,a,b,selected,store,reference,journey,command,effects};
}
test("native family withdrawal closes stale parent drafts/finals/portfolio and publications while retaining encrypted history and unrelated families",async()=>{
 const s=await setup(),ref=s.reference(),draft={action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"SYNTHETIC_PRIVATE_DRAFT"}]};
 const drafted=await s.journey().save(ref,draft),final={action:"submit",operationId:randomUUID(),expectedRevisionId:drafted.revisionId,answers:[1,2,3].map(i=>({questionId:`Q01-${i}`,value:"Synthetic complete answer"}))};
 const submitted=await s.journey().save(ref,final),observe={action:"observe",operationId:randomUUID(),expectedRevisionId:submitted.revisionId,submissionId:submitted.revisionId,task:"Synthetic hookless task",assistance:"with_guidance"};
 const observed=await s.journey(s.f.owner).save(ref,observe),publication={action:"publish_parent_summary",operationId:randomUUID(),expectedRevisionId:observed.revisionId,observationId:observed.revisionId,summary:"Synthetic safe portfolio",parentAccountIds:[s.a.parent.id]};
 await s.journey(s.f.owner).save(ref,publication);expect((await s.journey().read(ref,"parent")).portfolio).not.toBeNull();
 const protectedTables=["ls_identity.accounts","ls_cases.family_members","ls_education.guardian_authorities","ls_education.account_grants","ls_education.educational_assignments","ls_education.lesson_heads","ls_education.lesson_events","ls_fishing_stage.enrollments","ls_fishing_payments.outbox","ls_identity.auth_mail_outbox"];
 const snapshot=()=>Promise.all(protectedTables.map(async table=>(await s.f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[s.f.workspaceId])).rows));
 const before=await snapshot(),audit=await s.store().readRetainedAudit(s.selected),command=await s.command(),saved=await s.store().withdraw(command);
 expect(saved).toMatchObject({state:"withdrawn",revokedLessonCount:1,replayed:false});expect(await s.store().withdraw(command)).toEqual({...saved,replayed:true});
 await expect(s.journey().read(ref,"learner")).rejects.toThrow("FORBIDDEN");await expect(s.journey().read(ref,"parent")).rejects.toThrow("FORBIDDEN");
 for(const body of [draft,final,{...draft,operationId:randomUUID()}])await expect(s.journey().save(ref,body)).rejects.toThrow("FORBIDDEN");
 await expect(s.journey(s.f.owner).save(ref,{...publication,operationId:randomUUID()})).rejects.toThrow("FORBIDDEN");
 expect(await s.journey(s.b.parent).read(s.reference(s.b),"learner")).toMatchObject({submission:null});
 const retained=await s.store().readRetainedAudit(s.selected);expect(retained).toMatchObject({withdrawn:true,retainedEventCount:audit.retainedEventCount,historySha256:audit.historySha256});expect(JSON.stringify(retained)).not.toMatch(/SYNTHETIC_PRIVATE|answers|ciphertext|draft/);
 expect(await snapshot()).toEqual(before);expect(await s.effects()).toEqual({revocations:1,withdrawals:1});
 await expect(s.store().withdraw({...command,expectedScopeSha256:"b".repeat(64)})).rejects.toThrow("CONFLICT");
});
test("native stale scope, concurrent commands and a failed receipt write cannot partially revoke classroom access",async()=>{
 const s=await setup(),command=await s.command();
 await expect(s.store().withdraw({...command,expectedScopeSha256:"b".repeat(64)})).rejects.toThrow("CONFLICT");expect(await s.effects()).toEqual({revocations:0,withdrawals:0});
 const fail:IdentityStore={transaction:work=>s.f.db.transaction(tx=>work({query:async(statement,values=[])=>{if(statement.includes("INSERT INTO ls_fishing_stage.command_receipts")&&values[3]==="classroom.family.withdraw")throw Error("SYNTHETIC_RECEIPT_FAILURE");return tx.query(statement,values);}}))};
 await expect(s.store(s.f.owner,fail).withdraw(command)).rejects.toThrow("SYNTHETIC_RECEIPT_FAILURE");expect(await s.effects()).toEqual({revocations:0,withdrawals:0});
 expect(await s.journey().read(s.reference(),"learner")).toMatchObject({submission:null});
 const results=await Promise.allSettled([s.store().withdraw(command),s.store().withdraw({...command,operationId:randomUUID()})]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);expect(await s.effects()).toEqual({revocations:1,withdrawals:1});
});
test("native withdrawal requires a fresh current operator before review and successful receipt replay",async()=>{
 const s=await setup(),command=await s.command(),foreign=await programFixture();fixtures.push(foreign);
 for(const actor of [s.a.parent,{...s.a.parent,role:"practitioner" as const},foreign.owner])await expect(s.store(actor).review(s.selected)).rejects.toThrow();
 await s.store().withdraw(command);await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);
 await expect(s.store().withdraw(command)).rejects.toThrow("UNAUTHENTICATED");await expect(s.store().readRetainedAudit(s.selected)).rejects.toThrow("UNAUTHENTICATED");expect(await s.effects()).toEqual({revocations:1,withdrawals:1});
});
test("native broad learner revocation fails closed when another household or independently granted parent shares the reference",async()=>{
 const s=await setup();
 await s.f.pool.query(`INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')`,[s.f.workspaceId,s.b.householdId,s.a.learnerId]);
 await expect(s.store().review(s.selected)).rejects.toThrow("CONFLICT");expect(await s.effects()).toEqual({revocations:0,withdrawals:0});
 await s.f.pool.query("DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3",[s.f.workspaceId,s.b.householdId,s.a.learnerId]);
 await s.f.pool.query(`INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,clock_timestamp(),'synthetic independent second guardian',$4)`,[s.f.workspaceId,s.a.learnerId,s.b.parent.id,s.f.owner.id]);
 await s.f.pool.query(`INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,'RM-101','synthetic-lesson-v1',true,ARRAY['read_learner'],$4)`,[s.f.workspaceId,s.b.parent.id,s.a.learnerId,s.f.owner.id]);
 expect(await s.journey(s.b.parent).read(s.reference(),"learner")).toMatchObject({submission:null});
 await expect(s.store().review(s.selected)).rejects.toThrow("CONFLICT");expect(await s.effects()).toEqual({revocations:0,withdrawals:0});
});
