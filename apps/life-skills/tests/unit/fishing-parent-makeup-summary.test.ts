/** Pure synthetic markup checks; not route, fresh-session or browser acceptance. */
import {afterEach,describe,expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {FishingParentMakeupSummary} from "../../src/features/fishing-stage/parent-makeup-summary.tsx";
import type {OccurrenceProjection,StageView} from "../../src/features/fishing-stage/contract.ts";
import type {Locale} from "../../src/lib/locale.ts";

type Notice=StageView["notices"][number];
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const originalId=id(10),replacementId=id(11),selected=id(4);
function occurrence(changes:Partial<OccurrenceProjection>={}):OccurrenceProjection{
 return {cohortId:id(1),stageId:id(2),stage:1,id:originalId,revision:4,workspaceId:id(3) as OccurrenceProjection["workspaceId"],program:"sunday_fishing_academy",
  templateVersion:"synthetic-v1",ordinal:1,moduleId:"PRIVATE_MODULE",moduleVersion:"synthetic-v1",state:"published",optional:false,
  time:{kind:"scheduled",startsAt:"2026-10-18T14:00:00.000Z",endsAt:"2026-10-18T15:00:00.000Z",timeZone:"America/New_York"},
  location:"PRIVATE_LOCATION",directions:"PRIVATE_DIRECTIONS",equipment:"PRIVATE_EQUIPMENT",logisticalNote:"PRIVATE_NOTE",
  instructor:{accountId:id(6) as OccurrenceProjection["instructor"]["accountId"],displayName:"PRIVATE_INSTRUCTOR"},childCapacity:8,
  replacesOccurrenceId:null,changedBy:id(6) as OccurrenceProjection["changedBy"],changedAt:"2026-10-17T15:00:00.000Z",changeReason:"PRIVATE_REASON",allowedActions:["report_absence"],...changes};
}
function replacement(changes:Partial<OccurrenceProjection>={}):OccurrenceProjection{
 return occurrence({id:replacementId,ordinal:2,revision:3,time:{kind:"scheduled",startsAt:"2026-11-01T15:00:00.000Z",endsAt:"2026-11-01T16:00:00.000Z",timeZone:"America/New_York"},...changes});
}
function notice(changes:Partial<Notice>={}):Notice{
 return {id:id(20),occurrenceId:originalId,state:"protected",receivedAt:"2026-10-15T13:00:00.000Z",originalStartsAt:"2026-10-17T14:00:00.000Z",
  originalOccurrenceRevision:2,scheduleChangedSinceNotice:true,requestedAt:null,replacementOccurrenceId:null,specificTripGuaranteed:false,...changes};
}
function view(changes:Partial<StageView>={}):StageView{
 return {cohortId:id(1),stageId:id(2),stage:1,revision:9,role:"parent",enrollmentId:selected,occurrences:[occurrence()],nextOccurrenceId:null,notices:[notice()],attendance:[],lessonReferences:[],...changes};
}
const render=(data:StageView,locale:Locale="en")=>renderToStaticMarkup(createElement(FishingParentMakeupSummary,{view:data,locale}));
const text=(html:string)=>html.replace(/<[^>]*>/g," ").replace(/\s+/g," ");
function freeze(value:unknown):void{
 if(value&&typeof value==="object"){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe.each(["en","he"]as const)("%s parent makeup presentation",locale=>{
 const choose=(en:string,he:string)=>locale==="he"?he:en;
 it("shows no-record wording without treating it as absence or booking",()=>{
  const html=render(view({notices:[]}),locale);
  expect(html).toContain(choose("No makeup notices recorded.","לא נרשמו דיווחי השלמה."));
  expect(html).not.toMatch(/Absent|No-show|confirmed|נעדר|לא הגיע|אושר מקום/);
  expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(text(html)).toContain(choose("Stage revision: 9","גרסת השלב: 9"));
  expect(html).toContain("America/New_York");expect(html).not.toContain("<li");
 });
 it.each([
  ["protected","Makeup entitlement preserved. A suitable place still needs confirmation.","הזכאות להשלמה נשמרה. עדיין נדרש אישור למקום מתאים."],
  ["best_effort","The instructor will review a suitable opportunity. A particular trip is not guaranteed.","המדריך יבדוק אפשרות מתאימה. אין הבטחה למקום ביציאה מסוימת."],
  ["operator_review","The instructor will review a suitable opportunity. A particular trip is not guaranteed.","המדריך יבדוק אפשרות מתאימה. אין הבטחה למקום ביציאה מסוימת."],
  ["operator_undelivered","The cancelled session remains undelivered. Replacement arrangements need confirmation.","המפגש שבוטל טרם סופק. יש לאשר את הסדרי ההשלמה."],
 ]as const)("preserves the supplied %s notice classification",(state,en,he)=>{
  const html=render(view({notices:[notice({state})]}),locale);
  expect(text(html)).toContain(choose(en,he));
  if(state!=="protected")expect(html).not.toContain(choose("Makeup entitlement preserved.","הזכאות להשלמה נשמרה."));
 });
 it("retains original schedule evidence separately from the revised current session",()=>{
  const html=render(view(),locale);
  expect(html).toContain(`<h3>${choose("Original session","המפגש המקורי")} 1</h3>`);
  expect(html).toContain(`<dt>${choose("Original session revision","גרסת המפגש המקורית")}</dt><dd>2</dd>`);
  expect(html).toContain(`<dt>${choose("Current session revision","גרסת המפגש הנוכחית")}</dt><dd>4</dd>`);
  for(const value of ["2026-10-17T14:00:00.000Z","2026-10-18T14:00:00.000Z","2026-10-15T13:00:00.000Z"])expect(html).toContain(`dateTime="${value}"`);
  expect(html).toContain(choose("Session details changed after this notice. Your original notice time is retained.","פרטי המפגש השתנו לאחר הדיווח. מועד הדיווח המקורי נשמר."));
  expect(html).toContain('class="lsw-card"');
 });
 it("does not invent a schedule-change warning or a pending request",()=>{
  const html=render(view({notices:[notice({scheduleChangedSinceNotice:false,originalOccurrenceRevision:4})]}),locale);
  expect(html).toContain(choose("No makeup request recorded.","לא נרשמה בקשת השלמה."));
  expect(html).not.toContain(choose("Session details changed","פרטי המפגש השתנו"));
  expect(html).not.toContain(choose("Your makeup request is awaiting confirmation.","בקשת ההשלמה שלך ממתינה לאישור."));
  expect(html).not.toContain(choose("A replacement is recorded.","נרשם מפגש חלופי."));
 });
 it("shows a valid pending request and its received instant",()=>{
  const requestedAt="2026-10-16T11:45:00-04:00",html=render(view({notices:[notice({requestedAt})]}),locale);
  expect(html).toContain(choose("Your makeup request is awaiting confirmation.","בקשת ההשלמה שלך ממתינה לאישור."));
  expect(html).toContain(`dateTime="${requestedAt}"`);
  expect(html).not.toContain(choose("A replacement is recorded.","נרשם מפגש חלופי."));
 });
 it.each(["published","completed","cancelled"]as const)("shows the recorded replacement's actual %s state without a reservation promise",state=>{
  const html=render(view({occurrences:[occurrence(),replacement({state})],notices:[notice({requestedAt:"2026-10-16T12:00:00Z",replacementOccurrenceId:replacementId})]}),locale);
  const label=state==="published"?choose("Published","פורסם"):state==="completed"?choose("Completed","התקיים"):choose("Cancelled","בוטל");
  expect(html).toContain(choose("A replacement is recorded.","נרשם מפגש חלופי."));
  expect(html).toContain(`<dt>${choose("Replacement session","המפגש החלופי")}</dt><dd>${choose("Session","מפגש")} 2</dd>`);
  expect(html).toContain(`<dt>${choose("Replacement status","מצב המפגש החלופי")}</dt><dd>${label}</dd>`);
  expect(html).toContain(`<dt>${choose("Replacement revision","גרסת המפגש החלופי")}</dt><dd>3</dd>`);
  expect(html).toContain('dateTime="2026-11-01T15:00:00.000Z"');
  expect(html).not.toMatch(/awaiting confirmation|still needs confirmation|place has been confirmed|\breserved\b|ממתינה לאישור|עדיין נדרש אישור|אושר מקום/);
  expect(html).not.toContain(replacementId);
 });
 it("keeps recorded replacements without inferring a missing request",()=>{
  const html=render(view({occurrences:[occurrence(),replacement()],notices:[notice({replacementOccurrenceId:replacementId})]}),locale);
  expect(html).toContain(choose("No makeup request recorded.","לא נרשמה בקשת השלמה."));
  expect(html).toContain(choose("A replacement is recorded.","נרשם מפגש חלופי."));
 });
 it("preserves cancellation and ordinary policy after a replacement is recorded",()=>{
  for(const state of ["operator_undelivered","best_effort","operator_review"]as const){
   const html=render(view({occurrences:[occurrence({state:"cancelled"}),replacement({state:"completed"})],notices:[notice({state,replacementOccurrenceId:replacementId})]}),locale);
   expect(html).toContain(state==="operator_undelivered"?choose("The cancelled session remains undelivered.","המפגש שבוטל טרם סופק."):choose("A particular trip is not guaranteed.","אין הבטחה למקום ביציאה מסוימת."));
   expect(html).not.toContain(choose("Replacement arrangements need confirmation.","יש לאשר את הסדרי ההשלמה."));
  }
 });
 it.each([
  ["outside view",[]],
  ["duplicate",[replacement(),replacement()]],
  ["duplicate in foreign cohort",[replacement(),replacement({cohortId:id(99)})]],
  ["foreign cohort",[replacement({cohortId:id(99)})]],
  ["foreign stage ID",[replacement({stageId:id(99)})]],
  ["foreign stage",[replacement({stage:2})]],
  ["draft",[replacement({state:"draft"})]],
  ["unknown lifecycle",[replacement({state:"PRIVATE_STATE" as OccurrenceProjection["state"]})]],
  ["future revision",[replacement({revision:10})]],
  ["zero revision",[replacement({revision:0})]],
  ["fractional revision",[replacement({revision:2.5})]],
  ["invalid ordinal",[replacement({ordinal:13 as OccurrenceProjection["ordinal"]})]],
 ]as const)("hides %s replacement details but retains the recorded linkage",(_label,occurrences)=>{
  const html=render(view({occurrences:[occurrence(),...occurrences],notices:[notice({replacementOccurrenceId:replacementId})]}),locale);
  expect(html).toContain(choose("A replacement is recorded, but its details are unavailable here.","נרשם מפגש חלופי, אך פרטיו אינם זמינים כאן."));
  expect(html).not.toContain('dateTime="2026-11-01T15:00:00.000Z"');
  expect(html).not.toContain(choose("<dt>Replacement session</dt>","<dt>המפגש החלופי</dt>"));
  expect(html).not.toContain(replacementId);expect(html).not.toContain("PRIVATE_STATE");
 });
 it("keeps valid original snapshot evidence when the original occurrence cannot be resolved",()=>{
  for(const occurrences of [[],[occurrence(),occurrence()],[occurrence({cohortId:id(99)})],[occurrence({state:"draft"})]]){
   const html=render(view({occurrences}),locale);
   expect(html).toContain(choose("Original session details unavailable here.","פרטי המפגש המקורי אינם זמינים כאן."));
   expect(html).toContain('dateTime="2026-10-17T14:00:00.000Z"');
   expect(html).not.toContain('dateTime="2026-10-18T14:00:00.000Z"');expect(html).not.toContain(originalId);
  }
 });
 it("shows unavailable for malformed notice facts without leaking raw values",()=>{
  const html=render(view({notices:[notice({state:"PRIVATE_STATE" as Notice["state"],receivedAt:"PRIVATE_RECEIPT",originalStartsAt:"PRIVATE_START",originalOccurrenceRevision:NaN,
   requestedAt:"PRIVATE_REQUEST",scheduleChangedSinceNotice:"PRIVATE_FLAG" as unknown as boolean,replacementOccurrenceId:" "})]}),locale);
  for(const phrase of [choose("Notice status unavailable.","מצב הדיווח אינו זמין."),choose("Makeup request status unavailable.","מצב בקשת ההשלמה אינו זמין."),
   choose("Schedule comparison unavailable.","השוואת המועדים אינה זמינה."),choose("Replacement status unavailable.","מצב ההשלמה אינו זמין.")])expect(html).toContain(phrase);
  expect(html).not.toMatch(/PRIVATE_|NaN|Invalid Date/);
  expect(html).not.toContain(choose("awaiting confirmation","ממתינה לאישור"));
 });
 it("rejects invalid original revision evidence instead of borrowing the current revision",()=>{
  for(const originalOccurrenceRevision of [0,-1,2.5,5,Number.MAX_SAFE_INTEGER+1]){
   expect(render(view({notices:[notice({originalOccurrenceRevision})]}),locale)).toContain(`<dt>${choose("Original session revision","גרסת המפגש המקורית")}</dt><dd>${choose("Unavailable","לא זמין")}</dd>`);
  }
 });
 it("retains undated replacements and rejects invalid schedule ranges",()=>{
  const withTime=(time:OccurrenceProjection["time"])=>render(view({occurrences:[replacement({time})],notices:[notice({replacementOccurrenceId:replacementId})]}),locale);
  expect(withTime({kind:"undated",timeZone:"America/New_York"})).toContain(choose("Date not yet set","טרם נקבע מועד"));
  for(const time of [
   {kind:"scheduled",startsAt:"2026-11-01T15:00:00Z",endsAt:"2026-11-01T14:00:00Z",timeZone:"America/New_York"},
   {kind:"scheduled",startsAt:"2026-11-01T15:00:00Z",endsAt:"2026-11-01T15:00:00Z",timeZone:"America/New_York"},
   {kind:"scheduled",startsAt:"2026-11-01T15:00:00Z",endsAt:"PRIVATE_END",timeZone:"America/New_York"},
   {kind:"scheduled",startsAt:"2026-11-01T15:00:00Z",endsAt:"2026-11-01T16:00:00Z",timeZone:"PRIVATE_ZONE"},
  ]as const){const html=withTime(time);expect(html).toContain(choose("Session time unavailable","מועד המפגש אינו זמין"));expect(html).not.toContain('dateTime="2026-11-01T15:00:00Z"');expect(html).not.toContain("PRIVATE_");}
 });
 it("never formats local wall times, impossible dates or malformed offsets",()=>{
  for(const value of ["2026-10-17T10:00:00","2026-02-30T10:00:00Z","2026-02-29T10:00:00Z","2026-04-31T10:00:00Z","2026-10-17T24:00:00Z","2026-10-17T10:00:00+25:00","<script>PRIVATE</script>"]){
   const html=render(view({occurrences:[],notices:[notice({originalStartsAt:value,receivedAt:value,requestedAt:value})]}),locale);
   expect(html).not.toContain("<time");expect(html).not.toContain("PRIVATE");expect(html).not.toContain("Invalid Date");
   expect(html).toContain(choose("Makeup request status unavailable.","מצב בקשת ההשלמה אינו זמין."));
  }
  expect(render(view({notices:[notice({originalStartsAt:"2028-02-29T10:00:00Z"})]}),locale)).toContain('dateTime="2028-02-29T10:00:00Z"');
 });
 it("distinguishes fall-back instants and spring-forward local hours in New York",()=>{
  const autumn=render(view({occurrences:[],notices:[notice({originalStartsAt:"2026-11-01T01:30:00-04:00",receivedAt:"2026-11-01T01:30:00-05:00"})]}),locale);
  expect(autumn).toContain(choose("EDT","GMT-4"));expect(autumn).toContain(choose("EST","GMT-5"));
  expect(text(autumn).match(/1:30/g)).toHaveLength(2);
  const spring=render(view({occurrences:[],notices:[notice({originalStartsAt:"2026-03-08T06:30:00Z",receivedAt:"2026-03-08T07:30:00Z"})]}),locale);
  expect(spring).toContain("1:30");expect(spring).toContain("3:30");expect(spring).not.toContain("2:30");
  expect(spring).toContain(choose("EDT","GMT-4"));expect(spring).toContain(choose("EST","GMT-5"));
 });
 it("has no actions, fetches, mutation, private fields or inferred payment/readiness",()=>{
  const data=view({occurrences:[occurrence(),replacement()],notices:[notice({replacementOccurrenceId:replacementId})],
   attendance:[{enrollmentId:id(50),occurrenceId:replacementId,state:"absent",recordedAt:"2026-12-31T12:00:00Z"}],lessonReferences:[{occurrenceId:replacementId,moduleId:"PRIVATE_LESSON",version:"PRIVATE_VERSION"}]});
  Object.assign(data,{parentName:"PRIVATE_PARENT",childName:"PRIVATE_CHILD",amount:999991,classCount:999992,credits:999993,readiness:"PRIVATE_READY"});
  Object.assign(data.notices[0]!,{reason:"PRIVATE_MEDICAL",decisionReason:"PRIVATE_DECISION",replacementReservationId:"PRIVATE_RESERVATION",specificTripGuaranteed:true});
  const before=structuredClone(data);freeze(data);
  const fetch=vi.fn(()=>{throw Error("NO_FETCH");});vi.stubGlobal("fetch",fetch);
  vi.spyOn(Date,"now").mockImplementation(()=>{throw Error("NO_CLOCK_POLICY");});
  const html=render(data,locale);
  expect(data).toEqual(before);expect(fetch).not.toHaveBeenCalled();
  expect(html).not.toMatch(/PRIVATE_|00000000-0000|999991|999992|999993|2026-12-31/);
  expect(html).not.toMatch(/<(?:button|a|form|input|select|textarea)\b|\bon(?:Click|Submit)=/i);
  expect(html).not.toMatch(/trip is guaranteed|place has been confirmed|ready to|אושר מקום|מוכן ל/);
 });
 it("consumes replacement changes only from the next supplied projection",()=>{
  const old=view({occurrences:[occurrence(),replacement()],notices:[notice({replacementOccurrenceId:replacementId})]}),snapshot=structuredClone(old);
  const updated=view({revision:10,occurrences:[occurrence(),replacement({revision:5,state:"cancelled"})],notices:[notice({replacementOccurrenceId:replacementId})]});
  expect(render(old,locale)).toContain(`<dt>${choose("Replacement status","מצב המפגש החלופי")}</dt><dd>${choose("Published","פורסם")}</dd>`);
  expect(render(updated,locale)).toContain(`<dt>${choose("Replacement status","מצב המפגש החלופי")}</dt><dd>${choose("Cancelled","בוטל")}</dd>`);
  expect(old).toEqual(snapshot);
 });
});

describe("presentation guards only",()=>{
 it.each(["practitioner","child"]as const)("renders nothing for %s, regardless of enrollment data",role=>{
  for(const locale of ["en","he"]as const)expect(render(view({role}),locale)).toBe("");
 });
 it.each([null,""," "," selected "])("requires a concrete selected enrollment: %s",enrollmentId=>{
  for(const locale of ["en","he"]as const)expect(render(view({enrollmentId}),locale)).toBe("");
 });
 it.each([-1,NaN,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])("rejects invalid stage revision %s",revision=>{
  for(const locale of ["en","he"]as const)expect(render(view({revision}),locale)).toBe("");
 });
 it("allows an authorized empty revision zero without choosing a child or session",()=>{
  expect(render(view({revision:0,occurrences:[],notices:[]}))).toContain("No makeup notices recorded.");
 });
});
