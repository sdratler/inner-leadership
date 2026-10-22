/** Actual native password sessions/HTTP/SQL; every family, source, merchant and
 * lesson is synthetic. No provider, production record or release evidence. */
import {randomUUID} from "node:crypto";
import {ClassroomFamilyRetainedHistoryStore} from "../../../src/features/resources/classroom-family-retained-history-store.ts";
import {ClassroomFamilyRetainedHistoryHttp} from "../../../src/features/resources/classroom-family-retained-history-http.ts";
import {classroomFamilyRetainedHistoryPath} from "../../../src/features/resources/classroom-family-retained-history-contract.ts";
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
async function historySetup(){
 const s=await setup();for(const child of s.children)await s.f.pool.query("INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,'RM-101','synthetic-lesson-v1',true,ARRAY['observe','publish_parent_summary','read_teacher'],$2)",[s.f.workspaceId,s.f.owner.id,child.learnerId]);
 const factory=(bound:IdentityStore)=>new NativeFishingProgram(bound,s.f.ring,{childAccountsEnabled:false,merchant:s.f.merchant}),store=new ClassroomFamilyRetainedHistoryStore(s.f.db,s.f.config,s.f.store,systemClock,factory),http=new ClassroomFamilyRetainedHistoryHttp(s.f.runtime,store),reference={learnerId:s.children[0]!.learnerId,moduleId:"RM-101",version:"synthetic-lesson-v1"};
 const request=(body:unknown,token=s.f.token,headers:Record<string,string>={},suffix="",method="POST")=>new Request(s.f.config.origin+classroomFamilyRetainedHistoryPath+suffix,{method,headers:{cookie:SESSION_COOKIE+"="+token,origin:s.f.config.origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":s.f.sessions.csrf(token),...headers},...method==="GET"?{}:{body:JSON.stringify(body)}});
 const body=(withdrawalOperationId:string)=>({action:"review" as const,...s.query,withdrawalOperationId}),read=(withdrawalOperationId:string)=>({...body(withdrawalOperationId),action:"read" as const,reference});
 const snapshot=async()=>Promise.all(["ls_education.lesson_events","ls_education.lesson_heads","ls_education.access_revocations","ls_education.account_grants","ls_education.guardian_authorities","ls_education.educational_assignments","ls_fishing_stage.enrollments","ls_fishing_stage.command_receipts","ls_fishing_payments.purchases","ls_fishing_payments.outbox","ls_identity.auth_mail_outbox"].map(async table=>(await s.f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[s.f.workspaceId])).rows));
 return {...s,historyStore:store,historyHttp:http,historyRequest:request,historyBody:body,historyRead:read,reference,snapshot,factory};
}
test("ordinary owner password session reopens exact saved withdrawal history; read retry leaves business bytes unchanged and parent access denied",async()=>{
 const s=await historySetup(),draft={action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"PRIVATE_DRAFT_SENTINEL"}]};
 const d=await (await s.lesson(undefined,undefined,draft)).json();expect(d.ok).toBe(true);const submitted={action:"submit",operationId:randomUUID(),expectedRevisionId:d.data.revisionId,answers:[1,2,3].map(i=>({questionId:`Q01-${i}`,value:"Synthetic saved submission "+i}))};
 const sub=await (await s.lesson(undefined,undefined,submitted)).json();expect(sub.ok).toBe(true);const journey=new FishingLessonJourney(new FishingLessonNativeStore(s.f.db,s.f.ring,s.f.owner),()=>new Date());
 await journey.save(s.reference,{action:"observe",operationId:randomUUID(),expectedRevisionId:sub.data.revisionId,submissionId:sub.data.revisionId,task:"Synthetic retained task",assistance:"independent",privateNote:"Synthetic private instructor note",knowledgeAssessment:{state:"recorded",assessment:"Synthetic assessment"}});
 const {command}=await s.command();expect((await s.http.handle(s.request("POST",command))).status).toBe(200);const before=await s.snapshot();
 const token=await s.f.passwordLogin(s.f.owner.id+"@example.invalid"),review=await s.historyHttp.handle(s.historyRequest(s.historyBody(command.operationId),token));expect(review.status).toBe(200);const choices=(await review.json()).data;expect(choices.children).toHaveLength(2);expect(choices).toMatchObject({withdrawalOperationId:command.operationId,applicationId:s.query.applicationId,stageId:s.query.stageId});expect(JSON.stringify(choices)).not.toMatch(/householdId|ciphertext|PRIVATE_DRAFT|privateNote/);
 const first=await s.historyHttp.handle(s.historyRequest(s.historyRead(command.operationId),token));expect(first.status).toBe(200);expect(first.headers.get("cache-control")).toBe("private, no-store");expect(first.headers.get("referrer-policy")).toBe("no-referrer");const payload=(await first.json()).data;expect(payload).toMatchObject({withdrawalOperationId:command.operationId,state:"retained_read_only",submission:{answers:submitted.answers},observations:[{privateNote:"Synthetic private instructor note"}]});expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_DRAFT|SYNTHETIC TEACHER|ciphertext|parentAccountIds|publish_parent_summary/);
 const retry=await s.historyHttp.handle(s.historyRequest(s.historyRead(command.operationId),token));expect(retry.status).toBe(200);expect((await retry.json()).data).toEqual(payload);expect((await s.lesson()).status).toBe(403);expect(await s.snapshot()).toEqual(before);
});
test("retained HTTP rejects role, CSRF, origin, query injection, caller authority and wrong original family references",async()=>{
 const s=await historySetup(),{command}=await s.command();expect((await s.http.handle(s.request("POST",command))).status).toBe(200);const body=s.historyRead(command.operationId),before=await s.snapshot();
 expect((await s.historyHttp.handle(s.historyRequest(body,s.parentToken))).status).toBe(403);
 expect((await s.historyHttp.handle(s.historyRequest(body,undefined,{"x-csrf-token":"bad"}))).status).toBe(403);expect((await s.historyHttp.handle(s.historyRequest(body,undefined,{origin:"https://other.invalid"}))).status).toBe(403);
 expect((await s.historyHttp.handle(s.historyRequest(body,undefined,{},"?stageId="+s.query.stageId))).status).toBe(400);expect((await s.historyHttp.handle(s.historyRequest(body,undefined,{},"","GET"))).status).toBe(404);
 for(const extra of [{householdId:s.unrelated.householdId},{role:"practitioner"},{binding:{}},{export:true}])expect((await s.historyHttp.handle(s.historyRequest({...body,...extra}))).status).toBe(400);
 for(const changed of [{stageId:randomUUID()},{applicationId:randomUUID()},{reference:{...s.reference,learnerId:s.unrelated.learnerId}},{withdrawalOperationId:randomUUID()}])expect((await s.historyHttp.handle(s.historyRequest({...body,...changed}))).status).not.toBe(200);
 await expect(s.historyStore.read({...s.parent,role:"practitioner"},body)).rejects.toThrow("FORBIDDEN");expect(await s.snapshot()).toEqual(before);
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);expect((await s.historyHttp.handle(s.historyRequest(body))).status).toBe(401);expect(await s.snapshot()).toEqual(before);
});
test("default constructor remains closed; current owner grant and independent privacy revocation still deny retained content",async()=>{
 const s=await historySetup(),{command}=await s.command();expect((await s.http.handle(s.request("POST",command))).status).toBe(200);const body=s.historyRead(command.operationId),closed=new ClassroomFamilyRetainedHistoryHttp(s.f.runtime,new ClassroomFamilyRetainedHistoryStore(s.f.db,s.f.config,s.f.store));const before=await s.snapshot();
 expect((await closed.handle(s.historyRequest(body))).status).toBe(503);expect(await s.snapshot()).toEqual(before);
 await s.f.pool.query("UPDATE ls_education.account_grants SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);expect((await s.historyHttp.handle(s.historyRequest(body))).status).toBe(403);
 await s.f.pool.query("UPDATE ls_education.account_grants SET active=true WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.owner.id]);await s.f.pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,module_id,version,recorded_by) VALUES($1,$2,$3,$4,'RM-101','synthetic-lesson-v1',$3)",[s.f.workspaceId,randomUUID(),s.f.owner.id,s.reference.learnerId]);const denied=await s.snapshot();expect((await s.historyHttp.handle(s.historyRequest(body))).status).toBe(403);expect(await s.snapshot()).toEqual(denied);
});
test("missing or damaged outer result receipt cannot substitute for the verified native withdrawal manifest",async()=>{
 const s=await historySetup(),{command}=await s.command();expect((await s.http.handle(s.request("POST",command))).status).toBe(200);const before=await s.snapshot();
 for(const missing of [true,false]){
  const db:IdentityStore={transaction:work=>s.f.db.transaction(tx=>work({query:async(q,v=[])=>{const rows=await tx.query(q,v);return (q.includes("FROM ls_fishing_stage.command_receipts")&&v[2]===command.operationId?(missing?[]:rows.map(r=>({...r as object,ciphertext:"invalid"}))):rows) as never;}}))};
  const http=new ClassroomFamilyRetainedHistoryHttp(s.f.runtime,new ClassroomFamilyRetainedHistoryStore(db,s.f.config,s.f.store,systemClock,s.factory));expect((await http.handle(s.historyRequest(s.historyRead(command.operationId)))).status).toBe(503);
 }expect(await s.snapshot()).toEqual(before);
});
