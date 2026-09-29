"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IdentityClientError, type IdentityClientErrorCode } from "../identity/client.ts";
import { loginHref } from "../identity/login-return.ts";
import { civilDate } from "../calendar/time.ts";
import { Button, Input, Select } from "../../ui/workspace/controls.tsx";
import { UnsavedChangesGuard } from "../../ui/workspace/draft-guard.tsx";
import { checkInAttempt, checkInReadback, incomingPracticeReport, ownCheckInHistory, practiceAccessLossPage, practiceAccessLost, PracticeAudienceAccessError, practiceAudienceLossPage, practiceDraftIds, practiceRangeOccurrences, practiceSaveUncertain, submitPracticeCheckIn, type CheckInAttempt } from "./occurrence-client.ts";
import { occurrenceRange, shiftOccurrenceDay } from "./occurrence-range.ts";
import { completionStatuses, type CompletionStatus, type CompletionView, type PracticeOccurrenceItem, type PracticeOccurrencePage } from "./types.ts";

const copy = {
  en: { title: "Morning & evening practice", choose: "Choose a case to view scheduled practice.", loading: "Loading practice…", empty: "No practice is scheduled in this period.", error: "Practice could not load. Appointments are not affected.", retry: "Retry", unreported: "Unreported", morning: "Morning", evening: "Evening", instruction: "Instruction for this occurrence", version: "Published version", own: "Your check-in", status: "What happened?", chooseStatus: "Choose a result", save: "Save check-in", correct: "Save correction", saved: "Saved and read back.", uncertain: "The save result is not confirmed. Your selection is kept. Retry the same save before changing it.", conflict: "A newer report may exist. Your selection is kept; refresh the recorded result before saving a correction.", failure: "The check-in was not saved. Your selection is kept. Try again.", refresh: "Refresh recorded result", history: "Your check-in history", historyError: "History could not load. Try opening it again.", closed: "This occurrence is closed.", readOnly: "You are not assigned to report this occurrence.", auth: "Sign in again to reopen your private practice.", denied: "Your account no longer has access to this practice.", signIn: "Sign in", overflow: "Only the first 500 occurrences are shown. Choose a shorter date range to see the remaining items.", date: "From date", go: "Show 14 days", dirty: "Your unsaved check-in will be lost. Leave this view?", revision: "Revision", done: "Done", partly_done: "Partly done", not_done: "Not done", rescheduled: "Rescheduled", not_applicable: "Not applicable" },
  he: { title: "תרגול בוקר וערב", choose: "בחרו תיק כדי לצפות בתרגול שנקבע.", loading: "טוען תרגול…", empty: "אין תרגול מתוכנן בתקופה הזאת.", error: "התרגול לא נטען. הפגישות אינן מושפעות.", retry: "ניסיון חוזר", unreported: "טרם דווח", morning: "בוקר", evening: "ערב", instruction: "ההנחיה לתרגול הזה", version: "גרסה שפורסמה", own: "הדיווח שלך", status: "מה קרה?", chooseStatus: "בחירת תוצאה", save: "שמירת דיווח", correct: "שמירת תיקון", saved: "נשמר ונבדק מחדש.", uncertain: "תוצאת השמירה טרם אומתה. הבחירה נשמרת כאן. יש לנסות שוב את אותה שמירה לפני שמשנים אותה.", conflict: "ייתכן שקיים דיווח חדש יותר. הבחירה נשמרת כאן; יש לרענן את התוצאה שנשמרה לפני שמירת תיקון.", failure: "הדיווח לא נשמר. הבחירה נשמרת כאן. אפשר לנסות שוב.", refresh: "רענון התוצאה שנשמרה", history: "היסטוריית הדיווחים שלך", historyError: "ההיסטוריה לא נטענה. אפשר לפתוח אותה שוב.", closed: "התרגול הזה נסגר.", readOnly: "לא הוגדרת לדווח על התרגול הזה.", auth: "יש להיכנס מחדש כדי לפתוח את התרגול הפרטי.", denied: "לחשבון שלך אין עוד גישה לתרגול הזה.", signIn: "כניסה", overflow: "מוצגים רק 500 התרגולים הראשונים. יש לבחור תקופה קצרה יותר כדי לראות את היתר.", date: "מתאריך", go: "הצגת 14 ימים", dirty: "הדיווח שטרם נשמר יאבד. לצאת מהתצוגה?", revision: "גרסה", done: "בוצע", partly_done: "בוצע חלקית", not_done: "לא בוצע", rescheduled: "נדחה", not_applicable: "לא רלוונטי" },
} as const;
const audienceChanged = { en: "Access to one practice audience changed. Other selections are kept. Retry to refresh your current access.", he: "הגישה לאחת מקבוצות התרגול השתנתה. שאר הבחירות נשמרות כאן. אפשר לנסות שוב כדי לרענן את הגישה הנוכחית." };
type Role = "parent" | "adult_client" | "child" | "practitioner";

/** Same components on Practice and Calendar; no role switching or synthetic data. */
export function PracticeOccurrenceWorkspace({ locale, role, caseId, audienceId, from, to, refreshToken = 0, onDirtyChange }: {
  locale: "en" | "he"; role: Role; caseId?: string | undefined; audienceId?: string | undefined;
  from?: string | undefined; to?: string | undefined; refreshToken?: number | undefined; onDirtyChange?: ((dirty: boolean) => void) | undefined;
}) {
  const t = copy[locale], base = `/${locale}/${role === "parent" ? "family" : role === "practitioner" ? "app" : "client"}`;
  const [selectedDate, setSelectedDate] = useState(() => civilDate(new Date().toISOString()));
  const [dateInput, setDateInput] = useState(selectedDate), [refresh, setRefresh] = useState(0);
  const start = from ?? selectedDate, end = to ?? shiftOccurrenceDay(start, 14), key = `${caseId ?? ""}|${audienceId ?? ""}|${start}|${end}`;
  const [state, setState] = useState<{ key: string; status: "ready" | "error"; code?: string; page: PracticeOccurrencePage }>({ key: "", status: "ready", page: { items: [], hasMore: false } });
  const dirty = useRef(new Set<string>());
  const [hasDirty, setHasDirty] = useState(false);
  const dirtyChange = useCallback((id: string, value: boolean) => {
    if (value) dirty.current.add(id); else dirty.current.delete(id);
    const current = dirty.current.size > 0; setHasDirty(current); onDirtyChange?.(current);
  }, [onDirtyChange]);
  useEffect(() => {
    const ids = practiceDraftIds(dirty.current, state.page);
    if (ids.length === dirty.current.size && hasDirty === (ids.length > 0)) return;
    dirty.current = new Set(ids);
    let canceled = false;
    queueMicrotask(() => { if (!canceled) { const current = dirty.current.size > 0; setHasDirty(current); onDirtyChange?.(current); } });
    return () => { canceled = true; };
  }, [state.page, hasDirty, onDirtyChange]);
  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();
    // Same-scope readback must not unmount another occurrence's unsaved form.
    queueMicrotask(() => { if (!controller.signal.aborted) setState(previous => previous.key === key ? previous : { key: "", status: "ready", page: { items: [], hasMore: false } }); });
    void (async () => {
      occurrenceRange(start, end);
      const page = await practiceRangeOccurrences(caseId, audienceId, start, end, controller.signal);
      if (!controller.signal.aborted) setState({ key, status: "ready", page });
    })().catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof PracticeAudienceAccessError) {
        setState(previous => ({ key, status: "error", code: "AUDIENCE_ACCESS_CHANGED", page: previous.key === key ? practiceAudienceLossPage(previous.page, error.audienceId) : { items: [], hasMore: false } }));
        return;
      }
      const denied = practiceAccessLost(error);
      if (denied) { dirty.current.clear(); setHasDirty(false); onDirtyChange?.(false); }
      setState(previous => ({ key, status: "error", code: error instanceof IdentityClientError ? error.code : "UNAVAILABLE", page: !denied && previous.key === key ? previous.page : { items: [], hasMore: false } }));
    });
    return () => controller.abort();
  }, [caseId, audienceId, start, end, key, refresh, refreshToken, onDirtyChange]);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  const accessLost = useCallback((id: string, code: IdentityClientErrorCode) => {
    // Functional update also handles another card's concurrent readback. Never
    // restore a stale page captured when this card's request began.
    setState(previous => ({ ...previous, status: code === "UNAUTHENTICATED" ? "error" : "ready", code, page: practiceAccessLossPage(previous.page, id, code) }));
    setRefresh(value => value + 1);
  }, []);
  const returnPath = base + "/practice?" + new URLSearchParams({ section: "checkins", ...(caseId ? { caseId } : {}), ...(audienceId ? { audienceId } : {}) });
  return <section className="lsw-stack" aria-label={t.title} dir={locale === "he" ? "rtl" : "ltr"}>
    <UnsavedChangesGuard dirty={hasDirty} message={t.dirty} />
    {!from && <form className="lsw-toolbar" onSubmit={event => { event.preventDefault(); if (!event.currentTarget.checkValidity()) return; if (hasDirty && !window.confirm(t.dirty)) return; dirty.current.clear(); setHasDirty(false); onDirtyChange?.(false); setSelectedDate(dateInput); }}><Input id="practice-from" label={t.date} type="date" required value={dateInput} onChange={event => setDateInput(event.target.value)} /><Button type="submit">{t.go}</Button></form>}
    {!caseId ? <p>{t.choose}</p> : state.key !== key ? <p role="status">{t.loading}</p> : <>
      {state.status === "error" && <div role="alert"><p>{state.code === "AUDIENCE_ACCESS_CHANGED" ? audienceChanged[locale] : state.code === "UNAUTHENTICATED" ? t.auth : ["FORBIDDEN", "NOT_FOUND"].includes(state.code ?? "") ? t.denied : t.error}</p>{state.code === "UNAUTHENTICATED" ? <a className="lsw-button lsw-button--secondary" href={loginHref(locale, returnPath)}>{t.signIn}</a> : <Button variant="secondary" onClick={reload}>{t.retry}</Button>}</div>}
      {!state.page.items.length ? state.status === "ready" && <p role="status">{t.empty}</p> : <div className="lsw-stack">{state.page.items.map(item => <PracticeOccurrenceCard key={key + ":" + item.occurrence.id} locale={locale} item={item} onReadback={reload} onAccessLost={accessLost} onDirty={dirtyChange} />)}</div>}
      {state.page.hasMore && <p role="status">{t.overflow}</p>}
    </>}
  </section>;
}

export function PracticeOccurrenceCard({ locale, item, onReadback, onAccessLost, onDirty }: {
  locale: "en" | "he"; item: PracticeOccurrenceItem; onReadback: () => void; onAccessLost: (id: string, code: IdentityClientErrorCode) => void; onDirty: (id: string, dirty: boolean) => void;
}) {
  const t = copy[locale], id = item.occurrence.id;
  const [status, setStatus] = useState<CompletionStatus | "">("");
  const [savedReport, setSavedReport] = useState(item.ownReport);
  const [phase, setPhase] = useState<"idle" | "saving" | "uncertain" | "conflict" | "error" | "saved">("idle");
  const [history, setHistory] = useState<CompletionView[] | null>(null), [historyFailed, setHistoryFailed] = useState(false);
  const attempt = useRef<CheckInAttempt | null>(null), controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    const incoming = incomingPracticeReport(savedReport, item.ownReport, Boolean(status), attempt.current !== null || ["saving", "uncertain", "conflict"].includes(phase));
    if (incoming === savedReport) return;
    let canceled = false;
    queueMicrotask(() => { if (!canceled) { setSavedReport(incoming); setHistory(null); setHistoryFailed(false); setPhase("idle"); } });
    return () => { canceled = true; };
  }, [item.ownReport, savedReport, status, phase]);
  const canSave = item.canReport && (item.occurrence.state === "open" || savedReport !== null);
  async function save() {
    if (!status || !canSave || phase === "saving" || phase === "conflict") return;
    const retryingUnconfirmed = attempt.current !== null;
    const body = attempt.current ?? checkInAttempt(id, status, savedReport?.reportId);
    attempt.current = body; controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setPhase("saving"); onDirty(id, true);
    let mutationConfirmed = false;
    try {
      await submitPracticeCheckIn(body, current.signal);
      mutationConfirmed = true;
      // A successful HTTP mutation is not enough: read its persisted report back.
      const rows = await ownCheckInHistory(id, current.signal);
      if (!mounted.current || current.signal.aborted) return;
      const latest = rows.at(-1);
      const receipt = checkInReadback(body, rows);
      if (!latest || receipt === "pending") throw new IdentityClientError("UNAVAILABLE");
      if (receipt === "superseded") { setSavedReport(latest); setHistory(rows); setPhase("conflict"); attempt.current = null; return; }
      setSavedReport(latest); setHistory(rows); setPhase("saved"); setStatus(""); attempt.current = null; onDirty(id, false); onReadback();
    } catch (error) {
      if (!mounted.current || current.signal.aborted) return;
      if (practiceAccessLost(error)) { onDirty(id, false); onAccessLost(id, (error as IdentityClientError).code); return; }
      // A rejected retry cannot disprove an earlier uncertain/confirmed write.
      const uncertain = practiceSaveUncertain(error, mutationConfirmed || retryingUnconfirmed);
      setPhase(uncertain ? "uncertain" : error instanceof IdentityClientError && error.code === "CONFLICT" ? "conflict" : "error");
      if (!uncertain) attempt.current = null;
    }
  }
  async function refreshReport() {
    if (phase === "saving") return;
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    try {
      const rows = await ownCheckInHistory(id, current.signal);
      if (current.signal.aborted || !mounted.current) return;
      const receipt = phase === "uncertain" && attempt.current ? checkInReadback(attempt.current, rows) : null;
      if (receipt === "pending") { setHistoryFailed(false); return; }
      if (receipt === "recorded") {
        setSavedReport(rows.at(-1) ?? null); setHistory(rows); setHistoryFailed(false); setPhase("saved"); setStatus(""); attempt.current = null; onDirty(id, false); onReadback(); return;
      }
      setSavedReport(rows.at(-1) ?? null); setHistory(rows); setHistoryFailed(false); setPhase("idle"); attempt.current = null; onReadback();
    } catch (error) {
      if (current.signal.aborted || !mounted.current) return;
      if (practiceAccessLost(error)) { onDirty(id, false); onAccessLost(id, (error as IdentityClientError).code); } else setHistoryFailed(true);
    }
  }
  const format = (value: string) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", dateStyle: "medium" }).format(new Date(value + "T12:00:00Z"));
  return <article className="lsw-card lsw-stack" aria-labelledby={`practice-${id}`}>
    <header className="lsw-section-header"><div><h3 id={`practice-${id}`}>{format(item.occurrence.occursOn)} · {t[item.occurrence.period]}</h3><p>{item.practice.templateKey} · {t.version} {item.practice.version}</p></div><strong>{savedReport ? t[savedReport.status] : t.unreported}</strong></header>
    {item.occurrence.state === "closed" && <p>{t.closed}</p>}
    {item.practice.instructions && <details className="lsw-details"><summary>{t.instruction}</summary><p className="lsw-practice-instruction">{item.practice.instructions}</p></details>}
    {canSave ? <details className="lsw-details"><summary>{t.own}</summary><form className="lsw-stack" onSubmit={event => { event.preventDefault(); if (event.currentTarget.checkValidity()) void save(); }}>
      <Select id={`practice-result-${id}`} label={t.status} required value={status} disabled={phase === "saving" || phase === "uncertain"} onChange={event => { setStatus(event.target.value as CompletionStatus); setPhase(current => current === "conflict" ? "conflict" : "idle"); attempt.current = null; onDirty(id, Boolean(event.target.value)); }}><option value="">{t.chooseStatus}</option>{completionStatuses.map(value => <option value={value} key={value}>{t[value]}</option>)}</Select>
      <Button type="submit" busy={phase === "saving"} disabled={!status || phase === "conflict"}>{phase === "uncertain" ? t.retry : savedReport ? t.correct : t.save}</Button>
      {(phase === "conflict" || phase === "uncertain") && <Button variant="secondary" onClick={() => void refreshReport()}>{t.refresh}</Button>}
    </form></details> : <p>{t.readOnly}</p>}
    {phase === "saved" && <p role="status">{t.saved}</p>}
    {["error", "uncertain", "conflict"].includes(phase) && <p role="alert">{phase === "uncertain" ? t.uncertain : phase === "conflict" ? t.conflict : t.failure}</p>}
    {savedReport && <details className="lsw-details" onToggle={event => { if (event.currentTarget.open && !history && phase !== "saving" && phase !== "uncertain") void refreshReport(); }}><summary>{t.history}</summary>{historyFailed ? <p role="alert">{t.historyError}</p> : history ? <ol>{history.map(report => <li key={report.reportId}>{t.revision} {report.revision} · {t[report.status]} · {new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short" }).format(new Date(report.reportedAt))}</li>)}</ol> : <p role="status">{t.loading}</p>}</details>}
  </article>;
}
