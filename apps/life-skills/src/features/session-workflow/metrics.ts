import { invariant, nonempty, validIso } from "./policy.ts";
export const METRICS = [
    { id: "engagement", en: "Engagement", he: "מעורבות", low: "Rare engagement in the activity, even with support", mid: "Intermittent engagement with prompts", high: "Sustained engagement with appropriate support", lowHe: "מעורבות מועטה בפעילות גם עם תמיכה", midHe: "מעורבות לסירוגין בעזרת תזכורות", highHe: "מעורבות מתמשכת עם תמיכה מתאימה" },
    { id: "regulation", en: "Calm / regulation", he: "רוגע וויסות", low: "Frequent difficulty settling in this setting", mid: "Settles with recurring support", high: "Uses workable ways to settle and recover", lowHe: "קושי תכוף להירגע בהקשר הזה", midHe: "נרגע בעזרת תמיכה חוזרת", highHe: "משתמש בדרכים מתאימות להירגע ולהתאושש" },
    { id: "frustration_tolerance", en: "Frustration tolerance", he: "התמודדות עם תסכול", low: "Hard to return after ordinary frustration", mid: "Returns with guidance", high: "Handles frustration and returns flexibly", lowHe: "קושי לחזור לפעילות לאחר תסכול רגיל", midHe: "חוזר לפעילות בעזרת הכוונה", highHe: "מתמודד עם התסכול וחוזר בגמישות" },
    { id: "initiative", en: "Initiative", he: "יוזמה", low: "Rarely initiates in this session", mid: "Some initiation with invitations", high: "Initiates relevant ideas or actions", lowHe: "כמעט לא יזם במהלך המפגש", midHe: "יוזמה מסוימת בעקבות הזמנה", highHe: "יוזם רעיונות או פעולות רלוונטיים" },
    { id: "reflection", en: "Reflective capacity", he: "יכולת התבוננות", low: "Little expressed reflection in this session", mid: "Reflects with concrete questions", high: "Connects experiences, choices and possible next steps", lowHe: "מעט התבוננות מנוסחת במפגש", midHe: "מתבונן בעזרת שאלות קונקרטיות", highHe: "מקשר בין חוויות, בחירות ואפשרויות להמשך" },
    { id: "impulse_control", en: "Impulse control", he: "שליטה בדחפים", low: "Frequent difficulty pausing before action", mid: "Pauses with prompts", high: "Pauses and considers alternatives in this setting", lowHe: "קושי תכוף לעצור לפני פעולה", midHe: "עוצר בעזרת תזכורות", highHe: "עוצר ושוקל חלופות בהקשר הזה" },
    { id: "responsiveness", en: "Responsiveness", he: "תגובתיות לשיח", low: "Responses rarely support a reciprocal exchange", mid: "Responds with time and support", high: "Responds meaningfully at an individually appropriate pace", lowHe: "מעט תגובות המאפשרות חילופי דברים", midHe: "מגיב כשניתנים זמן ותמיכה", highHe: "מגיב באופן משמעותי בקצב המתאים לו" },
    { id: "participation", en: "Participation", he: "השתתפות", low: "Limited participation in agreed activity", mid: "Participates in parts with support", high: "Participates actively in the agreed activity", lowHe: "השתתפות מוגבלת בפעילות שסוכמה", midHe: "משתתף בחלקים בעזרת תמיכה", highHe: "משתתף באופן פעיל בפעילות שסוכמה" },
    { id: "social_engagement", en: "Social engagement / eye contact", he: "מעורבות חברתית וקשר עין", low: "Limited reciprocal engagement observed", mid: "Some reciprocal engagement through preferred communication", high: "Flexible reciprocal engagement through suitable communication", lowHe: "נצפתה מעט מעורבות הדדית", midHe: "מעורבות הדדית מסוימת בדרכי התקשורת המועדפות", highHe: "מעורבות הדדית גמישה בדרכי תקשורת מתאימות" },
] as const;
export type MetricId = typeof METRICS[number]["id"];
export interface MetricValue {
    score: number | null;
    notObservedReason: string | null;
    note: string;
}
export type MetricValues = Record<MetricId, MetricValue>;
export interface MetricRecord {
    schemaVersion: 1;
    workspaceId: string;
    caseId: string;
    sessionId: string;
    recordedByAccountId: string;
    source: "practitioner_observation";
    recordedAt: string;
    revision: number;
    values: MetricValues;
}
export function blankMetrics(): MetricValues {
    return Object.fromEntries(METRICS.map(m => [m.id, { score: null, notObservedReason: "Not recorded", note: "" }])) as MetricValues;
}
export function validateMetricRecord(record: MetricRecord): void {
    invariant(record.source === "practitioner_observation" && record.schemaVersion === 1, "METRIC_SOURCE");
    invariant(validIso(record.recordedAt) && Number.isInteger(record.revision) && record.revision >= 1, "METRIC_METADATA");
    invariant(Object.keys(record.values).sort().join() === METRICS.map(m => m.id).sort().join(), "METRIC_SET");
    for (const metric of METRICS) {
        const v = record.values[metric.id];
        invariant(v && typeof v.note === "string" && v.note.length <= 1000, "METRIC_NOTE");
        invariant(v.score === null ? nonempty(v.notObservedReason, 200) : Number.isInteger(v.score) && v.score >= 1 && v.score <= 10 && v.notObservedReason === null, "METRIC_VALUE");
    }
}
/** No composite score, imputation, normative ranking or parent/client projection. */
export function metricSeries(records: readonly MetricRecord[], workspaceId: string, caseId: string, metric: MetricId) {
    invariant(METRICS.some(m => m.id === metric), "METRIC_UNKNOWN");
    const latest = new Map<string, MetricRecord>();
    for (const r of records) {
        invariant(r.workspaceId === workspaceId && r.caseId === caseId, "METRIC_SCOPE");
        validateMetricRecord(r);
        const existing = latest.get(r.sessionId);
        if (!existing || existing.revision < r.revision)
            latest.set(r.sessionId, r);
    }
    return [...latest.values()].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)).map(r => ({ sessionId: r.sessionId, at: r.recordedAt, score: r.values[metric].score, note: r.values[metric].note }));
}
export const METRIC_NOTICE = "Private practitioner observations, not a validated diagnostic scale. Missing observations stay blank. Eye contact and response speed are contextual observations, not standalone measures of wellbeing or compliance.";
