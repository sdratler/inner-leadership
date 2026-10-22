import {beforeAll,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import type {FishingCalendarChoices,FishingCalendarPlan} from "../../../src/features/fishing/program-calendar-contract.ts";
import {fishingCalendarSearch} from "../../../src/features/fishing/program-calendar-contract.ts";
import {educationSearch} from "../../../src/features/resources/education-query.ts";
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import type {OccurrenceProjection} from "../../../src/features/fishing-stage/contract.ts";
import {classroomEntryReducer,classroomEntryRequestFromQuery,classroomEntrySearch,initialClassroomEntry,readClassroomEntry,type ClassroomEntryData,type ClassroomEntryRequest,type ClassroomEntryState} from "../../../src/features/fishing-stage/classroom-entry-contract.ts";
import {ClassroomEntryPanel,FishingClassroomEntry} from "../../../src/features/fishing-stage/classroom-entry-workspace.tsx";
import {Fixture,actor,id,ref} from "./fixture.ts";

// Synthetic in-memory Stage service output; no native database or mounted UI proof.
type Plan=Omit<FishingCalendarPlan,"lessonLinks">&{lessonLinks:{occurrenceId:string;href:string}[]};
let base:Plan;
const request:ClassroomEntryRequest={generation:0,learnerId:id(3),enrollmentId:id(30)};
beforeAll(async()=>{
 const f=new Fixture(),service=new FishingStageService(f,{now:()=>f.now});
 await service.execute(actor(),ref,{action:"create",operationId:id(800),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});
 await service.execute(actor(),ref,{action:"publish",operationId:id(801),expectedRevision:1});
 const view=await service.read(actor("parent"),ref);if(!view)throw Error("SYNTHETIC_VIEW_REQUIRED");
 const lesson=view.lessonReferences[0]!;
 base={selection:{learnerId:id(3),enrollmentId:id(30),reference:ref},choice:{...ref,learnerId:id(3),enrollmentId:id(30),label:"Synthetic stage",templateVersion:f.template.version,childCapacity:4},
  view,operator:{venues:[],roster:[],makeupNotices:[],makeupFits:[]},lessonLearnerId:id(3),
  lessonLinks:[{occurrenceId:lesson.occurrenceId,href:`/en/family/resources?${educationSearch({learnerId:id(3),moduleId:lesson.moduleId,version:lesson.version},"lesson")}`}]};
});
function fixture(selected:ClassroomEntryRequest=request,locale:"en"|"he"="en"){
 const plan=structuredClone(base);plan.lessonLinks[0]!.href=plan.lessonLinks[0]!.href.replace("/en/",`/${locale}/`);
 const context:FishingCalendarChoices={availability:"ready",role:"parent",children:[{learnerId:id(3),displayName:"Synthetic learner A"},{learnerId:id(6),displayName:"Synthetic learner B"}],
  selectedLearnerId:selected.learnerId,stages:selected.learnerId?[structuredClone(plan.choice)]:[]};
 const session=vi.fn().mockResolvedValue({accountId:id(2),role:"parent",locale});
 const read=vi.fn(async(path:string):Promise<unknown>=>{
  if(path.startsWith("fishing/context"))return structuredClone(context);
  if(path.startsWith("fishing/plan?"))return structuredClone(plan);
  throw Error("UNEXPECTED_READ");
 });
 const port={session,read};return {plan,context,port,load:(current=()=>true)=>readClassroomEntry(selected,port,current)};
}
function occurrence(plan:Plan,change:Partial<OccurrenceProjection>){plan.view!.occurrences[0]={...plan.view!.occurrences[0]!,...change};}
async function readyState():Promise<ClassroomEntryState>{const data=await fixture().load();if(!data)throw Error("SYNTHETIC_READ_REQUIRED");return {...initialClassroomEntry(),request:{...request},...data,status:"ready"};}
function render(state:ClassroomEntryState,locale:"en"|"he"="en"){return renderToStaticMarkup(createElement(ClassroomEntryPanel,{locale,state,dispatch:()=>{}}));}

describe("explicit classroom entry",()=>{
 it("restores explicit Back context as loading metadata only and rechecks both native session reads",async()=>{
  const restored=classroomEntryRequestFromQuery({learnerId:request.learnerId!,enrollmentId:request.enrollmentId!});expect(restored).toEqual(request);
  const state=initialClassroomEntry(restored!);expect(state.status).toBe("loading");expect(state.children).toEqual([]);expect(state.stages).toEqual([]);expect(state.lessons).toEqual([]);
  const f=fixture(state.request);expect((await f.load())?.lessons).toHaveLength(1);expect(f.port.session).toHaveBeenCalledTimes(2);
  f.context.stages=[];await expect(f.load()).rejects.toMatchObject({code:"NOT_FOUND"});
 });
 it.each([{enrollmentId:id(30)},{learnerId:"invalid"},{learnerId:[id(3)]},{learnerId:id(3),enrollmentId:[id(30)]},{learnerId:id(3),enrollmentId:""}])("rejects malformed or partial chooser URL context %j",query=>{
  expect(classroomEntryRequestFromQuery(query)).toBeNull();
 });
 it("leaves initial and learner-only selection explicit and preserves unrelated query context",()=>{
  expect(classroomEntryRequestFromQuery({caseId:id(20)})).toEqual(initialClassroomEntry().request);
  const learner=classroomEntryRequestFromQuery({learnerId:id(3)})!;expect(learner.enrollmentId).toBeNull();
  const selected=new URLSearchParams(classroomEntrySearch(request,"caseId=retained&learnerId=old&learnerId=duplicate&enrollmentId=old"));
  expect(selected.getAll("learnerId")).toEqual([id(3)]);expect(selected.getAll("enrollmentId")).toEqual([id(30)]);expect(selected.get("caseId")).toBe("retained");
  const cleared=new URLSearchParams(classroomEntrySearch(learner,selected.toString()));expect(cleared.has("enrollmentId")).toBe(false);
  expect(classroomEntrySearch(initialClassroomEntry().request,cleared.toString())).toBe("caseId=retained");
 });
 it("keeps two available children unselected and never reads a first stage by default",async()=>{
  const f=fixture(initialClassroomEntry().request),data=await f.load();expect(data?.children).toHaveLength(2);expect(data?.lessons).toEqual([]);
  expect(f.port.read.mock.calls).toEqual([["fishing/context"]]);expect(f.port.session).toHaveBeenCalledTimes(2);
  const state=classroomEntryReducer(initialClassroomEntry(),{type:"loaded",generation:0,data:data!});
  expect(state.request.learnerId).toBeNull();expect(state.request.enrollmentId).toBeNull();expect(render(state)).toContain('value="" selected=""');expect(render(state)).not.toContain("Open lesson");
 });
 it("reads the explicitly selected native plan and returns only the offered href",async()=>{
  const f=fixture(),data=await f.load();expect(f.port.read.mock.calls).toEqual([[`fishing/context?learnerId=${id(3)}`],["fishing/plan?"+fishingCalendarSearch(base.selection)]]);
  expect(data?.lessons).toEqual([{occurrenceId:base.lessonLinks[0]!.occurrenceId,ordinal:1,moduleId:"RM-101",version:"synthetic-module-v1",state:"published",href:base.lessonLinks[0]!.href}]);
  expect(f.port.session).toHaveBeenCalledTimes(2);
 });
 it("waits for a deliberate stage choice after learner selection",async()=>{
  const f=fixture({...request,enrollmentId:null}),data=await f.load();expect(data?.stages).toHaveLength(1);expect(data?.lessons).toEqual([]);expect(f.port.read).toHaveBeenCalledTimes(1);
 });
 it.each(["not_configured","no_grants","no_plan"] as const)("does not infer links from %s",async mode=>{
  const f=fixture();if(mode==="not_configured")Object.assign(f.context,{availability:"not_configured",selectedLearnerId:null,children:[],stages:[]});
  else{f.plan.lessonLinks=[];if(mode==="no_plan")f.plan.view=null;}
  const data=await f.load();expect(data?.lessons).toEqual([]);expect(data?.availability).toBe(mode==="not_configured"?"not_configured":"ready");
  if(mode==="not_configured")expect(f.port.read).toHaveBeenCalledTimes(1);
 });
 it("rejects an implicit server first-child selection",async()=>{
  const f=fixture(initialClassroomEntry().request);f.context.selectedLearnerId=id(3);await expect(f.load()).rejects.toMatchObject({code:"UNAVAILABLE"});expect(f.port.read).toHaveBeenCalledTimes(1);
 });
 it("rejects a removed enrollment before reading its former plan",async()=>{
  const f=fixture();f.context.stages=[];await expect(f.load()).rejects.toMatchObject({code:"NOT_FOUND"});expect(f.port.read).toHaveBeenCalledTimes(1);
 });
 it.each(["practitioner","child","adult_client"])("rejects ordinary %s sessions before reading a roster",async role=>{
  const f=fixture();f.port.session.mockResolvedValue({accountId:id(2),role,locale:"en"});await expect(f.load()).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.port.read).not.toHaveBeenCalled();
 });
 it.each(["account","role","locale"])("discards a completed read when its ordinary session changes %s",async field=>{
  const f=fixture(),session={accountId:id(2),role:"parent",locale:"en"};f.port.session.mockResolvedValueOnce(session).mockResolvedValueOnce({...session,...(field==="account"?{accountId:id(222)}:field==="role"?{role:"child"}:{locale:"he"})});
  await expect(f.load()).rejects.toMatchObject({code:"FORBIDDEN"});
 });
 it("drops private and unused metadata instead of retaining a raw plan in UI state",async()=>{
  const f=fixture();Object.assign(f.plan,{privateNote:"PRIVATE_TEACHER_CANARY"});Object.assign(f.plan.view!,{teacherKey:"PRIVATE_TEACHER_CANARY"});
  occurrence(f.plan,{logisticalNote:"PRIVATE_UNUSED_CANARY"});const data=await f.load();expect(JSON.stringify(data)).not.toMatch(/CANARY|teacherKey|privateNote|logisticalNote|operator|occurrences/);
 });
});

describe("response binding",()=>{
 const mismatches:[string,(f:ReturnType<typeof fixture>)=>void][]=[
  ["different learner",f=>{f.context.selectedLearnerId=id(6);}],
  ["unknown selected learner",f=>{f.context.children=f.context.children.filter(c=>c.learnerId!==id(3));}],
  ["duplicate learner",f=>{f.context.children.push(f.context.children[0]!);}],
  ["duplicate enrollment",f=>{f.context.stages.push(f.context.stages[0]!);}],
  ["foreign learner stage",f=>{f.context.stages[0]!.learnerId=id(6);}],
  ["operator choice without enrollment",f=>{f.context.stages[0]!.enrollmentId=null;}],
  ["different plan selection",f=>{f.plan.selection.learnerId=id(6);}],
  ["different cohort",f=>{f.plan.selection.reference={...ref,cohortId:id(55)};}],
  ["changed stage choice",f=>{f.plan.choice.templateVersion="changed-version";}],
  ["different lesson learner",f=>{f.plan.lessonLearnerId=id(6);}],
  ["teacher view",f=>{f.plan.view!.role="practitioner";}],
  ["foreign view enrollment",f=>{f.plan.view!.enrollmentId=id(44);}],
  ["foreign view stage",f=>{Object.assign(f.plan.view!,{stageId:id(55)});}],
  ["foreign occurrence scope",f=>occurrence(f.plan,{cohortId:id(55)})],
  ["wrong module ordinal",f=>occurrence(f.plan,{moduleId:"RM-102"})],
  ["duplicate occurrence",f=>{f.plan.view!.occurrences[1]={...f.plan.view!.occurrences[1]!,id:f.plan.view!.occurrences[0]!.id};}],
  ["duplicate ordinal",f=>{f.plan.view!.occurrences[1]={...f.plan.view!.occurrences[1]!,ordinal:1};}],
  ["missing lesson binding",f=>{f.plan.view!.lessonReferences=[];}],
  ["changed module version",f=>{f.plan.view!.lessonReferences[0]!.version="another-version";}],
  ["foreign lesson reference",f=>{f.plan.view!.lessonReferences[0]!.occurrenceId=id(55);}],
  ["duplicate lesson binding",f=>{f.plan.view!.lessonReferences.push(f.plan.view!.lessonReferences[0]!);}],
  ["draft lesson link",f=>occurrence(f.plan,{state:"draft"})],
  ["unknown linked occurrence",f=>{f.plan.lessonLinks[0]!.occurrenceId=id(55);}],
  ["duplicate link",f=>{f.plan.lessonLinks.push(f.plan.lessonLinks[0]!);}],
  ["link with missing plan",f=>{f.plan.view=null;}],
 ];
 it.each(mismatches)("rejects %s without a partial list",async(_label,change)=>{const f=fixture();change(f);await expect(f.load()).rejects.toMatchObject({code:"UNAVAILABLE"});});
 it.each([
  (href:string)=>"https://example.invalid"+href,(href:string)=>"//example.invalid"+href,
  ()=>"javascript:alert(1)",(href:string)=>href.replace("/family/","/app/"),
  (href:string)=>href.replace(id(3),id(6)),(href:string)=>href.replace("RM-101","RM-102"),
  (href:string)=>href.replace("synthetic-module-v1","other-v2"),(href:string)=>href.replace("section=lesson","section=review"),
  (href:string)=>href+"&learnerId="+id(6),(href:string)=>href+"#teacher",(href:string)=>href.replace("/en/","/he/"),
  (href:string)=>href.replace("/en/","/en/../en/"),(href:string)=>href.replace("/en/","/\\en/"),
 ])("rejects a substituted lesson href %#",async alter=>{
  const f=fixture();f.plan.lessonLinks[0]!.href=alter(f.plan.lessonLinks[0]!.href);await expect(f.load()).rejects.toMatchObject({code:"UNAVAILABLE"});
 });
 it("keeps the exact server Hebrew URL when the ordinary session is Hebrew",async()=>{const f=fixture(request,"he");expect((await f.load())?.lessons[0]!.href).toBe(f.plan.lessonLinks[0]!.href);});
});

describe("late reads and selection changes",()=>{
 it("stops a stale context read before requesting any plan",async()=>{
  const f=fixture();let current=true,resolve!:(value:unknown)=>void;
  f.port.read.mockImplementationOnce(()=>new Promise(value=>{resolve=value;}));const pending=f.load(()=>current);
  await vi.waitFor(()=>expect(f.port.read).toHaveBeenCalledTimes(1));current=false;resolve(f.context);
  expect(await pending).toBeNull();expect(f.port.read).toHaveBeenCalledTimes(1);expect(f.port.session).toHaveBeenCalledTimes(1);
 });
 it("stops a stale plan read before another session request or state update",async()=>{
  const f=fixture();let current=true,resolve!:(value:unknown)=>void;
  f.port.read.mockImplementationOnce(async()=>f.context).mockImplementationOnce(()=>new Promise(value=>{resolve=value;}));const pending=f.load(()=>current);
  await vi.waitFor(()=>expect(f.port.read).toHaveBeenCalledTimes(2));current=false;resolve(f.plan);
  expect(await pending).toBeNull();expect(f.port.session).toHaveBeenCalledTimes(1);
 });
 it("clears links synchronously on learner, stage and refresh changes",async()=>{
  const ready=await readyState();for(const action of[{type:"learner",learnerId:id(6)},{type:"stage",enrollmentId:null},{type:"refresh"},{type:"restart"}] as const){
   const next=classroomEntryReducer(ready,action);expect(next.lessons).toEqual([]);expect(next.status).toBe("loading");expect(render(next)).not.toContain("Open lesson");expect(next.request.generation).toBe(1);
  }
  const changed=classroomEntryReducer(ready,{type:"learner",learnerId:id(6)});expect(changed.request.enrollmentId).toBeNull();expect(changed.stages).toEqual([]);
 });
 it("rejects choices never offered by the current context",async()=>{
  const ready=await readyState();expect(classroomEntryReducer(ready,{type:"learner",learnerId:id(222)})).toBe(ready);expect(classroomEntryReducer(ready,{type:"stage",enrollmentId:id(222)})).toBe(ready);
 });
 it("ignores old successes and errors even after selecting the same learner again",async()=>{
  const ready=await readyState(),oldData:ClassroomEntryData={availability:ready.availability,children:ready.children,stages:ready.stages,lessons:ready.lessons};
  let next=classroomEntryReducer(ready,{type:"learner",learnerId:id(6)});next=classroomEntryReducer(next,{type:"learner",learnerId:id(3)});
  expect(classroomEntryReducer(next,{type:"loaded",generation:0,data:oldData})).toBe(next);expect(classroomEntryReducer(next,{type:"failed",generation:0,failure:"FORBIDDEN"})).toBe(next);
  expect(next.lessons).toEqual([]);expect(next.request.enrollmentId).toBeNull();
 });
 it.each(["UNAUTHENTICATED","FORBIDDEN","NOT_FOUND","UNAVAILABLE"] as const)("clears all names and links on current %s failure",async failure=>{
  const ready=await readyState(),pending=classroomEntryReducer(ready,{type:"stage",enrollmentId:request.enrollmentId}),failed=classroomEntryReducer(pending,{type:"failed",generation:pending.request.generation,failure});
  expect(failed.children).toEqual([]);expect(failed.stages).toEqual([]);expect(failed.lessons).toEqual([]);const html=render(failed);
  expect(html).not.toMatch(/Synthetic learner|Synthetic stage|Open lesson/);expect(html).toContain('role="alert"');if(failure==="UNAUTHENTICATED")expect(html).toContain("/en/login?next=%2Fen%2Ffamily%2Fresources");
 });
});

describe("ordinary Materials presentation",()=>{
 it.each(["en","he"] as const)("renders %s labels, direction, semantic controls and only lesson links",async locale=>{
  const data=await fixture(request,locale).load(),state={...initialClassroomEntry(),request:{...request},...data!,status:"ready" as const},html=render(state,locale);
  expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);expect(html.match(/<select /g)).toHaveLength(2);expect(html.match(/<label /g)).toHaveLength(2);
  expect(html).toContain(`href="/${locale}/family/resources?`);expect(html).toContain(locale==="he"?"פתיחת שיעור":"Open lesson");
  expect(html).not.toMatch(/<form|<textarea|style=|PRIVATE|teacher|payment|grant|enroll now|checkout/i);
 });
 it("renders initial loading without fetching, a role switch or a preselected child",()=>{
  const html=renderToStaticMarkup(createElement(FishingClassroomEntry,{locale:"he"}));expect(html).toContain('role="status"');expect(html).not.toMatch(/<select|href=|role switch/i);
 });
 it("uses existing tokens and logical responsive layout without hiding overflow",()=>{
  const css=readFileSync(new URL("../../../src/features/fishing-stage/classroom-entry.module.css",import.meta.url),"utf8");
  expect(css).toContain("var(--ls-paper)");expect(css).toContain("var(--ls-deep)");expect(css).toContain(":focus-visible");expect(css).toContain("@media(max-width:600px)");
  expect(css).toContain("grid-template-columns:minmax(0,1fr)");expect(css).not.toMatch(/overflow(?:-x)?:hidden|#[a-f\d]{3,8}\b|(?:margin|padding)-(?:left|right):/i);
 });
});
