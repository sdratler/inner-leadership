"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sessionInfo } from "../identity/client.ts";
import type { CommunityInboxPage, CommunityInboxPost } from "../community-inbox/bridge.ts";
import type { CommunityReplyResult } from "./bridge.ts";
import type { CommunitySavedDraft } from "./drafts-bridge.ts";
import {CommunityThreadPanel} from './thread-panel.tsx';
import { UnsavedChangesGuard } from "../../ui/workspace/draft-guard.tsx";
import { canResumeRuleOperation, matchesEditedDraftReadback, matchesGeneratedReadback, matchesSavedDraftBinding, matchesSubmittedInput, proposalForResult, replyFailureKind, ruleDraftPromotionNeedsConfirmation, type CommunitySourceInput } from "./input-state.ts";

type Locale = "he" | "en";
const copy = {
  en: {
    savedDrafts: "Saved community drafts", savedHelp: "Your latest 20 unexpired drafts. Public reply text only; no clinical notes. Opening or saving does not generate, send or publish anything.", savedLoading: "Loading saved drafts…", savedEmpty: "No saved drafts yet.", savedUnavailable: "Saved drafts could not be loaded. Your editor is unchanged; retry when the connection is available.", savedRetry: "Reload saved drafts", savedOpen: "Open saved draft", savedReplace: "Replace the unsaved text in this editor with this saved draft?", saveDraft: "Save edited reply", saveSaving: "Saving this exact reply…", saveVerified: "Saved and read back from Scout", saveFailed: "This save is unconfirmed. Your text is preserved. Retry the same save; do not assume it was stored.", saveConflict: "The saved version changed elsewhere. Your text is preserved. Open the saved version to compare before editing again; no text was overwritten.", savedVersion: "Draft version", savedAt: "Last edit", savedHistorical: "This saved draft shows the source versions recorded at generation. Generate a new reply to check the current writing guide.", saveBeforeCopy: "Save and verify your edited reply before reviewing and copying it.", leaveUnsaved: "Leave without saving the community reply changes?", unmeteredCost: "Monetary cost is not returned by this backend; unknown is not zero.",
    inbox: "Community post inbox", inboxHelp: "Captured public posts for manual review. Exact captured responses are shown separately under tracked replies; this post list is not complete conversation history. Nothing is posted automatically.",
    inboxAll: "All", inboxReady: "Ready", inboxNew: "New", inboxReplied: "Marked replied", inboxEmpty: "No captured posts in this view. If you expected posts, check the approved groups and Scout collection status.",
    inboxUnavailable: "The captured-post inbox could not load. Your draft input is preserved. Retry when the Scout connection is available.", inboxLoading: "Loading captured posts…", inboxRetry: "Retry inbox", inboxMore: "More posts", inboxUse: "Use this post for a draft", inboxReplace: "Replace the current unsaved question and link with this post?", inboxOriginal: "Open original Facebook post", inboxDraft: "Saved suggestion", inboxNoDraft: "No saved suggestion yet", inboxCaptured: "Captured", inboxNoComments: "Comments not captured", inboxStatus: "Workflow status",
    intro: "Draft a reply to a public community question. Paste only the minimum public question text; remove names, phone numbers and private child details. Nothing is posted or sent automatically.",
    question: "Public question or post excerpt", url: "Original Facebook post link (optional)", generate: "Generate draft",
    reply: "Editable reply", correction: "Specific instructions", revise: "Revise this reply only", persistent: "Apply correction + update my writing rules",
    proposed: "Reusable preference understood (not saved)", scope: "Apply instructions to", once: "This reply only", community: "Future Community replies", general: "Global writing voice / Content Voice",
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
    savedDrafts: "טיוטות קהילה שמורות", savedHelp: "20 הטיוטות האחרונות שלך שעדיין בתוקף. רק תגובות ציבוריות, ללא הערות קליניות. פתיחה ושמירה אינן יוצרות, שולחות או מפרסמות דבר.", savedLoading: "טוען טיוטות שמורות…", savedEmpty: "אין עדיין טיוטות שמורות.", savedUnavailable: "לא ניתן לטעון טיוטות שמורות. העורך לא השתנה; אפשר לנסות שוב כשהחיבור זמין.", savedRetry: "טעינה מחדש של טיוטות שמורות", savedOpen: "פתיחת הטיוטה השמורה", savedReplace: "להחליף את הטקסט שטרם נשמר בעורך בטיוטה הזאת?", saveDraft: "שמירת התגובה הערוכה", saveSaving: "שומר את התגובה המדויקת הזאת…", saveVerified: "נשמר ונקרא מחדש מ־Scout", saveFailed: "השמירה לא אומתה. הטקסט נשמר במסך. יש לנסות שוב את אותה שמירה; אין להניח שהוא נשמר במערכת.", saveConflict: "הגרסה השמורה השתנתה במקום אחר. הטקסט שלך נשמר במסך. יש לפתוח את הגרסה השמורה להשוואה לפני עריכה נוספת; לא נדרס טקסט.", savedVersion: "גרסת טיוטה", savedAt: "עריכה אחרונה", savedHistorical: "הטיוטה השמורה מציגה את גרסאות המקור שנרשמו בעת היצירה. יש ליצור תגובה חדשה כדי לבדוק את המדריך הנוכחי.", saveBeforeCopy: "יש לשמור ולאמת את התגובה הערוכה לפני בדיקה והעתקה.", leaveUnsaved: "לצאת בלי לשמור את השינויים בתגובת הקהילה?", unmeteredCost: "השרת אינו מחזיר עלות כספית; לא ידוע אינו אפס.",
    inbox: "תיבת פוסטים מהקהילה", inboxHelp: "פוסטים ציבוריים שנקלטו לבדיקה ידנית. תגובות שנקלטו במדויק מוצגות בנפרד תחת תגובות במעקב; רשימת הפוסטים אינה היסטוריית שיחה מלאה. דבר אינו מתפרסם אוטומטית.",
    inboxAll: "הכול", inboxReady: "מוכן", inboxNew: "חדש", inboxReplied: "סומן כנענה", inboxEmpty: "אין פוסטים שנקלטו בתצוגה זו. אם ציפית לפוסטים, בדוק את הקבוצות שאושרו ואת מצב האיסוף.",
    inboxUnavailable: "לא ניתן לטעון את תיבת הפוסטים. הטיוטה שלך נשמרה במסך. אפשר לנסות שוב כשהחיבור זמין.", inboxLoading: "טוען פוסטים שנקלטו…", inboxRetry: "ניסיון חוזר", inboxMore: "עוד פוסטים", inboxUse: "שימוש בפוסט הזה ליצירת טיוטה", inboxReplace: "להחליף את השאלה והקישור שהוזנו ועדיין לא נשמרו בפוסט הזה?", inboxOriginal: "פתיחת הפוסט המקורי", inboxDraft: "הצעה שמורה", inboxNoDraft: "אין עדיין הצעה שמורה", inboxCaptured: "נקלט", inboxNoComments: "תגובות לא נקלטו", inboxStatus: "סטטוס טיפול",
    intro: "טיוטת תגובה לשאלה ציבורית בקהילה. יש להדביק רק את הקטע הציבורי הנחוץ, ללא שמות, טלפונים או פרטים אישיים על ילדים. דבר אינו מתפרסם או נשלח אוטומטית.",
    question: "השאלה הציבורית או קטע מהפוסט", url: "קישור לפוסט המקורי בפייסבוק (לא חובה)", generate: "יצירת טיוטה",
    reply: "תגובה ניתנת לעריכה", correction: "הנחיות ספציפיות", revise: "תיקון התגובה הזאת בלבד", persistent: "החלת התיקון ועדכון כללי הכתיבה שלי",
    proposed: "העדפת כתיבה חוזרת שזוהתה (לא נשמרה)", scope: "החלת ההנחיות על", once: "התגובה הזאת בלבד", community: "תגובות קהילה עתידיות", general: "סגנון הכתיבה הכללי / Content Voice",
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
async function readSaved(draftId?: string, signal?: AbortSignal): Promise<CommunitySavedDraft[]> {
  const response=await fetch('/api/community-drafts'+(draftId?'?draftId='+encodeURIComponent(draftId):''),{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:signal??null});
  const payload=await response.json() as {ok?:boolean;data?:{drafts?:CommunitySavedDraft[]}};
  if(!response.ok||!payload.ok||!Array.isArray(payload.data?.drafts))throw Error('saved');
  return payload.data.drafts;
}

export function CommunityReplyWorkspace({ locale }: { locale: Locale }) {
  const t = {...copy[locale],inboxNoComments:locale==='he'?'קטע הפוסט בלבד; תגובות במעקב מוצגות בנפרד':'Post excerpt only; tracked responses are separate'};
  const [question, setQuestion] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [correction, setCorrection] = useState("");
  const [draft, setDraft] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [proposedRule, setProposedRule] = useState("");
  const [ruleScope, setRuleScope] = useState<"community" | "general">("community");
  const [correctionScope, setCorrectionScope] = useState<'once'|'community'|'general'>('once');
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
  const [savedDrafts, setSavedDrafts] = useState<CommunitySavedDraft[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState(false);
  const [persisted, setPersisted] = useState<CommunitySavedDraft | null>(null);
  const [historical, setHistorical] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [draftSaveError, setDraftSaveError] = useState(false);
  const inFlight = useRef(false);
  const inboxRequest = useRef(0);
  const attempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const ruleAttempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const draftAttempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const savedReadEpoch=useRef(0),draftReadEpoch=useRef(0);
  const stale = !!result && !matchesSubmittedInput({ question, originalUrl }, submittedInput);
  const dirty = !!result && draft !== (persisted?.draft ?? result.reply);
  const unsaved = dirty || stale || (!!result && !persisted) || !!correction.trim() || (!result && !!(question.trim() || originalUrl.trim()));
  const copyAllowed = !!result?.copyAllowed && !!persisted?.copyAllowed && !dirty && !stale;

  const loadSaved = useCallback(async (signal?:AbortSignal)=>{
    const epoch=++savedReadEpoch.current;
    try{const rows=await readSaved(undefined,signal);if(!signal?.aborted&&epoch===savedReadEpoch.current){setSavedDrafts(rows);setSavedError(false);}}
    catch{if(!signal?.aborted&&epoch===savedReadEpoch.current){setSavedDrafts([]);setSavedError(true);}}
    finally{if(!signal?.aborted&&epoch===savedReadEpoch.current)setSavedLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController(),epoch=++savedReadEpoch.current;
    void readSaved(undefined,controller.signal)
      .then(rows=>{if(!controller.signal.aborted&&epoch===savedReadEpoch.current){setSavedDrafts(rows);setSavedError(false);}})
      .catch(()=>{if(!controller.signal.aborted&&epoch===savedReadEpoch.current){setSavedDrafts([]);setSavedError(true);}})
      .finally(()=>{if(!controller.signal.aborted&&epoch===savedReadEpoch.current)setSavedLoading(false);});
    return()=>controller.abort();
  },[]);
  async function confirmGenerated(value:CommunityReplyResult,input:CommunitySourceInput|null):Promise<boolean>{
    const epoch=++draftReadEpoch.current;
    try{const row=(await readSaved(value.operationId))[0];
      if(epoch!==draftReadEpoch.current)return false;
      if(!matchesGeneratedReadback(row,value,input))throw Error('binding');
      if(!row)throw Error('binding');
      savedReadEpoch.current++;setSavedLoading(false);setSavedError(false);
      setPersisted(row);setSavedDrafts(previous=>[row,...previous.filter(item=>item.draftId!==row.draftId)].slice(0,20));setDraftSaveError(false);
      setDraftNotice(row.draft===value.reply?`${t.saveVerified} · ${t.savedVersion} ${row.revision}`:t.saveConflict);
      return true;
    }catch{if(epoch===draftReadEpoch.current){setDraftSaveError(true);setDraftNotice(t.saveFailed);}return false;}
  }
  async function openSaved(row:CommunitySavedDraft){
    if(inFlight.current||(unsaved&&!window.confirm(t.savedReplace)))return;
    draftReadEpoch.current++;
    inFlight.current=true;setBusy(true);
    try{const latest=(await readSaved(row.draftId))[0];if(!matchesSavedDraftBinding(latest,row))throw Error('saved');
      setQuestion(latest.question);setOriginalUrl(latest.originalUrl??'');setResult(latest.generated);setDraft(latest.draft);setPersisted(latest);setHistorical(true);setCorrectionScope('once');
      setSubmittedInput({question:latest.question,originalUrl:latest.originalUrl??''});setReviewed(false);setCorrection('');setCorrectionBase(null);setProposedRule('');setTargetRuleId(null);setExistingRules([]);setExistingSourceSha(null);setRuleSave(null);
      attempt.current=null;ruleAttempt.current=null;draftAttempt.current=null;setNotice('');setDraftSaveError(false);setDraftNotice(`${t.saveVerified} · ${t.savedVersion} ${latest.revision}`);
    }catch{setDraftSaveError(true);setDraftNotice(t.savedUnavailable);}
    finally{inFlight.current=false;setBusy(false);}
  }
  async function saveEdited(){
    if(inFlight.current||!result||!persisted||stale||draft.trim().length<10||!dirty)return;
    inFlight.current=true;setBusy(true);setDraftSaveError(false);setDraftNotice(t.saveSaving);
    try{const session=await sessionInfo();if(session.role!=='practitioner')throw Error('role');
      const value={draftId:persisted.draftId,expectedRevision:persisted.revision,draft};const fingerprint=JSON.stringify(value);
      if(draftAttempt.current?.fingerprint!==fingerprint)draftAttempt.current={fingerprint,operationId:crypto.randomUUID()};
      const response=await fetch('/api/community-drafts',{method:'PUT',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({operationId:draftAttempt.current.operationId,...value})});
      if(response.status===409)throw Error('conflict');
      const payload=await response.json() as {ok?:boolean;data?:CommunitySavedDraft};if(!response.ok||!payload.ok||!payload.data)throw Error('save');
      const readback=(await readSaved(value.draftId))[0];if(!matchesEditedDraftReadback(readback,persisted,payload.data,value.draft))throw Error('conflict');
      savedReadEpoch.current++;setSavedLoading(false);setSavedError(false);
      setPersisted(readback);setSavedDrafts(previous=>[readback,...previous.filter(item=>item.draftId!==readback.draftId)].slice(0,20));draftAttempt.current=null;setReviewed(false);setDraftNotice(`${t.saveVerified} · ${t.savedVersion} ${readback.revision}`);
    }catch(error){setDraftSaveError(true);setDraftNotice(error instanceof Error&&error.message==='conflict'?t.saveConflict:t.saveFailed);}
    finally{inFlight.current=false;setBusy(false);}
  }

  async function loadInbox(status: string, cursor = "") {
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
  }
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
    setCorrectionScope('once');
    setSubmittedInput(null); setNotice(""); setCorrectionBase(null); setProposedRule(""); setTargetRuleId(null); attempt.current = null;
    setPersisted(null);setHistorical(false);setDraftNotice('');setDraftSaveError(false);draftAttempt.current=null;
    draftReadEpoch.current++;
  }

  async function retryGenerated(){
    if(inFlight.current||!result||persisted||stale)return;
    inFlight.current=true;setBusy(true);
    try{if(await confirmGenerated(result,submittedInput))attempt.current=null;}finally{inFlight.current=false;setBusy(false);}
  }
  async function request(mode: "generate" | "revise_once") {
    if (inFlight.current || question.trim().length < 8 || (mode === "revise_once" && (stale || draft.trim().length < 10 || correction.trim().length < 3))) return;
    inFlight.current = true; setBusy(true); setNotice("");
    draftReadEpoch.current++;
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
      setSubmittedInput({ question: command.question, originalUrl: command.originalUrl ?? "" });
      if(mode==='generate')setCorrectionScope('once');
      setResult(payload.data); setDraft(payload.data.reply); setReviewed(false);
      setPersisted(null);setHistorical(false);draftAttempt.current=null;if(await confirmGenerated(payload.data,{question:command.question,originalUrl:command.originalUrl??''}))attempt.current=null;
      const proposal = proposalForResult(mode, payload.data.suggestedRule, payload.data.ruleScope);
      setProposedRule(proposal.rule); setRuleScope(proposal.scope);
      setTargetRuleId(null); setExistingRules([]); setExistingSourceSha(null);
      setCorrectionBase(mode === "revise_once" ? { question: command.question,
        originalUrl: command.originalUrl ?? "", reply: command.previousReply!, correction: command.correction! } : null);
    } catch { setNotice(t.failed); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function saveRule() {
    if (inFlight.current || !result || !correctionBase || stale || correctionScope !== 'community' || ruleScope !== "community" ||
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
    if (!copyAllowed || !reviewed || !draft.trim()) return;
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
    setPersisted(null);setHistorical(false);draftAttempt.current=null;void confirmGenerated(saved.draft,saved.draftInput);
    setCorrection(""); setProposedRule(""); setCorrectionBase(null); setTargetRuleId(null);
    setCorrectionScope('once');
    attempt.current = null; ruleAttempt.current = null;
  }

  return <div className="lsr-community-reply" dir={locale === "he" ? "rtl" : "ltr"}>
    <UnsavedChangesGuard dirty={unsaved} message={t.leaveUnsaved}/>
    {savedError&&<p role="alert" className="lsr-inline-error">{t.savedUnavailable} <button type="button" disabled={busy||savedLoading} onClick={()=>{setSavedLoading(true);void loadSaved();}}>{t.savedRetry}</button></p>}
    <details><summary>{t.savedDrafts}: {savedDrafts.length}</summary><p>{t.savedHelp}</p>
      {savedLoading&&<p role="status">{t.savedLoading}</p>}{!savedLoading&&!savedError&&!savedDrafts.length&&<p>{t.savedEmpty}</p>}
      {savedDrafts.map(row=><article className="lsr-publication-row" key={row.draftId}><h3>{row.question}</h3><p>{t.savedVersion} {row.revision} · {t.savedAt}: {row.editedAt??row.generated.provenance.generatedAt}</p><button type="button" disabled={busy} onClick={()=>void openSaved(row)}>{t.savedOpen}</button></article>)}
      <button type="button" disabled={busy||savedLoading} onClick={()=>{setSavedLoading(true);void loadSaved();}}>{t.savedRetry}</button>
    </details>
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
        <h3>{post.groupName}</h3><p className="lsr-community-original" dir="auto">{post.excerpt}{post.excerptTruncated ? '…' : ''}</p>
        <section className="lsr-reading-aid" lang="en" dir="ltr" aria-label="English reading aid">
          <h4>English reading aid</h4>
          {post.englishReadingAid?.length?<><ul>{post.englishReadingAid.map((line,index)=><li key={index}>{line}</li>)}</ul><p className="lsr-help">Convenience summary, not the source. The original excerpt remains authoritative.</p></>:<p className="lsr-help">No English reading aid is available for this post. Reading it does not run a paid analysis.</p>}
        </section>
        <p className="lsr-help">{t.inboxStatus}: {post.status} · {t.inboxCaptured}: {post.postedAt ?? post.capturedAt ?? '—'} · {t.inboxNoComments}</p>
        {post.draft && <details><summary>{t.inboxDraft}</summary><p>{post.draft}</p></details>}
        {!post.draft && <p className="lsr-help">{t.inboxNoDraft}</p>}
        <div className="lsr-actions"><a className="lsr-button" href={post.postUrl} target="_blank" rel="noopener noreferrer">{t.inboxOriginal}</a>
          <button type="button" onClick={() => choosePost(post)}>{t.inboxUse}</button></div>
      </article>)}
      {inboxCursor && <button type="button" disabled={inboxLoading} onClick={() => { setInboxLoading(true); setInboxError(false); void loadInbox(inboxStatus, inboxCursor); }}>{t.inboxMore}</button>}
    </section>
    <CommunityThreadPanel locale={locale} posts={inbox}/>
    <p className="lsr-instruction">{t.intro}</p>
    <div className="lsr-form-grid"><label>{t.question}<textarea value={question} disabled={busy} maxLength={2000} onChange={event => setQuestion(event.target.value)} /></label>
      <label>{t.url}<input type="url" value={originalUrl} disabled={busy} maxLength={1000} onChange={event => setOriginalUrl(event.target.value)} placeholder="https://www.facebook.com/groups/…" /></label></div>
    <div className="lsr-actions"><button type="button" className="lsr-primary" disabled={busy || question.trim().length < 8} onClick={() => void request("generate")}>{t.generate}</button></div>
    {result && <>
      {stale && <p role="alert" className="lsr-inline-error">{t.stale}</p>}
      <label>{t.reply}<textarea value={draft} disabled={busy} maxLength={3000} onChange={event => { setDraft(event.target.value); setReviewed(false); setProposedRule(""); setCorrectionBase(null); }} /></label>
      <div className="lsr-actions"><button type="button" disabled={busy||stale||!persisted||!dirty||draft.trim().length<10} onClick={()=>void saveEdited()}>{t.saveDraft}</button>
        {persisted&&<button type="button" disabled={busy} onClick={()=>void openSaved(persisted)}>{t.savedOpen}</button>}</div>
      {historical&&<p className="lsr-help">{t.savedHistorical}</p>}
      {(dirty||!persisted)&&<p className="lsr-help">{t.saveBeforeCopy}</p>}
      {persisted&&<p className="lsr-help">{t.savedVersion} {persisted.revision} · {t.savedAt}: {persisted.editedAt??persisted.generated.provenance.generatedAt}</p>}
      {draft !== result.reply && <p className="lsr-help">{t.warning}</p>}
      {(!result.copyAllowed||persisted?.copyAllowed===false) && <p role="alert" className="lsr-inline-error">{t.blocked} {(persisted?.reviewFlags??result.reviewFlags).join(", ")}</p>}
      <label className="lsr-community-review"><input type="checkbox" checked={reviewed} disabled={busy || !copyAllowed} onChange={event => setReviewed(event.target.checked)} />{t.reviewed}</label>
      <div className="lsr-actions"><button type="button" disabled={busy || !reviewed || !copyAllowed || !draft.trim()} onClick={() => void copyDraft()}>{t.copy}</button>
        {!stale && result.originalUrl && <a className="lsr-button" href={result.originalUrl} target="_blank" rel="noopener noreferrer">{t.open}</a>}</div>
      <details><summary>{t.sources}</summary><dl className="lsr-community-sources">
        <dt><a href="https://drive.google.com/file/d/174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn/view" target="_blank" rel="noopener noreferrer">{t.guide}</a></dt><dd>v{result.provenance.guide.declaredVersion ?? "—"} · Drive #{result.provenance.guide.driveRevision} · {result.provenance.guide.modifiedAt} · SHA-256 {result.provenance.guide.sha256.slice(0, 12)}</dd>
        <dt>{t.includedRules}</dt><dd>{result.provenance.guide.includedCommunityRuleIds.join(", ") || "—"}</dd>
        <dt><a href="https://docs.google.com/document/d/12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0/edit" target="_blank" rel="noopener noreferrer">{t.playbook}</a></dt><dd>v{result.provenance.playbook.declaredVersion ?? "—"} · Drive #{result.provenance.playbook.driveRevision} · {result.provenance.playbook.modifiedAt} · SHA-256 {result.provenance.playbook.sha256.slice(0, 12)}</dd>
        <dt>{t.synced}</dt><dd>{result.provenance.guide.checkedAt} · {result.provenance.playbook.checkedAt}</dd>
        <dt>{t.generation}</dt><dd>{result.provenance.generatedAt} · {result.provenance.model} · {result.provenance.policyVersion}</dd>
        <dt>{t.usage}</dt><dd>{result.provenance.usage.inputTokens} / {result.provenance.usage.outputTokens}</dd>
        <dt>{t.unmeteredCost}</dt><dd>—</dd>
      </dl></details>
      <div className="lsr-correction-controls"><label>{t.correction}<textarea value={correction} disabled={busy} maxLength={1000} onChange={event => { setCorrection(event.target.value); setProposedRule(""); setCorrectionBase(null); }} /></label>
        <label>{t.scope}<select value={correctionScope} disabled={busy} onChange={event=>setCorrectionScope(event.target.value==='community'?'community':event.target.value==='general'?'general':'once')}>
          <option value="once">{t.once}</option><option value="community">{t.community}</option><option value="general">{t.general}</option>
        </select></label></div>
      <div className="lsr-actions"><button type="button" disabled={busy || stale || draft.trim().length < 10 || correction.trim().length < 3} onClick={() => void request("revise_once")}>{t.revise}</button>
        {correctionScope==='community'&&<button type="button" className="lsr-primary" disabled={busy || stale || !correctionBase || proposedRule.trim().length < 8 || ruleScope !== "community" ||
          (existingSourceSha !== null && existingSourceSha !== result.provenance.guide.sha256)} onClick={() => void saveRule()}>{t.persistent}</button>}</div>
      {correctionScope!=='once'&&proposedRule && <div className="lsr-form-grid"><label>{t.proposed}<textarea value={proposedRule} maxLength={400} onChange={event => setProposedRule(event.target.value)} /></label>
        <label>{t.language}<select value={ruleLanguage} onChange={event => { setRuleLanguage(event.target.value === "both" ? "both" : event.target.value === "he" ? "he" : "en"); setTargetRuleId(null); }}><option value="he">{t.hebrew}</option><option value="en">{t.english}</option><option value="both">{t.both}</option></select></label></div>}
      {correctionScope==='community'&&proposedRule && existingRules.some(rule => rule.language === ruleLanguage || rule.language === "both" || ruleLanguage === "both") && <label>{t.existingRule}<select value={targetRuleId ?? ""} onChange={event => {
        const selected = existingRules.find(rule => rule.id === event.target.value);
        setTargetRuleId(selected?.id ?? null);
        if (selected?.language === "both") setRuleLanguage("both");
      }}>
        <option value="">{t.addRule}</option>{existingRules.filter(rule => rule.language === ruleLanguage || rule.language === "both" || ruleLanguage === "both").map(rule =>
          <option key={rule.id} value={rule.id}>{rule.id}: {rule.rule.slice(0, 120)}</option>)}</select></label>}
      {targetRuleId && <p className="lsr-help">{t.ruleBefore}: {existingRules.find(rule => rule.id === targetRuleId)?.rule}</p>}
      {existingSourceSha !== null && existingSourceSha !== result.provenance.guide.sha256 && <p role="alert" className="lsr-inline-error">{t.ruleConflict}</p>}
      {(correctionScope === "general" || (correctionScope==='community'&&ruleScope==='general'&&proposedRule)) && <p className="lsr-help">{t.generalGate}</p>}
      {correctionScope!=='once'&&!proposedRule && <p className="lsr-help">{t.interpret}</p>}
    </>}
    {draftNotice&&<p role={draftSaveError?'alert':'status'} className={draftSaveError?'lsr-inline-error':'lsr-status'}>{draftNotice}</p>}
    {draftSaveError&&result&&!persisted&&<button type="button" disabled={busy||stale} onClick={()=>void retryGenerated()}>{locale==='en'?'Retry this draft’s verification':'ניסיון חוזר לאימות הטיוטה הזאת'}</button>}
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
