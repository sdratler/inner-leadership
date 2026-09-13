"use client";

import { useEffect, useState } from "react";

type Kind = "home-practice" | "goals" | "commitments";
type Item = Readonly<Record<string, unknown>>;

const copy = {
  en: { loading: "Loading…", empty: "Nothing has been shared here yet.", unavailable: "This view is unavailable. Try again later.", unreported: "No check-in is recorded as unreported — never as not done." },
  he: { loading: "טוען…", empty: "עדיין לא שותף כאן דבר.", unavailable: "התצוגה אינה זמינה כרגע. אפשר לנסות שוב מאוחר יותר.", unreported: "ללא דיווח מוצג כ׳טרם דווח׳ — לעולם לא כ׳לא בוצע׳." },
} as const;

export function PracticeList({ locale, kind, caseId, audienceId }: { locale: "en" | "he"; kind: Kind; caseId?: string | undefined; audienceId?: string | undefined }) {
  const requestKey = `${kind}:${caseId ?? ""}:${audienceId ?? ""}`;
  const [state, setState] = useState<{ key: string; status: "ready" | "error"; items: Item[] }>({ key: "", status: "ready", items: [] });
  useEffect(() => {
    if (!caseId || !audienceId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ caseId, audienceId });
    fetch(`/api/${kind}?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true || !("data" in payload) || !Array.isArray(payload.data)) throw new Error("UNAVAILABLE");
        setState({ key: requestKey, status: "ready", items: payload.data as Item[] });
      })
      .catch(error => { if (!(error instanceof DOMException && error.name === "AbortError")) setState({ key: requestKey, status: "error", items: [] }); });
    return () => controller.abort();
  }, [audienceId, caseId, kind, requestKey]);
  if (!caseId || !audienceId) return <p>{copy[locale].empty}</p>;
  if (state.key !== requestKey) return <p aria-live="polite">{copy[locale].loading}</p>;
  if (state.status === "error") return <p role="alert">{copy[locale].unavailable}</p>;
  if (!state.items.length) return <p>{copy[locale].empty}</p>;
  return <div>
    <ul>{state.items.map((item, index) => <li key={String(item.id ?? index)}>
      <strong>{String(item.title ?? item.templateKey ?? "Practice")}</strong>
      {typeof item.instructions === "string" ? <p>{item.instructions}</p> : null}
      {typeof item.state === "string" ? <small>{item.state}</small> : null}
    </li>)}</ul>
    {kind === "home-practice" ? <p><small>{copy[locale].unreported}</small></p> : null}
  </div>;
}
