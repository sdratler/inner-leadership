"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../../lib/locale.ts";
import { Breadcrumb } from "../../ui/workspace/surfaces.tsx";
import { accountRead } from "../identity/client.ts";

type Role = "parent" | "practitioner";
type Mode = "resources" | "forms" | "both";
type Case = { id: string; displayName: string; kind: "minor" | "adult" };
type Resource = { assignmentId: string; title: string; completed: boolean; detailsAvailable: boolean; type?: string; description?: string; dueDate?: string | null; displayDate?: string; completionEnabled?: boolean };
type Form = { id: string; templateKey: string; templateVersion: number; dueDate: string | null; state: string; locale: "he" | "en" };
type ItemLoad = { key: string; resources: Resource[] | null; forms: Form[] | null };

const copy = {
  en: { resources: "Resources", forms: "Forms", title: "Forms & resources", lead: "Only items assigned to an authorized case appear here.", child: "Child", loading: "Loading assigned items…", empty: "Nothing is assigned for this authorized context.", unavailable: "Assigned items are unavailable. Try again later.", due: "Due", state: "State", details: "Details", private: "This item has a title-only audience; protected details are not shown.", practice: "Practice" },
  he: { resources: "משאבים", forms: "טפסים", title: "טפסים ומשאבים", lead: "כאן מופיעים רק פריטים שהוקצו לתיק מורשה.", child: "ילד/ה", loading: "טוען פריטים שהוקצו…", empty: "לא הוקצו פריטים להקשר מורשה זה.", unavailable: "הפריטים שהוקצו אינם זמינים. אפשר לנסות שוב מאוחר יותר.", due: "עד", state: "מצב", details: "פרטים", private: "לקהל זה מוצגת כותרת בלבד; הפרטים המוגנים אינם מוצגים.", practice: "תרגול" },
} as const;

function result<T>(response: Response): Promise<T> {
  return response.json().then((payload: unknown) => {
    if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true || !("data" in payload)) throw new Error("UNAVAILABLE");
    return (payload as { data: T }).data;
  });
}

export function SharedItemsWorkspace({ locale, role, mode, initialCaseId = "" }: { locale: Locale; role: Role; mode: Mode; initialCaseId?: string | undefined }) {
  const t = copy[locale];
  const router = useRouter();
  const [cases, setCases] = useState<Case[]>([]);
  const [casesLoaded, setCasesLoaded] = useState(false);
  const [casesUnavailable, setCasesUnavailable] = useState(false);
  const [caseId, setCaseId] = useState(initialCaseId);
  const [items, setItems] = useState<ItemLoad>({ key: "", resources: null, forms: null });
  const [itemsUnavailableKey, setItemsUnavailableKey] = useState<string | null>(null);

  const eligible = role === "parent" ? cases.filter((item) => item.kind === "minor") : cases;
  const selected = eligible.some((item) => item.id === caseId) ? caseId : eligible[0]?.id ?? "";
  const requestKey = selected ? `${mode}:${selected}` : "";
  const title = mode === "resources" ? t.resources : mode === "forms" ? t.forms : t.title;
  const route = role === "parent" ? "family/resources" : `app/${mode}`;

  useEffect(() => {
    let live = true;
    void accountRead<Case[]>("cases")
      .then((loadedCases) => { if (live) setCases(loadedCases); })
      .catch(() => { if (live) setCasesUnavailable(true); })
      .finally(() => { if (live) setCasesLoaded(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!requestKey) return;
    let live = true;
    const query = `?caseId=${encodeURIComponent(selected)}`;
    const requests = [
      ...(mode === "resources" || mode === "both" ? [fetch(`/api/resources/assignments${query}`, { credentials: "same-origin", cache: "no-store" }).then((response) => result<Resource[]>(response))] : []),
      ...(mode === "forms" || mode === "both" ? [fetch(`/api/forms/assignments${query}`, { credentials: "same-origin", cache: "no-store" }).then((response) => result<Form[]>(response))] : []),
    ];
    void Promise.all(requests)
      .then((values) => {
        if (!live) return;
        let index = 0;
        setItems({
          key: requestKey,
          resources: mode === "resources" || mode === "both" ? values[index++] as Resource[] : null,
          forms: mode === "forms" || mode === "both" ? values[index] as Form[] : null,
        });
        setItemsUnavailableKey(null);
      })
      .catch(() => { if (live) setItemsUnavailableKey(requestKey); });
    return () => { live = false; };
  }, [mode, requestKey, selected]);

  function change(next: string) {
    setCaseId(next);
    router.replace(`/${locale}/${route}?caseId=${encodeURIComponent(next)}`, { scroll: false });
  }

  const itemsReady = items.key === requestKey;
  const unavailable = casesUnavailable || itemsUnavailableKey === requestKey;
  const loading = !casesLoaded || (Boolean(requestKey) && !itemsReady && !unavailable);
  const resources = itemsReady ? items.resources : null;
  const forms = itemsReady ? items.forms : null;

  return <section className="lsw-stack lsw-shared-items">
    <Breadcrumb label={locale === "he" ? "מיקום" : "Location"} items={[{ label: title }]}/>
    <header className="lsw-page-header"><div><p className="lsw-eyebrow">{role === "parent" ? (locale === "he" ? "מרחב המשפחה" : "Family workspace") : (locale === "he" ? "מרחב המטפל" : "Practitioner workspace")}</p><h1>{title}</h1><p>{t.lead}</p></div></header>
    {eligible.length > 1 && <div className="lsw-field"><label htmlFor="shared-case">{t.child}</label><select id="shared-case" className="lsw-input" value={selected} onChange={(event) => change(event.target.value)}>{eligible.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></div>}
    {eligible.length === 1 && <p className="lsw-context">{t.child}: <strong>{eligible[0]?.displayName}</strong></p>}
    {unavailable ? <section className="lsw-alert" role="alert"><p>{t.unavailable}</p></section> : loading ? <p role="status">{t.loading}</p> : !selected ? <p>{t.empty}</p> : <div className="lsw-stack">
      {(mode === "resources" || mode === "both") && <section className="lsw-card"><h2>{t.resources}</h2>{resources?.length ? <ul className="lsw-shared-list">{resources.map((item) => <li key={item.assignmentId}><strong>{item.title}</strong>{item.detailsAvailable ? <details className="lsw-details"><summary>{t.details}</summary><div className="lsw-stack">{item.description && <p>{item.description}</p>}{item.dueDate && <p>{t.due}: <time dateTime={item.dueDate}>{item.dueDate}</time></p>}</div></details> : <p className="lsw-help">{t.private}</p>}</li>)}</ul> : <p>{t.empty}</p>}</section>}
      {(mode === "forms" || mode === "both") && <section className="lsw-card"><h2>{t.forms}</h2>{forms?.length ? <ul className="lsw-shared-list">{forms.map((item) => <li key={item.id}><strong>{item.templateKey}</strong><p>{t.state}: {item.state}</p>{item.dueDate && <p>{t.due}: <time dateTime={item.dueDate}>{item.dueDate}</time></p>}</li>)}</ul> : <p>{t.empty}</p>}</section>}
    </div>}
  </section>;
}
