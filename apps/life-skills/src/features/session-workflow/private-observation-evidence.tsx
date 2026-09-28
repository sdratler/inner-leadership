"use client";
import { useEffect, useId, useState } from "react";
import { METRICS, validateObservationEvidence, type MetricId, type PrivateObservationEvidence } from "./metrics.ts";
import type { Locale } from "./types.ts";
import { sessionRead } from "./client.ts";
import { PrivateMetricTrend } from "../../ui/revamp/session-metrics.tsx";
import { Section, word } from "../../ui/revamp/primitives.tsx";
import "../../ui/revamp/styles.css";

/** Mounted only in practitioner workspaces; the server independently checks the current role/case.
 * This separate read model is never copied into report fields or a publication request.
 */
export function PrivateObservationEvidencePanel({ locale, caseId, refreshToken = 0 }: { locale: Locale; caseId: string; refreshToken?: number }) {
  const id = useId(), [open, setOpen] = useState(false), [metric, setMetric] = useState<MetricId>("engagement"), [retry, setRetry] = useState(0);
  const [data, setData] = useState<PrivateObservationEvidence | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setData(null); setError(false);
      void sessionRead<PrivateObservationEvidence>(`/observations?caseId=${encodeURIComponent(caseId)}`, controller.signal).then(value => {
        validateObservationEvidence(value, caseId);
        if (!controller.signal.aborted) setData(value);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    });
    return () => controller.abort();
  }, [caseId, open, refreshToken, retry]);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(value));
  const starts = new Map(data?.sessions.map(item => [item.sessionId, item.startsAt]));
  return <div className="lsr" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}><Section privateOnly title={word(locale, "Private observation evidence", "עדויות תצפית פרטיות")} description={word(locale, "For your review only. Scores, graphs and private context are not attached to the family report.", "לעיון שלך בלבד. ציונים, גרפים והקשר פרטי אינם מצורפים לדוח המשפחה.")}>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{word(locale, "Saved observations, revisions and graphs", "תצפיות שמורות, גרסאות וגרפים")}</summary>
      {error ? <div role="alert"><p>{word(locale, "Private observations could not be loaded. Check your sign-in and retry; your unsaved input above is unchanged.", "לא ניתן לטעון את התצפיות הפרטיות. יש לבדוק את ההתחברות ולנסות שוב. הקלט שלא נשמר למעלה לא השתנה.")}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{word(locale, "Retry loading observations", "ניסיון חוזר לטעינת התצפיות")}</button></div> : !data ? <p role="status">{word(locale, "Loading saved private observations…", "טוען תצפיות פרטיות שמורות…")}</p> : <>
        <label htmlFor={id}>{word(locale, "Criterion", "קריטריון")}<select id={id} value={metric} onChange={event => setMetric(event.target.value as MetricId)}>{METRICS.map(item => <option key={item.id} value={item.id}>{item[locale]}</option>)}</select></label>
        <PrivateMetricTrend embedded locale={locale} records={data.records} sessions={data.sessions} workspaceId={data.workspaceId} caseId={data.caseId} metric={metric}/>
        <details><summary>{word(locale, "Revision history for this criterion", "היסטוריית גרסאות לקריטריון הזה")}</summary>{!data.records.length ? <p>{word(locale, "No saved revisions yet.", "עדיין אין גרסאות שמורות.")}</p> : <div tabIndex={0} role="region" aria-label={word(locale, "Observation revision history", "היסטוריית גרסאות התצפיות")} style={{ overflowX: "auto" }}><table style={{ minWidth: 900, tableLayout: "fixed" }}><caption>{word(locale, "Saved practitioner revisions — earlier values are retained", "גרסאות שנשמרו בידי איש המקצוע — הערכים הקודמים נשמרים")}</caption><colgroup><col style={{ width: 160 }}/><col style={{ width: 80 }}/><col style={{ width: 180 }}/><col style={{ width: 120 }}/><col/></colgroup><thead><tr><th>{word(locale, "Session date", "מועד המפגש")}</th><th>{word(locale, "Revision", "גרסה")}</th><th>{word(locale, "Saved at", "מועד השמירה")}</th><th>{word(locale, "Observation", "תצפית")}</th><th>{word(locale, "Private context", "הקשר פרטי")}</th></tr></thead><tbody>{data.records.map(record => <tr key={`${record.sessionId}:${record.revision}`}><td>{date(starts.get(record.sessionId)!)}</td><td>{record.revision}</td><td>{date(record.recordedAt)}</td><td>{record.values[metric].score ?? word(locale, "Not observed", "לא נצפה")}</td><td dir="auto">{record.values[metric].note}{record.values[metric].score === null && <p>{record.values[metric].notObservedReason}</p>}</td></tr>)}</tbody></table></div>}</details>
      </>}
    </details>
  </Section></div>;
}
