import type {Locale} from "../../lib/locale.ts";
import type {OccurrenceProjection,StageView} from "./contract.ts";

const zone="America/New_York";
function concreteId(value:unknown):value is string{
 return typeof value==="string"&&value.length>0&&value===value.trim();
}
function revision(value:number,maximum:number):boolean{
 return Number.isSafeInteger(value)&&value>=1&&value<=maximum;
}
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
function occurrenceFor(view:StageView,id:unknown):OccurrenceProjection|null{
 if(!concreteId(id))return null;
 // Count all matching IDs before checking scope: never choose one duplicate.
 const matches=view.occurrences.filter(occurrence=>occurrence.id===id),occurrence=matches[0];
 if(matches.length!==1||!occurrence)return null;
 return occurrence.cohortId===view.cohortId&&occurrence.stageId===view.stageId&&occurrence.stage===view.stage&&
  revision(occurrence.revision,view.revision)&&Number.isInteger(occurrence.ordinal)&&occurrence.ordinal>=1&&occurrence.ordinal<=12&&
  (occurrence.state==="published"||occurrence.state==="completed"||occurrence.state==="cancelled")?occurrence:null;
}

export type FishingParentMakeupSummaryProps={view:StageView;locale:Locale};
/** Readonly presentation of an ALREADY authorized StageView, not authentication.
 * Notices have no per-item enrollment ID: Root must refresh the authorized view
 * for the selected enrollment and discard stale data when identity changes.
 * No fetching, identity selection, policy calculation or booking happens here. */
export function FishingParentMakeupSummary({view,locale}:FishingParentMakeupSummaryProps){
 if(view.role!=="parent"||!concreteId(view.enrollmentId)||!Number.isSafeInteger(view.revision)||view.revision<0)return null;
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const unknown=t("Unavailable","לא זמין");
 const format=new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{
  timeZone:zone,year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short",
 });
 const time=(value:string)=>{
  const parsed=instant(value);
  return parsed===null?unknown:<time dateTime={value}>{format.format(parsed)}</time>;
 };
 const schedule=(occurrence:OccurrenceProjection)=>{
  const value=occurrence.time;
  if(value.kind==="undated")return t("Date not yet set","טרם נקבע מועד");
  if(value.kind!=="scheduled")return t("Session time unavailable","מועד המפגש אינו זמין");
  const starts=instant(value.startsAt),ends=instant(value.endsAt);
  return value.timeZone===zone&&starts!==null&&ends!==null&&ends>starts?
   <>{time(value.startsAt)} – {time(value.endsAt)}</>:t("Session time unavailable","מועד המפגש אינו זמין");
 };
 const states={published:t("Published","פורסם"),completed:t("Completed","התקיים"),cancelled:t("Cancelled","בוטל")};
 return <section className="lsw-stack" lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-label={t("Makeup notices","דיווחי השלמה")}>
  <h2>{t("Makeup notices","דיווחי השלמה")}</h2>
  <p>{t("Stage revision:","גרסת השלב:")} {view.revision} · <bdi>{zone}</bdi></p>
  {view.notices.length===0?<p>{t("No makeup notices recorded.","לא נרשמו דיווחי השלמה.")}</p>:<ol className="lsw-stack">
   {view.notices.map((notice,index)=>{
    const original=occurrenceFor(view,notice.occurrenceId),replacement=occurrenceFor(view,notice.replacementOccurrenceId);
    const replacementState=notice.replacementOccurrenceId===null?"none":concreteId(notice.replacementOccurrenceId)?"recorded":"unknown";
    const requestState=notice.requestedAt===null?"none":instant(notice.requestedAt)!==null?"recorded":"unknown";
    const ordinary=notice.state==="best_effort"||notice.state==="operator_review";
    return <li className="lsw-card" key={index}>
     <h3>{original?<>{t("Original session","המפגש המקורי")} {original.ordinal}</>:t("Original session details unavailable here.","פרטי המפגש המקורי אינם זמינים כאן.")}</h3>
     <dl>
      <dt>{t("Original session revision","גרסת המפגש המקורית")}</dt><dd>{revision(notice.originalOccurrenceRevision,original?.revision??view.revision)?notice.originalOccurrenceRevision:unknown}</dd>
      <dt>{t("Original start","המועד המקורי")}</dt><dd>{time(notice.originalStartsAt)}</dd>
      <dt>{t("Notice received","הדיווח התקבל")}</dt><dd>{time(notice.receivedAt)}</dd>
     </dl>
     {notice.state==="protected"?<p>{t("Makeup entitlement preserved.","הזכאות להשלמה נשמרה.")}{replacementState==="none"&&<> {t("A suitable place still needs confirmation.","עדיין נדרש אישור למקום מתאים.")}</>}</p>:
      notice.state==="operator_undelivered"?<p>{t("The cancelled session remains undelivered.","המפגש שבוטל טרם סופק.")}{replacementState==="none"&&<> {t("Replacement arrangements need confirmation.","יש לאשר את הסדרי ההשלמה.")}</>}</p>:
      ordinary?<p>{replacementState==="none"&&<>{t("The instructor will review a suitable opportunity.","המדריך יבדוק אפשרות מתאימה.")} </>}{t("A particular trip is not guaranteed.","אין הבטחה למקום ביציאה מסוימת.")}</p>:
      <p>{t("Notice status unavailable.","מצב הדיווח אינו זמין.")}</p>}
     {notice.scheduleChangedSinceNotice===true&&<p>{t("Session details changed after this notice. Your original notice time is retained.","פרטי המפגש השתנו לאחר הדיווח. מועד הדיווח המקורי נשמר.")}</p>}
     {notice.scheduleChangedSinceNotice!==true&&notice.scheduleChangedSinceNotice!==false&&<p>{t("Schedule comparison unavailable.","השוואת המועדים אינה זמינה.")}</p>}
     {original&&<dl>
      <dt>{t("Current session status","מצב המפגש הנוכחי")}</dt><dd>{states[original.state as keyof typeof states]}</dd>
      <dt>{t("Current session revision","גרסת המפגש הנוכחית")}</dt><dd>{original.revision}</dd>
      <dt>{t("Current session time","מועד המפגש הנוכחי")}</dt><dd>{schedule(original)}</dd>
     </dl>}
     {requestState==="recorded"?<>
      <p>{t("Request received:","הבקשה התקבלה:")} {time(notice.requestedAt!)}</p>
      {replacementState==="none"&&<p>{t("Your makeup request is awaiting confirmation.","בקשת ההשלמה שלך ממתינה לאישור.")}</p>}
     </>:<p>{requestState==="none"?t("No makeup request recorded.","לא נרשמה בקשת השלמה."):t("Makeup request status unavailable.","מצב בקשת ההשלמה אינו זמין.")}</p>}
     {replacementState==="recorded"&&(replacement?<>
      <p>{t("A replacement is recorded.","נרשם מפגש חלופי.")}</p>
      <dl>
       <dt>{t("Replacement session","המפגש החלופי")}</dt><dd>{t("Session","מפגש")} {replacement.ordinal}</dd>
       <dt>{t("Replacement status","מצב המפגש החלופי")}</dt><dd>{states[replacement.state as keyof typeof states]}</dd>
       <dt>{t("Replacement revision","גרסת המפגש החלופי")}</dt><dd>{replacement.revision}</dd>
       <dt>{t("Replacement time","מועד המפגש החלופי")}</dt><dd>{schedule(replacement)}</dd>
      </dl>
     </>:<p>{t("A replacement is recorded, but its details are unavailable here.","נרשם מפגש חלופי, אך פרטיו אינם זמינים כאן.")}</p>)}
     {replacementState==="unknown"&&<p>{t("Replacement status unavailable.","מצב ההשלמה אינו זמין.")}</p>}
    </li>;
   })}
  </ol>}
 </section>;
}
