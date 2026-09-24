"use client";

import { useRef, useState } from "react";
import { sessionInfo } from "../identity/client.ts";
import type { CommunityReplyResult } from "./bridge.ts";

type Locale = "he" | "en";
const copy = {
  en: {
    intro: "Draft a reply to a public community question. Paste only the minimum public question text; remove names, phone numbers and private child details. Nothing is posted or sent automatically.",
    question: "Public question or post excerpt", url: "Original Facebook post link (optional)", generate: "Generate draft",
    reply: "Editable reply", correction: "Tell me what to change", revise: "Revise this reply only", persistent: "Update my writing rules",
    pending: "The canonical writing-rule update is not yet connected. This correction changes only this reply; no source rule has been saved.",
    copy: "Copy reply", open: "Open original post", copied: "Copied. Review the edited text before posting manually.",
    failed: "Generation was not confirmed. Your input is preserved; do not assume a reply was saved or posted.",
    blocked: "The draft needs manual safety review before it can be copied.",
    sources: "Source versions used", guide: "Content Voice", playbook: "Community Response Playbook", synced: "Read for this draft",
    warning: "Editing changes the checked draft. Review your final wording before copying; nothing is posted by the app.",
  },
  he: {
    intro: "טיוטת תגובה לשאלה ציבורית בקהילה. יש להדביק רק את הקטע הציבורי הנחוץ, ללא שמות, טלפונים או פרטים אישיים על ילדים. דבר אינו מתפרסם או נשלח אוטומטית.",
    question: "השאלה הציבורית או קטע מהפוסט", url: "קישור לפוסט המקורי בפייסבוק (לא חובה)", generate: "יצירת טיוטה",
    reply: "תגובה ניתנת לעריכה", correction: "מה לשנות בתגובה", revise: "תיקון התגובה הזאת בלבד", persistent: "עדכון כללי הכתיבה שלי",
    pending: "עדכון כללי הכתיבה במקור עדיין אינו מחובר. התיקון חל רק על תגובה זו; לא נשמר כלל במקור.",
    copy: "העתקת התגובה", open: "פתיחת הפוסט המקורי", copied: "הועתק. יש לבדוק את הנוסח הערוך לפני פרסום ידני.",
    failed: "יצירת התגובה לא אומתה. הטקסט שהזנת נשמר במסך; אין להניח שתגובה נשמרה או פורסמה.",
    blocked: "הטיוטה דורשת בדיקת בטיחות ידנית לפני העתקה.",
    sources: "גרסאות המקורות ששימשו", guide: "מדריך סגנון הכתיבה", playbook: "מדריך תגובות בקהילה", synced: "נקראו עבור טיוטה זו",
    warning: "עריכה משנה את הטיוטה שנבדקה. יש לבדוק את הנוסח הסופי לפני העתקה; האפליקציה אינה מפרסמת אותו.",
  },
};

export function CommunityReplyWorkspace({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [question, setQuestion] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [correction, setCorrection] = useState("");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<CommunityReplyResult | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function request(mode: "generate" | "revise_once") {
    if (inFlight.current || question.trim().length < 8 || (mode === "revise_once" && (!draft.trim() || correction.trim().length < 3))) return;
    inFlight.current = true; setBusy(true); setNotice("");
    try {
      const session = await sessionInfo();
      if (session.role !== "practitioner") throw Error("role");
      const response = await fetch("/api/community-reply", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ operationId: crypto.randomUUID(), mode, question: question.trim(), ...(originalUrl.trim() ? { originalUrl: originalUrl.trim() } : {}),
          ...(mode === "revise_once" ? { correction: correction.trim(), previousReply: draft } : {}) }),
      });
      const payload = await response.json() as { ok?: boolean; data?: CommunityReplyResult };
      if (!response.ok || payload.ok !== true || !payload.data) throw Error("unconfirmed");
      setResult(payload.data); setDraft(payload.data.reply);
      if (mode === "revise_once") setCorrection("");
    } catch { setNotice(t.failed); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function copyDraft() {
    if (!result?.copyAllowed || !draft.trim()) return;
    try { await navigator.clipboard.writeText(draft); setNotice(t.copied); }
    catch { setNotice(t.failed); }
  }

  return <div className="lsr-community-reply" dir={locale === "he" ? "rtl" : "ltr"}>
    <p className="lsr-instruction">{t.intro}</p>
    <div className="lsr-form-grid"><label>{t.question}<textarea value={question} maxLength={2000} onChange={event => setQuestion(event.target.value)} /></label>
      <label>{t.url}<input type="url" value={originalUrl} maxLength={1000} onChange={event => setOriginalUrl(event.target.value)} placeholder="https://www.facebook.com/groups/…" /></label></div>
    <div className="lsr-actions"><button type="button" className="lsr-primary" disabled={busy || question.trim().length < 8} onClick={() => void request("generate")}>{t.generate}</button></div>
    {result && <>
      <label>{t.reply}<textarea value={draft} maxLength={3000} onChange={event => setDraft(event.target.value)} /></label>
      {draft !== result.reply && <p className="lsr-help">{t.warning}</p>}
      {!result.copyAllowed && <p role="alert" className="lsr-inline-error">{t.blocked} {result.reviewFlags.join(", ")}</p>}
      <div className="lsr-actions"><button type="button" disabled={!result.copyAllowed || !draft.trim()} onClick={() => void copyDraft()}>{t.copy}</button>
        {result.originalUrl && <a className="lsr-button" href={result.originalUrl} target="_blank" rel="noopener noreferrer">{t.open}</a>}</div>
      <details><summary>{t.sources}</summary><dl className="lsr-community-sources">
        <dt>{t.guide}</dt><dd>v{result.provenance.guide.declaredVersion ?? "—"} · Drive #{result.provenance.guide.driveRevision} · {result.provenance.guide.modifiedAt} · SHA-256 {result.provenance.guide.sha256.slice(0, 12)}</dd>
        <dt>{t.playbook}</dt><dd>v{result.provenance.playbook.declaredVersion ?? "—"} · Drive #{result.provenance.playbook.driveRevision} · {result.provenance.playbook.modifiedAt} · SHA-256 {result.provenance.playbook.sha256.slice(0, 12)}</dd>
        <dt>{t.synced}</dt><dd>{result.provenance.guide.checkedAt} · {result.provenance.playbook.checkedAt}</dd>
      </dl></details>
      <label>{t.correction}<textarea value={correction} maxLength={1000} onChange={event => setCorrection(event.target.value)} /></label>
      <div className="lsr-actions"><button type="button" disabled={busy || correction.trim().length < 3} onClick={() => void request("revise_once")}>{t.revise}</button>
        <button type="button" disabled title={t.pending}>{t.persistent}</button></div>
      {result.suggestedRule && <p>{result.suggestedRule} · {result.ruleScope}</p>}
      <p className="lsr-help">{t.pending}</p>
    </>}
    {notice && <p role="status" className={notice === t.failed ? "lsr-inline-error" : "lsr-status"}>{notice}</p>}
  </div>;
}
