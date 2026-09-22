"use client";
import type { Locale } from "../../features/session-workflow/types.ts";
import { METRICS, type MetricId, type MetricValues, type MetricRecord, metricSeries } from "../../features/session-workflow/metrics.ts";
import { Section, word } from "./primitives.tsx";
export function SessionMetricFields({ locale, values, onChange, disabled }: {
    locale: Locale;
    values: MetricValues;
    onChange: (v: MetricValues) => void;
    disabled: boolean;
}) {
    return <div className="lsr-metrics">{METRICS.map(m => <div className="lsr-metric" key={m.id}><label htmlFor={`metric-${m.id}`}><strong>{m[locale]}</strong><span>{word(locale, "Your observation in this session", "התצפית שלך במפגש הזה")}</span></label><select id={`metric-${m.id}`} value={values[m.id].score ?? ""} disabled={disabled} onChange={e => onChange({ ...values, [m.id]: { ...values[m.id], score: e.target.value ? Number(e.target.value) : null, notObservedReason: e.target.value ? null : word(locale, "Not observed", "לא נצפה") } })}><option value="">{word(locale, "Not observed", "לא נצפה")}</option>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select><details><summary>{word(locale, "Scale anchors and observation note", "עוגני הסולם והערת תצפית")}</summary><p>1 — {locale === "he" ? m.lowHe : m.low}<br />5 — {locale === "he" ? m.midHe : m.mid}<br />10 — {locale === "he" ? m.highHe : m.high}</p><label>{word(locale, "Optional context", "הקשר נוסף, לא חובה")}<input maxLength={1000} disabled={disabled} value={values[m.id].note} onChange={e => onChange({ ...values, [m.id]: { ...values[m.id], note: e.target.value } })}/></label></details></div>)}</div>;
}
export function PrivateMetricTrend({ locale, records, workspaceId, caseId, metric }: {
    locale: Locale;
    records: readonly MetricRecord[];
    workspaceId: string;
    caseId: string;
    metric: MetricId;
}) {
    const data = metricSeries(records, workspaceId, caseId, metric), label = METRICS.find(m => m.id === metric)![locale];
    const x = (i: number) => 45 + i * (510 / Math.max(1, data.length - 1)), y = (v: number) => 190 - (v - 1) * 18;
    const lines: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }[] = [];
    data.forEach((v, i) => {
        const prev = data[i - 1];
        if (prev && prev.score !== null && v.score !== null)
            lines.push({ x1: x(i - 1), y1: y(prev.score), x2: x(i), y2: y(v.score) });
    });
    return <Section title={`${word(locale, "Private trend", "מגמה פרטית")} — ${label}`} privateOnly description={word(locale, "Subjective session observations; not a validated diagnostic scale. Missing observations remain gaps.", "תצפיות אישיות ממפגשים, לא כלי אבחון מתוקף. תצפיות חסרות נשארות ללא ציון.")}>
    {data.length ? <><svg className="lsr-trend" viewBox="0 0 600 240" role="img" aria-label={`${label}: ${word(locale, "values in the accessible table below", "הערכים בטבלה הנגישה למטה")}`}><line x1="45" y1="20" x2="45" y2="192" stroke="currentColor"/>{[1, 5, 10].map(v => <g key={v}><text x="20" y={y(v) + 5}>{v}</text><line x1="45" y1={y(v)} x2="560" y2={y(v)} stroke="currentColor" opacity=".15"/></g>)}{lines.map((l, i) => <line key={i} {...l} stroke="currentColor" strokeWidth="3"/>)}{data.map((v, i) => v.score !== null ? <circle key={v.sessionId} cx={x(i)} cy={y(v.score)} r="5" fill="currentColor"/> : null)}</svg><details><summary>{word(locale, "View session values", "צפייה בערכי המפגשים")}</summary><table><caption>{label}</caption><thead><tr><th>{word(locale, "Date", "תאריך")}</th><th>{word(locale, "Observation", "תצפית")}</th><th>{word(locale, "Context", "הקשר")}</th></tr></thead><tbody>{data.map(d => <tr key={d.sessionId}><td>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(new Date(d.at))}</td><td>{d.score ?? word(locale, "Not observed", "לא נצפה")}</td><td>{d.note}</td></tr>)}</tbody></table></details></> : <p>{word(locale, "No observations recorded yet.", "עדיין אין תצפיות שמורות.")}</p>}
  </Section>;
}
