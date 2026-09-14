"use client";

import { useState, type FormEvent } from "react";
import type { Locale } from "../../lib/locale.ts";

const copy = {
  en: {
    title: "Context updates", intro: "Share a contextual observation linked to the exact published home-practice version.",
    notice: "A reviewed update means the practitioner read it. It is not a witnessed or clinically verified event.",
    caseId: "Case ID", audienceId: "Audience ID", versionId: "Published practice version ID", reportId: "Report ID",
    body: "What did you notice?", send: "Send attributed update", review: "Mark as reviewed", reply: "Reply", adapt: "Create adapted draft",
    replyBody: "Practitioner reply", instructions: "Adapted practice instructions", success: "Saved", failure: "Unable to complete the request",
  },
  he: {
    title: "עדכוני הקשר", intro: "שתפו תצפית הקשרית המקושרת לגרסה המדויקת שפורסמה של תרגול הבית.",
    notice: "עדכון שנבדק פירושו שהמטפל קרא אותו. אין זו עדות לאירוע שנצפה או אומת קלינית.",
    caseId: "מזהה מקרה", audienceId: "מזהה קהל", versionId: "מזהה גרסת תרגול שפורסמה", reportId: "מזהה דיווח",
    body: "מה שמתם לב?", send: "שליחת עדכון מיוחס", review: "סימון כנבדק", reply: "תגובה", adapt: "יצירת טיוטה מותאמת",
    replyBody: "תגובת מטפל", instructions: "הוראות תרגול מותאמות", success: "נשמר", failure: "לא ניתן להשלים את הבקשה",
  },
} as const;

async function csrf(): Promise<string> {
  const response = await fetch("/api/identity/session", { credentials: "same-origin", cache: "no-store" });
  const result = await response.json() as { ok: boolean; data?: { csrfToken?: string } };
  if (!response.ok || !result.ok || !result.data?.csrfToken) throw new Error("SESSION_REQUIRED");
  return result.data.csrfToken;
}

export function UpdatesWorkspace({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [caseId, setCaseId] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [reportId, setReportId] = useState("");
  const [body, setBody] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState("");

  async function post(payload: Record<string, unknown>) {
    setStatus("");
    try {
      const response = await fetch("/api/updates", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { ok: boolean; data?: { id?: string }; error?: { code?: string } };
      if (!response.ok || !result.ok) throw new Error(result.error?.code ?? "REQUEST_FAILED");
      if (result.data?.id) setReportId(result.data.id);
      setStatus(t.success);
    } catch { setStatus(t.failure); }
  }

  function submitReport(event: FormEvent) {
    event.preventDefault();
    void post({ action: "submit_report", caseId, audienceId, practiceVersionId: versionId, body, idempotencyKey: crypto.randomUUID() });
  }

  return <main style={{ maxWidth: 760, margin: "0 auto", padding: "2rem", fontFamily: "system-ui" }}>
    <h1>{t.title}</h1>
    <p>{t.intro}</p>
    <aside style={{ borderInlineStart: "4px solid #177b73", paddingInlineStart: "1rem", marginBlock: "1rem" }}>{t.notice}</aside>
    <form onSubmit={submitReport}>
      <label>{t.caseId}<input required value={caseId} onChange={event => setCaseId(event.target.value)} /></label>
      <label>{t.audienceId}<input required value={audienceId} onChange={event => setAudienceId(event.target.value)} /></label>
      <label>{t.versionId}<input required value={versionId} onChange={event => setVersionId(event.target.value)} /></label>
      <label>{t.body}<textarea required maxLength={8000} value={body} onChange={event => setBody(event.target.value)} /></label>
      <button type="submit">{t.send}</button>
    </form>
    <section style={{ marginBlockStart: "2rem" }}>
      <label>{t.reportId}<input value={reportId} onChange={event => setReportId(event.target.value)} /></label>
      <button type="button" onClick={() => void post({ action: "review", reportId })}>{t.review}</button>
      <label>{t.replyBody}<textarea maxLength={8000} value={replyBody} onChange={event => setReplyBody(event.target.value)} /></label>
      <button type="button" onClick={() => void post({ action: "reply", reportId, body: replyBody, publish: true, idempotencyKey: crypto.randomUUID() })}>{t.reply}</button>
      <label>{t.instructions}<textarea maxLength={8000} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
      <button type="button" onClick={() => void post({ action: "adapt", reportId, adaptedInstructions: instructions, idempotencyKey: crypto.randomUUID() })}>{t.adapt}</button>
    </section>
    <p role="status" aria-live="polite">{status}</p>
  </main>;
}

