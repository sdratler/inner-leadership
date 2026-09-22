"use client";
import { useMemo, useState } from "react";
import type { CaseMode, Locale } from "../../features/session-workflow/types.ts";
import { word } from "./primitives.tsx";
export interface ClientListItem {
    id: string;
    name: string;
    mode: CaseMode;
    status: "active" | "paused" | "closed";
    nextAppointment: string | null;
    currentPractice: string | null;
    unreadCount: number | null;
    lastSession: string | null;
    href: string;
}
export function ClientFilters({ locale, search, onSearch, status, onStatus }: {
    locale: Locale;
    search: string;
    onSearch: (v: string) => void;
    status: string;
    onStatus: (v: string) => void;
}) { return <div className="lsr-filter-bar"><label>{word(locale, "Find a client", "חיפוש לקוח")}<input type="search" value={search} onChange={e => onSearch(e.target.value)} placeholder={word(locale, "Search by name", "חיפוש לפי שם")}/></label><label>{word(locale, "Case status", "מצב התיק")}<select value={status} onChange={e => onStatus(e.target.value)}><option value="all">{word(locale, "All", "הכול")}</option><option value="active">{word(locale, "Active", "פעיל")}</option><option value="paused">{word(locale, "Paused", "מושהה")}</option><option value="closed">{word(locale, "Closed", "סגור")}</option></select></label></div>; }
export function ClientList({ locale, items }: {
    locale: Locale;
    items: readonly ClientListItem[];
}) {
    const [search, setSearch] = useState(""), [status, setStatus] = useState("active"), [page, setPage] = useState(0);
    const filtered = useMemo(() => items.filter(x => x.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)) && (status === "all" || x.status === status)), [items, search, status, locale]);
    const pages = Math.max(1, Math.ceil(filtered.length / 50)), currentPage = Math.min(page, pages - 1);
    const date = (v: string | null) => v ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(v)) : word(locale, "Not scheduled", "טרם נקבע");
    return <section className="lsr"><header className="lsr-page-heading"><h1>{word(locale, "Clients", "לקוחות")}</h1><p>{word(locale, "A clear view of the next meeting, current practice and communications.", "תמונה ברורה של המפגש הבא, התרגול הנוכחי והתקשורת.")}</p></header><ClientFilters locale={locale} search={search} onSearch={value => { setSearch(value); setPage(0); }} status={status} onStatus={value => { setStatus(value); setPage(0); }}/><p role="status">{filtered.length} {word(locale, "clients shown", "לקוחות מוצגים")}</p><div className="lsr-client-list">{filtered.slice(currentPage * 50, currentPage * 50 + 50).map(c => <article className="lsr-client-row" key={c.id}><div><h2><a href={c.href}>{c.name}</a></h2><span className="lsr-chip">{c.mode === "adult" ? word(locale, "Adult", "מבוגר") : c.mode === "minor_own_device" ? word(locale, "Child + parents", "ילד והורים") : word(locale, "Parent-managed", "דרך ההורים")}</span></div><dl><dt>{word(locale, "Next appointment", "המפגש הבא")}</dt><dd>{date(c.nextAppointment)}</dd><dt>{word(locale, "Current practice", "תרגול נוכחי")}</dt><dd>{c.currentPractice ?? word(locale, "No current assignment", "אין משימה נוכחית")}</dd></dl><div className="lsr-client-actions"><span>{c.unreadCount === null ? word(locale, "Message status unavailable", "מצב ההודעות אינו זמין") : `${c.unreadCount} ${word(locale, "unread", "לא נקראו")}`}</span><a className="lsr-button" href={c.href}>{word(locale, "Open client", "פתיחת התיק")}</a></div></article>)}</div>{!filtered.length && <p>{word(locale, "No clients match these filters. Clear the search or select All.", "אין לקוחות התואמים לסינון. ניתן למחוק את החיפוש או לבחור הכול.")}</p>}{pages > 1 && <nav className="lsr-actions" aria-label={word(locale, "Client list pages", "עמודי רשימת הלקוחות")}><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{word(locale, "Previous", "קודם")}</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>{word(locale, "Next", "הבא")}</button></nav>}</section>;
}
