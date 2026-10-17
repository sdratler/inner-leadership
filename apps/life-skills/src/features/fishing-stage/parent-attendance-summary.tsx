import type {Locale} from "../../lib/locale.ts";
import type {OccurrenceProjection,StageView} from "./contract.ts";

type Attendance = StageView["attendance"][number];
type AttendanceSummary =
 | {kind:"recorded";state:Attendance["state"];recordedAt:string}
 | {kind:"unrecorded"|"unknown"|"conflict"};
const zone="America/New_York";
const attendanceStates:readonly Attendance["state"][]=["present","late","absent","no_show"];
function instant(value:string):number|null{
 // Supplied instants need an explicit offset; never use the device's timezone.
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const time=Date.parse(value);return Number.isFinite(time)?time:null;
}
function attendanceFor(view:StageView,occurrenceId:string):AttendanceSummary{
 const facts=view.attendance.filter(fact=>fact.enrollmentId===view.enrollmentId&&fact.occurrenceId===occurrenceId);
 if(facts.length===0)return {kind:"unrecorded"};
 let latest=-Infinity,states=new Set<Attendance["state"]>();
 for(const fact of facts){
  const at=instant(fact.recordedAt);
  // An unorderable own fact cannot safely be replaced by an older known fact.
  if(at===null)return {kind:"unknown"};
  if(at>latest){latest=at;states=new Set([fact.state]);}
  else if(at===latest)states.add(fact.state);
 }
 if(states.size!==1)return {kind:"conflict"};
 const state=[...states][0]!;
 return attendanceStates.includes(state)?{kind:"recorded",state,recordedAt:new Date(latest).toISOString()}:{kind:"unknown"};
}
function currentOccurrence(occurrence:OccurrenceProjection,view:StageView):boolean{
 return occurrence.cohortId===view.cohortId&&occurrence.stageId===view.stageId&&occurrence.stage===view.stage&&
  Number.isSafeInteger(occurrence.revision)&&occurrence.revision>=1&&occurrence.revision<=view.revision&&
  Number.isInteger(occurrence.ordinal)&&occurrence.ordinal>=1&&occurrence.ordinal<=12&&
  (occurrence.state==="published"||occurrence.state==="completed"||occurrence.state==="cancelled");
}

export type FishingParentAttendanceSummaryProps={view:StageView;locale:Locale};
/** Presentation of an ALREADY authorized current StageView. This guard is not
 * authentication or a server boundary. No fetch, mutations, identity switching,
 * payment/credit, makeup or safety conclusions are derived here. Root owns
 * refreshing the authorized projection after an instructor's correction. */
export function FishingParentAttendanceSummary({view,locale}:FishingParentAttendanceSummaryProps){
 if(view.role!=="parent"||typeof view.enrollmentId!=="string"||view.enrollmentId.length===0||view.enrollmentId!==view.enrollmentId.trim()||
  !Number.isSafeInteger(view.revision)||view.revision<0)return null;
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const format=(value:string)=>new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{
  timeZone:zone,year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short",
 }).format(new Date(value));
 const statuses={published:t("Published","פורסם"),completed:t("Completed","התקיים"),cancelled:t("Cancelled","בוטל")};
 const attendanceLabels:Record<Attendance["state"],string>={present:t("Present","נכח"),late:t("Late","איחר"),absent:t("Absent","נעדר"),no_show:t("No-show","לא הגיע")};
 const occurrences=view.occurrences.filter(occurrence=>currentOccurrence(occurrence,view)&&view.occurrences.filter(other=>other.id===occurrence.id).length===1);
 return <section className="lsw-stack" lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-label={t("Session status and attendance","מצב המפגשים ונוכחות")}>
  <h2>{t("Session status and attendance","מצב המפגשים ונוכחות")}</h2>
  <p>{t("Stage revision:","גרסת השלב:")} {view.revision}</p>
  {occurrences.length===0?<p>{t("No published sessions to show.","אין מפגשים שפורסמו להצגה.")}</p>:<ol className="lsw-stack">
   {occurrences.map(occurrence=>{
    const attendance=attendanceFor(view,occurrence.id),time=occurrence.time;
    const starts=time.kind==="scheduled"?instant(time.startsAt):null,ends=time.kind==="scheduled"?instant(time.endsAt):null;
    const attendanceText=attendance.kind==="recorded"?attendanceLabels[attendance.state]:attendance.kind==="unrecorded"?t("Not recorded","טרם נרשמה"):
     attendance.kind==="conflict"?t("Unknown — conflicting attendance records","לא ידוע — רישומי נוכחות סותרים"):t("Unknown — attendance needs review","לא ידוע — נדרשת בדיקת נוכחות");
    return <li className="lsw-card" key={occurrence.id}>
     <h3>{t("Session","מפגש")} {occurrence.ordinal}</h3>
     <dl>
      <dt>{t("Session status","מצב המפגש")}</dt><dd>{statuses[occurrence.state as keyof typeof statuses]}</dd>
      <dt>{t("Session revision","גרסת המפגש")}</dt><dd>{occurrence.revision}</dd>
      <dt>{t("Attendance","נוכחות")}</dt><dd>{attendanceText}</dd>
     </dl>
     <p>{time.kind==="undated"?t("Date not yet set","טרם נקבע מועד"):
      time.timeZone===zone&&starts!==null&&ends!==null&&ends>starts?<>
       <time dateTime={time.startsAt}>{format(time.startsAt)}</time> – <time dateTime={time.endsAt}>{format(time.endsAt)}</time> · <bdi>{zone}</bdi>
      </>:t("Session time unavailable","מועד המפגש אינו זמין")}</p>
     {attendance.kind==="recorded"&&<p>{t("Attendance updated:","הנוכחות עודכנה:")} <time dateTime={attendance.recordedAt}>{format(attendance.recordedAt)}</time></p>}
    </li>;
   })}
  </ol>}
 </section>;
}
