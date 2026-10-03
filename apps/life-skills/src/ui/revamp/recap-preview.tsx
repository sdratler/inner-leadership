import type {Locale,RecipientRoutineRecap} from "../../features/session-workflow/types.ts";
import {FOCUS_LABELS,attendanceLabel} from "../../features/session-workflow/presentation.ts";
import {word} from "./primitives.tsx";
import "./styles.css";
/** The same routine-only projection is rendered for author and recipients.
 * Never accept a transcript, analysis, recording or metric record here. */
export function RecapPreview({recap,locale}:{recap:RecipientRoutineRecap;locale:Locale}){
 const time=(value:string,zone:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:zone}).format(new Date(value));
 return <div className="lsr" lang={recap.locale} dir={recap.locale==="he"?"rtl":"ltr"}><p className="lsr-help">{word(locale,"Reviewed update version","גרסת עדכון שנבדקה")} {recap.version} · {recap.locale==="he"?"עברית":"English"}</p><dl className="lsr-recap">
  <dt>{word(locale,"Attendance","נוכחות")}</dt><dd>{attendanceLabel(recap.attendance,locale)}</dd>
  <dt>{word(locale,"Broad focus","מוקד כללי")}</dt><dd>{recap.focus.map(id=>FOCUS_LABELS[id][locale]).join(" · ")||"—"}</dd>
  <dt>{word(locale,"This week's practice and each person's part","התרגול השבוע והתפקיד של כל משתתף")}</dt><dd>{recap.practices.length?recap.practices.map(practice=><div key={practice.responsibilityId}><strong>{word(locale,practice.participant==="parent"?"Parent":"Client",practice.participant==="parent"?"הורה":"מקבל השירות")}</strong><p dir="auto">{practice.instructions}</p><p className="lsr-help"><bdi>{practice.localTime} · {practice.timezone}</bdi> · <bdi>{practice.startsOn} — {practice.endsOn}</bdi> · {word(locale,"Practice version","גרסת תרגול")} {practice.version}</p></div>):word(locale,"No practice included in this version","לא נכלל תרגול בגרסה הזאת")}</dd>
  <dt>{word(locale,"Next step","הצעד הבא")}</dt><dd dir="auto">{recap.nextStep||"—"}</dd>
  <dt>{word(locale,"Next appointment","המפגש הבא")}</dt><dd>{recap.nextAppointment?<time dateTime={recap.nextAppointment.startsAt}>{time(recap.nextAppointment.startsAt,recap.nextAppointment.timezone)} · <bdi>{recap.nextAppointment.timezone}</bdi></time>:word(locale,"Not scheduled","טרם נקבע")}</dd>
 </dl></div>;
}
