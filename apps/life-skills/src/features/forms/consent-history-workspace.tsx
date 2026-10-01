"use client";
import { useEffect, useRef, useState } from "react";
import { IdentityClientError } from "../identity/client.ts";
import { loginHref } from "../identity/login-return.ts";
import { consentHistoryState, type ConsentHistoryItem, type ConsentHistoryKind, type ConsentHistoryPage } from "./consent-history.ts";
import { readConsentHistory } from "./consent-history-client.ts";

const words = {
  en: { title: "Recording consent & scoped disclosure history", recording: "Recording consent versions", disclosure: "Scoped disclosure records", kind: "Record type", loading: "Reading authorized history…", empty: "No records of this type are saved for this client.", refresh: "Refresh history", more: "Older records", retry: "Retry this read", error: "History could not load. No consent or access has been changed.", denied: "This case history is no longer available to your account.", login: "Sign in", privacy: "Practitioner-only metadata. Opening this history does not authorize recording, disclose private material or send anything. Evidence and recipient/topic details stay in their protected records.", version: "Recorded version", current: "Current version", signature: "Recorded signature date", signer: "Signing account", policy: "Policy version", withdrawn: "Withdrawn", superseded: "Superseded", checked: "Authority checked (recorded)", needs_review: "Authority needs review", restricted: "Authority restricted", revoked: "Revoked", expired: "Expired", recorded_use: "Use recorded — not delivery proof", recorded_authorization: "Authorization recorded — not used", recordingFlag: "Recording", transcription: "Transcription", ai: "AI processing", informed: "Child informed (recorded)", yes: "Allowed / recorded", no: "Not allowed / not recorded", date: "Authorized on", expiry: "Expires", revokeDate: "Revoked on", used: "Use recorded on", channel: "Channel", phone: "Phone", meeting: "Meeting", secure_message: "Secure message", author: "Authorizing account", practitioner: "Recording practitioner", childDiscussion: "Child discussion recorded", session: "Open related session", updated: "Read from saved records at" },
  he: { title: "היסטוריית הסכמה להקלטה ואישורי מסירה מוגבלים", recording: "גרסאות הסכמה להקלטה", disclosure: "רשומות אישור מסירה מוגבל", kind: "סוג רשומה", loading: "קורא היסטוריה מורשית…", empty: "לא נשמרו רשומות מסוג זה לתיק הזה.", refresh: "רענון ההיסטוריה", more: "רשומות קודמות", retry: "ניסיון קריאה חוזר", error: "ההיסטוריה לא נטענה. ההסכמה והרשאות הגישה לא השתנו.", denied: "היסטוריית התיק אינה זמינה עוד לחשבון שלך.", login: "כניסה", privacy: "פרטי רשומה לאיש המקצוע בלבד. פתיחת ההיסטוריה אינה מתירה הקלטה, מוסרת מידע פרטי או שולחת הודעה. האסמכתאות ופרטי הנמען והנושא נשארים ברשומות המוגנות שלהם.", version: "גרסה שנרשמה", current: "גרסה נוכחית", signature: "תאריך חתימה שנרשם", signer: "חשבון החותם", policy: "גרסת המדיניות", withdrawn: "בוטלה ההסכמה", superseded: "הוחלפה בגרסה חדשה", checked: "סמכות נבדקה לפי הרשומה", needs_review: "נדרשת בדיקת סמכות", restricted: "סמכות מוגבלת", revoked: "האישור בוטל", expired: "תוקף האישור פג", recorded_use: "נרשם שימוש — לא הוכחת מסירה", recorded_authorization: "נרשם אישור — לא נעשה שימוש", recordingFlag: "הקלטה", transcription: "תמלול", ai: "עיבוד בבינה מלאכותית", informed: "יידוע הילד לפי הרשומה", yes: "מותר / נרשם", no: "לא מותר / לא נרשם", date: "מועד האישור", expiry: "בתוקף עד", revokeDate: "מועד ביטול", used: "מועד שימוש שנרשם", channel: "ערוץ", phone: "טלפון", meeting: "פגישה", secure_message: "הודעה מאובטחת", author: "חשבון המאשר", practitioner: "איש המקצוע שתיעד", childDiscussion: "נרשמה שיחה עם הילד", session: "פתיחת המפגש המקושר", updated: "נקרא מהרשומות השמורות בתאריך" },
} as const;

/** Read-only case history; a separate component avoids disturbing form drafts. */
export function ConsentHistoryWorkspace({ locale, caseId }: { locale: "en" | "he"; caseId: string }) {
  const t = words[locale], [open, setOpen] = useState(false), [kind, setKind] = useState<ConsentHistoryKind>("recording");
  const [cursor, setCursor] = useState<string | null>(null), [page, setPage] = useState<ConsentHistoryPage | null>(null), [revision, setRevision] = useState(0);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error" | "denied" | "login">("idle");
  const [code, setCode] = useState(""), generation = useRef(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), request = ++generation.current;
    queueMicrotask(() => { if (!controller.signal.aborted) setPhase("loading"); });
    void readConsentHistory(caseId, kind, cursor, controller.signal).then(result => {
      if (controller.signal.aborted || request !== generation.current) return;
      setPage(result); setPhase("ready"); setCode("");
    }).catch(error => {
      if (controller.signal.aborted || request !== generation.current) return;
      const c = error instanceof IdentityClientError ? error.code : "UNAVAILABLE";
      setCode(c);
      if (["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(c)) { setPage(null); setPhase(c === "UNAUTHENTICATED" ? "login" : "denied"); }
      else setPhase("error");
    });
    return () => controller.abort();
  }, [open, caseId, kind, cursor, revision]);
  const date = (value: string) => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const visible = page?.caseId === caseId && page.kind === kind ? page : null;
  const refresh = () => { setCursor(null); setPage(null); setRevision(n => n + 1); };
  return <details className="lsw-card lsw-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t.title}</summary>
    <div className="lsw-stack" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
      <p className="lsw-help">{t.privacy}</p>
      <div className="lsw-toolbar"><label className="lsw-field">{t.kind}<select aria-label={t.kind} disabled={phase === "loading"} value={kind} onChange={event => { const k = event.target.value; if (k === "recording" || k === "disclosure") { setPage(null); setCursor(null); setKind(k); } }}><option value="recording">{t.recording}</option><option value="disclosure">{t.disclosure}</option></select></label><button className="lsw-button lsw-button--secondary" type="button" disabled={phase === "loading"} onClick={refresh}>{t.refresh}</button></div>
      {phase === "loading" && <p role="status">{t.loading}</p>}
      {["error", "denied", "login"].includes(phase) && <div role="alert"><p>{phase === "error" ? t.error : t.denied}</p>{code === "UNAUTHENTICATED" ? <a className="lsw-button lsw-button--secondary" href={loginHref(locale, `/${locale}/app/forms?caseId=${encodeURIComponent(caseId)}`)}>{t.login}</a> : <button className="lsw-button lsw-button--secondary" type="button" onClick={() => setRevision(n => n + 1)}>{t.retry}</button>}</div>}
      {visible && <><p className="lsw-help">{t.updated} <time dateTime={visible.observedAt}>{date(visible.observedAt)}</time></p>{visible.items.length ? <ol className="lsw-card-list" style={{ gridTemplateColumns: "minmax(0,1fr)", listStyle: "none", padding: 0 }}>{visible.items.map(item => <ConsentHistoryRecord key={item.kind === "recording" ? `${item.id}:${item.version}` : item.id} item={item} observedAt={visible.observedAt} locale={locale} caseId={caseId} />)}</ol> : <p role="status">{t.empty}</p>}
        {visible.hasMore && <button className="lsw-button lsw-button--secondary" type="button" disabled={phase === "loading"} onClick={() => { setPage(null); setCursor(visible.nextCursor); }}>{t.more}</button>}</>}
    </div>
  </details>;
}
export function ConsentHistoryRecord({ item, observedAt, locale, caseId }: { item: ConsentHistoryItem; observedAt: string; locale: "en" | "he"; caseId: string }) {
  const t = words[locale], date = (value: string | null) => value ? <time dateTime={value}>{new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}</time> : "—";
  const flag = (value: boolean) => value ? t.yes : t.no;
  return <li className="lsw-card" style={{ minWidth: 0, overflowWrap: "anywhere" }}><details>
    <summary>{item.kind === "recording" ? `${t.version} ${item.version}` : t.disclosure} · <strong>{t[consentHistoryState(item, observedAt)]}</strong> · {date(item.kind === "recording" ? item.signedAt : item.authorizedAt)}</summary>
    {item.kind === "recording" ? <dl><div><dt>{t.signature}</dt><dd>{date(item.signedAt)}</dd></div><div><dt>{t.policy}</dt><dd>{item.policyVersion}</dd></div><div><dt>{t.signer}</dt><dd><bdi>{item.signedByAccountId}</bdi></dd></div>
      {([[t.recordingFlag, item.recordingAllowed], [t.transcription, item.transcriptionAllowed], [t.ai, item.aiProcessingAllowed], [t.informed, item.childInformed]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{flag(value)}</dd></div>)}{item.withdrawnAt && <div><dt>{t.withdrawn}</dt><dd>{date(item.withdrawnAt)}</dd></div>}</dl>
      : <><dl><div><dt>{t.channel}</dt><dd>{t[item.channel]}</dd></div><div><dt>{t.date}</dt><dd>{date(item.authorizedAt)}</dd></div><div><dt>{t.expiry}</dt><dd>{date(item.expiresAt)}</dd></div><div><dt>{t.author}</dt><dd><bdi>{item.authorizedByAccountId}</bdi></dd></div><div><dt>{t.practitioner}</dt><dd><bdi>{item.recordedByPractitionerId}</bdi></dd></div><div><dt>{t.childDiscussion}</dt><dd>{flag(item.childDiscussionRecorded)}</dd></div>{item.revokedAt && <div><dt>{t.revokeDate}</dt><dd>{date(item.revokedAt)}</dd></div>}{item.usedAt && <div><dt>{t.used}</dt><dd>{date(item.usedAt)}</dd></div>}</dl>{item.sessionId && <a href={`/${locale}/app/cases/${encodeURIComponent(caseId)}/sessions/${encodeURIComponent(item.sessionId)}`}>{t.session}</a>}</>}
  </details></li>;
}
