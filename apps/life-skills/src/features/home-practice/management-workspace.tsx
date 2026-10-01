"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IdentityClientError } from "../identity/client.ts";
import { UnsavedChangesGuard } from "../../ui/workspace/draft-guard.tsx";
import { authoringReadback, managementAudiences, readPracticeManagement, savePracticeAuthoring, type PracticeAudience, type PracticeAuthoringCommand, type PracticeManagementData } from "./management-client.ts";
import type { ManagedPracticeVersion } from "./types.ts";

const words = {
  en: { loading: "Loading authorized practice…", choose: "Choose a case to manage practice.", case: "Choose case", audience: "Audience", full: "Shared details", limited: "Title & completion only", private: "Practitioner only", unpublished: "Audience not published", empty: "No items in this audience yet.", loadFailed: "Practice could not be read. Your input is still here.", retry: "Read again", create: "Create", reference: "Practice reference", instructions: "Instructions", start: "Starts on", end: "Ends on (optional)", title: "Title", goal: "Goal", commitment: "Commitment", optional: "Not linked", draft: "Draft — not shared", published: "Published", current: "Current version", previous: "Earlier version", details: "Instruction details", save: "Save draft", saving: "Saving…", saved: "Saved and verified.", revision: "Prepare a revision", cancel: "Cancel editing", discard: "Discard this unsaved input?", publish: "Publish this exact version", confirm: "Share this exact instruction version with this audience? This does not send a provider message or schedule an occurrence.", version: "Version", failed: "The change could not be saved. Your input is still here; read the saved state before retrying.", conflict: "The saved version changed. Read it again before choosing a version to publish.", uncertain: "The result is uncertain. Do not submit again: check saved versions first. Your input is retained.", check: "Check saved versions", reviewed: "I checked the saved list; discard this attempt", uncertainDiscard: "Only discard after checking the saved list. A prior request may already have saved. Discard this retained attempt?", dirty: "You have unsaved practice changes. Leave this page?", bounded: "Only the 100 newest versions are shown. Older records are retained.", needGoal: "Create a goal in Goals before adding a commitment.", noEffects: "Saving does not publish, send a message or book anything. Publication is a separate explicit action.", noDraftEdit: "Saved drafts are retained unchanged. Review the saved version before publication." },
  he: { loading: "טוען תרגול מורשה…", choose: "בחרו תיק לניהול התרגול.", case: "בחירת תיק", audience: "קהל", full: "פרטים משותפים", limited: "כותרת והשלמה בלבד", private: "לאיש המקצוע בלבד", unpublished: "הקהל טרם פורסם", empty: "עדיין אין פריטים בקהל הזה.", loadFailed: "לא ניתן לקרוא את התרגול. הקלט שלכם נשאר כאן.", retry: "קריאה מחדש", create: "יצירה", reference: "שם או מזהה התרגול", instructions: "הנחיות", start: "מתחיל בתאריך", end: "מסתיים בתאריך (רשות)", title: "כותרת", goal: "מטרה", commitment: "מחויבות", optional: "ללא קישור", draft: "טיוטה — לא שותפה", published: "פורסם", current: "גרסה נוכחית", previous: "גרסה קודמת", details: "פרטי ההנחיה", save: "שמירת טיוטה", saving: "שומר…", saved: "נשמר ואומת.", revision: "הכנת גרסה חדשה", cancel: "ביטול העריכה", discard: "לבטל את הקלט שטרם נשמר?", publish: "פרסום הגרסה הזאת בדיוק", confirm: "לשתף את גרסת ההנחיה הזאת בדיוק עם הקהל הזה? פעולה זו אינה שולחת הודעה דרך ספק ואינה קובעת מועד לתרגול.", version: "גרסה", failed: "לא ניתן לשמור את השינוי. הקלט נשאר כאן; בדקו את המצב השמור לפני ניסיון נוסף.", conflict: "הגרסה השמורה השתנתה. קראו אותה מחדש לפני בחירת גרסה לפרסום.", uncertain: "תוצאת השמירה אינה ודאית. אל תשלחו שוב: בדקו קודם את הגרסאות השמורות. הקלט נשמר כאן.", check: "בדיקת הגרסאות השמורות", reviewed: "בדקתי את הרשימה; ביטול ניסיון זה", uncertainDiscard: "יש לבטל רק לאחר בדיקת הרשימה השמורה. ייתכן שבקשה קודמת כבר נשמרה. לבטל את הניסיון שנשמר כאן?", dirty: "יש שינויי תרגול שלא נשמרו. לצאת מהעמוד?", bounded: "מוצגות רק 100 הגרסאות האחרונות. הרשומות הקודמות נשמרו.", needGoal: "צרו מטרה בעמוד המטרות לפני הוספת מחויבות.", noEffects: "שמירה אינה מפרסמת, שולחת הודעה או קובעת מפגש. פרסום הוא פעולה נפרדת ומפורשת.", noDraftEdit: "טיוטות שמורות נשמרות ללא שינוי. יש לבדוק את הגרסה השמורה לפני פרסום." },
} as const;
type Kind = "home-practice" | "goals" | "commitments";
type Draft = { title: string; reference: string; instructions: string; startsOn: string; endsOn: string; goalId: string; commitmentId: string; revision: ManagedPracticeVersion | null };
const blank = (): Draft => ({ title: "", reference: "", instructions: "", startsOn: "", endsOn: "", goalId: "", commitmentId: "", revision: null });

export function PracticeManagementWorkspace({ locale, kind, caseId, audienceId }: { locale: "en" | "he"; kind: Kind; caseId?: string | undefined; audienceId?: string | undefined }) {
  // The keyed editor below prevents stale case/audience data being reused after
  // navigation. The shared draft guard warns before ordinary navigation.
  if (!caseId) return <p>{words[locale].choose} <a href={`/${locale}/app/clients`}>{words[locale].case}</a></p>;
  return <ManagementEditor key={`${locale}:${kind}:${caseId}:${audienceId ?? ""}`} locale={locale} kind={kind} caseId={caseId} initialAudienceId={audienceId} />;
}
function ManagementEditor({ locale, kind, caseId, initialAudienceId }: { locale: "en" | "he"; kind: Kind; caseId: string; initialAudienceId?: string | undefined }) {
  const t = words[locale], [selected, setSelected] = useState(initialAudienceId ?? ""), [loaded, setLoaded] = useState<{ id: string; audiences: PracticeAudience[]; data: PracticeManagementData } | null>(null);
  const [draft, setDraft] = useState<Draft>(blank), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [attempt, setAttempt] = useState<{ command: PracticeAuthoringCommand; receipt: Record<string, unknown> | null } | null>(null), [checked, setChecked] = useState(false), [editorOpen, setEditorOpen] = useState(false);
  const inFlight = useRef(false), generation = useRef(0), mounted = useRef(false);
  const dirty = Boolean(draft.title || draft.reference || draft.instructions || draft.startsOn || draft.endsOn || draft.goalId || draft.commitmentId || draft.revision);
  const load = useCallback(async (id: string, signal: AbortSignal) => {
    const audiences = await managementAudiences(caseId, signal), target = id || audiences[0]?.id;
    if (!target) return { id: "", audiences, data: { practice: { items: [], hasMore: false }, goals: [], commitments: [] } };
    if (!audiences.some(row => row.id === target)) throw new IdentityClientError("NOT_FOUND");
    return { id: target, audiences, data: await readPracticeManagement(caseId, target, signal) };
  }, [caseId]);
  const refresh = useCallback(async () => {
    const current = ++generation.current, controller = new AbortController(); setLoading(true); setError("");
    try { const result = await load(selected, controller.signal); if (mounted.current && generation.current === current) { setLoaded(result); setSelected(result.id); } }
    catch { if (mounted.current && generation.current === current) { setLoaded(null); setError(t.loadFailed); } }
    finally { if (mounted.current && generation.current === current) setLoading(false); }
  }, [load, selected, t.loadFailed]);
  useEffect(() => { mounted.current = true; const controller = new AbortController(), current = ++generation.current;
    void load(selected, controller.signal).then(result => { if (!controller.signal.aborted && current === generation.current) { setLoaded(result); setSelected(result.id); setLoading(false); } }).catch(() => { if (!controller.signal.aborted && current === generation.current) { setLoaded(null); setLoading(false); setError(t.loadFailed); } });
    return () => { mounted.current = false; generation.current += 1; controller.abort(); };
  }, [load, selected, t.loadFailed]);
  const locked = busy || loading || attempt !== null, data = loaded?.id === selected ? loaded.data : null;
  const clear = () => { setDraft(blank()); setEditorOpen(false); setAttempt(null); setChecked(false); };
  const run = async (command: PracticeAuthoringCommand) => {
    if (inFlight.current || locked || !selected || !data) return;
    inFlight.current = true; setBusy(true); setNotice(""); setError(""); let receipt: Record<string, unknown> | null = null;
    try {
      receipt = await savePracticeAuthoring(command);
      const result = await load(selected, new AbortController().signal);
      if (!authoringReadback(command, receipt, result.data)) throw new IdentityClientError("UNAVAILABLE");
      if (mounted.current) { setLoaded(result); clear(); setNotice(t.saved); }
    } catch (failure) {
      if (!mounted.current) return;
      const uncertain = receipt !== null || !(failure instanceof IdentityClientError) || ["UNAVAILABLE", "INTERNAL"].includes(failure.code);
      if (uncertain) { setAttempt({ command, receipt }); setChecked(false); setError(t.uncertain); }
      else {
        if (failure instanceof IdentityClientError && ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(failure.code)) setLoaded(null);
        setError(failure instanceof IdentityClientError && failure.code === "CONFLICT" ? t.conflict : t.failed);
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const check = async () => {
    if (!attempt || inFlight.current) return; inFlight.current = true; setBusy(true);
    try { const result = await load(selected, new AbortController().signal); if (!mounted.current) return; setLoaded(result); setChecked(true);
      if ((attempt.receipt || attempt.command.action === "publish") && authoringReadback(attempt.command, attempt.receipt ?? {}, result.data)) { clear(); setError(""); setNotice(t.saved); }
    } catch { if (mounted.current) { setLoaded(null); setChecked(false); setError(t.loadFailed); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const save = () => {
    const command: PracticeAuthoringCommand = kind === "goals" ? { action: "goal", caseId, audienceId: selected, title: draft.title.trim() }
      : kind === "commitments" ? { action: "commitment", caseId, audienceId: selected, title: draft.title.trim(), goalId: draft.goalId }
      : draft.revision ? { action: "revise", assignmentId: draft.revision.assignmentId, instructions: draft.instructions.trim(), startsOn: draft.startsOn, endsOn: draft.endsOn || null }
      : { action: "create_draft", caseId, audienceId: selected, templateKey: draft.reference.trim(), templateVersion: "manual-1", instructions: draft.instructions.trim(), startsOn: draft.startsOn, endsOn: draft.endsOn || null, ...(draft.goalId ? { goalId: draft.goalId } : {}), ...(draft.commitmentId ? { commitmentId: draft.commitmentId } : {}) };
    void run(command);
  };
  return <div className="lsw-stack lsw-practice-management"><UnsavedChangesGuard dirty={dirty || attempt !== null} message={t.dirty} />
    {loaded && <label className="lsw-field">{t.audience}<select aria-label={t.audience} disabled={locked} value={selected} onChange={event => { if (dirty && !window.confirm(t.discard)) return; clear(); setLoaded(null); setLoading(true); setSelected(event.target.value); }}>
      {loaded.audiences.map((row, index) => <option key={row.id} value={row.id}>{index + 1} · {row.visibility === "private" ? t.private : row.visibility === "family_full" ? t.full : t.limited}{row.published ? "" : " · " + t.unpublished}</option>)}
    </select></label>}
    {loading && <p role="status">{t.loading}</p>}{error && <div role="alert"><p>{error}</p>{attempt ? <><button type="button" disabled={busy} onClick={() => void check()}>{t.check}</button>{checked && <button type="button" disabled={busy} onClick={() => { if (window.confirm(t.uncertainDiscard)) { clear(); setError(""); } }}>{t.reviewed}</button>}</> : <button type="button" disabled={busy || loading} onClick={() => void refresh()}>{t.retry}</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {data && <>
      {kind === "home-practice" ? <ul className="lsw-card-list">{data.practice.items.map(row => <li className="lsw-card lsw-stack" key={row.versionId}>
        <strong>{row.templateKey}</strong><span>{t.version} {row.version} · {row.state === "draft" ? t.draft : row.active ? t.current : t.previous}</span>
        <details className="lsw-details"><summary>{t.details}</summary><p className="lsw-practice-instruction">{row.instructions}</p><p><time>{row.startsOn}</time>{row.endsOn ? " — " + row.endsOn : ""}</p></details>
        {row.state === "draft" ? <><p className="lsw-help">{t.noDraftEdit}</p><button className="lsw-button lsw-button--primary" type="button" disabled={locked || dirty} onClick={() => { if (window.confirm(`${t.confirm}\n\n${row.templateKey} · ${t.version} ${row.version}\n${t.audience}: ${selected}\n\n${row.instructions}`)) void run({ action: "publish", assignmentId: row.assignmentId, versionId: row.versionId }); }}>{t.publish}</button></>
          : row.active && <button className="lsw-button lsw-button--secondary" type="button" disabled={locked || dirty || data.practice.items.some(item => item.assignmentId === row.assignmentId && item.state === "draft")} onClick={() => { setDraft({ ...blank(), instructions: row.instructions, startsOn: row.startsOn, endsOn: row.endsOn ?? "", revision: row }); setEditorOpen(true); }}>{t.revision}</button>}
      </li>)}</ul> : <ul className="lsw-card-list">{(kind === "goals" ? data.goals : data.commitments).map(row => <li className="lsw-card" key={row.id}>{row.title}</li>)}</ul>}
      {!(kind === "home-practice" ? data.practice.items : kind === "goals" ? data.goals : data.commitments).length && <p>{t.empty}</p>}
      {kind === "home-practice" && data.practice.hasMore && <p role="status">{t.bounded}</p>}
      {selected && <details className="lsw-details" open={editorOpen} onToggle={event => setEditorOpen(event.currentTarget.open)}><summary>{draft.revision ? t.revision : t.create}</summary>
        <PracticeAuthoringForm locale={locale} kind={kind} draft={draft} data={data} locked={locked} busy={busy} onChange={setDraft} onSave={save} onCancel={() => { if (!dirty || window.confirm(t.discard)) clear(); }} />
      </details>}
    </>}
  </div>;
}
export function PracticeAuthoringForm({ locale, kind, draft, data, locked, busy, onChange, onSave, onCancel }: { locale: "en" | "he"; kind: Kind; draft: Draft; data: PracticeManagementData; locked: boolean; busy: boolean; onChange: (value: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const t = words[locale];
  return <form className="lsw-stack" onSubmit={event => { event.preventDefault(); if (!locked) onSave(); }}><fieldset className="lsw-stack" disabled={locked}><legend>{draft.revision ? t.revision : t.create}</legend>
    {kind !== "home-practice" ? <label className="lsw-field">{t.title}<input value={draft.title} required maxLength={200} onChange={event => onChange({ ...draft, title: event.target.value })} /></label>
      : <>{!draft.revision && <label className="lsw-field">{t.reference}<input value={draft.reference} required maxLength={100} onChange={event => onChange({ ...draft, reference: event.target.value })} /></label>}
        <label className="lsw-field">{t.instructions}<textarea aria-label={t.instructions} className="lsw-practice-instruction" rows={6} value={draft.instructions} required maxLength={8000} onChange={event => onChange({ ...draft, instructions: event.target.value })} /></label>
        <div className="lsw-two-fields"><label className="lsw-field">{t.start}<input type="date" required value={draft.startsOn} onChange={event => onChange({ ...draft, startsOn: event.target.value })} /></label><label className="lsw-field">{t.end}<input type="date" min={draft.startsOn} value={draft.endsOn} onChange={event => onChange({ ...draft, endsOn: event.target.value })} /></label></div></>}
    {kind !== "goals" && !draft.revision && <label className="lsw-field">{t.goal}<select required={kind === "commitments"} aria-label={t.goal} value={draft.goalId} onChange={event => onChange({ ...draft, goalId: event.target.value, commitmentId: "" })}><option value="">{t.optional}</option>{data.goals.filter(row => row.state === "active").map(row => <option value={row.id} key={row.id}>{row.title}</option>)}</select></label>}
    {kind === "commitments" && !data.goals.some(row => row.state === "active") && <p>{t.needGoal}</p>}
    {kind === "home-practice" && !draft.revision && <label className="lsw-field">{t.commitment}<select aria-label={t.commitment} disabled={!draft.goalId} value={draft.commitmentId} onChange={event => onChange({ ...draft, commitmentId: event.target.value })}><option value="">{t.optional}</option>{data.commitments.filter(row => row.state === "active" && row.goalId === draft.goalId).map(row => <option value={row.id} key={row.id}>{row.title}</option>)}</select></label>}
    <p className="lsw-help">{kind === "home-practice" ? t.noEffects : locale === "he" ? "שמירה מאפשרת לקהל המורשה שנבחר לצפות בפריט. היא אינה שולחת הודעה או קובעת מפגש." : "Saving makes this item available to the selected authorized audience. It does not send a message or book anything."}</p><div className="lsw-actions"><button className="lsw-button lsw-button--primary" type="submit" disabled={locked || kind === "commitments" && !draft.goalId} aria-busy={busy || undefined}>{busy ? t.saving : kind === "home-practice" ? t.save : locale === "he" ? "שמירת הפריט לקהל הזה" : "Save item to this audience"}</button><button className="lsw-button lsw-button--secondary" type="button" onClick={onCancel}>{t.cancel}</button></div>
  </fieldset></form>;
}
