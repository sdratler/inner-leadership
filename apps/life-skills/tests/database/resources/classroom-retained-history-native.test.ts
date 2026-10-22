/** Owned loopback native retention proof only. All agreements, content, people,
 * merchant and payment readbacks are synthetic, never real archive admission. */
import {randomUUID} from "node:crypto";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {programFixture,type ProgramFixture} from "../fishing/native-program-fixture.ts";
import {agreementAcceptanceFixture,agreementBundleFixture} from "../../fixtures/academy-agreements.ts";
import {owner03PolicyVersion} from "../../../src/features/fishing-payments/owner03-policy.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../../src/features/identity/store.ts";
import {ClassroomWithdrawalNativeStore} from "../../../src/features/resources/classroom-withdrawal-native-store.ts";
import {ClassroomRetainedHistoryNativeStore} from "../../../src/features/resources/classroom-retained-history-native-store.ts";
import {classroomWithdrawalVersion} from "../../../src/features/resources/classroom-withdrawal-contract.ts";
import {withdrawalManifestAction,withdrawalManifestId} from "../../../src/features/resources/classroom-withdrawal-manifest.ts";
import {FishingLessonJourney} from "../../../src/features/resources/fishing-lesson-journey.ts";
import {FishingLessonNativeStore} from "../../../src/features/resources/fishing-lesson-native-store.ts";
const fixtures:ProgramFixture[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function setup(){
 const f=await programFixture({capacity:3,readableRm101:"SYNTHETIC_ONLY",policyVersion:owner03PolicyVersion,confirmation:{kind:"all_native_dues_paid"},owner03Bundle:agreementBundleFixture(),termsDocument:"SYNTHETIC retained history terms, not actual legal approval."});fixtures.push(f);const plan=await f.createPlan(),a=await f.family(),b=await f.family();
 for(const family of [a,b]){
  const stageId=f.ref.stageId,learnerId=family.learnerId,fit={commandId:randomUUID(),id:randomUUID(),stageId,learnerId,purpose:"enrollment" as const,decision:"approved" as const,targetOccurrenceId:null,targetRevision:null,note:"SYNTHETIC retained content fit"};await f.program.recordFit(f.owner,fit);
  const acceptance={commandId:randomUUID(),id:randomUUID(),blockId:randomUUID(),stageId,learnerId,householdId:family.householdId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash,expectedPlanRevision:plan.revision,occurrenceIds:plan.occurrences.slice(0,4).map(o=>o.id),currency:"USD" as const,priceCents:65000 as const,purchasedLessons:4 as const,automaticFutureCharges:false as const,agreementAcceptance:agreementAcceptanceFixture()};await f.program.acceptMonthlyBlockTerms(family.parent,acceptance);
  const block={id:acceptance.blockId,acceptanceId:acceptance.id,occurrenceIds:acceptance.occurrenceIds},hold={commandId:randomUUID(),holdId:randomUUID(),stageId,learnerId,householdId:family.householdId,payerAccountId:family.parent.id,expectedCohortRevision:1,reason:"SYNTHETIC four places",block};await f.program.reserveOfferHold(f.owner,hold);
  const offer={commandId:randomUUID(),id:randomUUID(),stageId,payerAccountId:family.parent.id,householdId:family.householdId,policyApprovalId:f.policyId,expiresAt:f.at(24),lines:[{id:randomUUID(),learnerId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,holdId:hold.holdId,mode:"monthly_block" as const,block,dueAt:[f.at(0)]}]};await f.program.approveOffer(f.owner,offer);
  const issued=await f.paymentStore.registerApprovedOffer(f.owner,randomUUID(),offer.id,1),purchaseId=issued.purchaseIds[0]!;await f.settle({family,purchaseId,offer});await f.program.confirmEnrollment(f.owner,{commandId:randomUUID(),id:randomUUID(),stageId,purchaseId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,policyApprovalId:f.policyId,expectedPaymentRevision:(await f.paymentStore.readPayment(f.owner,purchaseId))!.revision});
  await f.pool.query("INSERT INTO ls_education.educational_assignments(workspace_id,learner_id,module_id,version,active,assigned_by) VALUES($1,$2,'RM-101','synthetic-lesson-v1',true,$3)",[f.workspaceId,learnerId,f.owner.id]);
  for(const [actor,permissions]of [[family.parent,["submit","read_learner","read_parent"]],[f.owner,["observe","publish_parent_summary","read_teacher"]]]as const)await f.pool.query("INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,'RM-101','synthetic-lesson-v1',true,$4::text[],$5)",[f.workspaceId,actor.id,learnerId,permissions,f.owner.id]);
 }
 const selected={stageId:f.ref.stageId,householdId:a.householdId},reference={learnerId:a.learnerId,moduleId:"RM-101",version:"synthetic-lesson-v1"};
 const withdrawal=(db:IdentityStore=f.db,actor:Actor=f.owner)=>new ClassroomWithdrawalNativeStore(db,f.ring,actor,f.program),history=(db:IdentityStore=f.db,actor:Actor=f.owner)=>new ClassroomRetainedHistoryNativeStore(db,f.ring,actor,f.program),journey=(actor:Actor=a.parent)=>new FishingLessonJourney(new FishingLessonNativeStore(f.db,f.ring,actor),()=>new Date());
 const command=async(family=a)=>({version:classroomWithdrawalVersion,stageId:f.ref.stageId,householdId:family.householdId,operationId:randomUUID(),expectedScopeSha256:(await withdrawal().review({stageId:f.ref.stageId,householdId:family.householdId})).scopeSha256});
 const query=(operationId:string)=>({...selected,withdrawalOperationId:operationId,reference});
 const snapshot=async()=>Promise.all(["ls_identity.accounts","ls_education.lesson_events","ls_education.lesson_heads","ls_education.access_revocations","ls_education.account_grants","ls_education.guardian_authorities","ls_education.educational_assignments","ls_fishing_stage.enrollments","ls_fishing_stage.command_receipts","ls_fishing_payments.purchases","ls_fishing_payments.outbox","ls_identity.auth_mail_outbox"].map(async table=>(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows));
 return {f,a,b,selected,reference,withdrawal,history,journey,command,query,snapshot};
}
test("separate operator history preserves submitted work/observations after withdrawal without exposing private drafts or restoring ordinary access",async()=>{
 const s=await setup(),draft=await s.journey().save(s.reference,{action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"PRIVATE_ACTOR_DRAFT_SENTINEL"}]}),submitted=await s.journey().save(s.reference,{action:"submit",operationId:randomUUID(),expectedRevisionId:draft.revisionId,answers:[1,2,3].map(i=>({questionId:`Q01-${i}`,value:"Synthetic submitted answer "+i}))});
 const laterDraft=await s.journey().save(s.reference,{action:"save_draft",operationId:randomUUID(),expectedRevisionId:submitted.revisionId,answers:[{questionId:"Q01-1",value:"LATER_PRIVATE_DRAFT_SENTINEL"}]}),observation={action:"observe",operationId:randomUUID(),expectedRevisionId:laterDraft.revisionId,submissionId:submitted.revisionId,task:"Synthetic hookless practice",assistance:"with_guidance",privateNote:"Synthetic owner observation",knowledgeAssessment:{state:"recorded",assessment:"Synthetic independent explanation"}};
 const observed=await s.journey(s.f.owner).save(s.reference,observation),publication={action:"publish_parent_summary",operationId:randomUUID(),expectedRevisionId:observed.revisionId,observationId:observed.revisionId,summary:"Synthetic parent summary",parentAccountIds:[s.a.parent.id]};await s.journey(s.f.owner).save(s.reference,publication);
 const c=await s.command();await expect(s.history().read(s.query(c.operationId))).rejects.toThrow();await s.withdrawal().withdraw(c);expect((await s.withdrawal().withdraw(c)).replayed).toBe(true);
 const before=await s.snapshot(),retained=await s.history().read(s.query(c.operationId));expect(retained).toMatchObject({state:"retained_read_only",retainedEventCount:5,submission:{revisionId:submitted.revisionId,answers:[{questionId:"Q01-1",value:"Synthetic submitted answer 1"},{questionId:"Q01-2",value:"Synthetic submitted answer 2"},{questionId:"Q01-3",value:"Synthetic submitted answer 3"}]},observations:[{task:observation.task,privateNote:observation.privateNote,knowledgeAssessment:observation.knowledgeAssessment}]});
 expect(JSON.stringify(retained)).not.toMatch(/PRIVATE_ACTOR_DRAFT|LATER_PRIVATE_DRAFT|SYNTHETIC TEACHER|parentAccountIds|summaryRecipients|ciphertext|operationId|publish_parent_summary/);
 for(const view of ["learner","parent"]as const)await expect(s.journey().read(s.reference,view)).rejects.toThrow("FORBIDDEN");await expect(s.journey(s.f.owner).read(s.reference,"teacher")).rejects.toThrow("FORBIDDEN");await expect(s.journey(s.f.owner).save(s.reference,publication)).rejects.toThrow("FORBIDDEN");
 expect(await s.journey(s.b.parent).read({...s.reference,learnerId:s.b.learnerId},"learner")).toMatchObject({submission:null});expect(await s.snapshot()).toEqual(before);
});
test("history requires original manifest membership, current exact family/source/grant and fresh operator session",async()=>{
 const s=await setup(),c=await s.command();await s.withdrawal().withdraw(c);
 for(const q of [{...s.query(c.operationId),householdId:s.b.householdId},{...s.query(c.operationId),stageId:randomUUID()},{...s.query(c.operationId),reference:{...s.reference,learnerId:s.b.learnerId}}])await expect(s.history().read(q)).rejects.toThrow();
 for(const actor of [s.a.parent,{...s.a.parent,role:"practitioner" as const}])await expect(s.history(undefined,actor).read(s.query(c.operationId))).rejects.toThrow();
 // A valid later assignment/revocation still was not in the original manifest.
 await s.f.pool.query("INSERT INTO ls_education.educational_assignments(workspace_id,learner_id,module_id,version,active,assigned_by) VALUES($1,$2,'RM-102','synthetic-lesson-v1',true,$3)",[s.f.workspaceId,s.a.learnerId,s.f.owner.id]);
 await s.f.pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,module_id,version,recorded_by) VALUES($1,$2,NULL,$3,'RM-102','synthetic-lesson-v1',$4)",[s.f.workspaceId,randomUUID(),s.a.learnerId,s.f.owner.id]);
 await expect(s.history().read({...s.query(c.operationId),reference:{...s.reference,moduleId:"RM-102"}})).rejects.toThrow("FORBIDDEN");
 await s.f.pool.query("UPDATE ls_education.account_grants SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);await expect(s.history().read(s.query(c.operationId))).rejects.toThrow("FORBIDDEN");
 await s.f.pool.query("UPDATE ls_education.account_grants SET active=true WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);
 await s.f.pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,module_id,version,recorded_by) VALUES($1,$2,$3,$4,'RM-101','synthetic-lesson-v1',$3)",[s.f.workspaceId,randomUUID(),s.f.owner.id,s.a.learnerId]);await expect(s.history().read(s.query(c.operationId))).rejects.toThrow("FORBIDDEN");
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);await expect(s.history().read(s.query(c.operationId))).rejects.toThrow("UNAUTHENTICATED");
});
test("native manifest and history reject legacy absence, cross-receipt transplant, ciphertext/SQL/head corruption and event overflow without edits",async()=>{
 const s=await setup();await s.journey().save(s.reference,{action:"submit",operationId:randomUUID(),expectedRevisionId:null,answers:[1,2,3].map(i=>({questionId:`Q01-${i}`,value:"Synthetic retained answer"}))});const a=await s.command(),b=await s.command(s.b);await s.withdrawal().withdraw(a);await s.withdrawal().withdraw(b);
 const mid=withdrawalManifestId(s.f.workspaceId,s.f.owner.id,a.operationId),otherMid=withdrawalManifestId(s.f.workspaceId,s.f.owner.id,b.operationId),before=await s.snapshot();
 type Transform=(tx:SqlSession,statement:string,values:readonly unknown[],rows:unknown[])=>Promise<unknown[]>|unknown[];
 const altered=(transform:Transform):IdentityStore=>({transaction:work=>s.f.db.transaction(tx=>work({query:async(statement,values=[])=>await transform(tx,statement,values,await tx.query(statement,values)) as never}))});
 const faults:Transform[]=[
  (_tx,q,v,rows)=>q.includes("FROM ls_fishing_stage.command_receipts")&&v[2]===mid?[]:rows,
  async(tx,q,v,rows)=>q.includes("FROM ls_fishing_stage.command_receipts")&&v[2]===mid?tx.query(q,[v[0],v[1],otherMid]):rows,
  async(tx,q,v,rows)=>q.includes("FROM ls_fishing_stage.command_receipts")&&v[2]===a.operationId?tx.query(q,[v[0],v[1],b.operationId]):rows,
  (_tx,q,_v,rows)=>q.includes("FROM ls_education.lesson_heads")?[{id:randomUUID()}]:rows,
  (_tx,q,_v,rows)=>q.includes("FROM ls_education.lesson_events")?rows.map(r=>({...r as object,ciphertext:"invalid"})):rows,
  (_tx,q,_v,rows)=>q.includes("FROM ls_education.lesson_events")?rows.map(r=>({...r as object,id:randomUUID()})):rows,
  (_tx,q,_v,rows)=>q.includes("FROM ls_education.lesson_events")?Array.from({length:501},()=>rows[0]):rows,
  (_tx,q,_v,rows)=>q.includes('recorded_by AS "recordedBy"')?rows.map(r=>({...r as object,accountId:s.f.owner.id})):rows,
 ];
 for(const fault of faults)await expect(s.history(altered(fault)).read(s.query(a.operationId))).rejects.toThrow();
 await expect(s.withdrawal(altered(faults[0]!)).withdraw(a)).rejects.toThrow("UNAVAILABLE");expect(await s.snapshot()).toEqual(before);
 await s.f.pool.query("UPDATE ls_education.catalog_versions SET approval_state='withdrawn' WHERE workspace_id=$1 AND module_id='RM-101'",[s.f.workspaceId]);await expect(s.history().read(s.query(a.operationId))).rejects.toThrow();
});
test("failed manifest insertion and oversized proof roll back the complete withdrawal rather than weakening existing receipt limits",async()=>{
 const s=await setup(),c=await s.command(),before=await s.snapshot(),failed:IdentityStore={transaction:work=>s.f.db.transaction(tx=>work({query:async(q,v=[])=>{if(q.includes("INSERT INTO ls_fishing_stage.command_receipts")&&v[3]===withdrawalManifestAction)throw Error("SYNTHETIC_MANIFEST_FAILURE");return tx.query(q,v);}}))};
 await expect(s.withdrawal(failed).withdraw(c)).rejects.toThrow("SYNTHETIC_MANIFEST_FAILURE");expect(await s.snapshot()).toEqual(before);
 await s.f.pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,module_id,version,recorded_by) SELECT $1,gen_random_uuid(),$2,NULL,'RM-401','synthetic-other-scope',$3 FROM generate_series(1,800)",[s.f.workspaceId,s.b.parent.id,s.f.owner.id]);
 const large=await s.command(),preserved=await s.snapshot();await expect(s.withdrawal().withdraw(large)).rejects.toThrow("UNAVAILABLE");expect(await s.snapshot()).toEqual(preserved);
});
