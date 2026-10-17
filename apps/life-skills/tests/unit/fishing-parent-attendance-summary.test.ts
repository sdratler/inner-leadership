/** Pure synthetic server-markup checks. No route/session/privacy acceptance. */
import {describe,it,expect,vi,afterEach} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {FishingParentAttendanceSummary} from "../../src/features/fishing-stage/parent-attendance-summary.tsx";
import type {OccurrenceProjection,StageView} from "../../src/features/fishing-stage/contract.ts";
import type {Locale} from "../../src/lib/locale.ts";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const selected=id(4),other=id(5),first=id(10),second=id(11);
function occurrence(changes:Partial<OccurrenceProjection>={}):OccurrenceProjection{
 return {cohortId:id(1),stageId:id(2),stage:1,id:first,revision:4,workspaceId:id(3) as OccurrenceProjection["workspaceId"],program:"sunday_fishing_academy",
  templateVersion:"synthetic-v1",ordinal:1,moduleId:"UNRENDERED_MODULE",moduleVersion:"synthetic-v1",state:"completed",optional:false,
  time:{kind:"scheduled",startsAt:"2026-10-17T14:00:00.000Z",endsAt:"2026-10-17T15:00:00.000Z",timeZone:"America/New_York"},
  location:"PRIVATE_LOCATION",directions:"PRIVATE_DIRECTIONS",equipment:"PRIVATE_EQUIPMENT",logisticalNote:"PRIVATE_NOTE",
  instructor:{accountId:id(6) as OccurrenceProjection["instructor"]["accountId"],displayName:"PRIVATE_INSTRUCTOR_NAME"},childCapacity:8,
  replacesOccurrenceId:null,changedBy:id(6) as OccurrenceProjection["changedBy"],changedAt:"2026-10-17T15:00:00.000Z",changeReason:"PRIVATE_REASON",allowedActions:[],...changes};
}
function fact(state:StageView["attendance"][number]["state"],recordedAt="2026-10-17T15:10:00.000Z",enrollmentId=selected,occurrenceId=first):StageView["attendance"][number]{
 return {enrollmentId,occurrenceId,state,recordedAt};
}
function view(changes:Partial<StageView>={}):StageView{
 return {cohortId:id(1),stageId:id(2),stage:1,revision:9,role:"parent",enrollmentId:selected,occurrences:[occurrence()],nextOccurrenceId:null,notices:[],attendance:[],lessonReferences:[],...changes};
}
const render=(data:StageView,locale:Locale="en")=>renderToStaticMarkup(createElement(FishingParentAttendanceSummary,{view:data,locale}));
const text=(html:string)=>html.replace(/<[^>]*>/g," ").replace(/\s+/g," ");
afterEach(()=>vi.unstubAllGlobals());

describe.each(["en","he"]as const)("%s authorized parent attendance presentation",locale=>{
 it("shows the actual stage and session revisions, localized status and direction",()=>{
  const html=render(view({attendance:[fact("present")]}),locale);
  expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(text(html)).toContain(locale==="he"?"גרסת השלב: 9":"Stage revision: 9");
  expect(html).toContain(locale==="he"?"<dt>גרסת המפגש</dt><dd>4</dd>":"<dt>Session revision</dt><dd>4</dd>");
  expect(html).toContain(locale==="he"?"<dd>התקיים</dd>":"<dd>Completed</dd>");
  expect(html).toContain(locale==="he"?"<dd>נכח</dd>":"<dd>Present</dd>");
  expect(html).toContain("lsw-stack");expect(html).toContain("lsw-card");
 });
 it.each([
  ["present","Present","נכח"],["late","Late","איחר"],["absent","Absent","נעדר"],["no_show","No-show","לא הגיע"],
 ]as const)("renders the supplied %s fact without deriving another state",(state,en,he)=>{
  expect(render(view({attendance:[fact(state)]}),locale)).toContain(`<dd>${locale==="he"?he:en}</dd>`);
 });
 it("selects the latest corrected fact by instant, not input order or date-string ordering",()=>{
  const old=fact("absent","2026-10-17T11:10:00.000-04:00"),corrected=fact("present","2026-10-17T15:11:00.000Z");
  for(const facts of [[corrected,old],[old,corrected]]){
   const data=view({attendance:facts}),before=structuredClone(data),html=render(data,locale);
   expect(html).toContain(locale==="he"?"<dd>נכח</dd>":"<dd>Present</dd>");
   expect(html).not.toContain(locale==="he"?"<dd>נעדר</dd>":"<dd>Absent</dd>");
   expect(html).toContain('dateTime="2026-10-17T15:11:00.000Z"');expect(data).toEqual(before);
  }
 });
 it("keeps unrecorded attendance distinct from completion, cancellation and published status",()=>{
  const data=view({occurrences:[occurrence({state:"completed"}),occurrence({id:second,ordinal:2,state:"cancelled"}),occurrence({id:id(12),ordinal:3,state:"published"})]});
  const html=render(data,locale);
  for(const status of locale==="he"?["התקיים","בוטל","פורסם"]:["Completed","Cancelled","Published"])expect(html).toContain(`<dd>${status}</dd>`);
  expect(html.match(new RegExp(locale==="he"?"<dd>טרם נרשמה</dd>":"<dd>Not recorded</dd>","g"))).toHaveLength(3);
  expect(html).not.toContain(locale==="he"?"<dd>נעדר</dd>":"<dd>Absent</dd>");
 });
 it("retains undated sessions without synthesizing a date or attendance",()=>{
  const html=render(view({occurrences:[occurrence({state:"published",time:{kind:"undated",timeZone:"America/New_York"}})]}),locale);
  expect(html).toContain(locale==="he"?"טרם נקבע מועד":"Date not yet set");expect(html).not.toContain("<time");
  expect(html).toContain(locale==="he"?"<dd>טרם נרשמה</dd>":"<dd>Not recorded</dd>");
 });
 it("ignores other enrollments and occurrence IDs absent from this view",()=>{
  const html=render(view({attendance:[fact("no_show","2026-10-17T16:00:00Z",other),fact("absent","2026-10-17T16:00:00Z",selected,id(99))]}),locale);
  expect(html).toContain(locale==="he"?"<dd>טרם נרשמה</dd>":"<dd>Not recorded</dd>");
  expect(html).not.toContain(other);expect(html).not.toContain(id(99));
 });
 it("does not let stale or unrelated records override the selected family's correction",()=>{
  const html=render(view({attendance:[fact("late"),fact("absent","2026-10-17T15:00:00Z"),fact("no_show","2099-01-01T00:00:00Z",other),fact("absent","2099-01-01T00:00:00Z",selected,second)]}),locale);
  expect(html).toContain(locale==="he"?"<dd>איחר</dd>":"<dd>Late</dd>");expect(html).not.toContain("2099");
 });
 it("shows unknown for conflicting equal-instant records in either order",()=>{
  const a=fact("present","2026-10-17T15:10:00Z"),b=fact("no_show","2026-10-17T11:10:00-04:00");
  for(const facts of [[a,b],[b,a]]){
   const html=render(view({attendance:facts}),locale);
   expect(html).toContain(locale==="he"?"לא ידוע — רישומי נוכחות סותרים":"Unknown — conflicting attendance records");
   expect(html).not.toContain(locale==="he"?"<dd>נכח</dd>":"<dd>Present</dd>");
   expect(html).not.toContain(locale==="he"?"<dd>לא הגיע</dd>":"<dd>No-show</dd>");
  }
 });
 it("accepts repeated equal-instant same-state facts and a later correction resolving an earlier conflict",()=>{
  const a=fact("present"),same=fact("present","2026-10-17T11:10:00-04:00");
  expect(render(view({attendance:[a,same]}),locale)).toContain(locale==="he"?"<dd>נכח</dd>":"<dd>Present</dd>");
  const html=render(view({attendance:[a,fact("no_show"),fact("late","2026-10-17T15:11:00Z")]}),locale);
  expect(html).toContain(locale==="he"?"<dd>איחר</dd>":"<dd>Late</dd>");
 });
 it("does not turn unknown state or unorderable own facts into an absence or an older answer",()=>{
  for(const bad of [fact("unexpected" as StageView["attendance"][number]["state"]),fact("absent","invalid"),fact("absent","2026-10-17T15:10:00")]){
   const html=render(view({attendance:[fact("present","2026-10-17T15:00:00Z"),bad]}),locale);
   expect(html).toContain(locale==="he"?"לא ידוע — נדרשת בדיקת נוכחות":"Unknown — attendance needs review");
   expect(html).not.toContain(locale==="he"?"<dd>נעדר</dd>":"<dd>Absent</dd>");expect(html).not.toContain("unexpected");
  }
 });
 it("does not expose supplied names, private details, identity keys, notices or action controls",()=>{
  const html=render(view({attendance:[fact("present")],occurrences:[occurrence({allowedActions:["read","record_attendance","cancel"]})]}),locale);
  expect(html).not.toMatch(/PRIVATE_|UNRENDERED_MODULE|<button|<form|<input|href=|paidCents|entitlement|guarantee|grade|Zoom/);
  for(const key of [selected,id(1),id(2),id(3),id(6)])expect(html).not.toContain(key);
 });
});

it.each(["practitioner","child"]as const)("renders nothing for %s, even with a supplied enrollment",role=>{
 expect(render(view({role,attendance:[fact("present")]}))).toBe("");
});
it.each([null,"","   ",` ${selected}`])("renders nothing without a concrete exact selection (%s)",enrollmentId=>{
 expect(render(view({enrollmentId,attendance:[fact("present")]}))).toBe("");
});
it("does not borrow attendance when the selected enrollment changes",()=>{
 const data=view({enrollmentId:other,attendance:[fact("present")]});
 expect(render(data)).toContain("<dd>Not recorded</dd>");
 data.attendance.push(fact("late","2026-10-17T15:11:00Z",other));expect(render(data)).toContain("<dd>Late</dd>");
});
it("displays the supplied older revision honestly; it cannot prove the view is fresh",()=>{
 const html=render(view({revision:4,attendance:[fact("absent")]}));
 expect(text(html)).toContain("Stage revision: 4");expect(html).toContain("<dd>Absent</dd>");expect(html).not.toMatch(/latest|up.to.date|verified/i);
});
it("omits draft, mismatched-stage, impossible-revision and duplicate occurrence rows",()=>{
 const bad=[occurrence({state:"draft"}),occurrence({stageId:id(99)}),occurrence({cohortId:id(98)}),occurrence({stage:2}),occurrence({revision:10})];
 for(const candidate of bad)expect(render(view({occurrences:[candidate],attendance:[fact("present")]}))).not.toContain("<li");
 expect(render(view({occurrences:[occurrence(),occurrence({revision:3})],attendance:[fact("present")]}))).not.toContain("<li");
});
it("preserves the actual New York DST instants and offset distinction",()=>{
 const html=render(view({occurrences:[occurrence({time:{kind:"scheduled",startsAt:"2026-11-01T05:30:00Z",endsAt:"2026-11-01T06:30:00Z",timeZone:"America/New_York"}})]}));
 expect(html).toContain('dateTime="2026-11-01T05:30:00Z"');expect(html).toContain('dateTime="2026-11-01T06:30:00Z"');
 expect(html).toContain("1:30 AM EDT");expect(html).toContain("1:30 AM EST");expect(html).toContain("America/New_York");
});
it("keeps supplied scheduled instants in Hebrew and never uses device-local time",()=>{
 const html=render(view(),"he");expect(html).toContain('dateTime="2026-10-17T14:00:00.000Z"');expect(html).toContain("10:00");expect(html).toContain("America/New_York");
});
it("marks malformed or foreign-zone scheduled times unavailable instead of inventing dates",()=>{
 for(const time of [{kind:"scheduled",startsAt:"invalid",endsAt:"2026-10-17T15:00:00Z",timeZone:"America/New_York"},
  {kind:"scheduled",startsAt:"2026-10-17T14:00:00Z",endsAt:"2026-10-17T13:00:00Z",timeZone:"America/New_York"},
  {kind:"scheduled",startsAt:"2026-10-17T14:00:00Z",endsAt:"2026-10-17T15:00:00Z",timeZone:"Asia/Jerusalem"}]as const){
  const html=render(view({occurrences:[occurrence({time})]}));expect(html).toContain("Session time unavailable");expect(html).not.toContain("<time");
 }
});
it("does not load or mutate data while presenting an authorized view",()=>{
 const fetch=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});vi.stubGlobal("fetch",fetch);
 const data=view({attendance:[fact("present")]}),before=structuredClone(data);render(data);expect(fetch).not.toHaveBeenCalled();expect(data).toEqual(before);
});
