"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../lib/locale.ts";
import { Button, Input } from "../../ui/workspace/controls.tsx";
import { Dialog, closeDialog, openDialog } from "../../ui/workspace/dialogs.tsx";
import { UnsavedChangesGuard } from "../../ui/workspace/draft-guard.tsx";
import { calendarRead } from "./client.ts";
import { AvailabilityForm, type SaveForm } from "./forms.tsx";
import { useCalendarMutation, useDialogGuard } from "./form-support.tsx";
import { dateRange, shiftDay } from "./time.ts";
import { formatTime } from "./views.tsx";
import { text } from "./copy.ts";
import type { Availability } from "./types.ts";
export function AvailabilitySettings({ locale, initialDate }: { locale: Locale; initialDate: string }) {
 const t = text(locale), range = dateRange(initialDate,"week");
 const [rows,setRows] = useState<Availability[]>([]), [loading,setLoading] = useState(true), [error,setError] = useState(false), [dirty,setDirty] = useState(false);
 const generation = useRef(0), mutation = useCalendarMutation(locale);
 const clearDirty = useCallback(() => setDirty(false),[]);
 useDialogGuard("lsu-availability-editor",dirty,mutation.locked,locale,clearDirty);
 const load = useCallback(async () => { const id = ++generation.current; setLoading(true); setError(false); try { const result = await calendarRead<Availability[]>("availability?" + new URLSearchParams({ from:range.from,to:range.to })); if(id === generation.current)setRows(result); } catch { if(id === generation.current)setError(true); } finally { if(id === generation.current)setLoading(false); } },[range.from,range.to]);
 useEffect(() => { const timer = window.setTimeout(() => void load(),0); return () => { window.clearTimeout(timer); generation.current += 1; }; },[load]);
 const save: SaveForm = (path,body,done,method="POST") => mutation.run(path,body,async () => { done?.(); setDirty(false); closeDialog("lsu-availability-editor"); await load(); },method);
 const href = (date:string) => `/${locale}/app/settings/availability?date=${date}`;
 return <main className="lsu-settings-content"><UnsavedChangesGuard dirty={dirty || mutation.uncertain} message={t.dirty}/><header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale === "he" ? "הגדרות" : "Settings"}</p><h1>{t.availability}</h1><p>{locale === "he" ? "ניהול חלונות זמן פתוחים וחסומים. השינויים אינם מזיזים פגישות קיימות." : "Manage open and blocked time windows. Changes do not move existing appointments."}</p></div></header>
 <nav className="lsu-section-nav" aria-label={t.period}><a href={href(shiftDay(initialDate,-7))}>{locale === "he" ? "שבוע קודם" : "Previous week"}</a><a href={href(shiftDay(initialDate,7))}>{locale === "he" ? "שבוע הבא" : "Next week"}</a><a href={`/${locale}/app/calendar?date=${initialDate}`}>{locale === "he" ? "חזרה ליומן" : "Back to calendar"}</a></nav>
 <form className="ls-cal-period" action={`/${locale}/app/settings/availability`}><Input id="availability-date" label={t.period} type="date" name="date" defaultValue={initialDate} required/><Button type="submit" variant="secondary">{t.go}</Button></form>
 <p className="lsw-help" dir="ltr">Asia/Jerusalem</p><Button disabled={mutation.locked} onClick={e => openDialog("lsu-availability-editor",e)}>{t.addWindow}</Button>
 {loading ? <p role="status">{t.loading}</p> : error ? <section className="lsu-state lsu-state--error" role="alert"><p>{t.unavailable}</p><Button variant="secondary" onClick={() => void load()}>{t.retry}</Button></section> : <section className="lsu-panel" aria-label={t.availability}>{rows.length ? <ul className="ls-cal-availability-list">{rows.map(row => <li key={row.id}><div><strong>{t[row.kind]}</strong><p>{formatTime(row.startsAt,locale)} — {formatTime(row.endsAt,locale)}</p></div><Button variant="quiet" disabled={mutation.locked} onClick={() => { if(window.confirm(`${t.remove}: ${formatTime(row.startsAt,locale)} — ${formatTime(row.endsAt,locale)}?`))save(`availability/${row.id}/remove`,{expectedVersion:row.version}); }}>{t.remove}</Button></li>)}</ul> : <p>{t.emptyAvailability}</p>}</section>}
 {mutation.feedback}<Dialog id="lsu-availability-editor" title={t.addWindow} locale={locale} busy={mutation.locked}><AvailabilityForm locale={locale} locked={mutation.locked} onDirty={setDirty} save={save}/>{mutation.feedback}</Dialog></main>;
}
