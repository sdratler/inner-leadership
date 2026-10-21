import {describe,expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("server-only",()=>({}));
import {FishingLessonJourney,learnerLessonSchema,lessonJourneyCommandSchema,
 type LessonJourneyContext,type LessonJourneyEvent,type LessonJourneyStore} from "../../../src/features/resources/fishing-lesson-journey.ts";
import {FishingLessonCard} from "../../../src/features/resources/fishing-lesson-card.tsx";
import {asId} from "../../../src/lib/ids.ts";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const instant=new Date("2026-10-14T15:00:00Z"),ref={learnerId:id(3),moduleId:"RM-101",version:"synthetic-v1"};
const lesson=learnerLessonSchema.parse({moduleId:"RM-101",version:ref.version,stage:1,locale:"en",title:"Synthetic hookless lesson",
 instruction:"Synthetic instruction only.",questions:[{id:"Q01-1",prompt:"Describe your synthetic practice."}],sourceSha256:"a".repeat(64),status:"approved"});
function context(role:LessonJourneyContext["actor"]["role"]="parent"):LessonJourneyContext{
 const actorId=role==="parent"?id(2):role==="child"?id(4):id(1);
 return {actor:{id:asId(actorId,"account"),workspaceId:asId(id(9),"workspace"),personId:asId(id(3),"person"),role,
  state:"active",locale:"en",sessionDigest:"synthetic",expiresAt:instant.getTime()+60000},sessionRevoked:false,lesson,
  assignment:{workspaceId:id(9),learnerId:id(3),moduleId:ref.moduleId,version:ref.version,active:true},
  grant:{workspaceId:id(9),accountId:actorId,learnerId:id(3),moduleId:ref.moduleId,version:ref.version,active:true,
   permissions:["submit","observe","publish_parent_summary","read_learner","read_parent","read_teacher"]},authorizedParentAccountIds:[id(2)],
   eligibleSummaryRecipients:[{accountId:id(2),label:"synthetic-parent@example.invalid"}]};
}
// Isolated synthetic repository, explicitly NOT native-storage or ordinary-login evidence.
class Fixture implements LessonJourneyStore{
 current=context();events:LessonJourneyEvent[]=[];reads=0;appends=0;failAppend=false;
 private tail:Promise<void>=Promise.resolve();
 async transaction<T>(work:Parameters<LessonJourneyStore["transaction"]>[0]):Promise<T>{
  const before=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>{release=resolve;});await before;
  const snapshot=structuredClone(this.events);
  try{return await work({resolveFreshContext:async()=>structuredClone(this.current),
   readEvents:async()=>{this.reads++;return structuredClone(this.events);},
   append:async(event,expected)=>{
    if(this.failAppend)throw Error("SYNTHETIC_STORAGE_FAILURE");
    if((this.events.at(-1)?.id??null)!==expected)throw Error("SYNTHETIC_CAS_CONFLICT");
    this.appends++;this.events.push(structuredClone(event));
   }}) as T;
  }catch(error){this.events=snapshot;throw error;}finally{release();}
 }
 reload(){const next=new Fixture();next.current=structuredClone(this.current);next.events=JSON.parse(JSON.stringify(this.events));return next;}
}
const service=(fixture:Fixture)=>new FishingLessonJourney(fixture,()=>instant);
const submit=(operation=10,expected:string|null=null)=>({action:"submit",operationId:id(operation),expectedRevisionId:expected,
 answers:[{questionId:"Q01-1",value:"Synthetic learner work, not a private parent summary."}]});
async function preparedJourney(){
 const db=new Fixture(),app=service(db),submission=await app.save(ref,submit());
 db.current=context("practitioner");
 const observed=await app.save(ref,{action:"observe",operationId:id(11),expectedRevisionId:submission.revisionId,
  submissionId:submission.revisionId,task:"Hookless practice",assistance:"with_guidance",privateNote:"SYNTHETIC PRIVATE NOTE"});
 return {db,app,submission,observed};
}
describe("prepared Real Mensch transactional journey — synthetic port only",()=>{
 it("saves attributed assisted work, reloads, observes, deliberately publishes and reloads a closed parent portfolio",async()=>{
  const {db,app,observed}=await preparedJourney();
  db.current=context("parent");expect((await app.read(ref,"parent")).portfolio).toBeNull();
  const learner=await app.read(ref,"learner");expect(learner).toMatchObject({submission:{assistedBy:id(2),submittedBy:id(2)}});
  db.current=context("practitioner");
  const shared=await app.save(ref,{action:"publish_parent_summary",operationId:id(12),expectedRevisionId:observed.revisionId,
   observationId:observed.revisionId,summary:"Practised a hookless task with guidance.",parentAccountIds:[id(2)]});
  const reopened=db.reload();reopened.current=context("parent");
  const portfolio=await service(reopened).read(ref,"parent");
  expect(portfolio).toEqual({moduleId:"RM-101",version:ref.version,portfolio:{revisionId:shared.revisionId,
   summary:"Practised a hookless task with guidance.",publishedAt:instant.toISOString(),sourceSha256:"a".repeat(64)}});
  expect(JSON.stringify(portfolio)).not.toMatch(/PRIVATE NOTE|learner work|answers|assistance|safety|payment|score|teacherGuide/);
  expect(db.events).toHaveLength(3);expect(db.events[1]!.command).toMatchObject({privateNote:"SYNTHETIC PRIVATE NOTE"});
 });
 it("replays exact saved work after reload without duplicates; changed operation conflicts",async()=>{
  const db=new Fixture(),saved=await service(db).save(ref,submit()),reopened=db.reload();
  expect(await service(reopened).save(ref,submit())).toEqual({revisionId:saved.revisionId,duplicate:true});
  await expect(service(reopened).save(ref,{...submit(),answers:[{questionId:"Q01-1",value:"changed"}]})).rejects.toThrow("CONFLICT");
  expect(reopened.events).toHaveLength(1);
 });
 it("serializes concurrent stale submissions and preserves the winner",async()=>{
  const db=new Fixture(),results=await Promise.allSettled([service(db).save(ref,submit(10)),service(db).save(ref,submit(20))]);
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(db.events).toHaveLength(1);
 });
 it("keeps storage errors genuine, preserves input, and allows exact retry",async()=>{
  const db=new Fixture(),input=submit();db.failAppend=true;
  await expect(service(db).save(ref,input)).rejects.toThrow("STORAGE_FAILURE");expect(db.events).toHaveLength(0);
  expect(input.answers[0]!.value).toContain("Synthetic learner");db.failAppend=false;
  await service(db).save(ref,input);expect(db.events).toHaveLength(1);
 });
 it.each(["revoked_session","expired","revoked_account","inactive_assignment","inactive_grant","wrong_family","wrong_workspace","wrong_account","missing_permission","draft_catalog","withdrawn_catalog","version_drift"])("denies %s before reading learner records",async failure=>{
  const db=new Fixture();
  if(failure==="revoked_session")db.current.sessionRevoked=true;
  if(failure==="expired")db.current.actor.expiresAt=instant.getTime();
  if(failure==="revoked_account")db.current.actor.state="revoked";
  if(failure==="inactive_assignment")db.current.assignment.active=false;
  if(failure==="inactive_grant")db.current.grant.active=false;
  if(failure==="wrong_family")db.current.grant.learnerId=id(99);
  if(failure==="wrong_workspace")db.current.grant.workspaceId=id(99);
  if(failure==="wrong_account")db.current.grant.accountId=id(99);
  if(failure==="missing_permission")db.current.grant.permissions=[];
  if(failure==="draft_catalog")db.current.lesson={...lesson,status:"prepared"};
  if(failure==="withdrawn_catalog")db.current.lesson={...lesson,status:"withdrawn"};
  if(failure==="version_drift")db.current.assignment.version="synthetic-v2";
  await expect(service(db).save(ref,submit())).rejects.toThrow("FORBIDDEN");expect(db.reads).toBe(0);expect(db.appends).toBe(0);
 });
 it("rechecks revoked access before replaying a previously successful operation",async()=>{
  const db=new Fixture();await service(db).save(ref,submit());db.current.grant.active=false;
  await expect(service(db).save(ref,submit())).rejects.toThrow("FORBIDDEN");expect(db.events).toHaveLength(1);
 });
 it.each(["parent","child","adult_client"])("denies %s teacher read/write even with mislabeled permissions",async role=>{
  const {db,submission}=await preparedJourney();db.current=context(role as LessonJourneyContext["actor"]["role"]);
  await expect(service(db).read(ref,"teacher")).rejects.toThrow("FORBIDDEN");
  await expect(service(db).save(ref,{action:"observe",operationId:id(20),expectedRevisionId:db.events.at(-1)!.id,
   submissionId:submission.revisionId,task:"task",assistance:"independent"})).rejects.toThrow("FORBIDDEN");
 });
 it("child submissions are own work and cannot become parent impersonation",async()=>{
  const db=new Fixture();db.current=context("child");await service(db).save(ref,submit());
  expect(await service(db).read(ref,"learner")).toMatchObject({submission:{submittedBy:id(4),assistedBy:null}});
  db.current.actor.personId=asId(id(99),"person");await expect(service(db).read(ref,"learner")).rejects.toThrow("FORBIDDEN");
 });
 it("requires current authorized parent relationship even for an active grant",async()=>{
  const db=new Fixture();db.current.authorizedParentAccountIds=[];
  await expect(service(db).save(ref,submit())).rejects.toThrow("FORBIDDEN");await expect(service(db).read(ref,"parent")).rejects.toThrow("FORBIDDEN");
  await expect(service(db).read(ref,"learner")).rejects.toThrow("FORBIDDEN");
 });
 it("rejects foreign/duplicate question IDs and client actor/readiness fields",async()=>{
  const db=new Fixture();for(const answers of [[{questionId:"Q02-1",value:"x"}],[...submit().answers,...submit().answers]])
   await expect(service(db).save(ref,{...submit(),answers})).rejects.toThrow("QUESTION_MISMATCH");
  for(const extra of [{actorId:id(1)},{passed:true},{safetyClearance:true},{paymentVerified:true},{teacherAnswer:"x"}])
   expect(lessonJourneyCommandSchema.safeParse({...submit(),...extra}).success).toBe(false);
 });
 it.each([1,2,3])("requires every approved question for final submission (%i questions), while complete work replays",async count=>{
  const db=new Fixture(),app=service(db);
  db.current.lesson=learnerLessonSchema.parse({...lesson,questions:Array.from({length:count},(_,index)=>({id:`Q01-${index+1}`,prompt:`Synthetic question ${index+1}`}))});
  const complete={...submit(),answers:db.current.lesson.questions.map(question=>({questionId:question.id,value:"Synthetic complete answer"})).reverse()};
  const incomplete={...complete,answers:complete.answers.slice(1)};
  await expect(app.save(ref,incomplete)).rejects.toThrow();expect(db.events).toHaveLength(0);expect(db.appends).toBe(0);
  const saved=await app.save(ref,complete),reloaded=service(db.reload());
  expect(await reloaded.read(ref,"learner")).toMatchObject({submission:{revisionId:saved.revisionId,answers:complete.answers}});
  expect(await reloaded.save(ref,complete)).toEqual({revisionId:saved.revisionId,duplicate:true});
  expect(db.events).toHaveLength(1);
 });
 it("new work invalidates old observation for a new share, without silently replacing a historical share",async()=>{
  const {db,app,observed}=await preparedJourney(),published=await app.save(ref,{action:"publish_parent_summary",operationId:id(12),
   expectedRevisionId:observed.revisionId,observationId:observed.revisionId,summary:"Exact version one.",parentAccountIds:[id(2)]});
  db.current=context("parent");const newer=await app.save(ref,submit(13,published.revisionId));
  expect(await app.read(ref,"parent")).toMatchObject({portfolio:{revisionId:published.revisionId,summary:"Exact version one."}});
  db.current=context("practitioner");await expect(app.save(ref,{action:"publish_parent_summary",operationId:id(14),expectedRevisionId:newer.revisionId,
   observationId:observed.revisionId,summary:"Wrong old observation",parentAccountIds:[id(2)]})).rejects.toThrow("OBSERVATION_MISMATCH");
 });
 it("refuses a wrong-parent or duplicate audience and does not publish",async()=>{
  const {db,app,observed}=await preparedJourney();for(const parentAccountIds of [[id(99)],[id(2),id(2)]])
   await expect(app.save(ref,{action:"publish_parent_summary",operationId:id(12),expectedRevisionId:observed.revisionId,
    observationId:observed.revisionId,summary:"safe",parentAccountIds})).rejects.toThrow("FORBIDDEN");
  expect(db.events).toHaveLength(2);
 });
 it("keeps publication recipients teacher-only and rechecks eligibility after the teacher read",async()=>{
  const {db,app,observed}=await preparedJourney();
  expect(await app.read(ref,"teacher")).toMatchObject({summaryRecipients:[{accountId:id(2),label:"synthetic-parent@example.invalid"}]});
  db.current.eligibleSummaryRecipients=[];
  await expect(app.save(ref,{action:"publish_parent_summary",operationId:id(12),expectedRevisionId:observed.revisionId,
   observationId:observed.revisionId,summary:"safe",parentAccountIds:[id(2)]})).rejects.toThrow("FORBIDDEN");
  expect(db.events).toHaveLength(2);
  db.current=context("parent");db.current.eligibleSummaryRecipients=[];
  expect(JSON.stringify(await app.read(ref,"parent"))).not.toMatch(/summaryRecipients|synthetic-parent/);
  expect(JSON.stringify(await app.read(ref,"learner"))).not.toMatch(/summaryRecipients|synthetic-parent/);
  await app.save(ref,submit(13,observed.revisionId)); // submit authority is independent.
  expect(db.events).toHaveLength(3);
 });
 it("preserves committed actor-bound publication replay without authorizing a new ineligible share",async()=>{
  const {db,app,observed}=await preparedJourney(),command={action:"publish_parent_summary",operationId:id(12),expectedRevisionId:observed.revisionId,
   observationId:observed.revisionId,summary:"safe",parentAccountIds:[id(2)]};
  const saved=await app.save(ref,command);db.current.eligibleSummaryRecipients=[];
  expect(await app.save(ref,command)).toEqual({...saved,duplicate:true});
  await expect(app.save(ref,{...command,operationId:id(14),expectedRevisionId:saved.revisionId})).rejects.toThrow("FORBIDDEN");
  expect(db.events).toHaveLength(3);
 });
 it("rejects source-byte drift and broken history rather than returning a successful empty portfolio",async()=>{
  const {db,app}=await preparedJourney();db.current.lesson={...lesson,sourceSha256:"b".repeat(64)};
  await expect(app.read(ref,"teacher")).rejects.toThrow("LEDGER_MISMATCH");db.current.lesson=lesson;
  db.events[1]!.previousRevisionId=null;await expect(app.read(ref,"teacher")).rejects.toThrow("LEDGER_MISMATCH");
 });
 it("supports four stages/stable IDs without mutating the old rank catalog or embedding answer fields",()=>{
  for(let stage=1;stage<=4;stage++)for(let week=1;week<=12;week++){
   const n=(stage-1)*12+week;
   expect(learnerLessonSchema.safeParse({...lesson,stage,moduleId:`RM-${stage}${String(week).padStart(2,"0")}`,
    questions:[{id:`Q${String(n).padStart(2,"0")}-1`,prompt:"Synthetic question"}]}).success).toBe(true);
  }
  expect(learnerLessonSchema.safeParse({...lesson,stage:2}).success).toBe(false);
  expect(learnerLessonSchema.safeParse({...lesson,teacherGuide:"private"}).success).toBe(false);
 });
 it("renders a reusable real component with collapsed details, retained answers, genuine error and no private key",()=>{
  const html=renderToStaticMarkup(createElement(FishingLessonCard,{lesson,answers:{"Q01-1":"retained synthetic answer"},onAnswer:()=>{},onSubmit:()=>{},
   error:"Synthetic explicit error for isolated component test"}));
  expect(html).toContain("retained synthetic answer");expect(html).toContain('role="alert"');expect(html).toContain("Submit my work");
  expect(html).toMatch(/<details\b[^>]*>/);expect(html).not.toMatch(/<details\b[^>]*\sopen(?:=|\s|>)/);expect(html).not.toMatch(/teacherGuide|PRIVATE NOTE|role-switch|price/);
 });
 it("retains the same readable component with Hebrew controls and disabled unchanged submission",()=>{
  const html=renderToStaticMarkup(createElement(FishingLessonCard,{lesson,locale:"he",answers:{"Q01-1":"טיוטה"},onAnswer:()=>{},onSubmit:()=>{},canSubmit:false}));
  expect(html).toContain("שליחת העבודה שלי");expect(html).toContain('class="lsw-input"');expect(html).toContain("טיוטה");
  expect(html).toMatch(/<button[^>]*disabled/);expect(html).not.toMatch(/<textarea[^>]*disabled/);expect(html).not.toMatch(/<details\b[^>]*\sopen(?:=|\s|>)/);
 });
});

it("durable draft is actor-private partial work and empty draft is not a final submission",async()=>{
 const db=new Fixture(),app=service(db),command={action:"save_draft",operationId:id(71),expectedRevisionId:null,answers:[]};
 const saved=await app.save(ref,command);expect((await app.read(ref,"learner")).draft).toMatchObject({revisionId:saved.revisionId,answers:[]});expect((await app.read(ref,"learner")).submission).toBeNull();
 db.current=context("practitioner");expect(await app.read(ref,"teacher")).not.toHaveProperty("draft");await expect(app.save(ref,{...command,operationId:id(72),expectedRevisionId:saved.revisionId})).rejects.toThrow("FORBIDDEN");
 db.current=context("parent");expect((await service(db.reload()).read(ref,"learner")).draft?.answers).toEqual([]);
});
