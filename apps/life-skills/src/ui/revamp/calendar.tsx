"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Locale } from "../../features/session-workflow/types.ts";
import { word } from "./primitives.tsx";
export interface CalendarItem {
    id: string;
    caseId: string;
    person: string;
    title: string;
    kind: "appointment" | "practice" | "parent_support" | "form_due";
    startsAt: string;
    endsAt: string | null;
    href: string;
    state: string;
}
const mediaQuery = "(max-width: 700px)";
const subscribeViewport = (notify: () => void) => { const q = window.matchMedia(mediaQuery); q.addEventListener("change", notify); return () => q.removeEventListener("change", notify); };
const smallViewport = () => window.matchMedia(mediaQuery).matches;
const serverViewport = () => false;
const localDate = (d: string, tz: string) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(d)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
export function PracticeCalendar({ locale, events, today, timezone = "Asia/Jerusalem", practitioner = false }: {
    locale: Locale;
    events: readonly CalendarItem[];
    today: string;
    timezone?: string;
    practitioner?: boolean;
}) {
    const [date, setDate] = useState(today), [selectedView, setView] = useState<"day" | "week" | "month" | null>(null), [client, setClient] = useState("all"), [kind, setKind] = useState("all");
    const mobile = useSyncExternalStore(subscribeViewport, smallViewport, serverViewport);
    const view = selectedView ?? (mobile ? "day" : "week");
    const people = useMemo(() => [...new Map(events.map(e => [e.caseId, e.person])).entries()], [events]);
    const start = Date.parse(date + "T12:00:00Z"), weekday = new Date(start).getUTCDay();
    const rangeStart = view === "day" ? start : view === "week" ? start - weekday * 86400000 : Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), 1, 12);
    const days = view === "day" ? 1 : view === "week" ? 7 : new Date(new Date(rangeStart).getUTCFullYear(), new Date(rangeStart).getUTCMonth() + 1, 0).getDate();
    const filtered = events.filter(e => (client === "all" || e.caseId === client) && (kind === "all" || e.kind === kind));
    const kindText = { appointment: word(locale, "Session", "מפגש"), practice: word(locale, "Practice", "תרגול"), parent_support: word(locale, "Parent support", "תמיכת הורה"), form_due: word(locale, "Form due", "מועד לטופס") };
    function shift(n: number) {
        const d = new Date(start);
        if (view === "month") {
            d.setUTCDate(1);
            d.setUTCMonth(d.getUTCMonth() + n);
        }
        else
            d.setUTCDate(d.getUTCDate() + n * (view === "week" ? 7 : 1));
        setDate(d.toISOString().slice(0, 10));
    }
    return <section className="lsr"><header className="lsr-page-heading"><h1>{word(locale, "Calendar", "יומן")}</h1><p>{word(locale, "Sessions and timed practice in one place.", "המפגשים והתרגול המתוזמן במקום אחד.")} · {timezone}</p></header><div className="lsr-calendar-toolbar"><div className="lsr-actions"><button type="button" onClick={() => shift(-1)}>{word(locale, "Previous", "קודם")}</button><button type="button" onClick={() => setDate(today)}>{word(locale, "Today", "היום")}</button><button type="button" onClick={() => shift(1)}>{word(locale, "Next", "הבא")}</button></div><label>{word(locale, "Date", "תאריך")}<input type="date" value={date} onChange={e => {
            if (e.target.value)
                setDate(e.target.value);
        }}/></label><div className="lsr-tabs" aria-label={word(locale, "Calendar view", "תצוגת היומן")}>{(["day", "week", "month"] as const).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{locale === "he" ? ({ day: "יום", week: "שבוע", month: "חודש" }[v]) : v[0]!.toUpperCase() + v.slice(1)}</button>)}</div></div><div className="lsr-filter-bar">{practitioner && <label>{word(locale, "Client", "לקוח")}<select value={client} onChange={e => setClient(e.target.value)}><option value="all">{word(locale, "All clients", "כל הלקוחות")}</option>{people.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>}<label>{word(locale, "Show", "הצגה")}<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">{word(locale, "All events", "כל האירועים")}</option>{Object.entries(kindText).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label></div><div className={`lsr-calendar-grid lsr-calendar-${view}`}>{view === "month" && Array.from({ length: new Date(rangeStart).getUTCDay() }, (_, i) => <div className="lsr-calendar-spacer" aria-hidden="true" key={`spacer-${i}`}/>)}{Array.from({ length: days }, (_, i) => { const d = new Date(rangeStart + i * 86400000), key = d.toISOString().slice(0, 10), items = filtered.filter(e => localDate(e.startsAt, timezone) === key).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)); return <section className="lsr-calendar-day" key={key}><h2>{new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(d)}</h2>{items.map(e => <a className={`lsr-calendar-item lsr-calendar-item-${e.kind}`} href={e.href} key={e.id}><span className="lsr-chip">{kindText[e.kind]}</span><time dateTime={e.startsAt}>{new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: timezone }).format(new Date(e.startsAt))}</time><strong>{e.title}</strong>{practitioner && <span>{e.person}</span>}<small>{e.state}</small></a>)}{!items.length && <p className="lsr-help">{word(locale, "No items", "אין אירועים")}</p>}</section>; })}</div></section>;
}
