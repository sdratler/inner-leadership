import type { Locale, BroadFocus, AttendanceSnapshot } from "./types.ts";
export const FOCUS_LABELS: Record<BroadFocus, Record<Locale, string>> = { responsibility: { en: "Responsibility", he: "אחריות" }, communication: { en: "Communication", he: "תקשורת" }, regulation: { en: "Regulation", he: "ויסות" }, values: { en: "Values", he: "ערכים" }, planning: { en: "Planning", he: "תכנון" }, relationships: { en: "Relationships", he: "קשרים" }, problem_solving: { en: "Problem solving", he: "פתרון בעיות" } };
export function attendanceLabel(s: AttendanceSnapshot, locale: Locale): string {
    const labels = { en: { unrecorded: "Not recorded", no_show: "Did not attend", canceled: "Canceled", late: "Attended; late", present: "Attended" }, he: { unrecorded: "טרם נרשמה", no_show: "לא הגיע/ה", canceled: "בוטל", late: "הגיע/ה באיחור", present: "השתתף/ה" } };
    if (s.state === "present" && s.arrivedAt && Date.parse(s.arrivedAt) <= Date.parse(s.startsAt))
        return locale === "he" ? "הגיע/ה בזמן" : "Attended on time";
    return labels[locale][s.state];
}
const processingLabels={queued:{en:"Queued for processing",he:"ממתין לעיבוד"},transcribing:{en:"Transcribing",he:"מתבצע תמלול"},transcript_saved:{en:"Source transcript saved",he:"תמלול המקור נשמר"},analyzing:{en:"Private analysis in progress",he:"ניתוח פרטי מתבצע"},ready:{en:"Processing complete",he:"העיבוד הושלם"},failed:{en:"Processing failed — check this session",he:"העיבוד נכשל — יש לבדוק את המפגש"},canceled:{en:"Processing canceled",he:"העיבוד בוטל"}} as const;
const audioLabels={temporary:{en:"Temporary audio retained",he:"קובץ שמע זמני נשמר"},delete_pending:{en:"Audio deletion pending",he:"מחיקת השמע ממתינה"},deleted:{en:"Audio deletion verified",he:"מחיקת השמע אומתה"},deletion_failed:{en:"Audio deletion failed — requires attention",he:"מחיקת השמע נכשלה — נדרשת בדיקה"}} as const;
/** Translate known display states only. Preserve unknown stored codes rather than
 * rewriting values or treating an unfamiliar value as successful completion. */
export function sessionProcessingLabel(state:string|null,audio:string|null,locale:Locale):string{
 const stage=state?(Object.hasOwn(processingLabels,state)?processingLabels[state as keyof typeof processingLabels][locale]:state):(locale==="he"?"לא הועלתה הקלטה.":"No recording uploaded.");
 const sound=audio?(Object.hasOwn(audioLabels,audio)?audioLabels[audio as keyof typeof audioLabels][locale]:audio):null;
 return sound?`${stage} · ${sound}`:stage;
}
