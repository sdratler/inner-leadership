"use client";
import type {Locale} from "../../lib/locale.ts";
import type {OccurrenceProjection,StageView} from "./contract.ts";

/** Embed in existing Calendar/Resources shells. No new navigation, API fetch,
 * account switch, provider effect or payment/enrollment inference. */
export function FishingStagePlan({view,locale="en",onNotice,onRequestMakeup,onEdit,lessonHref}:
 {view:StageView;locale?:Locale;onNotice?:(occurrence:OccurrenceProjection,reason:"ordinary_absence"|"unavoidable")=>void;
 onRequestMakeup?:(noticeId:string)=>void;onEdit?:(occurrence:OccurrenceProjection)=>void;lessonHref?:(occurrenceId:string)=>string|null}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const format=(value:string,zone:string)=>new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{timeZone:zone,dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
 const states={draft:t("Draft","טיוטה"),published:t("Published plan","תוכנית שפורסמה"),completed:t("Session delivered","המפגש התקיים"),cancelled:t("Cancelled — service remains undelivered","בוטל — השירות טרם סופק")};
 const next=view.occurrences.find(o=>o.id===view.nextOccurrenceId);
 const awaitingDates=view.occurrences.some(o=>o.time.kind==="undated"&&(o.state==="draft"||o.state==="published"));
 return <section lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-label={t("Fishing stage plan","תוכנית שלב הדיג")}>
  <h2>{t("Stage","שלב")} {view.stage} · {t("12 sessions","12 מפגשים")}</h2>
  <p>{next&&next.time.kind==="scheduled"?`${t("Next session:","המפגש הבא:")} ${format(next.time.startsAt,next.time.timeZone)}`:awaitingDates?t("Dates will appear when the instructor publishes the schedule.","המועדים יופיעו לאחר שהמדריך יפרסם את לוח הזמנים."):t("No upcoming session is scheduled.","אין מפגש קרוב שנקבע לו מועד.")}</p>
  <ol className="lsw-stack">{view.occurrences.map(o=>{const href=lessonHref?.(o.id),safeHref=href?.startsWith("/")&&!href.startsWith("//")&&!/[\\\u0000-\u0020]/.test(href)?href:null;
   return <li className="lsw-card" key={o.id}>
    <h3>{t("Session","מפגש")} {o.ordinal} · <bdi>{o.moduleId}</bdi></h3><p>{states[o.state]}</p>
    <p>{o.time.kind==="scheduled"?<><time dateTime={o.time.startsAt}>{format(o.time.startsAt,o.time.timeZone)}</time> – <time dateTime={o.time.endsAt}>{format(o.time.endsAt,o.time.timeZone)}</time> · <bdi>{o.time.timeZone}</bdi></>:t("Date not yet set","טרם נקבע מועד")}</p>
    <p>{o.location||t("Meeting place not yet set","טרם נקבע מקום מפגש")}</p>{o.directions&&<p>{o.directions}</p>}{o.equipment&&<p>{t("Bring:","יש להביא:")} {o.equipment}</p>}{o.logisticalNote&&<p>{o.logisticalNote}</p>}
    <p>{t("Instructor:","מדריך:")} {o.instructor.displayName}</p>
    {o.revision>1&&<p>{t("Updated","עודכן")} <time dateTime={o.changedAt}>{format(o.changedAt,o.time.timeZone)}</time> · {o.changeReason}</p>}
    {safeHref&&view.lessonReferences.some(l=>l.occurrenceId===o.id)&&<a href={safeHref}>{t("Open lesson","פתיחת שיעור")}</a>}
    {onNotice&&o.allowedActions.includes("report_absence")&&!view.notices.some(n=>n.occurrenceId===o.id)&&<form onSubmit={event=>{event.preventDefault();const reason=new FormData(event.currentTarget).get("reason");if(reason==="ordinary_absence"||reason==="unavoidable")onNotice(o,reason);}}>
     <label>{t("Absence type","סוג ההיעדרות")} <select name="reason"><option value="ordinary_absence">{t("Ordinary absence","היעדרות רגילה")}</option><option value="unavoidable">{t("Unavoidable absence","היעדרות בלתי נמנעת")}</option></select></label>
     <p>{t("No medical details are needed. A notice does not reserve a place on a replacement trip.","אין צורך בפרטים רפואיים. דיווח אינו שומר מקום ביציאה חלופית.")}</p><button type="submit">{t("Report absence","דיווח על היעדרות")}</button>
    </form>}
    {onEdit&&o.allowedActions.includes("revise")&&<button type="button" onClick={()=>onEdit(o)}>{t("Edit session","עריכת מפגש")}</button>}
   </li>;})}</ol>
  {view.notices.map(n=><article className="lsw-card" key={n.id}><h3>{t("Notice received","הדיווח התקבל")}</h3><time dateTime={n.receivedAt}>{format(n.receivedAt,"America/New_York")}</time>
   <p>{n.state==="protected"?t("Makeup entitlement preserved. A suitable place still needs confirmation.","הזכאות להשלמה נשמרה. עדיין נדרש אישור למקום מתאים."):n.state==="operator_undelivered"?t("The cancelled session remains undelivered. Replacement arrangements need confirmation.","המפגש שבוטל טרם סופק. יש לאשר את הסדרי ההשלמה."):t("The instructor will review a suitable opportunity. A particular trip is not guaranteed.","המדריך יבדוק אפשרות מתאימה. אין הבטחה למקום ביציאה מסוימת.")}</p>
   {n.scheduleChangedSinceNotice&&<p>{t("Session details changed after this notice. Your original notice time is retained.","פרטי המפגש השתנו לאחר הדיווח. מועד הדיווח המקורי נשמר.")}</p>}
   {n.requestedAt&&!n.replacementOccurrenceId&&<p>{t("Your makeup request is awaiting confirmation.","בקשת ההשלמה שלך ממתינה לאישור.")}</p>}
   {view.role==="parent"&&onRequestMakeup&&!n.requestedAt&&!n.replacementOccurrenceId&&<button type="button" onClick={()=>onRequestMakeup(n.id)}>{t("Request a makeup opportunity","בקשת אפשרות להשלמה")}</button>}
   {n.replacementOccurrenceId&&<p>{t("A replacement place has been confirmed.","אושר מקום להשלמה.")}</p>}</article>)}
 </section>;
}
