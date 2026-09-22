import type { Locale, BroadFocus, AttendanceSnapshot } from "./types.ts";
export const FOCUS_LABELS: Record<BroadFocus, Record<Locale, string>> = { responsibility: { en: "Responsibility", he: "אחריות" }, communication: { en: "Communication", he: "תקשורת" }, regulation: { en: "Regulation", he: "ויסות" }, values: { en: "Values", he: "ערכים" }, planning: { en: "Planning", he: "תכנון" }, relationships: { en: "Relationships", he: "קשרים" }, problem_solving: { en: "Problem solving", he: "פתרון בעיות" } };
export function attendanceLabel(s: AttendanceSnapshot, locale: Locale): string {
    const labels = { en: { unrecorded: "Not recorded", no_show: "Did not attend", canceled: "Canceled", late: "Attended; late", present: "Attended" }, he: { unrecorded: "טרם נרשמה", no_show: "לא הגיע/ה", canceled: "בוטל", late: "הגיע/ה באיחור", present: "השתתף/ה" } };
    if (s.state === "present" && s.arrivedAt && Date.parse(s.arrivedAt) <= Date.parse(s.startsAt))
        return locale === "he" ? "הגיע/ה בזמן" : "Attended on time";
    return labels[locale][s.state];
}
