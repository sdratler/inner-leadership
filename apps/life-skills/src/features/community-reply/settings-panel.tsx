"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommunitySettings } from "./settings-bridge.ts";

type Locale = "he" | "en";
const copy = {
  en: {
    title: "Scout settings and usage", loading: "Checking the live Scout settings…", unavailable: "Scout settings could not be verified. Collection and spending must not be assumed active.", retry: "Retry settings",
    collection: "Collection gates", enabled: "Eligible; actual scheduled run unverified", on: "On", disabled: "Off", groups: "Approved group URLs", provider: "Provider binding configured", noGroups: "No approved group URLs are configured; no collection is running.",
    worker: "Worker", autoDraft: "Automatic drafting", maxItems: "Maximum items per run", aiDaily: "AI requests per UTC day", manual: "Manual reply requests", used: "used", remaining: "remaining", requests: "AI requests today (UTC)", tokens: "Tokens today (input / output)", cost: "Money spent", unknownCost: "Not metered here — do not treat as zero", jobs: "Jobs by state", posts: "Unexpired captured posts by status", none: "None", asOf: "Checked at", readOnly: "Read-only actual configuration. These controls do not enable collection, drafting or posting.",
  },
  he: {
    title: "הגדרות ושימוש של Scout", loading: "בודק הגדרות חיות של Scout…", unavailable: "לא ניתן לאמת את הגדרות Scout. אין להניח שאיסוף או הוצאה פעילים.", retry: "בדיקה חוזרת",
    collection: "תנאי האיסוף", enabled: "כשיר; הרצה מתוזמנת בפועל לא אומתה", on: "פעיל", disabled: "כבוי", groups: "כתובות קבוצות שאושרו", provider: "חיבור הספק מוגדר", noGroups: "לא הוגדרו כתובות קבוצות מאושרות; אין איסוף פעיל.",
    worker: "תהליך רקע", autoDraft: "יצירת טיוטות אוטומטית", maxItems: "מספר מרבי של פריטים בהרצה", aiDaily: "בקשות AI ליום UTC", manual: "בקשות תגובה ידניות", used: "נוצלו", remaining: "נותרו", requests: "בקשות AI היום (UTC)", tokens: "טוקנים היום (קלט / פלט)", cost: "הוצאה כספית", unknownCost: "אינה נמדדת כאן — אין לראות בכך אפס", jobs: "משימות לפי מצב", posts: "פוסטים שנקלטו ועדיין בתוקף", none: "אין", asOf: "נבדק ב־", readOnly: "הגדרות חיות לקריאה בלבד. המסך אינו מפעיל איסוף, טיוטות או פרסום.",
  },
};
async function requestSettings(signal?: AbortSignal): Promise<CommunitySettings> {
  const response = await fetch("/api/community-settings", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: signal ?? null });
  const payload = await response.json() as { ok?: boolean; data?: CommunitySettings };
  if (!response.ok || payload.ok !== true || !payload.data) throw Error("unavailable");
  return payload.data;
}

export function CommunitySettingsPanel({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [settings, setSettings] = useState<CommunitySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await requestSettings(signal);
      if (!signal?.aborted) setSettings(data);
    } catch { if (!signal?.aborted) { setSettings(null); setError(true); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void requestSettings(controller.signal)
      .then(data => { if (!controller.signal.aborted) setSettings(data); })
      .catch(() => { if (!controller.signal.aborted) { setSettings(null); setError(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const state = (value: boolean) => value ? t.on : t.disabled;
  const distribution = (counts: Record<string, number>) => Object.entries(counts).length ? Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join(" · ") : t.none;
  return <section className="lsr-panel" aria-label={t.title}>
    <h3>{t.title}</h3><p className="lsr-help">{t.readOnly}</p>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p role="alert" className="lsr-inline-error">{t.unavailable} <button type="button" onClick={() => { setLoading(true); setError(false); void load(); }}>{t.retry}</button></p>}
    {settings && !loading && !error && <>
      {!settings.collection.eligible && settings.collection.allowedGroupCount === 0 && <p role="status" className="lsr-status">{t.noGroups}</p>}
      <dl className="lsr-community-settings">
        <dt>{t.collection}</dt><dd>{settings.collection.eligible ? t.enabled : t.disabled}</dd>
        <dt>{t.groups}</dt><dd>{settings.collection.allowedGroupCount}</dd>
        <dt>{t.provider}</dt><dd>{state(settings.collection.providerConfigured)}</dd>
        <dt>{t.worker}</dt><dd>{state(settings.collection.workerEnabled)}</dd>
        <dt>{t.autoDraft}</dt><dd>{state(settings.collection.autoDraft)}</dd>
        <dt>{t.maxItems}</dt><dd>{settings.collection.maxItemsPerRun}</dd>
        <dt>{t.aiDaily}</dt><dd>{settings.usageTodayUtc.requests} / {settings.limits.aiRequestsPerUtcDay}</dd>
        <dt>{t.manual}</dt><dd>{settings.limits.manualReplyUsed} {t.used} · {settings.limits.manualReplyRemaining} {t.remaining} / {settings.limits.manualReplyTotal}</dd>
        <dt>{t.requests}</dt><dd>{settings.usageTodayUtc.requests}</dd>
        <dt>{t.tokens}</dt><dd>{settings.usageTodayUtc.inputTokens} / {settings.usageTodayUtc.outputTokens}</dd>
        <dt>{t.cost}</dt><dd>{t.unknownCost}</dd>
        <dt>{t.jobs}</dt><dd>{distribution(settings.queue.jobs)}</dd>
        <dt>{t.posts}</dt><dd>{distribution(settings.queue.posts)}</dd>
        <dt>{t.asOf}</dt><dd><time dateTime={settings.asOf}>{settings.asOf}</time></dd>
      </dl>
    </>}
  </section>;
}
