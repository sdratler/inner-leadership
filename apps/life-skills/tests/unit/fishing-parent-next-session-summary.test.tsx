/** Synthetic markup checks only; not session, route or browser acceptance. */
import {afterEach,describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {FishingParentNextSessionSummary} from "../../src/features/fishing-stage/parent-next-session-summary.tsx";
import type {OccurrenceProjection,StageView} from "../../src/features/fishing-stage/contract.ts";
import type {Locale} from "../../src/lib/locale.ts";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const nextId=id(20),otherId=id(10),selected=id(4),zone="America/New_York";
function scheduled(startsAt="2026-10-18T14:00:00.000Z",endsAt="2026-10-18T15:00:00.000Z",timeZone=zone):OccurrenceProjection["time"]{
 return {kind:"scheduled",startsAt,endsAt,timeZone};
}
function occurrence(changes:Partial<OccurrenceProjection>={}):OccurrenceProjection{
 return {cohortId:id(1),stageId:id(2),stage:1,id:nextId,revision:3,workspaceId:id(3) as OccurrenceProjection["workspaceId"],program:"sunday_fishing_academy",
  templateVersion:"PRIVATE_TEMPLATE",ordinal:7,moduleId:"PRIVATE_MODULE",moduleVersion:"PRIVATE_VERSION",state:"published",optional:false,time:scheduled(),
  location:"PRIVATE_LOCATION",directions:"PRIVATE_DIRECTIONS",equipment:"PRIVATE_EQUIPMENT",logisticalNote:"PRIVATE_NOTE",childCapacity:8,
  instructor:{accountId:id(6) as OccurrenceProjection["instructor"]["accountId"],displayName:"PRIVATE_INSTRUCTOR"},
  replacesOccurrenceId:id(50),changedBy:id(6) as OccurrenceProjection["changedBy"],changedAt:"2026-10-17T15:00:00.000Z",changeReason:"PRIVATE_REASON",allowedActions:["report_absence"],...changes};
}
const other=()=>occurrence({id:otherId,ordinal:1,revision:1,time:scheduled("2026-10-11T14:00:00Z","2026-10-11T15:00:00Z")});
function view(changes:Partial<StageView>={}):StageView{
 return {cohortId:id(1),stageId:id(2),stage:1,revision:9,role:"parent",enrollmentId:selected,occurrences:[other(),occurrence()],nextOccurrenceId:nextId,notices:[],attendance:[],lessonReferences:[],...changes};
}
const render=(data:StageView,locale:Locale="en")=>renderToStaticMarkup(<FishingParentNextSessionSummary view={data} locale={locale}/>);
const text=(html:string)=>html.replace(/<[^>]*>/g," ").replace(/\s+/g," ");
function freeze(value:unknown):void{
 if(value&&typeof value==="object"){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe.each(["en","he"]as const)("%s selected-parent next session",locale=>{
 const choose=(en:string,he:string)=>locale==="he"?he:en;
 const unavailable=choose("Next session details unavailable.","פרטי המפגש הבא אינם זמינים.");
 const expectUnavailable=(data:StageView)=>{
  const html=render(data,locale);
  expect(html).toContain(`<p>${unavailable}</p>`);expect(html).not.toContain("<time");expect(html).not.toContain("<h3>");
  expect(html).not.toContain("PRIVATE_");expect(html).not.toContain("00000000-0000");
  return html;
 };
 it("shows the pointed session and revisions with semantic localized markup",()=>{
  const html=render(view(),locale);
  expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(html).toContain(`aria-label="${choose("Next session","המפגש הבא")}"`);
  expect(html).toContain(`<h3>${choose("Session","מפגש")} 7</h3>`);
  expect(html).toContain(`<dt>${choose("Stage revision","גרסת השלב")}</dt><dd>9</dd>`);
  expect(html).toContain(`<dt>${choose("Session revision","גרסת המפגש")}</dt><dd>3</dd>`);
  expect(html).toContain('class="lsw-stack"');expect(html).toContain('class="lsw-card"');
  expect(html).toContain('dateTime="2026-10-18T14:00:00.000Z"');expect(html).toContain('dateTime="2026-10-18T15:00:00.000Z"');
  expect(html).toContain("America/New_York");expect(html).not.toContain('dateTime="2026-10-11T14:00:00Z"');
 });
 it("uses only the supplied pointer regardless of array or chronological order",()=>{
  const pointed=occurrence(),unselected=other();
  for(const occurrences of [[unselected,pointed],[pointed,unselected]]){
   const html=render(view({occurrences}),locale);
   expect(html).toContain(`<h3>${choose("Session","מפגש")} 7</h3>`);
   expect(html).not.toContain(`<h3>${choose("Session","מפגש")} 1</h3>`);
  }
  expect(render(view({nextOccurrenceId:otherId}),locale)).toContain(`<h3>${choose("Session","מפגש")} 1</h3>`);
 });
 it("uses the same unavailable wording for null, unknown and malformed pointers with no fallback",()=>{
  const empty=expectUnavailable(view({nextOccurrenceId:null,occurrences:[]}));
  for(const nextOccurrenceId of [null,id(99),""," ",` ${nextId} `,undefined as unknown as string,7 as unknown as string]){
   expect(expectUnavailable(view({nextOccurrenceId}))).toBe(empty);
  }
 });
 it("rejects duplicates before selecting any valid, foreign or draft match",()=>{
  for(const occurrences of [[occurrence(),occurrence()],[occurrence(),occurrence({cohortId:id(99)})],[occurrence({state:"draft"}),occurrence()]]){
   expectUnavailable(view({occurrences:[other(),...occurrences]}));
   expectUnavailable(view({occurrences:[...occurrences].reverse()}));
  }
 });
 it.each([
  ["foreign cohort",{cohortId:id(99)}],
  ["foreign stage ID",{stageId:id(99)}],
  ["foreign stage",{stage:2}],
  ["draft",{state:"draft"}],
  ["cancelled",{state:"cancelled"}],
  ["completed",{state:"completed"}],
  ["unknown lifecycle",{state:"PRIVATE_STATE"}],
  ["zero revision",{revision:0}],
  ["negative revision",{revision:-1}],
  ["future revision",{revision:10}],
  ["fractional revision",{revision:2.5}],
  ["nonfinite revision",{revision:NaN}],
  ["unsafe revision",{revision:Number.MAX_SAFE_INTEGER+1}],
  ["zero ordinal",{ordinal:0}],
  ["excess ordinal",{ordinal:13}],
  ["fractional ordinal",{ordinal:7.5}],
 ]as const)("rejects the %s pointed occurrence",(_label,changes)=>{
  expectUnavailable(view({occurrences:[other(),occurrence(changes as Partial<OccurrenceProjection>)]}));
 });
 it("rejects missing or invalid scope even when the occurrence has the same malformed values",()=>{
  for(const scope of [{cohortId:""},{stageId:" "},{stage:5 as StageView["stage"]}]){
   expectUnavailable(view({...scope,occurrences:[occurrence(scope)]}));
  }
 });
 it("accepts boundary ordinals and a revision equal to the supplied stage revision",()=>{
  for(const ordinal of [1,12]as const){
   const html=render(view({occurrences:[occurrence({ordinal,revision:9})]}),locale);
   expect(html).toContain(`<h3>${choose("Session","מפגש")} ${ordinal}</h3>`);
   expect(html).toContain(`<dt>${choose("Session revision","גרסת המפגש")}</dt><dd>9</dd>`);
  }
 });
 it("retains an undated pointed session without inventing a time or another pointer",()=>{
  const html=render(view({occurrences:[other(),occurrence({time:{kind:"undated",timeZone:zone}})]}),locale);
  expect(html).toContain(choose("Date not yet set","טרם נקבע מועד"));expect(html).not.toContain("<time");
  expect(html).toContain(`<h3>${choose("Session","מפגש")} 7</h3>`);
 });
 it("hides malformed, unordered or foreign-zone scheduled intervals",()=>{
  for(const time of [scheduled("2026-10-18T14:00:00Z","2026-10-18T14:00:00Z"),scheduled("2026-10-18T15:00:00Z","2026-10-18T14:00:00Z"),
   scheduled("2026-10-18T14:00:00Z","PRIVATE_END"),scheduled("2026-10-18T14:00:00Z","2026-10-18T15:00:00Z","PRIVATE_ZONE"),
   {kind:"PRIVATE_KIND"} as unknown as OccurrenceProjection["time"],null as unknown as OccurrenceProjection["time"]]){
   const html=render(view({occurrences:[occurrence({time})]}),locale);
   expect(html).toContain(choose("Session time unavailable","מועד המפגש אינו זמין"));expect(html).not.toContain("<time");expect(html).not.toContain("PRIVATE_");
  }
 });
 it("rejects local wall times, calendar rollover and malformed offsets without leaking them",()=>{
  for(const value of ["2026-10-18T10:00:00","2026-02-30T10:00:00Z","2026-02-29T10:00:00Z","2026-04-31T10:00:00Z","2026-10-18T24:00:00Z","2026-10-18T10:00:00+25:00","<script>PRIVATE_TIME</script>",null as unknown as string]){
   const html=render(view({occurrences:[occurrence({time:scheduled(value,"2027-01-01T12:00:00Z")})]}),locale);
   expect(html).toContain(choose("Session time unavailable","מועד המפגש אינו זמין"));expect(html).not.toContain("<time");expect(html).not.toMatch(/PRIVATE_|Invalid Date|NaN/);
  }
 });
 it("preserves valid original offsets and precision while formatting a leap-day interval in New York",()=>{
  const startsAt="2028-02-29T12:00:00.123+02:00",endsAt="2028-02-29T12:30+02:00";
  const html=render(view({occurrences:[occurrence({time:scheduled(startsAt,endsAt)})]}),locale);
  expect(html).toContain(`dateTime="${startsAt}"`);expect(html).toContain(`dateTime="${endsAt}"`);
  expect(text(html)).toContain("5:00");expect(text(html)).toContain("5:30");expect(html).toContain(choose("EST","GMT-5"));
 });
 it("distinguishes both fall-back instants with the same local hour",()=>{
  const startsAt="2026-11-01T01:30:00-04:00",endsAt="2026-11-01T01:30:00-05:00";
  const html=render(view({occurrences:[occurrence({time:scheduled(startsAt,endsAt)})]}),locale);
  expect(html).toContain(`dateTime="${startsAt}"`);expect(html).toContain(`dateTime="${endsAt}"`);
  expect(text(html).match(/1:30/g)).toHaveLength(2);expect(html).toContain(choose("EDT","GMT-4"));expect(html).toContain(choose("EST","GMT-5"));
 });
 it("formats the spring-forward interval without inventing a 2 AM local hour",()=>{
  const html=render(view({occurrences:[occurrence({time:scheduled("2026-03-08T06:30:00Z","2026-03-08T07:30:00Z")})]}),locale);
  expect(text(html)).toContain("1:30");expect(text(html)).toContain("3:30");expect(text(html)).not.toContain("2:30");
  expect(html).toContain(choose("EDT","GMT-4"));expect(html).toContain(choose("EST","GMT-5"));
 });
 it("compares interval instants rather than lexical wall-time order across a DST fold",()=>{
  const early="2026-11-01T01:45:00-04:00",late="2026-11-01T01:15:00-05:00";
  const valid=render(view({occurrences:[occurrence({time:scheduled(early,late)})]}),locale);
  expect(valid).toContain(`dateTime="${early}"`);expect(valid).toContain(`dateTime="${late}"`);
  const invalid=render(view({occurrences:[occurrence({time:scheduled(late,early)})]}),locale);
  expect(invalid).not.toContain("<time");expect(invalid).toContain(choose("Session time unavailable","מועד המפגש אינו זמין"));
 });
 it("does not use the local clock to replace an old supplied pointer with a future one",()=>{
  vi.spyOn(Date,"now").mockImplementation(()=>{throw Error("NO_CLOCK_POLICY");});
  const html=render(view({occurrences:[other(),occurrence({time:scheduled("2001-01-01T12:00:00Z","2001-01-01T13:00:00Z")})]}),locale);
  expect(html).toContain('dateTime="2001-01-01T12:00:00Z"');expect(html).not.toContain('dateTime="2026-10-11T14:00:00Z"');
 });
 it("renders no private data, actions, callbacks or entitlement claims and does not fetch or mutate",()=>{
  const data=view();Object.assign(data,{parentName:"PRIVATE_PARENT",childName:"PRIVATE_CHILD",enrollments:[{id:id(88),name:"PRIVATE_OTHER_CHILD"}],amount:999991,credits:999992,grade:999993,readiness:"PRIVATE_READY"});
  Object.assign(data.occurrences[1]!,{medical:"PRIVATE_MEDICAL",homework:"PRIVATE_HOMEWORK",reserved:true,paid:true});
  data.notices=[{id:id(30),occurrenceId:nextId,state:"protected",receivedAt:"PRIVATE_RECEIVED",originalStartsAt:"PRIVATE_ORIGINAL",originalOccurrenceRevision:1,scheduleChangedSinceNotice:false,requestedAt:null,replacementOccurrenceId:id(31),specificTripGuaranteed:false}];
  data.attendance=[{enrollmentId:id(88),occurrenceId:nextId,state:"absent",recordedAt:"PRIVATE_ATTENDANCE"}];
  data.lessonReferences=[{occurrenceId:nextId,moduleId:"PRIVATE_LESSON",version:"PRIVATE_LESSON_VERSION"}];
  const before=structuredClone(data);freeze(data);
  const fetch=vi.fn(()=>{throw Error("NO_FETCH");});vi.stubGlobal("fetch",fetch);
  const html=render(data,locale);expect(data).toEqual(before);expect(fetch).not.toHaveBeenCalled();
  expect(html).not.toMatch(/PRIVATE_|00000000-0000|999991|999992|999993/);
  expect(html).not.toMatch(/<(?:button|a|form|input|select|textarea)\b|\bon(?:Click|Submit)=/i);
  expect(text(html)).not.toMatch(/booking|reserv|guarantee|seat|attendance|paid|payment|eligible|curriculum|skill|grade|homework|ready|הרשמה|תשלום|נוכחות|מובטח|הזמנה|ציונים|שיעורי בית/i);
 });
 it("does not even read unrelated notice, attendance, lesson or private instructor data",()=>{
  const data=view();
  for(const key of ["notices","attendance","lessonReferences"])Object.defineProperty(data,key,{get(){throw Error("UNRELATED_DATA_READ");}});
  for(const key of ["instructor","location","logisticalNote","moduleId","equipment","directions","allowedActions"])Object.defineProperty(data.occurrences[1]!,key,{get(){throw Error("PRIVATE_DATA_READ");}});
  expect(render(data,locale)).toContain(`<h3>${choose("Session","מפגש")} 7</h3>`);
 });
 it("reflects the next supplied projection and does not retain a cancelled or cleared pointer",()=>{
  const old=view(),snapshot=structuredClone(old);
  expect(render(old,locale)).toContain(`<h3>${choose("Session","מפגש")} 7</h3>`);
  expectUnavailable(view({revision:10,occurrences:[other(),occurrence({revision:4,state:"cancelled"})]}));
  expectUnavailable(view({revision:10,nextOccurrenceId:null}));expect(old).toEqual(snapshot);
 });
});

describe("selected parent presentation guards",()=>{
 it.each(["practitioner","child"]as const)("renders nothing for %s even with an enrollment and next pointer",role=>{
  for(const locale of ["en","he"]as const)expect(render(view({role}),locale)).toBe("");
 });
 it.each([null,""," "," selected "])("requires a concrete selected enrollment: %s",enrollmentId=>{
  for(const locale of ["en","he"]as const)expect(render(view({enrollmentId}),locale)).toBe("");
 });
 it.each([-1,NaN,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])("rejects invalid stage revision %s",revision=>{
  for(const locale of ["en","he"]as const)expect(render(view({revision}),locale)).toBe("");
 });
 it("renders an unavailable empty revision zero without choosing an occurrence",()=>{
  expect(render(view({revision:0,nextOccurrenceId:null,occurrences:[]}))).toContain("Next session details unavailable.");
 });
});
