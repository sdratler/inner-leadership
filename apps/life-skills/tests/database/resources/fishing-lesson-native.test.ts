/** Actual loopback PG + production binder/keyring/fresh-session policy. Synthetic
 * identity/session fixtures are NOT password/browser or real-family evidence. */
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {afterAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {seal,tokenDigest} from "../../../src/features/identity/crypto.ts";
import {asId} from "../../../src/lib/ids.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {durableAuditSink} from "../../../src/features/identity/history.ts";
import {FishingLessonHttp} from "../../../src/features/resources/fishing-lesson-http.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {IdentityStore} from "../../../src/features/identity/store.ts";
import {FishingLessonNativeStore,educationCatalogAad} from "../../../src/features/resources/fishing-lesson-native-store.ts";
import {FishingLessonJourney,learnerLessonSchema,lessonJourneyCommandSchema,type LessonReference,type LessonJourneyEvent} from "../../../src/features/resources/fishing-lesson-journey.ts";
import {educationArtifactAad,encodeLessonEvent,type EducationStorageBinding} from "../../../src/features/resources/fishing-lesson-storage-contract.ts";
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
async function setup(options:{state?:"prepared"|"approved";tamper?:"bytes"|"class"|"source";questionCount?:1|2|3}={}){
 const f=await fixture();fixtures.push(f);const learnerId=(await f.pool.query(`SELECT c.person_id AS id FROM ls_cases.cases x JOIN ls_cases.clients c ON c.workspace_id=x.workspace_id AND c.id=x.client_id WHERE x.workspace_id=$1 AND x.id=$2`,[f.workspaceId,f.first.id])).rows[0].id as string;
 const reference={learnerId,moduleId:"RM-101",version:"synthetic-v1"};
 async function seed(ref:LessonReference=reference){
  const state=options.state??"approved",session=(Number(ref.moduleId[3])-1)*12+Number(ref.moduleId.slice(4));
  const lesson=learnerLessonSchema.parse({moduleId:ref.moduleId,version:ref.version,stage:Number(ref.moduleId[3]),locale:"en",title:"Synthetic lesson",instruction:"Synthetic hookless instructions",questions:Array.from({length:options.questionCount??1},(_,index)=>({id:`Q${String(session).padStart(2,"0")}-${index+1}`,prompt:`Synthetic question ${index+1}`})),sourceSha256:"a".repeat(64),status:state});
  const learnerBytes=JSON.stringify(lesson),teacherBytes="SYNTHETIC PRIVATE TEACHER KEY",learnerArtifact=randomUUID(),teacherArtifact=randomUUID();
  const binding:EducationStorageBinding={workspaceId:f.workspaceId,moduleId:ref.moduleId,version:ref.version,state,source:{sourceId:"synthetic-source",revision:"synthetic-revision",sha256:"a".repeat(64)},
   learner:{sourceId:"synthetic-learner-"+learnerArtifact,version:"1",locale:"en",sha256:hash(learnerBytes),storageClass:"resource_learner",state},
   teacher:{sourceId:"synthetic-teacher-"+teacherArtifact,version:"1",locale:"en",sha256:hash(teacherBytes),storageClass:"protected_teacher",state}};
  for(const [id,reference,bytes] of [[learnerArtifact,binding.learner,learnerBytes],[teacherArtifact,binding.teacher,teacherBytes]] as const){
   await f.pool.query(`INSERT INTO ls_education.artifact_versions(workspace_id,id,source_id,version,locale,storage_class,sha256,reference,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [f.workspaceId,id,reference.sourceId,reference.version,reference.locale,options.tamper==="class"&&id===learnerArtifact?"protected_teacher":reference.storageClass,reference.sha256,JSON.stringify(reference),seal(options.tamper==="bytes"&&id===learnerArtifact?"synthetic replaced bytes":bytes,educationArtifactAad(f.workspaceId,reference),f.keyring)]);
  }
  await f.pool.query(`INSERT INTO ls_education.catalog_versions(workspace_id,module_id,version,source_id,source_revision,source_sha256,learner_artifact_id,teacher_artifact_id,payload_ciphertext,approval_state,approval_provenance,approved_by,approved_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'synthetic-approved-fixture',$11,clock_timestamp())`,[f.workspaceId,ref.moduleId,ref.version,binding.source.sourceId,binding.source.revision,options.tamper==="source"?"b".repeat(64):binding.source.sha256,learnerArtifact,teacherArtifact,seal(JSON.stringify(binding),educationCatalogAad(f.workspaceId,ref.moduleId,ref.version),f.keyring),state,f.practitioner.actor.id]);
  await f.pool.query(`INSERT INTO ls_education.educational_assignments(workspace_id,learner_id,module_id,version,active,assigned_by) VALUES($1,$2,$3,$4,true,$5)`,[f.workspaceId,ref.learnerId,ref.moduleId,ref.version,f.practitioner.actor.id]);
  for(const [actor,permissions] of [[f.parent.actor,["submit","read_learner","read_parent"]],[f.practitioner.actor,["observe","publish_parent_summary","read_teacher"]]] as const)
   await f.pool.query(`INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,$4,$5,true,$6::text[],$7)`,[f.workspaceId,actor.id,ref.learnerId,ref.moduleId,ref.version,permissions,f.practitioner.actor.id]);
 }
 await seed();await f.pool.query(`INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,clock_timestamp(),'synthetic-independent-guardian-proof',$4)`,[f.workspaceId,learnerId,f.parent.actor.id,f.practitioner.actor.id]);
 const db=poolStore(f.pool),journey=(actor:Actor=f.parent.actor,store:IdentityStore=db,options:{childAccountsEnabled?:boolean}={})=>new FishingLessonJourney(new FishingLessonNativeStore(store,f.keyring,actor,undefined,options),()=>new Date());
 const command=()=>({action:"submit" as const,operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"SYNTHETIC LEARNER ANSWER"}]});
 const count=async()=>((await f.pool.query(`SELECT (SELECT count(*)::int FROM ls_education.lesson_events WHERE workspace_id=$1) AS events,(SELECT count(*)::int FROM ls_education.lesson_heads WHERE workspace_id=$1) AS heads`,[f.workspaceId])).rows[0]);
 return {f,reference,journey,command,count,seed};
}

test("native partial and empty actor-private drafts survive reopen without a final, teacher disclosure or loss on historical final replay",async()=>{
 const s=await setup({questionCount:3}),draft={action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"  PRIVATE_SYNTHETIC_PARTIAL_DRAFT  "}]};
 const saved=await s.journey().save(s.reference,draft);expect((await s.journey().save(s.reference,draft)).duplicate).toBe(true);
 expect(await s.journey().read(s.reference,"learner")).toMatchObject({submission:null,draft:{revisionId:saved.revisionId,answers:draft.answers}});
 const teacher=()=>s.journey(s.f.practitioner.actor),teacherRead=await teacher().read(s.reference,"teacher");expect(teacherRead.submission).toBeNull();expect(teacherRead).not.toHaveProperty("draft");expect(JSON.stringify(teacherRead)).not.toContain("PRIVATE_SYNTHETIC_PARTIAL_DRAFT");
 await expect(teacher().save(s.reference,{...draft,operationId:randomUUID(),expectedRevisionId:saved.revisionId})).rejects.toThrow("FORBIDDEN");
 await expect(s.journey().save(s.reference,{...draft,operationId:randomUUID()})).rejects.toThrow("CONFLICT");
 for(const answers of [[{questionId:"Q02-1",value:"foreign"}],[draft.answers[0]!,draft.answers[0]!]])await expect(s.journey().save(s.reference,{...draft,operationId:randomUUID(),expectedRevisionId:saved.revisionId,answers})).rejects.toThrow("QUESTION_MISMATCH");
 const empty=await s.journey().save(s.reference,{...draft,operationId:randomUUID(),expectedRevisionId:saved.revisionId,answers:[]});expect((await s.journey().read(s.reference,"learner")).draft?.answers).toEqual([]);
 await expect(s.journey().save(s.reference,{...s.command(),expectedRevisionId:empty.revisionId})).rejects.toThrow("QUESTION_MISMATCH");
 const command={...s.command(),expectedRevisionId:empty.revisionId,answers:[1,2,3].map(n=>({questionId:`Q01-${n}`,value:"SYNTHETIC final answer"}))},final=await s.journey().save(s.reference,command);expect((await s.journey().read(s.reference,"learner")).draft).toBeNull();
 const later=await s.journey().save(s.reference,{...draft,operationId:randomUUID(),expectedRevisionId:final.revisionId});expect((await s.journey().save(s.reference,command)).duplicate).toBe(true);expect((await s.journey().read(s.reference,"learner")).draft?.revisionId).toBe(later.revisionId);
 const observe={action:"observe",operationId:randomUUID(),expectedRevisionId:later.revisionId,submissionId:final.revisionId,task:"Synthetic named practical task",assistance:"with_guidance",knowledgeAssessment:{state:"recorded",assessment:"PRIVATE_SYNTHETIC_KNOWLEDGE: identified the three equipment checks"}},observed=await teacher().save(s.reference,observe);
 const corrected=await teacher().save(s.reference,{...observe,operationId:randomUUID(),expectedRevisionId:observed.revisionId,knowledgeAssessment:{state:"not_assessed"}});
 const history=await teacher().read(s.reference,"teacher");expect(history.observations.map(e=>e.command.action==="observe"?e.command.knowledgeAssessment:null)).toEqual([observe.knowledgeAssessment,{state:"not_assessed"}]);expect(history.submission?.revisionId).toBe(final.revisionId);expect(history).not.toHaveProperty("draft");
 await teacher().save(s.reference,{action:"publish_parent_summary",operationId:randomUUID(),expectedRevisionId:corrected.revisionId,observationId:corrected.revisionId,summary:"Synthetic deliberately safe summary",parentAccountIds:[s.f.parent.actor.id]});
 expect(JSON.stringify(await s.journey().read(s.reference,"parent"))).not.toMatch(/PRIVATE_SYNTHETIC|answers|draft|knowledgeAssessment|assistance/);expect((await s.journey().read(s.reference,"learner")).draft?.revisionId).toBe(later.revisionId);
 expect(await s.count()).toEqual({events:7,heads:1});expect(JSON.stringify((await s.f.pool.query("SELECT header,payload_ciphertext FROM ls_education.lesson_events WHERE workspace_id=$1",[s.f.workspaceId])).rows)).not.toMatch(/PRIVATE_SYNTHETIC|equipment checks/);
});

test("another independently authorized guardian cannot read a draft; their final supersedes it by ledger order",async()=>{
 const s=await setup(),other=s.f.parentTwo.actor,args=[s.f.workspaceId,s.reference.learnerId,s.reference.moduleId,s.reference.version,other.id,s.f.practitioner.actor.id];
 await s.f.pool.query("INSERT INTO ls_education.account_grants(workspace_id,learner_id,module_id,version,account_id,active,permissions,granted_by) VALUES($1,$2,$3,$4,$5,true,ARRAY['submit','read_learner','read_parent'],$6)",args);
 await s.f.pool.query("INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,clock_timestamp(),'SYNTHETIC independently verified second guardian',$4)",[s.f.workspaceId,s.reference.learnerId,other.id,s.f.practitioner.actor.id]);
 const command={action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[{questionId:"Q01-1",value:"PRIVATE_SYNTHETIC_PARENT_ONE"}]},saved=await s.journey().save(s.reference,command);
 const otherRead=await s.journey(other).read(s.reference,"learner");expect(otherRead.draft).toBeNull();expect(JSON.stringify(otherRead)).not.toContain("PRIVATE_SYNTHETIC_PARENT_ONE");
 await s.journey(other).save(s.reference,{...s.command(),expectedRevisionId:saved.revisionId});expect((await s.journey().read(s.reference,"learner")).draft).toBeNull();
});

test.each(["session","grant","guardian","source"] as const)("saved draft read and exact replay recheck current %s authority",async kind=>{
 const s=await setup(),command={action:"save_draft",operationId:randomUUID(),expectedRevisionId:null,answers:[]};await s.journey().save(s.reference,command);
 if(kind==="session")await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(kind==="grant")await s.f.pool.query("UPDATE ls_education.account_grants SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(kind==="guardian")await s.f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(kind==="source")await s.f.pool.query("UPDATE ls_education.catalog_versions SET approval_state='withdrawn' WHERE workspace_id=$1",[s.f.workspaceId]);
 await expect(s.journey().read(s.reference,"learner")).rejects.toThrow();await expect(s.journey().save(s.reference,command)).rejects.toThrow();expect(await s.count()).toEqual({events:1,heads:1});
});

test("explicit draft saves share the unchanged500-event capacity; replay cannot poison readable history",async()=>{
 const s=await setup(),last=await seedHistory(s,499),command={action:"save_draft",operationId:randomUUID(),expectedRevisionId:last.revisionId,answers:[]},saved=await s.journey().save(s.reference,command);
 expect((await s.journey().save(s.reference,command)).duplicate).toBe(true);await expect(s.journey().save(s.reference,{...command,operationId:randomUUID(),expectedRevisionId:saved.revisionId})).rejects.toMatchObject({code:"UNAVAILABLE"});expect(await s.count()).toEqual({events:500,heads:1});expect((await s.journey().read(s.reference,"learner")).draft).toMatchObject({revisionId:saved.revisionId,answers:[]});
});

test.each([1,2,3] as const)("native final submission requires all %i approved questions; rejection leaves no revision",async questionCount=>{
 const s=await setup({questionCount}),complete={...s.command(),answers:Array.from({length:questionCount},(_,index)=>({questionId:`Q01-${index+1}`,value:"Synthetic complete answer"})).reverse()};
 await expect(s.journey().save(s.reference,{...complete,answers:complete.answers.slice(1)})).rejects.toThrow();
 expect(await s.count()).toEqual({events:0,heads:0});
 const saved=await s.journey().save(s.reference,complete);
 expect(await s.journey().read(s.reference,"learner")).toMatchObject({submission:{revisionId:saved.revisionId,answers:complete.answers}});
 expect(await s.journey().save(s.reference,complete)).toEqual({revisionId:saved.revisionId,duplicate:true});
 expect(await s.count()).toEqual({events:1,heads:1});
});
test("encrypted save/fresh reload/lost-response replay preserves parent attribution and no clinical/CRM/task/payment effects",async()=>{
 const s=await setup(),protectedTables=["ls_contact_ops.profiles","ls_calendar.tasks","ls_calendar.task_history","ls_cases.case_guardians","ls_identity.accounts","ls_identity.people","ls_onboarding.first_session_orders","ls_identity.auth_mail_outbox"];
 const snapshot=()=>Promise.all(protectedTables.map(async table=>(await s.f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[s.f.workspaceId])).rows)),before=await snapshot();
 const command=s.command(),saved=await s.journey().save(s.reference,command);expect(await s.journey().save(s.reference,command)).toEqual({...saved,duplicate:true});
 const read=await s.journey().read(s.reference,"learner");expect(read).toMatchObject({revisionId:saved.revisionId,submission:{assistedBy:s.f.parent.actor.id,answers:command.answers}});
 const rows=(await s.f.pool.query("SELECT header,payload_ciphertext FROM ls_education.lesson_events WHERE workspace_id=$1",[s.f.workspaceId])).rows;
 expect(JSON.stringify(rows)).not.toMatch(/LEARNER ANSWER|TEACHER KEY/);expect(await s.count()).toEqual({events:1,heads:1});expect(await snapshot()).toEqual(before);
});
test("changed and cross-lesson actor-global operation reuse cannot create another event/head",async()=>{
 const s=await setup(),command=s.command();await s.journey().save(s.reference,command);
 await expect(s.journey().save(s.reference,{...command,answers:[{questionId:"Q01-1",value:"Changed"}]})).rejects.toThrow("CONFLICT");
 const other={...s.reference,moduleId:"RM-102"};await s.seed(other);
 await expect(s.journey().save(other,{...command,answers:[{questionId:"Q02-1",value:"Other lesson"}]})).rejects.toMatchObject({code:"CONFLICT"});expect(await s.count()).toEqual({events:1,heads:1});
});
test("concurrent stale predecessor permits one commit and retains no losing receipt",async()=>{
 const s=await setup(),results=await Promise.allSettled([s.journey().save(s.reference,s.command()),s.journey().save(s.reference,s.command())]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);expect(await s.count()).toEqual({events:1,heads:1});
});
test("failure after event INSERT before head CAS rolls back event and initial head; retry succeeds normally",async()=>{
 const s=await setup(),db=poolStore(s.f.pool),failing:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async(statement,values)=>{if(statement.startsWith("UPDATE ls_education.lesson_heads"))throw Error("SYNTHETIC HEAD FAILURE");return tx.query(statement,values);}}))};
 const command=s.command();await expect(s.journey(s.f.parent.actor,failing).save(s.reference,command)).rejects.toThrow("SYNTHETIC HEAD FAILURE");expect(await s.count()).toEqual({events:0,heads:0});
 await s.journey().save(s.reference,command);expect(await s.count()).toEqual({events:1,heads:1});
});
test("only explicitly published parent summary is returned; teacher observation/private note stays private",async()=>{
 const s=await setup(),submission=await s.journey().save(s.reference,s.command());
 const observation=await s.journey(s.f.practitioner.actor).save(s.reference,{action:"observe",operationId:randomUUID(),expectedRevisionId:submission.revisionId,submissionId:submission.revisionId,task:"Synthetic hookless practice",assistance:"with_guidance",privateNote:"SYNTHETIC PRIVATE OBSERVATION"});
 expect((await s.journey().read(s.reference,"parent")).portfolio).toBeNull();
 await s.journey(s.f.practitioner.actor).save(s.reference,{action:"publish_parent_summary",operationId:randomUUID(),expectedRevisionId:observation.revisionId,observationId:observation.revisionId,summary:"Synthetic approved parent summary",parentAccountIds:[s.f.parent.actor.id]});
 const parent=await s.journey().read(s.reference,"parent");expect(parent.portfolio).toMatchObject({summary:"Synthetic approved parent summary"});expect(JSON.stringify(parent)).not.toMatch(/PRIVATE OBSERVATION|LEARNER ANSWER|TEACHER KEY|privateNote|teacher/);
 expect(JSON.stringify(await s.journey().read(s.reference,"learner"))).not.toMatch(/PRIVATE OBSERVATION|TEACHER KEY/);
 await expect(s.journey().read(s.reference,"teacher")).rejects.toThrow("FORBIDDEN");expect(JSON.stringify(await s.journey(s.f.practitioner.actor).read(s.reference,"teacher"))).toContain("PRIVATE OBSERVATION");
});
test("teacher recipient choices are exact and minimized; missing read_parent does not revoke assisted submission",async()=>{
 const s=await setup(),teacher=()=>s.journey(s.f.practitioner.actor);
 expect((await teacher().read(s.reference,"teacher")).summaryRecipients).toEqual([{accountId:s.f.parent.actor.id,label:`synthetic-${s.f.parent.actor.id}@example.invalid`}]);
 await s.f.pool.query("UPDATE ls_education.account_grants SET permissions=ARRAY['submit','read_learner'] WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 expect((await teacher().read(s.reference,"teacher")).summaryRecipients).toEqual([]);
 const saved=await s.journey().save(s.reference,s.command());
 const learner=await s.journey().read(s.reference,"learner");expect(learner.revisionId).toBe(saved.revisionId);
 expect(JSON.stringify(learner)).not.toMatch(/summaryRecipients|example.invalid|emailCiphertext/);
 await expect(s.journey().read(s.reference,"parent")).rejects.toThrow("FORBIDDEN");
 expect(await s.count()).toEqual({events:1,heads:1});
});
test.each(["grant_missing","grant_inactive","wrong_reference","unverified","revoked_account","guardian","recipient_revocation","no_password"])("recipient %s between teacher read and publication denies atomically",async failure=>{
 const s=await setup(),submission=await s.journey().save(s.reference,s.command()),teacher=s.journey(s.f.practitioner.actor);
 const observed=await teacher.save(s.reference,{action:"observe",operationId:randomUUID(),expectedRevisionId:submission.revisionId,submissionId:submission.revisionId,task:"Synthetic practice",assistance:"with_guidance",privateNote:"PRIVATE SYNTHETIC NOTE"});
 expect((await teacher.read(s.reference,"teacher")).summaryRecipients?.map(p=>p.accountId)).toEqual([s.f.parent.actor.id]);
 if(failure==="wrong_reference")await s.seed({...s.reference,moduleId:"RM-102"});
 if(failure==="grant_missing"||failure==="wrong_reference")await s.f.pool.query("DELETE FROM ls_education.account_grants WHERE workspace_id=$1 AND account_id=$2 AND module_id=$3",[s.f.workspaceId,s.f.parent.actor.id,s.reference.moduleId]);
 if(failure==="grant_inactive")await s.f.pool.query("UPDATE ls_education.account_grants SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(failure==="unverified"){
  await expect(s.f.pool.query("UPDATE ls_identity.accounts SET email_verified_at=NULL WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id])).rejects.toMatchObject({code:"23514"});
  await s.f.pool.query("UPDATE ls_identity.accounts SET state='invited',email_verified_at=NULL WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 }
 if(failure==="revoked_account")await s.f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(failure==="guardian")await s.f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(failure==="recipient_revocation")await s.f.pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,recorded_by) VALUES($1,$2,$3,$4,$5)",[s.f.workspaceId,randomUUID(),s.f.parent.actor.id,s.reference.learnerId,s.f.practitioner.actor.id]);
 if(failure==="no_password"){
  await expect(s.f.pool.query("UPDATE ls_identity.accounts SET password_hash=NULL WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id])).rejects.toMatchObject({code:"23514"});
  await s.f.pool.query("UPDATE ls_identity.accounts SET state='invited',password_hash=NULL WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 }
 await expect(teacher.save(s.reference,{action:"publish_parent_summary",operationId:randomUUID(),expectedRevisionId:observed.revisionId,observationId:observed.revisionId,summary:"Synthetic summary",parentAccountIds:[s.f.parent.actor.id]})).rejects.toThrow("FORBIDDEN");
 expect(await s.count()).toEqual({events:2,heads:1});
 expect((await s.f.pool.query("SELECT revision_id FROM ls_education.lesson_heads WHERE workspace_id=$1 AND learner_id=$2 AND module_id=$3",[s.f.workspaceId,s.reference.learnerId,s.reference.moduleId])).rows[0].revision_id).toBe(observed.revisionId);
});
test("committed publication replay stays exact after recipient grant withdrawal but a new publication is forbidden",async()=>{
 const s=await setup(),submission=await s.journey().save(s.reference,s.command()),teacher=s.journey(s.f.practitioner.actor);
 const observed=await teacher.save(s.reference,{action:"observe",operationId:randomUUID(),expectedRevisionId:submission.revisionId,submissionId:submission.revisionId,task:"Synthetic practice",assistance:"independent"});
 const command={action:"publish_parent_summary",operationId:randomUUID(),expectedRevisionId:observed.revisionId,observationId:observed.revisionId,summary:"Synthetic summary",parentAccountIds:[s.f.parent.actor.id]},saved=await teacher.save(s.reference,command);
 await s.f.pool.query("UPDATE ls_education.account_grants SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 expect(await teacher.save(s.reference,command)).toEqual({...saved,duplicate:true});
 await expect(teacher.save(s.reference,{...command,operationId:randomUUID(),expectedRevisionId:saved.revisionId})).rejects.toThrow("FORBIDDEN");
 await expect(s.journey().read(s.reference,"parent")).rejects.toThrow("FORBIDDEN");expect(await s.count()).toEqual({events:3,heads:1});
});
test.each(["assignment","grant","guardian","session","revocation"])("fresh %s revocation denies retained read and replay, without erasing saved history",async kind=>{
 const s=await setup(),command=s.command();await s.journey().save(s.reference,command);
 if(kind==="assignment")await s.f.pool.query("UPDATE ls_education.educational_assignments SET active=false WHERE workspace_id=$1",[s.f.workspaceId]);
 if(kind==="grant")await s.f.pool.query("UPDATE ls_education.account_grants SET active=false WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(kind==="guardian")await s.f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1",[s.f.workspaceId]);
 if(kind==="session")await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 if(kind==="revocation")await s.f.pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,recorded_by) VALUES($1,$2,$3,$4,$5)",[s.f.workspaceId,randomUUID(),s.f.parent.actor.id,s.reference.learnerId,s.f.practitioner.actor.id]);
 await expect(s.journey().read(s.reference,"learner")).rejects.toThrow();await expect(s.journey().save(s.reference,command)).rejects.toThrow();expect(await s.count()).toEqual({events:1,heads:1});
});
test("clinical parent authority and unrelated role/workspace are not education access",async()=>{
 const s=await setup();await expect(s.journey(s.f.parentTwo.actor).read(s.reference,"learner")).rejects.toThrow("FORBIDDEN");
 await expect(s.journey(s.f.outsider.actor).save(s.reference,s.command())).rejects.toThrow("FORBIDDEN");
 const other=await fixture();fixtures.push(other);await expect(s.journey(other.parent.actor).read(s.reference,"learner")).rejects.toThrow("FORBIDDEN");expect(await s.count()).toEqual({events:0,heads:0});
});
test("fresh account role overrides a captured practitioner before teacher access",async()=>{
 const s=await setup();await s.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.practitioner.actor.id]);
 await expect(s.journey(s.f.practitioner.actor).read(s.reference,"teacher")).rejects.toThrow("FORBIDDEN");expect(await s.count()).toEqual({events:0,heads:0});
});
test.each(["bytes","class","source"] as const)("actual %s artifact/source drift is denied before save",async tamper=>{
 const s=await setup({tamper});await expect(s.journey().save(s.reference,s.command())).rejects.toMatchObject({code:"UNAVAILABLE"});expect(await s.count()).toEqual({events:0,heads:0});
});
test("Draft or withdrawn approval never becomes delivery because hashes/grants match",async()=>{
 const draft=await setup({state:"prepared"});await expect(draft.journey().read(draft.reference,"learner")).rejects.toThrow("FORBIDDEN");
 const s=await setup();await s.f.pool.query("UPDATE ls_education.catalog_versions SET approval_state='withdrawn' WHERE workspace_id=$1",[s.f.workspaceId]);await expect(s.journey().save(s.reference,s.command())).rejects.toThrow("FORBIDDEN");
 await expect(s.f.pool.query("UPDATE ls_education.catalog_versions SET approval_state='approved' WHERE workspace_id=$1",[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
});
test("actual immutable bytes/catalog/event guards reject mutation; event header is bound to native actor/operation/predecessor",async()=>{
 const s=await setup();await s.journey().save(s.reference,s.command());
 for(const sql of ["UPDATE ls_education.artifact_versions SET payload_ciphertext='changed' WHERE workspace_id=$1","UPDATE ls_education.catalog_versions SET source_revision='changed' WHERE workspace_id=$1","UPDATE ls_education.lesson_events SET header='{}'::jsonb WHERE workspace_id=$1","DELETE FROM ls_education.lesson_events WHERE workspace_id=$1"])
  await expect(s.f.pool.query(sql,[s.f.workspaceId])).rejects.toMatchObject({code:"23514"});
 expect(await s.count()).toEqual({events:1,heads:1});
});
async function seedHistory(s:Awaited<ReturnType<typeof setup>>,count:number){
 let previous:string|null=null,last:ReturnType<typeof lessonJourneyCommandSchema.parse>|null=null;
 for(let i=0;i<count;i++){
  const command=lessonJourneyCommandSchema.parse({...s.command(),expectedRevisionId:previous}),event:LessonJourneyEvent={id:randomUUID(),operationId:command.operationId,digest:"",previousRevisionId:previous,workspaceId:s.f.workspaceId,...s.reference,sourceSha256:"a".repeat(64),actorId:s.f.parent.actor.id,actorRole:"parent",at:new Date().toISOString(),command};
  event.digest=hash(JSON.stringify({ref:s.reference,command,actorId:event.actorId,workspaceId:event.workspaceId,sourceSha256:event.sourceSha256}));const encrypted=encodeLessonEvent(event,s.f.keyring);
  await s.f.pool.query(`INSERT INTO ls_education.lesson_events(workspace_id,id,learner_id,module_id,version,actor_account_id,operation_id,previous_revision_id,digest,header,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,[event.workspaceId,event.id,event.learnerId,event.moduleId,event.version,event.actorId,event.operationId,previous,event.digest,JSON.stringify(encrypted.header),encrypted.ciphertext]);previous=event.id;last=command;
 }
 await s.f.pool.query("INSERT INTO ls_education.lesson_heads(workspace_id,learner_id,module_id,version,revision_id) VALUES($1,$2,$3,$4,$5)",[s.f.workspaceId,s.reference.learnerId,s.reference.moduleId,s.reference.version,previous]);
 if(!last||!previous)throw Error("EMPTY_SYNTHETIC_HISTORY");return {command:last,revisionId:previous};
}
test("history overflow is rejected, not a truncated partial learner projection",async()=>{
 const s=await setup();await seedHistory(s,501);
 await expect(s.journey().read(s.reference,"learner")).rejects.toMatchObject({code:"UNAVAILABLE"});expect(await s.count()).toEqual({events:501,heads:1});
});
test("RM-EDU-HISTORY-CAPACITY-01:500 remains readable/replayable; concurrent new append is atomically denied without poisoning history",async()=>{
 const s=await setup(),last=await seedHistory(s,500);
 expect((await s.journey().read(s.reference,"learner"))).toMatchObject({revisionId:last.revisionId});
 expect(await s.journey().save(s.reference,last.command)).toEqual({revisionId:last.revisionId,duplicate:true});
 const results=await Promise.allSettled(Array.from({length:2},()=>s.journey().save(s.reference,{...s.command(),expectedRevisionId:last.revisionId})));
 expect(results.every(r=>r.status==="rejected"&&r.reason.code==="UNAVAILABLE")).toBe(true);
 expect(await s.count()).toEqual({events:500,heads:1});expect((await s.journey().read(s.reference,"learner"))).toMatchObject({revisionId:last.revisionId});
 // Capacity belongs to this aggregate, not the entire family/workspace.
 const other={...s.reference,moduleId:"RM-102"};await s.seed(other);
 await s.journey().save(other,{...s.command(),answers:[{questionId:"Q02-1",value:"Separate synthetic lesson"}]});
 expect(await s.count()).toEqual({events:501,heads:2});expect((await s.journey().read(s.reference,"learner"))).toMatchObject({revisionId:last.revisionId});
});
test("fresh optional child identity can submit only for its own explicitly assigned person",async()=>{
 const s=await setup(),id=asId(randomUUID(),"account"),token=randomBytes(32).toString("base64url"),person=asId(s.reference.learnerId,"person"),actor:Actor={...s.f.parent.actor,id,personId:person,role:"child",sessionDigest:tokenDigest(token)};
 await s.f.pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'child','active','en',$3,$4,clock_timestamp(),'synthetic-not-password-login',clock_timestamp(),clock_timestamp())`,[id,s.f.workspaceId,hash(id),seal("synthetic-child@example.invalid",`email:${s.f.workspaceId}:${id}`,s.f.keyring)]);
 await s.f.pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[s.f.workspaceId,id,person]);
 await s.f.pool.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,clock_timestamp(),$4)",[actor.sessionDigest,s.f.workspaceId,id,new Date(actor.expiresAt)]);
 await s.f.pool.query(`INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,$4,$5,true,ARRAY['submit','read_learner'],$6)`,[s.f.workspaceId,id,person,s.reference.moduleId,s.reference.version,s.f.practitioner.actor.id]);
 await expect(s.journey(actor).save(s.reference,s.command())).rejects.toThrow("FORBIDDEN");
 const enabled=()=>s.journey(actor,poolStore(s.f.pool),{childAccountsEnabled:true});
 const saved=await enabled().save(s.reference,s.command()),read=await enabled().read(s.reference,"learner");expect(read).toMatchObject({revisionId:saved.revisionId,submission:{submittedBy:id,assistedBy:null}});
 await expect(enabled().read(s.reference,"teacher")).rejects.toThrow("FORBIDDEN");
 await s.f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1",[s.f.workspaceId]);
 await expect(enabled().read(s.reference,"learner")).rejects.toThrow("FORBIDDEN");
 await expect(s.journey(s.f.practitioner.actor).read(s.reference,"teacher")).rejects.toThrow("FORBIDDEN");
 await s.f.pool.query("UPDATE ls_education.guardian_authorities SET active=true WHERE workspace_id=$1",[s.f.workspaceId]);
 const unrelatedMinor=(await s.f.pool.query(`SELECT c.person_id AS id FROM ls_cases.cases x JOIN ls_cases.clients c ON c.workspace_id=x.workspace_id AND c.id=x.client_id WHERE x.workspace_id=$1 AND x.id=$2`,[s.f.workspaceId,s.f.second.id])).rows[0].id;
 await s.f.pool.query("UPDATE ls_identity.account_subjects SET person_id=$3 WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,id,unrelatedMinor]);
 await expect(enabled().read(s.reference,"learner")).rejects.toThrow("FORBIDDEN");expect(await s.count()).toEqual({events:1,heads:1});
});
test("identity schema refuses active/unverified email; a valid pending transition invalidates the captured actor",async()=>{
 const s=await setup();await expect(s.f.pool.query("UPDATE ls_identity.accounts SET email_verified_at=NULL WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id])).rejects.toMatchObject({code:"23514"});
 await s.f.pool.query("UPDATE ls_identity.accounts SET state='invited',email_verified_at=NULL WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.parent.actor.id]);
 await expect(s.journey().save(s.reference,s.command())).rejects.toMatchObject({code:"UNAUTHENTICATED"});expect(await s.count()).toEqual({events:0,heads:0});
});
test.each(["actor","operation","predecessor","ciphertext"])("native encrypted event %s substitution fails closed",async tamper=>{
 const s=await setup(),id=randomUUID(),command=lessonJourneyCommandSchema.parse({...s.command(),expectedRevisionId:tamper==="predecessor"?randomUUID():null});
 const event:LessonJourneyEvent={id,operationId:command.operationId,digest:"",previousRevisionId:command.expectedRevisionId,workspaceId:s.f.workspaceId,...s.reference,sourceSha256:"a".repeat(64),actorId:tamper==="actor"?s.f.outsider.actor.id:s.f.parent.actor.id,actorRole:"parent",at:new Date().toISOString(),command};
 event.digest=hash(JSON.stringify({ref:s.reference,command,actorId:event.actorId,workspaceId:event.workspaceId,sourceSha256:event.sourceSha256}));const encoded=encodeLessonEvent(event,s.f.keyring);
 const otherCipher=encodeLessonEvent({...event,id:randomUUID()},s.f.keyring).ciphertext;
 await s.f.pool.query(`INSERT INTO ls_education.lesson_events(workspace_id,id,learner_id,module_id,version,actor_account_id,operation_id,previous_revision_id,digest,header,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9::jsonb,$10)`,
  [s.f.workspaceId,id,s.reference.learnerId,s.reference.moduleId,s.reference.version,s.f.parent.actor.id,tamper==="operation"?randomUUID():command.operationId,event.digest,JSON.stringify(encoded.header),tamper==="ciphertext"?otherCipher:encoded.ciphertext]);
 await s.f.pool.query("INSERT INTO ls_education.lesson_heads(workspace_id,learner_id,module_id,version,revision_id) VALUES($1,$2,$3,$4,$5)",[s.f.workspaceId,s.reference.learnerId,s.reference.moduleId,s.reference.version,id]);
 await expect(s.journey().read(s.reference,"learner")).rejects.toThrow();expect(await s.count()).toEqual({events:1,heads:1});
});
test("unmounted HTTP through actual native session/rate adapters saves/replays/reads; bad origin, CSRF and revoked session do not fall back",async()=>{
 const s=await setup(),db=poolStore(s.f.pool),clock={now:()=>new Date()},origin="https://synthetic-education.example.invalid",config={enabled:true,origin,workspaceId:s.f.workspaceId,keyring:s.f.keyring,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:"synthetic-education-http-rate-key",sessionSeconds:28800};
 const sessions=new IdentitySessions(db,config,clock),http=new FishingLessonHttp({config,sessions,limits:new PostgresIdentityRateStore(db),audit:durableAuditSink(db),clock},actor=>s.journey(actor));
 const command=s.command(),request=(overrides:Record<string,string>={})=>new Request(origin+"/api/resources/education/lesson",{method:"POST",headers:{cookie:SESSION_COOKIE+"="+s.f.parent.token,origin,"x-csrf-token":sessions.csrf(s.f.parent.token),"sec-fetch-site":"same-origin","content-type":"application/json",...overrides},body:JSON.stringify({reference:s.reference,command})});
 const saved=await http.handle(request()),result=await saved.json();expect(saved.status).toBe(200);expect((await (await http.handle(request())).json()).data).toEqual({...result.data,duplicate:true});
 const get=await http.handle(new Request(origin+"/api/resources/education/lesson?"+new URLSearchParams({...s.reference,view:"learner"}),{headers:{cookie:SESSION_COOKIE+"="+s.f.parent.token}}));expect(get.status).toBe(200);expect((await get.json()).data.revisionId).toBe(result.data.revisionId);
 for(const patch of [{origin:"https://evil.invalid"},{"x-csrf-token":"wrong"}])expect((await http.handle(request(patch))).status).toBe(403);
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[s.f.workspaceId,s.f.parent.actor.id]);expect((await http.handle(request())).status).toBe(401);expect(await s.count()).toEqual({events:1,heads:1});
});
