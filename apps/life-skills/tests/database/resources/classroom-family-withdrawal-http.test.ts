/** Actual native password sessions/HTTP/SQL; every family, source, merchant and
 * lesson is synthetic. No provider, production record or release evidence. */
import {randomUUID} from "node:crypto";
import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {academyFamilyFixture} from "../fishing/academy-family-fixture.ts";
import {unseal} from "../../../src/features/identity/crypto.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import {asId} from "../../../src/lib/ids.ts";
import {agreementBundleFixture,agreementAcceptanceFixture} from "../../fixtures/academy-agreements.ts";
import {owner03PolicyVersion} from "../../../src/features/fishing-payments/owner03-policy.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {NativeFishingProgram} from "../../../src/features/fishing/native-program.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {ClassroomFamilyWithdrawalStore} from "../../../src/features/resources/classroom-family-withdrawal-store.ts";
import {ClassroomFamilyWithdrawalHttp} from "../../../src/features/resources/classroom-family-withdrawal-http.ts";
import {classroomWithdrawalVersion} from "../../../src/features/resources/classroom-withdrawal-contract.ts";
import {classroomFamilyWithdrawalPath,type ClassroomFamilyWithdrawalCommand} from "../../../src/features/resources/classroom-family-withdrawal-contract.ts";
import {FishingLessonHttp} from "../../../src/features/resources/fishing-lesson-http.ts";
import {FishingLessonJourney} from "../../../src/features/resources/fishing-lesson-journey.ts";
import {FishingLessonNativeStore} from "../../../src/features/resources/fishing-lesson-native-store.ts";
async function setup(){
 const f=await academyFamilyFixture({capacity:4,policyVersion:owner03PolicyVersion,owner03Bundle:agreementBundleFixture(),termsDocument:"SYNTHETIC block terms only, not actual legal approval.",confirmation:{kind:"all_native_dues_paid"},readableRm101:"SYNTHETIC_ONLY"});const plan=await f.createPlan();
 const applicationId=await f.inquiry("Synthetic withdrawing siblings",2);await f.promote(applicationId);
 const familyCommand=await f.command(applicationId);familyCommand.children=[0,1].map(learnerIndex=>({learnerIndex,displayName:"Synthetic sibling "+(learnerIndex+1),existingLearnerId:null}));
 const response=await f.post(familyCommand);expect(response.status).toBe(200);const saved=(await response.json()).data.saved;
 const mail=(await f.pool.query("SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind='invite'",[f.workspaceId,saved.parentAccountId])).rows[0];
 await f.auth.consumePasswordToken("invite",JSON.parse(unseal(mail.payload_ciphertext,`auth-mail:${f.workspaceId}:${mail.id}`,f.ring)).token,"Ab12cd",randomUUID());
 const parentToken=await f.passwordLogin(familyCommand.parentEmail),parent=await f.sessions.actor(parentToken),unrelated=await f.family();
 const children=saved.children as {learnerId:string;displayName:string}[];
 for(const child of [...children.map(c=>({...c,parent,householdId:saved.householdId})),unrelated]){
  const learnerId=asId(child.learnerId,"person"),stageId=f.ref.stageId,fit={commandId:randomUUID(),id:randomUUID(),stageId,learnerId,purpose:"enrollment" as const,decision:"approved" as const,targetOccurrenceId:null,targetRevision:null,note:"SYNTHETIC sibling block fit"};await f.program.recordFit(f.owner,fit);
  const acceptance={commandId:randomUUID(),id:randomUUID(),blockId:randomUUID(),stageId,learnerId,householdId:child.householdId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash,expectedPlanRevision:plan.revision,occurrenceIds:plan.occurrences.slice(0,4).map(o=>o.id),currency:"USD" as const,priceCents:65000 as const,purchasedLessons:4 as const,automaticFutureCharges:false as const,agreementAcceptance:agreementAcceptanceFixture()};await f.program.acceptMonthlyBlockTerms(child.parent,acceptance);
  const block={id:acceptance.blockId,acceptanceId:acceptance.id,occurrenceIds:acceptance.occurrenceIds},hold={commandId:randomUUID(),holdId:randomUUID(),stageId,learnerId,householdId:child.householdId,payerAccountId:child.parent.id,expectedCohortRevision:1,reason:"SYNTHETIC four places",block};await f.program.reserveOfferHold(f.owner,hold);
  const offer={commandId:randomUUID(),id:randomUUID(),stageId,payerAccountId:child.parent.id,householdId:child.householdId,policyApprovalId:f.policyId,expiresAt:f.at(24),lines:[{id:randomUUID(),learnerId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,holdId:hold.holdId,mode:"monthly_block" as const,block,dueAt:[f.at(0)]}]};await f.program.approveOffer(f.owner,offer);
  const issued=await f.paymentStore.registerApprovedOffer(f.owner,randomUUID(),offer.id,1),purchaseId=issued.purchaseIds[0]!;await f.settle({family:{parent:child.parent},purchaseId,offer});
  await f.program.confirmEnrollment(f.owner,{commandId:randomUUID(),id:randomUUID(),stageId,purchaseId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,policyApprovalId:f.policyId,expectedPaymentRevision:(await f.paymentStore.readPayment(f.owner,purchaseId))!.revision});
  await f.pool.query("INSERT INTO ls_education.educational_assignments(workspace_id,learner_id,module_id,version,active,assigned_by) VALUES($1,$2,'RM-101','synthetic-lesson-v1',true,$3)",[f.workspaceId,child.learnerId,f.owner.id]);
  await f.pool.query("INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,'RM-101','synthetic-lesson-v1',true,ARRAY['submit','read_learner','read_parent'],$4)",[f.workspaceId,child.parent.id,child.learnerId,f.owner.id]);
 }
 const store=new ClassroomFamilyWithdrawalStore(f.db,f.config,f.store,systemClock,bound=>new NativeFishingProgram(bound,f.ring,{childAccountsEnabled:false,merchant:f.merchant})),http=new ClassroomFamilyWithdrawalHttp(f.runtime,store),query={applicationId,stageId:f.ref.stageId};
 const request=(method="GET",body:unknown=null,token=f.token,headers:Record<string,string>={},suffix=method==="GET"?"?"+new URLSearchParams(query):"")=>new Request(f.config.origin+classroomFamilyWithdrawalPath+suffix,{method,headers:{cookie:SESSION_COOKIE+"="+token,...method==="GET"?{}:{origin:f.config.origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":f.sessions.csrf(token),"idempotency-key":(body as {operationId?:string})?.operationId??""},...headers},...method==="GET"?{}:{body:JSON.stringify(body)}});
 const command=async()=>{const r=await http.handle(request());expect(r.status).toBe(200);const review=(await r.json()).data;return {review,command:{version:classroomWithdrawalVersion,operationId:randomUUID(),binding:review.binding,stageId:query.stageId,expectedScopeSha256:review.scopeSha256} as ClassroomFamilyWithdrawalCommand};};
 const lessonHttp=new FishingLessonHttp(f.runtime,actor=>new FishingLessonJourney(new FishingLessonNativeStore(f.db,f.ring,actor),()=>new Date()));
 const lesson=(learnerId=children[0]!.learnerId,token=parentToken,body?:unknown)=>lessonHttp.handle(new Request(f.config.origin+"/api/resources/education/lesson"+(body?"":"?"+new URLSearchParams({learnerId,moduleId:"RM-101",version:"synthetic-lesson-v1",view:"learner"})),{method:body?"POST":"GET",headers:{cookie:SESSION_COOKIE+"="+token,...body?{origin:f.config.origin,"content-type":"application/json","x-csrf-token":f.sessions.csrf(token),"sec-fetch-site":"same-origin"}:{}},...body?{body:JSON.stringify({reference:{learnerId,moduleId:"RM-101",version:"synthetic-lesson-v1"},command:body})}:{}}));
 const effects=async()=>(await f.pool.query("SELECT (SELECT count(*)::int FROM ls_education.access_revocations WHERE workspace_id=$1) AS revocations,(SELECT count(*)::int FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND action='classroom.family.withdraw') AS withdrawals",[f.workspaceId])).rows[0];
 return {f,query,children,parentToken,parent,unrelated,http,request,command,lesson,effects};
}
test("ordinary authenticated family HTTP reviews both siblings, saves once on lost-response retry and closes stale parent HTTP while retaining history",async()=>{
 const s=await setup(),draft={action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"SYNTHETIC_RETAINED_PRIVATE_HISTORY"}]};
 expect((await s.lesson()).status).toBe(200);expect((await s.lesson(undefined,undefined,draft)).status).toBe(200);
 const protectedBefore=await s.f.protectedState(),eventsBefore=(await s.f.pool.query("SELECT to_jsonb(e) AS row FROM ls_education.lesson_events e WHERE workspace_id=$1 ORDER BY id",[s.f.workspaceId])).rows;
 const {review,command}=await s.command();expect(review.children.map((c:{displayName:string})=>c.displayName).sort()).toEqual(["Synthetic sibling 1","Synthetic sibling 2"]);expect(review).toMatchObject({lessonCount:2,enrollmentCount:2,withdrawn:false});expect(JSON.stringify(review)).not.toMatch(/householdId|ciphertext|SYNTHETIC_RETAINED_PRIVATE_HISTORY|privateNote/);
 const first=await s.http.handle(s.request("POST",command));expect(first.status).toBe(200); // Simulate a lost response: do not use its result.
 const retry=await s.http.handle(s.request("POST",command));expect(retry.status).toBe(200);expect((await retry.json()).data).toMatchObject({operationId:command.operationId,state:"withdrawn",revokedLessonCount:2,replayed:true});
 for(const child of s.children)expect((await s.lesson(child.learnerId)).status).toBe(403);expect((await s.lesson(undefined,undefined,draft)).status).toBe(403);
 const unrelatedToken=await s.f.passwordLogin(s.unrelated.parent.id+"@example.invalid");expect((await s.lesson(s.unrelated.learnerId,unrelatedToken)).status).toBe(200);
 const readback=await s.http.handle(s.request());expect(readback.status).toBe(200);expect((await readback.json()).data).toMatchObject({withdrawn:true,retainedEventCount:1});
 expect(await s.effects()).toEqual({revocations:2,withdrawals:1});expect(await s.f.protectedState()).toEqual(protectedBefore);expect((await s.f.pool.query("SELECT to_jsonb(e) AS row FROM ls_education.lesson_events e WHERE workspace_id=$1 ORDER BY id",[s.f.workspaceId])).rows).toEqual(eventsBefore);
});
test("ordinary withdrawal denies parent, CSRF, injected authority, duplicate query, mismatched key and stale family before native effects",async()=>{
 const s=await setup(),{command}=await s.command();
 expect((await s.http.handle(s.request("GET",null,s.parentToken))).status).toBe(403);
 for(const extra of ["&applicationId="+s.query.applicationId,"&householdId="+s.unrelated.householdId,"&role=practitioner"])expect((await s.http.handle(s.request("GET",null,undefined,{},"?"+new URLSearchParams(s.query)+extra))).status).toBe(400);
 expect((await s.http.handle(s.request("POST",command,undefined,{"x-csrf-token":"bad"}))).status).toBe(403);
 expect((await s.http.handle(s.request("POST",command,undefined,{origin:"https://other.invalid"}))).status).toBe(403);
 expect((await s.http.handle(s.request("POST",command,undefined,{"idempotency-key":randomUUID()}))).status).toBe(400);
 expect((await s.http.handle(s.request("POST",{...command,householdId:s.unrelated.householdId}))).status).toBe(400);
 const stale={...command,binding:{...command.binding,expectedFamilyDigest:"f".repeat(64)}};expect((await s.http.handle(s.request("POST",stale))).status).toBe(409);
 expect(await s.effects()).toEqual({revocations:0,withdrawals:0});
 expect((await s.http.handle(s.request("POST",command))).status).toBe(200);
 // A successful receipt never bypasses the current saved-family binding.
 expect((await s.http.handle(s.request("POST",stale))).status).toBe(409);
 const edit=await s.f.leads.preview(s.f.owner,{action:"preview_edit",operationId:randomUUID(),expectedEpoch:command.binding.expectedEpoch,personId:command.binding.personId,expectedAssociationVersion:command.binding.expectedAssociationVersion,details:{status:"contacted",notes:"SYNTHETIC harmless current lead revision",nextAction:"",followUpDate:null}});
 if(edit.state!=="ready")throw Error("SYNTHETIC_CURRENT_EDIT_REQUIRED");await s.f.leads.confirm(s.f.owner,{action:"confirm",token:edit.token,confirmNewPerson:false});
 const current=await s.command();expect(current.review.binding.expectedAssociationVersion).toBe(command.binding.expectedAssociationVersion+1);
 // This changed binding is genuinely valid for the SAME family/stage. It must
 // not become an exact-body replay simply because native scope is unchanged.
 expect((await s.http.handle(s.request("POST",{...command,binding:current.review.binding}))).status).toBe(409);
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);
 expect((await s.http.handle(s.request("POST",command))).status).toBe(401);expect(await s.effects()).toEqual({revocations:2,withdrawals:1});
});
test("the production constructor remains closed without an admitted merchant even for a complete synthetic saved family",async()=>{
 const s=await setup(),closed=new ClassroomFamilyWithdrawalHttp(s.f.runtime,new ClassroomFamilyWithdrawalStore(s.f.db,s.f.config,s.f.store));
 const r=await closed.handle(s.request());expect(r.status).toBe(503);expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("referrer-policy")).toBe("no-referrer");expect(await s.effects()).toEqual({revocations:0,withdrawals:0});
});
test("failed outer exact-HTTP-body receipt rolls back both native revocations and inner receipt",async()=>{
 const s=await setup(),{command}=await s.command();
 const fail:IdentityStore={transaction:work=>s.f.db.transaction(tx=>work({query:async(statement,values=[])=>{if(statement.includes("INSERT INTO ls_fishing_stage.command_receipts")&&values[3]==="classroom.family.withdraw.http")throw Error("SYNTHETIC_OUTER_RECEIPT_FAILURE");return tx.query(statement,values);}}))};
 const store=new ClassroomFamilyWithdrawalStore(fail,s.f.config,s.f.store,systemClock,bound=>new NativeFishingProgram(bound,s.f.ring,{childAccountsEnabled:false,merchant:s.f.merchant})),http=new ClassroomFamilyWithdrawalHttp(s.f.runtime,store);
 expect((await http.handle(s.request("POST",command))).status).toBe(503);expect(await s.effects()).toEqual({revocations:0,withdrawals:0});expect((await s.lesson()).status).toBe(200);
 expect((await s.http.handle(s.request("POST",command))).status).toBe(200);expect((await s.http.handle(s.request("POST",command))).status).toBe(200);expect(await s.effects()).toEqual({revocations:2,withdrawals:1});
});
