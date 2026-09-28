"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sessionInfo } from "../identity/client.ts";
import type { CommunityInboxPage, CommunityInboxPost } from "../community-inbox/bridge.ts";
import type { CommunityReplyResult } from "./bridge.ts";
import { canResumeRuleOperation, matchesSubmittedInput, proposalForResult, replyFailureKind, ruleDraftPromotionNeedsConfirmation, type CommunitySourceInput } from "./input-state.ts";

type Locale = "he" | "en";
const copy = {
  en: {
    inbox: "Community post inbox", inboxHelp: "Captured public posts for manual review. No comments or conversation history are captured; nothing is posted automatically.",
    inboxAll: "All", inboxReady: "Ready", inboxNew: "New", inboxReplied: "Marked replied", inboxEmpty: "No captured posts in this view. If you expected posts, check the approved groups and Scout collection status.",
    inboxUnavailable: "The captured-post inbox could not load. Your draft input is preserved. Retry when the Scout connection is available.", inboxLoading: "Loading captured posts…", inboxRetry: "Retry inbox", inboxMore: "More posts", inboxUse: "Use this post for a draft", inboxReplace: "Replace the current unsaved question and link with this post?", inboxOriginal: "Open original Facebook post", inboxDraft: "Saved suggestion", inboxNoDraft: "No saved suggestion yet", inboxCaptured: "Captured", inboxNoComments: "Comments not captured", inboxStatus: "Workflow status",
    intro: "Draft a reply to a public community question. Paste only the minimum public question text; remove names, phone numbers and private child details. Nothing is posted or sent automatically.",
    question: "Public question or post excerpt", url: "Original Facebook post link (optional)", generate: "Generate draft",
    reply: "Editable reply", correction: "What should change?", revise: "Revise this reply only", persistent: "Apply correction + update my writing rules",
    proposed: "Reusable preference understood (not saved)", scope: "Future scope", community: "Community replies", general: "All writing",
    language: "Replies this rule applies to", hebrew: "Hebrew", english: "English", both: "Both languages",
    pending: "The canonical writing-rule update is not yet connected. This correction changes only this reply; no source rule has been saved.",
    interpret: "First use ‘Revise this reply only’ to review the reusable preference. Only an approved community-reply preference can be saved here.",
    savingRule: "Checking and saving the canonical Content Voice file…",
    ruleDenied: "The app's Google account cannot edit the canonical Content Voice file. No writing rule was saved; your correction is preserved.",
    ruleConflict: "The Content Voice source changed since this draft. No rule was overwritten. Generate a fresh reply, then review the correction again.",
    ruleDraftConflict: "This rule was saved, but the guide changed before its revised reply completed. This older draft cannot be resumed. Generate a fresh reply using the current guide; do not save the same rule again.",
    ruleUnknown: "The source save could not be confirmed. Retry the same correction; the app will read back the canonical file before writing again.",
    ruleSaved: "Writing rule saved and read back from the canonical Content Voice file.",
    draftPending: "The rule is saved, but the revised reply is not confirmed. Retry to resume the same operation.",
    ruleComplete: "Writing rule saved and read back. The revised reply used this saved source.",
    ruleAlready: "This preference already appears in the canonical guide. No duplicate rule was added.",
    ruleUnsafe: "This proposal contains details unsuitable for a reusable writing guide. Remove identifying, clinical or factual claims and review it again.",
    rulePlaybook: "This changes a community-channel rule governed by the separate Playbook. No Content Voice rule was written.",
    generalGate: "A rule for all writing needs separate source review; this action saves community-reply rules only.",
    existingRule: "Replace a reviewed existing community rule (optional)", addRule: "Add a new rule",
    ruleReview: "A similar rule already exists. Review it and select that rule explicitly if this correction should replace it; no source change was made.",
    ruleBefore: "Previous rule", ruleAfter: "Current rule", ruleVersion: "Current source version / last updated / last synchronized",
    retryRule: "Recheck / resume this correction", priorDraft: "Revised reply from this correction",
    loadRuleDraft: "Open this revised reply in the editor", resumeReplace: "Replace the current unsaved question/reply with the revised reply from this correction?",
    copy: "Copy reply", open: "Open original post", copied: "Copied. Review the edited text before posting manually.",
    failed: "Generation was not confirmed. Your input is preserved; do not assume a reply was saved or posted.",
    limited: "Manual drafting has reached its approved limit. Your input is preserved; no new reply was confirmed. An ongoing limit needs owner approval before more drafts can be generated.",
    blocked: "The draft needs manual safety review before it can be copied.",
    sources: "Source versions used", guide: "Content Voice", playbook: "Community Response Playbook", synced: "Latest source check",
    includedRules: "Community rule IDs included in the model input (not a compliance guarantee)",
    generation: "Generation", usage: "Model tokens (input/output)",
    warning: "Editing changes the checked draft. Review your final wording before copying; nothing is posted by the app.",
    stale: "This draft belongs to the previous question or link. Generate a new draft before copying or revising it.",
    reviewed: "I reviewed this exact reply for accuracy, privacy and no private-contact invitation.",
  },
  he: {
    inbox: "תיבת פוסטים מהקהילה", inboxHelp: "פוסטים ציבוריים שנקלטו לבדיקה ידנית. תגובות והיסטוריית שיחה אינן נקלטות; דבר אינו מתפרסם אוטומטית.",
    inboxAll: "הכול", inboxReady: "מוכן", inboxNew: "חדש", inboxReplied: "סומן כנענה", inboxEmpty: "אין פוסטים שנקלטו בתצוגה זו. אם ציפית לפוסטים, בדוק את הקבוצות שאושרו ואת מצב האיסוף.",
    inboxUnavailable: "לא ניתן לטעון את תיבת הפוסטים. הטיוטה שלך נשמרה במסך. אפשר לנסות שוב כשהחיבור זמין.", inboxLoading: "טוען פוסטים שנקלטו…", inboxRetry: "ניסיון חוזר", inboxMore: "עוד פוסטים", inboxUse: "שימוש בפוסט הזה ליצירת טיוטה", inboxReplace: "להחליף את השאלה והקישור שהוזנו ועדיין לא נשמרו בפוסט הזה?", inboxOriginal: "פתיחת הפוסט המקורי", inboxDraft: "הצעה שמורה", inboxNoDraft: "אין עדיין הצעה שמורה", inboxCaptured: "נקלט", inboxNoComments: "תגובות לא נקלטו", inboxStatus: "סטטוס טיפול",
    intro: "טיוטת תגובה לשאלה ציבורית בקהילה. יש להדביק רק את הקטע הציבורי הנחוץ, ללא שמות, טלפונים או פרטים אישיים על ילדים. דבר אינו מתפרסם או נשלח אוטומטית.",
    question: "השאלה הציבורית או קטע מהפוסט", url: "קישור לפוסט המקורי בפייסבוק (לא חובה)", generate: "יצירת טיוטה",
    reply: "תגובה ניתנת לעריכה", correction: "מה צריך לשנות?", revise: "תיקון התגובה הזאת בלבד", persistent: "החלת התיקון ועדכון כללי הכתיבה שלי",
    proposed: "העדפת כתיבה חוזרת שזוהתה (לא נשמרה)", scope: "תחולה לעתיד", community: "תגובות בקהילה", general: "כל הכתיבה",
    language: "שפת התגובות שעליהן הכלל חל", hebrew: "עברית", english: "אנגלית", both: "שתי השפות",
    pending: "עדכון כללי הכתיבה במקור עדיין אינו מחובר. התיקון חל רק על תגובה זו; לא נשמר כלל במקור.",
    interpret: "תחילה יש להשתמש ב׳תיקון התגובה הזאת בלבד׳ כדי לבדוק את העדפת הכתיבה החוזרת. כאן ניתן לשמור רק העדפה לתגובות בקהילה שאושרה.",
    savingRule: "בודק ושומר את קובץ המקור של מדריך סגנון הכתיבה…",
    ruleDenied: "לחשבון Google של האפליקציה אין הרשאת עריכה לקובץ המקור. לא נשמר כלל כתיבה; התיקון שהזנת נשמר במסך.",
    ruleConflict: "מקור סגנון הכתיבה השתנה מאז יצירת הטיוטה. לא נדרס כלל. יש ליצור תגובה חדשה ולבדוק שוב את התיקון.",
    ruleDraftConflict: "הכלל נשמר, אך המדריך השתנה לפני השלמת התגובה המתוקנת. לא ניתן להמשיך את הטיוטה הישנה. יש ליצור תגובה חדשה עם המדריך הנוכחי; אין לשמור שוב את אותו כלל.",
    ruleUnknown: "לא ניתן לאמת את שמירת המקור. יש לנסות שוב את אותו התיקון; האפליקציה תקרא את קובץ המקור לפני כתיבה נוספת.",
    ruleSaved: "כלל הכתיבה נשמר ונקרא מחדש מקובץ המקור.",
    draftPending: "הכלל נשמר, אך התגובה המתוקנת לא אומתה. אפשר לנסות שוב את אותה פעולה.",
    ruleComplete: "כלל הכתיבה נשמר ונקרא מחדש. התגובה המתוקנת השתמשה במקור המעודכן.",
    ruleAlready: "ההעדפה כבר מופיעה במדריך המקור. לא נוסף כלל כפול.",
    ruleUnsafe: "ההצעה מכילה פרטים שאינם מתאימים למדריך כתיבה חוזר. יש להסיר פרטים מזהים, קליניים או טענות עובדתיות ולבדוק שוב.",
    rulePlaybook: "השינוי נוגע לכלל ערוץ קהילתי שבאחריות מדריך התגובות הנפרד. לא נכתב כלל למדריך הכתיבה.",
    generalGate: "כלל לכל הכתיבה דורש בדיקת מקור נפרדת; הפעולה הזאת שומרת רק כללים לתגובות בקהילה.",
    existingRule: "החלפת כלל קהילה קיים לאחר בדיקה (לא חובה)", addRule: "הוספת כלל חדש",
    ruleReview: "כבר קיים כלל דומה. יש לבדוק אותו ולבחור בו במפורש אם התיקון אמור להחליף אותו; המקור לא השתנה.",
    ruleBefore: "כלל קודם", ruleAfter: "כלל נוכחי", ruleVersion: "גרסת המקור הנוכחית / עודכן לאחרונה / סונכרן לאחרונה",
    retryRule: "בדיקה חוזרת / המשך התיקון", priorDraft: "תגובה מתוקנת מהפעולה הזאת",
    loadRuleDraft: "פתיחת התגובה המתוקנת בעורך", resumeReplace: "להחליף את השאלה והתגובה הנוכחיות שטרם נשמרו בתגובה המתוקנת מהפעולה הזאת?",
    copy: "העתקת התגובה", open: "פתיחת הפוסט המקורי", copied: "הועתק. יש לבדוק את הנוסח הערוך לפני פרסום ידני.",
    failed: "יצירת התגובה לא אומתה. הטקסט שהזנת נשמר במסך; אין להניח שתגובה נשמרה או פורסמה.",
    limited: "יצירת הטיוטות הידנית הגיעה למגבלה שאושרה. הטקסט שהזנת נשמר במסך, ולא אומתה תגובה חדשה. כדי ליצור טיוטות נוספות נדרש אישור בעל החשבון למגבלה מתמשכת.",
    blocked: "הטיוטה דורשת בדיקת בטיחות ידנית לפני העתקה.",
    sources: "גרסאות המקורות ששימשו", guide: "מדריך סגנון הכתיבה", playbook: "מדריך תגובות בקהילה", synced: "בדיקת המקורות האחרונה",
    includedRules: "מזהי כללי הקהילה שנכללו בקלט למודל (לא הבטחה שהמודל פעל לפיהם)",
    generation: "יצירת הטיוטה", usage: "טוקנים של המודל (קלט/פלט)",
    warning: "עריכה משנה את הטיוטה שנבדקה. יש לבדוק את הנוסח הסופי לפני העתקה; האפליקציה אינה מפרסמת אותו.",
    stale: "הטיוטה שייכת לשאלה או לקישור הקודמים. יש ליצור טיוטה חדשה לפני העתקה או תיקון.",
    reviewed: "בדקתי את הנוסח המדויק לדיוק, פרטיות והיעדר הזמנה לפנייה פרטית.",
  },
};

type RuleSaveResult = {
  operationId: string; status: string; ruleId?: string; before?: string | null; after?: string;
  savedAt?: string | null; sourceAfterSha256?: string | null;
  draftSourceConflict?: boolean;
  source?: { declaredVersion: string | null; driveRevision: string; modifiedAt: string; checkedAt: string; sha256: string } | null;
  draft?: CommunityReplyResult | null;
  draftInput?: CommunitySourceInput | null;
};
const ruleOperationKey = "ls-community-rule-operation";

export function CommunityReplyWorkspace({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [question, setQuestion] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [correction, setCorrection] = useState("");
  const [draft, setDraft] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [proposedRule, setProposedRule] = useState("");
  const [ruleScope, setRuleScope] = useState<"community" | "general">("community");
  const [ruleLanguage, setRuleLanguage] = useState<"he" | "en" | "both">(locale);
  const [ruleSave, setRuleSave] = useState<RuleSaveResult | null>(null);
  const [correctionBase, setCorrectionBase] = useState<{ question: string; originalUrl: string; reply: string; correction: string } | null>(null);
  const [existingRules, setExistingRules] = useState<Array<{ id: string; language: "he" | "en" | "both"; rule: string }>>([]);
  const [existingSourceSha, setExistingSourceSha] = useState<string | null>(null);
  const [targetRuleId, setTargetRuleId] = useState<string | null>(null);
  const [result, setResult] = useState<CommunityReplyResult | null>(null);
  const [submittedInput, setSubmittedInput] = useState<CommunitySourceInput | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [inboxStatus, setInboxStatus] = useState("all");
  const [inbox, setInbox] = useState<CommunityInboxPost[]>([]);
  const [inboxCursor, setInboxCursor] = useState<string | null>(null);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState(false);
  const inFlight = useRef(false);
  const inboxRequest = useRef(0);
  const attempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const ruleAttempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const stale = !!result && !matchesSubmittedInput({ question, originalUrl }, submittedInput);

  const loadInbox = useCallback(async (status: string, cursor = "") => {
    const requestId = ++inboxRequest.current;
    try {
      const params = new URLSearchParams({ status }); if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/community-posts?${params}`, { credentials: "same-origin", cache: "no-store", redirect: "error" });
      const payload = await response.json() as { ok?: boolean; data?: CommunityInboxPage };
      if (!response.ok || payload.ok !== true || !payload.data || !Array.isArray(payload.data.items)) throw Error("inbox");
      if (requestId !== inboxRequest.current) return;
      setInbox(previous => cursor ? [...previous, ...payload.data!.items] : payload.data!.items);
      setInboxCursor(payload.data.nextCursor);
    } catch { if (requestId === inboxRequest.current) setInboxError(true); }
    finally { if (requestId === inboxRequest.current) setInboxLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++inboxRequest.current;
    void fetch("/api/community-posts?status=all", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal })
      .then(async response => { const payload = await response.json() as { ok?: boolean; data?: CommunityInboxPage }; if (!response.ok || payload.ok !== true || !payload.data) throw Error("inbox"); return payload.data; })
      .then(data => { if (!controller.signal.aborted && requestId === inboxRequest.current) { setInbox(data.items); setInboxCursor(data.nextCursor); } })
      .catch(() => { if (!controller.signal.aborted && requestId === inboxRequest.current) setInboxError(true); })
      .finally(() => { if (!controller.signal.aborted && requestId === inboxRequest.current) setInboxLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!correctionBase) return;
    const controller = new AbortController();
    void fetch("/api/content-voice/corrections?list=1", { credentials: "same-origin", cache: "no-store",
      redirect: "error", signal: controller.signal })
      .then(async response => { const payload = await response.json() as { ok?: boolean;
        data?: { source?: { sha256: string }; rules?: Array<{ id: string; language: "he" | "en" | "both"; rule: string }> } };
        if (!response.ok || !payload.ok) throw Error("source"); return payload.data; })
      .then(data => { if (!controller.signal.aborted && data) { setExistingRules(data.rules ?? []);
        setExistingSourceSha(data.source?.sha256 ?? null); } })
      .catch(() => { /* The server still checks source version and semantic conflicts. */ });
    return () => controller.abort();
  }, [correctionBase]);
  useEffect(() => {
    const operationId = window.localStorage.getItem(ruleOperationKey);
    if (!operationId || !/^[0-9a-f-]{36}$/i.test(operationId)) return;
    const controller = new AbortController();
    void fetch(`/api/content-voice/corrections?operationId=${encodeURIComponent(operationId)}`,
      { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal })
      .then(async response => { const payload = await response.json() as { ok?: boolean; data?: RuleSaveResult }; return response.ok && payload.ok ? payload.data : null; })
      .then(data => { if (!controller.signal.aborted && data) setRuleSave(data); })
      .catch(() => { /* The prior operation remains available for explicit retry. */ });
    return () => controller.abort();
  }, []);

  function choosePost(post: CommunityInboxPost) {
    if ((question.trim() || originalUrl.trim()) && !window.confirm(t.inboxReplace)) return;
    setQuestion(post.excerpt); setOriginalUrl(post.postUrl); setResult(null); setDraft(""); setCorrection(""); setReviewed(false);
    setSubmittedInput(null); setNotice(""); setCorrectionBase(null); setProposedRule(""); setTargetRuleId(null); attempt.current = null;
  }

  async function request(mode: "generate" | "revise_once") {
    if (inFlight.current || question.trim().length < 8 || (mode === "revise_once" && (stale || draft.trim().length < 10 || correction.trim().length < 3))) return;
    inFlight.current = true; setBusy(true); setNotice("");
    try {
      const session = await sessionInfo();
      if (session.role !== "practitioner") throw Error("role");
      const command = { mode, question: question.trim(), ...(originalUrl.trim() ? { originalUrl: originalUrl.trim() } : {}),
        ...(mode === "revise_once" ? { correction: correction.trim(), previousReply: draft } : {}) };
      const fingerprint = JSON.stringify(command);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, operationId: crypto.randomUUID() };
      const response = await fetch("/api/community-reply", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ operationId: attempt.current.operationId, ...command }),
      });
      const payload = await response.json() as { ok?: boolean; data?: CommunityReplyResult; error?: { code?: string } };
      if (replyFailureKind(response.status, payload.error?.code) === "limited") { setNotice(t.limited); return; }
      if (!response.ok || payload.ok !== true || !payload.data) throw Error("unconfirmed");
      attempt.current = null;
      setSubmittedInput({ question: command.question, originalUrl: command.originalUrl ?? "" });
      setResult(payload.data); setDraft(payload.data.reply); setReviewed(false);
      const proposal = proposalForResult(mode, payload.data.suggestedRule, payload.data.ruleScope);
      setProposedRule(proposal.rule); setRuleScope(proposal.scope);
      setTargetRuleId(null); setExistingRules([]); setExistingSourceSha(null);
      setCorrectionBase(mode === "revise_once" ? { question: command.question,
        originalUrl: command.originalUrl ?? "", reply: command.previousReply!, correction: command.correction! } : null);
    } catch { setNotice(t.failed); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function saveRule() {
    if (inFlight.current || !result || !correctionBase || stale || ruleScope !== "community" ||
        proposedRule.trim().length < 8 || correctionBase.correction !== correction.trim() ||
        correctionBase.question !== question.trim() || correctionBase.originalUrl !== originalUrl.trim() ||
        (existingSourceSha !== null && existingSourceSha !== result.provenance.guide.sha256)) return;
    inFlight.current = true; setBusy(true); setNotice(t.savingRule);
    try {
      const session = await sessionInfo();
      if (session.role !== "practitioner") throw Error("role");
      const command = { correction: correctionBase.correction, rule: proposedRule.trim(),
        language: ruleLanguage, sourceSha256: result.provenance.guide.sha256,
        sourceRevision: result.provenance.guide.driveRevision, question: correctionBase.question,
        ...(correctionBase.originalUrl ? { originalUrl: correctionBase.originalUrl } : {}),
        ...(targetRuleId ? { targetRuleId } : {}),
        previousReply: correctionBase.reply };
      const fingerprint = JSON.stringify(command);
      if (ruleAttempt.current?.fingerprint !== fingerprint)
        ruleAttempt.current = { fingerprint, operationId: crypto.randomUUID() };
      const operationId = ruleAttempt.current.operationId;
      window.localStorage.setItem(ruleOperationKey, operationId);
      const response = await fetch("/api/content-voice/corrections", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ operationId, ...command }),
      });
      const payload = await response.json() as { ok?: boolean; data?: RuleSaveResult };
      if (!response.ok || payload.ok !== true || !payload.data) throw Error("unconfirmed");
      setRuleSave(payload.data);
      const status = payload.data.status;
      if (!canResumeRuleOperation(status) && status !== "complete") window.localStorage.removeItem(ruleOperationKey);
      setNotice(status === "complete" ? t.ruleComplete : status === "saved" || status === "draft_pending" ? t.draftPending :
        status === "already_applied" ? t.ruleAlready : status === "needs_playbook" ? t.rulePlaybook :
        status === "unsafe" ? t.ruleUnsafe : status === "permission_denied" ? t.ruleDenied :
        status === "needs_review" ? t.ruleReview : status === "draft_conflict" ? t.ruleDraftConflict : status === "conflict" ? t.ruleConflict : t.ruleUnknown);
      if (status === "complete" && payload.data.draft) {
        promoteRuleDraft(payload.data);
      }
    } catch { setNotice(t.ruleUnknown); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function resumeRule() {
    if (inFlight.current || !ruleSave || !canResumeRuleOperation(ruleSave.status)) return;
    inFlight.current = true; setBusy(true); setNotice(t.savingRule);
    try {
      const session = await sessionInfo();
      if (session.role !== "practitioner") throw Error("role");
      const response = await fetch("/api/content-voice/corrections", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ operationId: ruleSave.operationId }),
      });
      const payload = await response.json() as { ok?: boolean; data?: RuleSaveResult };
      if (!response.ok || !payload.ok || !payload.data) throw Error("unconfirmed");
      setRuleSave(payload.data);
      setNotice(payload.data.status === "complete" ? t.ruleComplete :
        payload.data.status === "saved" || payload.data.status === "draft_pending" ? t.draftPending :
        payload.data.status === "permission_denied" ? t.ruleDenied :
        payload.data.status === "draft_conflict" ? t.ruleDraftConflict : payload.data.status === "conflict" ? t.ruleConflict : t.ruleUnknown);
      if (payload.data.status === "complete") promoteRuleDraft(payload.data);
    } catch { setNotice(t.ruleUnknown); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function copyDraft() {
    if (!result?.copyAllowed || stale || !reviewed || !draft.trim()) return;
    try { await navigator.clipboard.writeText(draft); setNotice(t.copied); }
    catch { setNotice(t.failed); }
  }

  function promoteRuleDraft(saved: RuleSaveResult) {
    if (!saved.draft || !saved.draftInput) return;
    const edited = (!!result && draft !== result.reply) || (!!correction.trim() && correctionBase?.correction !== correction.trim());
    if (ruleDraftPromotionNeedsConfirmation({ question, originalUrl }, saved.draftInput, edited,
      result?.operationId, saved.draft.operationId) && !window.confirm(t.resumeReplace)) return;
    setQuestion(saved.draftInput.question); setOriginalUrl(saved.draftInput.originalUrl);
    setResult(saved.draft); setDraft(saved.draft.reply); setReviewed(false); setSubmittedInput(saved.draftInput);
    setCorrection(""); setProposedRule(""); setCorrectionBase(null); setTargetRuleId(null);
    attempt.current = null; ruleAttempt.current = null;
  }

  return <div className="lsr-community-reply" dir={locale === "he" ? "rtl" : "ltr"}>
    <section className="lsr-panel" aria-label={t.inbox}>
      <h3>{t.inbox}</h3><p className="lsr-help">{t.inboxHelp}</p>
      <div className="lsr-tabs" role="group" aria-label={t.inboxStatus}>
        {([['all', t.inboxAll], ['ready', t.inboxReady], ['new', t.inboxNew], ['replied', t.inboxReplied]] as const).map(([status, label]) =>
          <button key={status} type="button" aria-pressed={inboxStatus === status} onClick={() => { if (status !== inboxStatus) { setInbox([]); setInboxCursor(null); setInboxLoading(true); setInboxError(false); setInboxStatus(status); void loadInbox(status); } }}>{label}</button>)}
      </div>
      {inboxLoading && <p role="status">{t.inboxLoading}</p>}
      {inboxError && <p role="alert" className="lsr-inline-error">{t.inboxUnavailable} <button type="button" onClick={() => { setInboxLoading(true); setInboxError(false); void loadInbox(inboxStatus); }}>{t.inboxRetry}</button></p>}
      {!inboxLoading && !inboxError && inbox.length === 0 && <p>{t.inboxEmpty}</p>}
      {inbox.map(post => <article key={post.id} className="lsr-publication-row">
        <h3>{post.groupName}</h3><p>{post.excerpt}{post.excerptTruncated ? '…' : ''}</p>
        <p className="lsr-help">{t.inboxStatus}: {post.status} · {t.inboxCaptured}: {post.postedAt ?? post.capturedAt ?? '—'} · {t.inboxNoComments}</p>
        {post.draft && <details><summary>{t.inboxDraft}</summary><p>{post.draft}</p></details>}
        {!post.draft && <p className="lsr-help">{t.inboxNoDraft}</p>}
        <div className="lsr-actions"><a className="lsr-button" href={post.postUrl} target="_blank" rel="noopener noreferrer">{t.inboxOriginal}</a>
          <button type="button" onClick={() => choosePost(post)}>{t.inboxUse}</button></div>
      </article>)}
      {inboxCursor && <button type="button" disabled={inboxLoading} onClick={() => { setInboxLoading(true); setInboxError(false); void loadInbox(inboxStatus, inboxCursor); }}>{t.inboxMore}</button>}
    </section>
    <p className="lsr-instruction">{t.intro}</p>
    <div className="lsr-form-grid"><label>{t.question}<textarea value={question} disabled={busy} maxLength={2000} onChange={event => setQuestion(event.target.value)} /></label>
      <label>{t.url}<input type="url" value={originalUrl} disabled={busy} maxLength={1000} onChange={event => setOriginalUrl(event.target.value)} placeholder="https://www.facebook.com/groups/…" /></label></div>
    <div className="lsr-actions"><button type="button" className="lsr-primary" disabled={busy || question.trim().length < 8} onClick={() => void request("generate")}>{t.generate}</button></div>
    {result && <>
      {stale && <p role="alert" className="lsr-inline-error">{t.stale}</p>}
      <label>{t.reply}<textarea value={draft} disabled={busy} maxLength={3000} onChange={event => { setDraft(event.target.value); setReviewed(false); setProposedRule(""); setCorrectionBase(null); }} /></label>
      {draft !== result.reply && <p className="lsr-help">{t.warning}</p>}
      {!result.copyAllowed && <p role="alert" className="lsr-inline-error">{t.blocked} {result.reviewFlags.join(", ")}</p>}
      <label className="lsr-community-review"><input type="checkbox" checked={reviewed} disabled={busy || stale || !result.copyAllowed} onChange={event => setReviewed(event.target.checked)} />{t.reviewed}</label>
      <div className="lsr-actions"><button type="button" disabled={busy || stale || !reviewed || !result.copyAllowed || !draft.trim()} onClick={() => void copyDraft()}>{t.copy}</button>
        {!stale && result.originalUrl && <a className="lsr-button" href={result.originalUrl} target="_blank" rel="noopener noreferrer">{t.open}</a>}</div>
      <details><summary>{t.sources}</summary><dl className="lsr-community-sources">
        <dt><a href="https://drive.google.com/file/d/174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn/view" target="_blank" rel="noopener noreferrer">{t.guide}</a></dt><dd>v{result.provenance.guide.declaredVersion ?? "—"} · Drive #{result.provenance.guide.driveRevision} · {result.provenance.guide.modifiedAt} · SHA-256 {result.provenance.guide.sha256.slice(0, 12)}</dd>
        <dt>{t.includedRules}</dt><dd>{result.provenance.guide.includedCommunityRuleIds.join(", ") || "—"}</dd>
        <dt><a href="https://docs.google.com/document/d/12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0/edit" target="_blank" rel="noopener noreferrer">{t.playbook}</a></dt><dd>v{result.provenance.playbook.declaredVersion ?? "—"} · Drive #{result.provenance.playbook.driveRevision} · {result.provenance.playbook.modifiedAt} · SHA-256 {result.provenance.playbook.sha256.slice(0, 12)}</dd>
        <dt>{t.synced}</dt><dd>{result.provenance.guide.checkedAt} · {result.provenance.playbook.checkedAt}</dd>
        <dt>{t.generation}</dt><dd>{result.provenance.generatedAt} · {result.provenance.model} · {result.provenance.policyVersion}</dd>
        <dt>{t.usage}</dt><dd>{result.provenance.usage.inputTokens} / {result.provenance.usage.outputTokens}</dd>
      </dl></details>
      <label>{t.correction}<textarea value={correction} disabled={busy} maxLength={1000} onChange={event => { setCorrection(event.target.value); setProposedRule(""); setCorrectionBase(null); }} /></label>
      <div className="lsr-actions"><button type="button" disabled={busy || stale || draft.trim().length < 10 || correction.trim().length < 3} onClick={() => void request("revise_once")}>{t.revise}</button>
        <button type="button" className="lsr-primary" disabled={busy || stale || !correctionBase || proposedRule.trim().length < 8 || ruleScope !== "community" ||
          (existingSourceSha !== null && existingSourceSha !== result.provenance.guide.sha256)} onClick={() => void saveRule()}>{t.persistent}</button></div>
      {proposedRule && <div className="lsr-form-grid"><label>{t.proposed}<textarea value={proposedRule} maxLength={400} onChange={event => setProposedRule(event.target.value)} /></label>
        <label>{t.scope}<select value={ruleScope} onChange={event => setRuleScope(event.target.value === "general" ? "general" : "community")}><option value="community">{t.community}</option><option value="general">{t.general}</option></select></label>
        <label>{t.language}<select value={ruleLanguage} onChange={event => { setRuleLanguage(event.target.value === "both" ? "both" : event.target.value === "he" ? "he" : "en"); setTargetRuleId(null); }}><option value="he">{t.hebrew}</option><option value="en">{t.english}</option><option value="both">{t.both}</option></select></label></div>}
      {proposedRule && existingRules.some(rule => rule.language === ruleLanguage || rule.language === "both" || ruleLanguage === "both") && <label>{t.existingRule}<select value={targetRuleId ?? ""} onChange={event => {
        const selected = existingRules.find(rule => rule.id === event.target.value);
        setTargetRuleId(selected?.id ?? null);
        if (selected?.language === "both") setRuleLanguage("both");
      }}>
        <option value="">{t.addRule}</option>{existingRules.filter(rule => rule.language === ruleLanguage || rule.language === "both" || ruleLanguage === "both").map(rule =>
          <option key={rule.id} value={rule.id}>{rule.id}: {rule.rule.slice(0, 120)}</option>)}</select></label>}
      {targetRuleId && <p className="lsr-help">{t.ruleBefore}: {existingRules.find(rule => rule.id === targetRuleId)?.rule}</p>}
      {existingSourceSha !== null && existingSourceSha !== result.provenance.guide.sha256 && <p role="alert" className="lsr-inline-error">{t.ruleConflict}</p>}
      {ruleScope === "general" && <p className="lsr-help">{t.generalGate}</p>}
      {!proposedRule && <p className="lsr-help">{t.interpret}</p>}
    </>}
    {ruleSave && <section className="lsr-panel" aria-live="polite">
      <h3>{t.persistent}</h3><p>{ruleSave.status === "complete" ? t.ruleComplete :
        ruleSave.status === "saved" || ruleSave.status === "draft_pending" ? t.draftPending :
        ruleSave.status === "already_applied" ? t.ruleAlready : ruleSave.status === "needs_playbook" ? t.rulePlaybook :
        ruleSave.status === "unsafe" ? t.ruleUnsafe : ruleSave.status === "permission_denied" ? t.ruleDenied :
        ruleSave.status === "needs_review" ? t.ruleReview : ruleSave.status === "draft_conflict" ? t.ruleDraftConflict : ruleSave.status === "conflict" ? t.ruleConflict : t.ruleUnknown}</p>
      {ruleSave.before && <details><summary>{t.ruleBefore}</summary><p>{ruleSave.before}</p></details>}
      {ruleSave.after && <p>{t.ruleAfter}: {ruleSave.after}</p>}
      {ruleSave.source && <p className="lsr-help">{t.ruleVersion}: v{ruleSave.source.declaredVersion ?? "—"} · Drive #{ruleSave.source.driveRevision} · {ruleSave.source.modifiedAt} · {ruleSave.source.checkedAt}</p>}
      {ruleSave.savedAt && <p className="lsr-help">{t.ruleSaved} {ruleSave.savedAt}</p>}
      {ruleSave.draft && <details><summary>{t.priorDraft}</summary><p>{ruleSave.draft.reply}</p>
        <p className="lsr-help">{t.sources}: {t.guide} v{ruleSave.draft.provenance.guide.declaredVersion ?? "—"} · Drive #{ruleSave.draft.provenance.guide.driveRevision} · SHA-256 {ruleSave.draft.provenance.guide.sha256.slice(0, 12)} · {ruleSave.draft.provenance.guide.includedCommunityRuleIds.join(", ") || "—"}; {t.playbook} v{ruleSave.draft.provenance.playbook.declaredVersion ?? "—"} · Drive #{ruleSave.draft.provenance.playbook.driveRevision}</p></details>}
      {ruleSave.draft && ruleSave.draftInput && <button type="button" disabled={busy} onClick={() => promoteRuleDraft(ruleSave)}>{t.loadRuleDraft}</button>}
      {canResumeRuleOperation(ruleSave.status) && <button type="button" disabled={busy} onClick={() => void resumeRule()}>{t.retryRule}</button>}
    </section>}
    {notice && <p role={notice === t.failed || notice === t.limited ? "alert" : "status"} className={notice === t.failed || notice === t.limited ? "lsr-inline-error" : "lsr-status"}>{notice}</p>}
  </div>;
}
