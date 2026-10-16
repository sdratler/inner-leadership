import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fishingCalendarCommandSchema} from "../../../src/features/fishing/program-calendar-http.ts";
import {fishingCalendarChoicesSchema,fishingCalendarSelectionQuery,fishingCalendarSearch,fishingCalendarContext,selectedFishingStage,fishingCivilTime,fishingCalendarWindowSchema,fishingCalendarEvents,type FishingCalendarPlan} from "../../../src/features/fishing/program-calendar-contract.ts";
import {orderedCalendarEntries} from "../../../src/features/calendar/entry-order.ts";
import {CalendarBoard,CalendarAgenda} from "../../../src/features/calendar/views.tsx";

const learner="11111111-1111-4111-8111-111111111111",enrollment="22222222-2222-4222-8222-222222222222",stageId="33333333-3333-4333-8333-333333333333",cohortId="44444444-4444-4444-8444-444444444444",operationId="55555555-5555-4555-8555-555555555555";
const selection={learnerId:learner,enrollmentId:enrollment,reference:{cohortId,stageId,stage:1 as const}};
const choices=fishingCalendarChoicesSchema.parse({availability:"ready",role:"parent",children:[{learnerId:learner,displayName:"Synthetic child"}],selectedLearnerId:learner,stages:[{...selection.reference,label:"Synthetic cohort",enrollmentId:enrollment,learnerId:learner,templateVersion:"synthetic-v1",childCapacity:2}]});
describe("fishing Calendar transport/context only — not native authorization proof",()=>{
 it("round-trips exact explicit native references without a role, case or authority field",()=>{
  const query=fishingCalendarSearch(selection);expect(fishingCalendarSelectionQuery(new URLSearchParams(query))).toEqual(selection);expect(query).not.toMatch(/role|caseId|workspaceId|grant/);
 });
 it("does not synthesize a learner or enrollment for an operator reference",()=>{
  const operator={...selection,learnerId:null,enrollmentId:null};expect(fishingCalendarSelectionQuery(new URLSearchParams(fishingCalendarSearch(operator)))).toEqual(operator);
 });
 it.each(["role","workspaceId","caseId","approved","merchant","teacherKey"])("rejects injected %s query authority",key=>{
  const query=new URLSearchParams(fishingCalendarSearch(selection));query.set(key,"forged");expect(()=>fishingCalendarSelectionQuery(query)).toThrow();
 });
 it("rejects duplicates, malformed UUIDs and naive numeric stage coercion",()=>{
  for(const value of ["1.0","01","1e0","NaN","5"]){const query=new URLSearchParams(fishingCalendarSearch(selection));query.set("stage",value);expect(()=>fishingCalendarSelectionQuery(query)).toThrow();}
  const duplicate=new URLSearchParams(fishingCalendarSearch(selection));duplicate.append("learnerId",learner);expect(()=>fishingCalendarSelectionQuery(duplicate)).toThrow();
  const malformed=new URLSearchParams(fishingCalendarSearch(selection));malformed.set("learnerId","constructor");expect(()=>fishingCalendarSelectionQuery(malformed)).toThrow();
 });
 it("matches the complete selection tuple, never just a stage/name/first row",()=>{
  expect(selectedFishingStage(choices,selection)?.enrollmentId).toBe(enrollment);
  for(const changed of [{learnerId:enrollment},{enrollmentId:null},{reference:{...selection.reference,cohortId:learner}},{reference:{...selection.reference,stage:2 as const}}])expect(selectedFishingStage(choices,{...selection,...changed})).toBeNull();
 });
 it("preserves only bounded context hints, not arbitrary URLs or private fields",()=>{
  const query=new URLSearchParams({...Object.fromEntries(new URLSearchParams(fishingCalendarSearch(selection))),fishing:"1",teacherKey:"PRIVATE",returnTo:"https://untrusted.invalid"});
  expect(fishingCalendarContext(query)).toEqual({fishing:"1",learnerId:learner,enrollmentId:enrollment,cohortId,stageId,stage:"1"});query.append("learnerId",enrollment);expect(fishingCalendarContext(query)).not.toHaveProperty("learnerId");
 });
 it("keeps unknown/injected command and intent fields closed",()=>{
  const body={selection,command:{action:"publish",operationId,expectedRevision:1},intent:{operationId,resources:[],makeupFitDecisionId:null}};
  expect(fishingCalendarCommandSchema.safeParse(body).success).toBe(true);
  for(const extra of [{actor:{id:learner}},{role:"practitioner"},{paid:true},{grant:true}])expect(fishingCalendarCommandSchema.safeParse({...body,...extra}).success).toBe(false);
  expect(fishingCalendarCommandSchema.safeParse({...body,intent:{...body.intent,receivedAt:"2026-10-16T00:00:00Z"}}).success).toBe(false);
 });
 it("returns the fishing delegation before any legacy credit draining code",()=>{
  const source=readFileSync(new URL("../../../src/features/calendar/http.ts",import.meta.url),"utf8");
  const dispatch=source.indexOf("if(path[0]==='fishing')return handleFishingCalendar(request,path.slice(1));");expect(dispatch).toBeGreaterThan(source.indexOf("path.length>3"));expect(dispatch).toBeLessThan(source.indexOf("const {identity,service}=await calendarRuntime()"));expect(dispatch).toBeLessThan(source.indexOf("const result=await service.db.read"));
 });
 it("keeps actual absence distinct from a damaged catalog without expanding source bounds",()=>{
  const source=readFileSync(new URL("../../../src/features/fishing/native-program.ts",import.meta.url),"utf8");
  expect(source).toContain("rows.every(row=>row.relation===null)&&namespaces.every(row=>row.present===false)");expect(source).toContain('rows.every(row=>row.relation===row.name&&row.kind==="r")');expect(source).toContain("rows.length<=fishingCalendarLimit");
 });
});

describe("one Calendar fishing projection: pure bounds/time/ordering, not authority proof",()=>{
 it.each([
  ["2026-03-08T06:59:00Z","2026-03-08","01:59"],["2026-03-08T07:00:00Z","2026-03-08","03:00"],
  ["2026-11-01T05:30:00Z","2026-11-01","01:30"],["2026-11-01T06:30:00Z","2026-11-01","01:30"],
  ["2026-07-02T03:59:00Z","2026-07-01","23:59"],["2026-07-02T04:00:00Z","2026-07-02","00:00"],
 ])("uses America/New_York at DST/window edge %s",(instant,date,time)=>expect(fishingCivilTime(instant)).toEqual({date,time}));
 it("rejects naive time, invalid dates, reversed and over-62-day windows",()=>{
  expect(()=>fishingCivilTime("2026-11-01T01:30:00")).toThrow();
  for(const range of [{from:"2026-02-30",to:"2026-03-01"},{from:"2026-03-02",to:"2026-03-01"},{from:"2026-01-01",to:"2026-03-04"}])expect(fishingCalendarWindowSchema.safeParse({...range,learnerId:null}).success).toBe(false);
  expect(fishingCalendarWindowSchema.safeParse({from:"2026-01-01",to:"2026-03-03",learnerId:null}).success).toBe(true);
 });
 function plan(){
  // Projection fixture only. Authorization/native persistence has separate tests.
  const occurrence={id:operationId,revision:1,ordinal:1,state:"published",time:{kind:"scheduled",startsAt:"2026-07-02T03:59:00Z",endsAt:"2026-07-02T04:59:00Z",timeZone:"America/New_York"},location:"Synthetic lake"};
  return {selection,choice:choices.stages[0]!,view:{occurrences:[occurrence]}} as unknown as Pick<FishingCalendarPlan,"selection"|"choice"|"view">;
 }
 it("deduplicates canonical occurrence IDs without choosing among independent enrollments",()=>{
  const first=plan(),second={...first,selection:{...selection,enrollmentId:cohortId}},range={from:"2026-07-01",to:"2026-07-01",learnerId:learner};
  const items=fishingCalendarEvents([first,second],range);expect(items).toHaveLength(1);expect(items[0]!.selections).toEqual([selection,second.selection]);
  expect(fishingCalendarEvents([first],{...range,from:"2026-07-02",to:"2026-07-02"})).toEqual([]);
  const entry=orderedCalendarEntries({items:[],fishing:items})[0]!;expect(entry).toMatchObject({kind:"fishing",key:"fishing-"+operationId,date:"2026-07-01",timing:{kind:"exact",time:"23:59"}});expect(entry.item).not.toHaveProperty("caseId");
 });
 it("omits draft/undated entries but keeps scheduled cancellations and completion",()=>{
  const p=plan(),o=p.view!.occurrences[0]!,range={from:"2026-07-01",to:"2026-07-01",learnerId:learner};
  for(const state of ["published","completed","cancelled"] as const)expect(fishingCalendarEvents([{...p,view:{...p.view!,occurrences:[{...o,state}]}}],range)[0]!.state).toBe(state);
  for(const occurrence of [{...o,state:"draft" as const},{...o,time:{kind:"undated" as const,timeZone:"America/New_York"}}])expect(fishingCalendarEvents([{...p,view:{...p.view!,occurrences:[occurrence]}}],range)).toEqual([]);
 });
 it("rejects conflicting duplicate revisions and foreign/guessed time zones",()=>{
  const p=plan(),o=p.view!.occurrences[0]!,range={from:"2026-07-01",to:"2026-07-01",learnerId:learner};
  expect(()=>fishingCalendarEvents([p,{...p,view:{...p.view!,occurrences:[{...o,revision:2}]}}],range)).toThrow();
  expect(()=>fishingCalendarEvents([{...p,view:{...p.view!,occurrences:[{...o,time:{kind:"scheduled",startsAt:"2026-07-02T03:59:00Z",endsAt:"2026-07-02T04:59:00Z",timeZone:"Asia/Jerusalem"}}]}}],range)).toThrow();
 });
 it("orders both Florida fold occurrences by actual instant, not ID or the repeated wall clock",()=>{
  const p=plan(),base=fishingCalendarEvents([p],{from:"2026-07-01",to:"2026-07-01",learnerId:learner})[0]!;
  const early={...base,id:operationId,startsAt:"2026-11-01T05:30:00Z",endsAt:"2026-11-01T05:45:00Z"},late={...base,id:learner,startsAt:"2026-11-01T06:30:00Z",endsAt:"2026-11-01T06:45:00Z"};
  expect(orderedCalendarEntries({items:[],fishing:[late,early]}).map(entry=>entry.kind==='fishing'?entry.item.id:null)).toEqual([early.id,late.id]);
 });
 it.each(["en","he"] as const)("renders the distinct native event in the same Board and Agenda (%s), with explicit Florida time",locale=>{
  const items=fishingCalendarEvents([plan()],{from:"2026-07-01",to:"2026-07-01",learnerId:learner}),props={items:[],fishing:items,locale,names:{},onOpen:()=>{},onOpenFishing:()=>{}};
  const board=renderToStaticMarkup(createElement(CalendarBoard,{...props,dates:["2026-07-01"],view:"day"})),agenda=renderToStaticMarkup(createElement(CalendarAgenda,props));
  expect(board.match(/data-ls-calendar-grid/g)).toHaveLength(1);for(const html of[board,agenda]){expect(html.match(/data-fishing-occurrence-id/g)).toHaveLength(1);expect(html).toContain("America/New_York");expect(html).not.toContain("data-appointment-id");}
 });
});
