import type {Locale} from "../../lib/locale.ts";
import type {OccurrenceProjection,StageView} from "./contract.ts";

const zone="America/New_York";
function concreteId(value:unknown):value is string{
 return typeof value==="string"&&value.length>0&&value===value.trim();
}
// Same private date validation as the makeup summary; existing files stay intact.
function instant(value:unknown):number|null{
 if(typeof value!=="string")return null;
 // Reject local wall times and calendar rollover before Date.parse normalizes them.
 const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
 if(!parts)return null;
 const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
 const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1]!||Number(parts[4])>23||Number(parts[5])>59||
  Number(parts[6]??0)>59||Number(parts[7]??0)>23||Number(parts[8]??0)>59)return null;
 const time=Date.parse(value);return Number.isFinite(time)?time:null;
}
function nextOccurrence(view:StageView):OccurrenceProjection|null{
 if(!concreteId(view.nextOccurrenceId)||!concreteId(view.cohortId)||!concreteId(view.stageId)||![1,2,3,4].includes(view.stage))return null;
 // Count every matching ID, including foreign/draft duplicates, before resolving.
 const matches=view.occurrences.filter(occurrence=>occurrence.id===view.nextOccurrenceId),occurrence=matches[0];
 if(matches.length!==1||!occurrence)return null;
 return occurrence.state==="published"&&occurrence.cohortId===view.cohortId&&occurrence.stageId===view.stageId&&occurrence.stage===view.stage&&
  Number.isSafeInteger(occurrence.revision)&&occurrence.revision>=1&&occurrence.revision<=view.revision&&
  Number.isInteger(occurrence.ordinal)&&occurrence.ordinal>=1&&occurrence.ordinal<=12?occurrence:null;
}

export type FishingParentNextSessionSummaryProps={view:StageView;locale:Locale};
/** Pure presentation of an ALREADY freshly authorized selected-parent StageView.
 * These guards cannot prove authorization. Root must bind the current session
 * and selected enrollment, clear stale views on identity/selection changes and
 * refresh after edits. Only the supplied pointer determines the next session;
 * no clock policy, fallback selection, fetch, callbacks or mutations occur here. */
export function FishingParentNextSessionSummary({view,locale}:FishingParentNextSessionSummaryProps){
 if(view.role!=="parent"||!concreteId(view.enrollmentId)||!Number.isSafeInteger(view.revision)||view.revision<0)return null;
 const t=(en:string,he:string)=>locale==="he"?he:en,next=nextOccurrence(view);
 const schedule=(occurrence:OccurrenceProjection)=>{
  const value=occurrence.time;
  if(value?.kind==="undated")return t("Date not yet set","טרם נקבע מועד");
  if(value?.kind!=="scheduled")return t("Session time unavailable","מועד המפגש אינו זמין");
  const starts=instant(value.startsAt),ends=instant(value.endsAt);
  if(value.timeZone!==zone||starts===null||ends===null||ends<=starts)return t("Session time unavailable","מועד המפגש אינו זמין");
  const format=new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{
   timeZone:zone,year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short",
  });
  return <><time dateTime={value.startsAt}>{format.format(starts)}</time> – <time dateTime={value.endsAt}>{format.format(ends)}</time> · <bdi>{zone}</bdi></>;
 };
 return <section className="lsw-stack" lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-label={t("Next session","המפגש הבא")}>
  <h2>{t("Next session","המפגש הבא")}</h2>
  {next?<div className="lsw-card">
   <h3>{t("Session","מפגש")} {next.ordinal}</h3>
   <dl>
    <dt>{t("Stage revision","גרסת השלב")}</dt><dd>{view.revision}</dd>
    <dt>{t("Session revision","גרסת המפגש")}</dt><dd>{next.revision}</dd>
   </dl>
   <p>{schedule(next)}</p>
  </div>:<p>{t("Next session details unavailable.","פרטי המפגש הבא אינם זמינים.")}</p>}
 </section>;
}
