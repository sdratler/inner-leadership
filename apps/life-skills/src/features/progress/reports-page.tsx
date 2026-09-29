"use client";
import { useEffect, useRef, useState } from "react";
import {useRouter} from 'next/navigation';
import { accountRead, sessionInfo } from "../identity/client.ts";
import { PrivateObservationEvidencePanel } from "../session-workflow/private-observation-evidence.tsx";
import {calendarCasesForMode,type CalendarMode} from '../calendar/mode.ts';
import {workspaceHref,type WorkspaceContext} from '../../ui/workspace/navigation-model.ts';
import {UnsavedChangesGuard} from '../../ui/workspace/draft-guard.tsx';
import {reconcileRevisionAttempt,sameNarrative,validNarrativeForSave,type RevisionAttempt,type RevisionReadback} from './draft-revision-client.ts';
import {reportSection,reportToday,reportVisibleReviews,reportViewWords,reportSections,type ReportSection} from './report-views.ts';
type Locale = "en" | "he"; type Role = "practitioner" | "parent";
type Case = { id: string; displayName: string; kind: string };
type Audience = { id: string; visibility: string; published: boolean };
export type Narrative = { taughtAndPractised: string[]; parentReportedExamples: string[]; practitionerObservations: string[]; usefulChanges: string[]; continuingDifficulty: string[]; uncertainty: string; nextAdjustment: string; informationLimits: string };
export type Review = { id: string; caseId: string; audienceId: string; periodStart: string; periodEnd: string; attendedSessionCount: number; state: "draft" | "published"; narrative: Narrative; revision: number; parentReports?: readonly {reportId:string}[]; assignmentVersionIds?: readonly string[] };
type Draft = { periodStart: string; taught: string; observations: string; useful: string; difficulty: string; uncertainty: string; next: string; limits: string };
const blank: Draft = { periodStart: "", taught: "", observations: "", useful: "", difficulty: "", uncertainty: "", next: "", limits: "" };
const words = {
 en: { title: "Monthly progress reports", intro: "A four-week report based on recorded attendance and your observations.", child: "Child", audience: "Family audience", loading: "Loading authorized reports…", error: "Could not load reports. Please refresh.", empty: "No reports to display.", family: "Only published reports shared with your family appear here.", draft: "Draft", published: "Published", saved: "New draft saved privately.", publishedNow: "Saved report published to this family audience.", save: "Save new draft version", publish: "Publish saved draft", select: "Saved draft", start: "Period start", end: "Period end (exclusive; 28 days later)", taught: "What was taught and practised", observations: "Practitioner observations", useful: "Useful changes", difficulty: "Continuing difficulty", uncertainty: "Uncertainty", next: "Next adjustment", limits: "Information limits", sources: "No parent reports or practice versions are attached in this editor. Do not present your own observations as an attributed parent report.", dirty: "Save these edits as a new draft before publishing.", failed: "The result could not be confirmed. Reload saved reports and check for your draft before trying again. Your text is still here.", reload: "Reload reports (discards unsaved edits)", attended: "Recorded attended sessions", required: "Complete the required fields and select a valid period.", noAudience: "No published full-family audience is available. Set up an authorized audience in the case first.", newDraft: "New draft", back: "Back to cases", busy: "Working…" },
 he: { title: "דוחות התקדמות חודשיים", intro: "דוח של ארבעה שבועות המבוסס על נוכחות מתועדת ותצפיות שלכם.", child: "ילד/ה", audience: "קהל המשפחה", loading: "טוען דוחות מורשים…", error: "לא ניתן לטעון את הדוחות. נסו לרענן.", empty: "אין דוחות להצגה.", family: "כאן מופיעים רק דוחות שפורסמו ושותפו עם המשפחה שלכם.", draft: "טיוטה", published: "פורסם", saved: "נשמרה טיוטה חדשה ופרטית.", publishedNow: "הדוח השמור פורסם לקהל המשפחה הזה.", save: "שמירת גרסת טיוטה חדשה", publish: "פרסום הטיוטה השמורה", select: "טיוטה שמורה", start: "תחילת התקופה", end: "סיום התקופה (לא כולל; כעבור 28 ימים)", taught: "מה נלמד ותורגל", observations: "תצפיות איש המקצוע", useful: "שינויים מועילים", difficulty: "קושי מתמשך", uncertainty: "אי־ודאות", next: "ההתאמה הבאה", limits: "מגבלות המידע", sources: "לעורך זה לא מצורפים דיווחי הורים או גרסאות תרגול. אין להציג תצפיות שלכם כדיווח מיוחס של הורה.", dirty: "יש לשמור את השינויים כטיוטה חדשה לפני הפרסום.", failed: "לא ניתן לאשר את התוצאה. טענו מחדש את הדוחות ובדקו אם הטיוטה נשמרה לפני ניסיון נוסף. הטקסט שלכם עדיין כאן.", reload: "טעינת דוחות מחדש (השינויים שלא נשמרו יאבדו)", attended: "מפגשים שנרשמה בהם נוכחות", required: "מלאו את שדות החובה ובחרו תקופה תקינה.", noAudience: "אין קהל משפחתי מלא ופורסם. יש להגדיר בתיק קהל מורשה תחילה.", newDraft: "טיוטה חדשה", back: "חזרה לתיקים", busy: "מעבד…" },
} as const;
const lines = (text: string) => text.split("\n").map(value => value.trim()).filter(Boolean);
const periodConflictCopy={en:'A report for this period already exists. Your changes were not saved; your text is still here. Review the saved report or choose another period.',he:'כבר קיים דוח לתקופה הזו. השינויים לא נשמרו; הטקסט שלכם עדיין כאן. בדקו את הדוח השמור או בחרו תקופה אחרת.'} as const;
class DuplicateReportPeriod extends Error {}
class RevisionConflict extends Error {}
class ReportValidationFailure extends Error {}

const revisionWords={
 en:{save:'Save draft revision',saved:'Draft revision saved and read back.',check:'Check saved revision',retry:'Retry the same revision',pending:'This revision is not yet confirmed. Your text is preserved. Check the saved revision or retry the same request; do not create a new request.',conflict:'Another saved revision exists. Your text is preserved. Review the current saved draft before continuing.',superseded:'Your revision was recorded, but a newer saved version exists. Your text is preserved; review the current version.',current:'Current saved version — review before continuing',keep:'Keep my text and use this saved revision as the base',load:'Load saved draft (discard my edits)',keepConfirm:'Use the displayed saved revision as the base while keeping your text? Your next save will revise that version. Nothing is published.',history:'Private draft revision history',historyNote:'This history is practitioner-only. Only the explicitly published report is shared with the family.',loadHistory:'Load revision history',more:'Earlier revisions',historyError:'Could not load private revision history. Your edits are unchanged.',version:'Revision',sourcePreserved:'Existing attributed parent examples and attached source references are preserved. This editor does not change source attachments.',dirty:'Save these edits before publishing.',publishedConflict:'Publication was not confirmed for the version you reviewed. Your text is preserved. Review the current saved report.'},
 he:{save:'שמירת גרסת הטיוטה',saved:'גרסת הטיוטה נשמרה ואומתה בקריאה חוזרת.',check:'בדיקת הגרסה השמורה',retry:'ניסיון חוזר של אותה שמירה',pending:'שמירת הגרסה עדיין לא אושרה. הטקסט נשמר בעורך. בדקו את הגרסה השמורה או נסו שוב את אותה בקשה; אין ליצור בקשה חדשה.',conflict:'קיימת גרסה שמורה אחרת. הטקסט נשמר בעורך. בדקו את הטיוטה השמורה העדכנית לפני שממשיכים.',superseded:'הגרסה שלכם נרשמה, אך קיימת גרסה שמורה חדשה יותר. הטקסט נשמר בעורך; בדקו את הגרסה העדכנית.',current:'הגרסה השמורה העדכנית — יש לבדוק לפני שממשיכים',keep:'שמירת הטקסט שלי והמשך על בסיס הגרסה השמורה הזו',load:'טעינת הטיוטה השמורה (ויתור על השינויים שלי)',keepConfirm:'להמשיך על בסיס הגרסה השמורה המוצגת, עם הטקסט שלכם? השמירה הבאה תעדכן את הגרסה הזו. דבר לא יפורסם.',history:'היסטוריית גרסאות טיוטה פרטית',historyNote:'היסטוריה זו מיועדת לאיש המקצוע בלבד. רק הדוח שפורסם במפורש משותף עם המשפחה.',loadHistory:'טעינת היסטוריית גרסאות',more:'גרסאות קודמות',historyError:'לא ניתן לטעון את היסטוריית הגרסאות הפרטית. השינויים בעורך לא השתנו.',version:'גרסה',sourcePreserved:'דוגמאות ההורים המיוחסות וההפניות למקורות הקיימים נשמרות. עורך זה אינו משנה את המקורות המצורפים.',dirty:'יש לשמור את השינויים לפני הפרסום.',publishedConflict:'לא ניתן לאשר פרסום של הגרסה שבדקתם. הטקסט נשמר בעורך. בדקו את הדוח השמור העדכני.'},
} as const;
type EditorState={dirty:boolean;busy:boolean;uncertain:boolean};
const idleEditor:EditorState={dirty:false,busy:false,uncertain:false};
const discardMessage=(locale:Locale)=>locale==='he'?'יש שינויים שלא נשמרו. לעבור ולוותר עליהם?':'You have unsaved report edits. Leave and discard them?';
export function periodEnd(start: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return ""; const date = new Date(`${start}T00:00:00Z`); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== start) return ""; date.setUTCDate(date.getUTCDate() + 28); return date.toISOString().slice(0,10); }
async function read<T>(url: string, signal: AbortSignal): Promise<T> { const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal }); const payload = await response.json(); if (!response.ok || payload.ok !== true) throw Error("READ_FAILED"); return payload.data as T; }
async function post<T>(url: string, body: unknown): Promise<T> { const session = await sessionInfo(); const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken }, body: JSON.stringify(body) }); const payload = await response.json(); if(response.status===409&&payload.ok===false&&payload.error?.code==='CONFLICT'){if(url==='/api/progress/reviews')throw new DuplicateReportPeriod();throw new RevisionConflict();} if(response.status===400&&payload.ok===false&&payload.error?.code==='INVALID_REQUEST')throw new ReportValidationFailure(); if (!response.ok || payload.ok !== true) throw Error("MUTATION_UNCONFIRMED"); return payload.data as T; }
export function ReportsPage({ locale, role, caseId, audienceId,mode='live',navigationContext={},section }: { locale: Locale; role: Role; caseId?: string | undefined; audienceId?: string | undefined;mode?:CalendarMode;navigationContext?:WorkspaceContext;section?:ReportSection|undefined }) {
 const router=useRouter(),context={...navigationContext,mode};
 const t=words[locale],contextKey=`${role}:${role==='practitioner'?mode:'authorized'}:${caseId??''}`;
 const [loaded,setLoaded]=useState<{key:string;items:Case[]}|null>(null),[selection,setSelection]=useState({key:contextKey,id:caseId??''}),[failedFor,setFailedFor]=useState(''),[retry,setRetry]=useState(0),[editorState,setEditorState]=useState<EditorState>(idleEditor);
 useEffect(()=>{let active=true;const promise=role==='practitioner'?accountRead<unknown>('cases',mode).then(items=>calendarCasesForMode(items,mode)):accountRead<Case[]>('cases');
  void promise.then(items=>{if(active){setLoaded({key:contextKey,items});setFailedFor('');}}).catch(()=>{if(active){setLoaded(null);setFailedFor(contextKey);}});return()=>{active=false;};
 },[role,mode,contextKey,retry]);
 const cases=loaded?.key===contextKey?loaded.items:null,selected=selection.key===contextKey?selection.id:caseId??'';
 const activeCase=selected?cases?.find(item=>item.id===selected)?.id??'':cases?.[0]?.id??'',missing=Boolean(cases&&selected&&!activeCase);
 function choose(id:string){if(editorState.busy||editorState.uncertain||id===activeCase||!cases?.some(item=>item.id===id))return;if(editorState.dirty&&!window.confirm(discardMessage(locale)))return;setEditorState(idleEditor);setSelection({key:contextKey,id});if(role==='practitioner'){const url=new URL(workspaceHref(locale,'app/reports',id,context),'https://private.invalid');if(section)url.searchParams.set('section',section);router.replace(url.pathname+url.search);}}
 return <section className="lsw-stack lsw-feature-page" dir={locale==='he'?'rtl':'ltr'}>
  <UnsavedChangesGuard dirty={editorState.dirty||editorState.busy||editorState.uncertain} message={discardMessage(locale)}/>
  <header className="lsw-page-header"><div><h1>{t.title}</h1><p>{t.intro}</p></div></header>
  <a href={workspaceHref(locale,role==='practitioner'?'app/clients':'family',undefined,role==='practitioner'?context:{})}>{t.back}</a>
  {role==='practitioner'&&mode==='demo'&&<p role="status">{locale==='he'?'DEMO — דוחות לתיקים סינתטיים בלבד.':'DEMO — reports for synthetic cases only.'} <a href={`/${locale}/app/reports`}>{locale==='he'?'חזרה לדוחות האמיתיים':'Return to live reports'}</a></p>}
  {failedFor===contextKey?<p role="alert">{t.error} <button type="button" onClick={()=>setRetry(value=>value+1)}>{locale==='he'?'ניסיון חוזר':'Retry case list'}</button></p>:cases===null?<p role="status">{t.loading}</p>:<>
   {cases.length>0&&<label>{role==='practitioner'?(locale==='he'?'לקוח/ה':'Client'):t.child}<select aria-label={role==='practitioner'?(locale==='he'?'לקוח/ה':'Client'):t.child} value={activeCase} disabled={editorState.busy||editorState.uncertain} onChange={event=>choose(event.target.value)}>{missing&&<option value="" disabled>{locale==='he'?'התיק שנבחר אינו זמין':'Selected case unavailable'}</option>}{cases.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
   {missing?<p role="alert">{locale==='he'?'התיק שנבחר אינו זמין ברשימה המורשית הזו. לא נפתח תיק אחר. בחרו תיק מורשה או חזרו לרשימה.':'The selected case is unavailable in this authorized list. No other case was opened. Choose an authorized case or return to the list.'}</p>:!activeCase?<p>{t.empty}</p>:<ReportCaseWorkspace key={`${locale}:${role}:${activeCase}:${role==='practitioner'?reportSection(section):'shared'}`} locale={locale} role={role} caseId={activeCase} initialAudienceId={!caseId||activeCase===caseId?audienceId:undefined} onEditorStateChange={setEditorState} section={section} navigationContext={context}/>}
  </>}
 </section>;
}
export function ReportCaseWorkspace({ locale, role, caseId, initialAudienceId,onEditorStateChange,section,navigationContext={} }: { locale: Locale; role: Role; caseId: string; initialAudienceId?: string | undefined;onEditorStateChange?:(state:EditorState)=>void;section?:ReportSection|undefined;navigationContext?:WorkspaceContext }) {
 const router=useRouter(),t = words[locale]; const [data, setData] = useState<{ audiences: Audience[]; reviews: Review[] } | null>(null), [error, setError] = useState(false), [selected, setSelected] = useState(initialAudienceId ?? "");
 const [editorState,setEditorState]=useState<EditorState>(idleEditor);
 useEffect(()=>{onEditorStateChange?.(editorState);},[editorState,onEditorStateChange]);
 useEffect(() => { const controller = new AbortController(); let active = true; void Promise.all([read<Audience[]>(`/api/identity/audiences?caseId=${encodeURIComponent(caseId)}`, controller.signal), read<Review[]>(`/api/progress/reviews?caseId=${encodeURIComponent(caseId)}`, controller.signal)]).then(([audiences,reviews]) => { if (!active) return; const allowed = audiences.filter(item => item.published && item.visibility === "family_full"); setData({ audiences: allowed, reviews: reviews.filter(item => item.caseId === caseId && allowed.some(audience => audience.id === item.audienceId) && (role === "practitioner" || item.state === "published")) }); }).catch(() => { if (active && !controller.signal.aborted) setError(true); }); return () => { active = false; controller.abort(); }; }, [caseId,role]);
 if (error) return <p role="alert">{t.error}</p>; if (!data) return <p role="status">{t.loading}</p>;
 const activeAudience = selected?data.audiences.find(item => item.id === selected)?.id??'':data.audiences[0]?.id??'';
 if(!activeAudience)return selected?<p role="alert">{locale==='he'?'קהל המשפחה שנבחר אינו זמין. לא נבחר קהל אחר. חזרו לרשימה ובחרו קהל מורשה.':'The selected family audience is unavailable. No other audience was selected. Return to the list and choose an authorized audience.'}</p>:<p>{t.noAudience}</p>;
 const reviews = data.reviews.filter(item => item.audienceId === activeAudience);
 const selectedSection=reportSection(section),v=reportViewWords[locale],visible=role==='practitioner'?reportVisibleReviews(reviews,selectedSection,reportToday()):reviews;
 const sectionHref=(next:ReportSection,audience=activeAudience)=>{const url=new URL(workspaceHref(locale,'app/reports',caseId,navigationContext),'https://private.invalid');url.searchParams.set('audienceId',audience);url.searchParams.set('section',next);return url.pathname+url.search;};
 function saved(review: Review) { setData(previous => previous ? { ...previous, reviews: [...previous.reviews.filter(item => item.id !== review.id), review] } : previous); }
 function chooseAudience(id:string){if(editorState.busy||editorState.uncertain||id===activeAudience||!data?.audiences.some(item=>item.id===id))return;if(editorState.dirty&&!window.confirm(discardMessage(locale)))return;setEditorState(idleEditor);setSelected(id);if(role==='practitioner')router.replace(sectionHref(selectedSection,id));}
 return <div className="lsw-stack"><label>{t.audience}<select value={activeAudience} disabled={editorState.busy||editorState.uncertain} onChange={event=>chooseAudience(event.target.value)}>{data.audiences.map((item,index) => <option key={item.id} value={item.id}>{t.audience} {index+1}</option>)}</select></label>
  {role==='practitioner'&&navigationContext.context==='client'&&<nav className="lsw-actions" aria-label={v.views}>{reportSections.map(next=><a key={next} href={sectionHref(next)} aria-current={next===selectedSection?'page':undefined}>{v[next]}</a>)}</nav>}
  {role==='practitioner'?<><h2>{v[selectedSection]}</h2>{selectedSection==='due'&&<p>{v.dueHelp}</p>}{!visible.length&&<p role="status">{v[`${selectedSection}Empty`]}</p>}
   {visible.map(review=><details className="lsw-card" key={review.id}><summary>{review.periodStart}–{review.periodEnd} · {review.state==='published'?t.published:t.draft} · {revisionWords[locale].version} {review.revision}</summary><ReportReadout locale={locale} review={review}/>{selectedSection==='history'&&<PrivateRevisionHistory locale={locale} review={review}/>}</details>)}
   {selectedSection==='drafts'&&<ReportEditor key={`${caseId}:${activeAudience}`} locale={locale} caseId={caseId} audienceId={activeAudience} reviews={reviews} onSaved={saved} onStateChange={setEditorState}/>}
  </>:<><p>{t.family}</p>{!reviews.length&&<p>{t.empty}</p>}{reviews.map(review=><ReportReadout key={review.id} locale={locale} review={review}/>)}</>}
 </div>;
}
export function ReportEditor({ locale, caseId, audienceId, reviews, onSaved,onStateChange }: { locale: Locale; caseId: string; audienceId: string; reviews: Review[]; onSaved: (review: Review) => void;onStateChange?:(state:EditorState)=>void }) {
 const t = words[locale],r=revisionWords[locale];
 const [draft,setDraft]=useState<Draft>(blank),[selectedId,setSelectedId]=useState(''),[base,setBase]=useState<Review|null>(null);
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[notice,setNotice]=useState('');
 const [periodConflict,setPeriodConflict]=useState(false),[currentSaved,setCurrentSaved]=useState<Review|null>(null);
 const [pendingKind,setPendingKind]=useState<'revision'|'publication'|null>(null);
 const lock=useRef(false),mounted=useRef(false),attempt=useRef<RevisionAttempt|null>(null),publication=useRef<Review|null>(null);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
 useEffect(()=>{onStateChange?.({dirty,busy,uncertain});},[dirty,busy,uncertain,onStateChange]);
 const selected=base?.id===selectedId&&base.caseId===caseId&&base.audienceId===audienceId?base:null;
 function loadDraft(review:Review|null){
  const n=review?.narrative;
  setDraft(review&&n?{periodStart:review.periodStart,taught:n.taughtAndPractised.join('\n'),observations:n.practitionerObservations.join('\n'),useful:n.usefulChanges.join('\n'),difficulty:n.continuingDifficulty.join('\n'),uncertainty:n.uncertainty,next:n.nextAdjustment,limits:n.informationLimits}:blank);
  setBase(review);setSelectedId(review?.id??'');setDirty(false);setUncertain(false);setPeriodConflict(false);setCurrentSaved(null);setNotice('');attempt.current=null;publication.current=null;setPendingKind(null);
 }
 function change(field:keyof Draft,value:string){if(lock.current||uncertain||currentSaved||selected?.state==='published'||(field==='periodStart'&&selected))return;setDraft(previous=>({...previous,[field]:value}));setDirty(true);if(periodConflict){setPeriodConflict(false);setNotice('');}}
 function choose(id:string){if(lock.current||uncertain||id===selectedId)return;if(dirty&&!window.confirm(discardMessage(locale)))return;loadDraft(reviews.find(item=>item.id===id&&item.caseId===caseId&&item.audienceId===audienceId&&item.state==='draft')??null);}
 async function savedReview(id:string):Promise<Review>{
  const items=await read<Review[]>(`/api/progress/reviews?caseId=${encodeURIComponent(caseId)}`,new AbortController().signal);
  const saved=items.find(item=>item.id===id&&item.caseId===caseId&&item.audienceId===audienceId);
  if(!saved||!Number.isSafeInteger(saved.revision)||saved.revision<1||!Number.isSafeInteger(saved.attendedSessionCount)||!['draft','published'].includes(saved.state))throw Error('INVALID_SAVED_REPORT');
  return saved;
 }
 function comparison(saved:Review,message:string){if(!mounted.current)return;onSaved(saved);setCurrentSaved(saved);setUncertain(true);setNotice(message);}
 async function confirmRevision(input:RevisionAttempt,confirmedConflict=false){
  const receipt=await read<RevisionReadback>(`/api/progress/reviews/revisions?reviewId=${encodeURIComponent(input.reviewId)}&operationId=${encodeURIComponent(input.operationId)}`,new AbortController().signal);
  const outcome=reconcileRevisionAttempt(input,receipt);
  if(outcome.state==='pending'){
   if(confirmedConflict||receipt.currentRevision!==input.expectedRevision||receipt.state!=='draft')comparison(await savedReview(input.reviewId),r.conflict);
   else if(mounted.current){setUncertain(true);setNotice(r.pending);}
   return;
  }
  const saved=await savedReview(input.reviewId);
  if(outcome.state==='superseded'||saved.revision!==outcome.saved.revision||!sameNarrative(saved.narrative,input.narrative)){comparison(saved,r.superseded);return;}
  if(mounted.current){onSaved(saved);setBase(saved);setDirty(false);setUncertain(false);setCurrentSaved(null);attempt.current=null;setPendingKind(null);setNotice(saved.state==='published'?t.publishedNow:r.saved);}
 }
 async function sendRevision(input:RevisionAttempt){
  let conflict=false;
  try{
   const result=await post<{reviewId:string;revision:number;operationId:string}>('/api/progress/reviews/revise',input);
   if(result.reviewId!==input.reviewId||result.revision!==input.expectedRevision+1||result.operationId!==input.operationId)throw Error('INVALID_REVISION_RECEIPT');
  }catch(error){if(error instanceof ReportValidationFailure)throw error;conflict=error instanceof RevisionConflict;}
  // Even a 201 or a lost response is reconciled against persisted history.
  await confirmRevision(input,conflict);
 }
 async function save(){
  if(lock.current||uncertain||!dirty||selected?.state==='published')return;
  const end=periodEnd(draft.periodStart),narrative:Narrative={taughtAndPractised:lines(draft.taught),parentReportedExamples:selected?.narrative.parentReportedExamples??[],practitionerObservations:lines(draft.observations),usefulChanges:lines(draft.useful),continuingDifficulty:lines(draft.difficulty),uncertainty:draft.uncertainty.trim(),nextAdjustment:draft.next.trim(),informationLimits:draft.limits.trim()};
  if(!end||!validNarrativeForSave(narrative)){setPeriodConflict(true);setNotice(locale==='he'?'מלאו את שדות החובה. עד 30 שורות בכל רשימה, עד 500 תווים לשורת לימוד ועד 1,500 לשורה אחרת; עד 3,000 תווים בשדה הסבר ועד 64KB בסך הכול. הטקסט לא נשלח.':'Complete required fields. Use at most 30 lines per list, 500 characters per teaching line, 1,500 per other line, 3,000 per explanation and 64KB in total. The text was not sent.');return;}
  lock.current=true;setBusy(true);setNotice('');setPeriodConflict(false);
  try{
   if(selected){
    const input:RevisionAttempt={reviewId:selected.id,expectedRevision:selected.revision,operationId:crypto.randomUUID(),narrative};attempt.current=input;setPendingKind('revision');
    await sendRevision(input);
   }else{
    const result=await post<{reviewId:string;attendedSessionCount:number;revision:number}>('/api/progress/reviews',{caseId,audienceId,periodStart:draft.periodStart,periodEnd:end,assignmentVersionIds:[],parentReportIds:[],narrative});
    if(!result.reviewId||result.revision!==1||!Number.isSafeInteger(result.attendedSessionCount))throw Error('INVALID_RECEIPT');
    const saved=await savedReview(result.reviewId);
    if(saved.periodStart!==draft.periodStart||saved.periodEnd!==end||saved.revision!==1||!sameNarrative(saved.narrative,narrative))throw Error('UNCONFIRMED_NEW_DRAFT');
    if(mounted.current){onSaved(saved);setSelectedId(saved.id);setBase(saved);setDirty(false);setNotice(saved.state==='published'?t.publishedNow:t.saved);}
   }
  }catch(error){if(mounted.current){if(error instanceof DuplicateReportPeriod){setPeriodConflict(true);setNotice(periodConflictCopy[locale]);}else if(error instanceof ReportValidationFailure){attempt.current=null;setPendingKind(null);setUncertain(false);setPeriodConflict(true);setNotice(locale==='he'?'השרת דחה את תוכן הטיוטה לפני השמירה. הטקסט עדיין כאן; בדקו את שדות החובה ואורך השורות ונסו שוב.':'The server rejected the draft content before saving. Your text is still here; check required fields and line lengths, then try again.');}else{setUncertain(true);setNotice(attempt.current?r.pending:t.failed);}}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 async function recover(retry=false){
  if(lock.current)return;const input=attempt.current,snapshot=publication.current;if(!input&&!snapshot)return;
  lock.current=true;setBusy(true);
  try{
   if(input){if(retry)await sendRevision(input);else await confirmRevision(input);}
   else if(snapshot){const saved=await savedReview(snapshot.id);if(saved.state==='published'&&saved.revision===snapshot.revision&&sameNarrative(saved.narrative,snapshot.narrative)){if(mounted.current){onSaved(saved);setBase(saved);setUncertain(false);setNotice(t.publishedNow);publication.current=null;setPendingKind(null);}}else comparison(saved,r.publishedConflict);}
  }catch{if(mounted.current)setNotice(input?r.pending:t.failed);}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 async function publish(){
  if(lock.current||uncertain||dirty||!selected||selected.state!=='draft')return;
  lock.current=true;setBusy(true);setNotice('');const snapshot=selected;publication.current=snapshot;setPendingKind('publication');
  try{
   await post('/api/progress/reviews/publish',{reviewId:snapshot.id,expectedRevision:snapshot.revision});
   const saved=await savedReview(snapshot.id);
   if(saved.state!=='published'||saved.revision!==snapshot.revision||!sameNarrative(saved.narrative,snapshot.narrative))throw Error('UNCONFIRMED_PUBLICATION');
   if(mounted.current){onSaved(saved);setBase(saved);publication.current=null;setPendingKind(null);setNotice(t.publishedNow);}
  }catch(error){if(mounted.current){setUncertain(true);setNotice(error instanceof RevisionConflict?r.publishedConflict:t.failed);}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 function adoptCurrent(keepText:boolean){
  if(lock.current||!currentSaved)return;
  if(keepText){if(currentSaved.state!=='draft'||!window.confirm(r.keepConfirm))return;setBase(currentSaved);setDirty(true);setUncertain(false);setCurrentSaved(null);setNotice('');attempt.current=null;publication.current=null;setPendingKind(null);}
  else{if(dirty&&!window.confirm(discardMessage(locale)))return;loadDraft(currentSaved);}
 }
 const fields = [["taught",t.taught],["observations",t.observations],["useful",t.useful],["difficulty",t.difficulty],["uncertainty",t.uncertainty],["next",t.next],["limits",t.limits]] as const;
 return <section className="lsw-card lsw-stack">
  <PrivateObservationEvidencePanel locale={locale} caseId={caseId}/>
  <label>{t.select}<select aria-label={t.select} value={selectedId} disabled={busy||uncertain} onChange={event=>choose(event.target.value)}><option value="">{t.newDraft}</option>{reviews.filter(item=>item.state==='draft'||item.id===selectedId).map(item=><option key={item.id} value={item.id}>{item.periodStart}–{item.periodEnd} · {r.version} {item.revision}</option>)}</select></label>
  <p>{selected?r.sourcePreserved:t.sources}</p>{selected&&<p>{r.version}: {selected.revision} · {selected.state==='published'?t.published:t.draft}</p>}
  <label>{t.start}<input type="date" value={draft.periodStart} disabled={busy||uncertain||Boolean(selected)} onChange={event=>change('periodStart',event.target.value)}/></label>
  <p>{t.end}: {periodEnd(draft.periodStart)||'—'}</p>
  {fields.map(([field,label])=><label key={field}>{label}<textarea value={draft[field]} disabled={busy||uncertain||selected?.state==='published'} maxLength={field==='uncertainty'||field==='next'||field==='limits'?3000:12000} onChange={event=>change(field,event.target.value)}/></label>)}
  <div className="lsw-actions"><button type="button" disabled={busy||uncertain||!dirty||selected?.state==='published'} onClick={()=>void save()}>{busy?t.busy:selected?r.save:t.save}</button><button type="button" disabled={busy||uncertain||dirty||!selected||selected.state!=='draft'} onClick={()=>void publish()}>{t.publish}</button></div>
  {dirty&&<p>{r.dirty}</p>}{notice&&<p role={periodConflict||uncertain?'alert':'status'}>{notice}</p>}
  {uncertain&&pendingKind&&<div className="lsw-actions"><button type="button" disabled={busy} onClick={()=>void recover()}>{r.check}</button>{pendingKind==='revision'&&!currentSaved&&<button type="button" disabled={busy} onClick={()=>void recover(true)}>{r.retry}</button>}</div>}
  {currentSaved&&<details><summary>{r.current}</summary><ReportReadout locale={locale} review={currentSaved}/><div className="lsw-actions">{currentSaved.state==='draft'&&<button type="button" disabled={busy} onClick={()=>adoptCurrent(true)}>{r.keep}</button>}<button type="button" disabled={busy} onClick={()=>adoptCurrent(false)}>{r.load}</button></div></details>}
  {uncertain&&!pendingKind&&<button type="button" onClick={()=>{if(!dirty||window.confirm(discardMessage(locale)))window.location.reload();}}>{t.reload}</button>}
  {selected&&<PrivateRevisionHistory key={`${selected.id}:${selected.revision}`} locale={locale} review={selected}/>}
 </section>;
}
function PrivateRevisionHistory({locale,review}:{locale:Locale;review:Review}){
 const r=revisionWords[locale],[data,setData]=useState<RevisionReadback|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),lock=useRef(false),mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function load(more=false){if(lock.current)return;lock.current=true;setBusy(true);setError(false);try{
  const page=await read<RevisionReadback>(`/api/progress/reviews/revisions?reviewId=${encodeURIComponent(review.id)}${more&&data?.nextBefore?`&before=${data.nextBefore}`:''}`,new AbortController().signal);
  if(page.reviewId!==review.id||!Array.isArray(page.revisions))throw Error('INVALID_HISTORY');
  if(mounted.current)setData(previous=>({...page,revisions:more&&previous?[...previous.revisions,...page.revisions]:page.revisions}));
 }catch{if(mounted.current)setError(true);}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 return <details><summary>{r.history}</summary><p>{r.historyNote}</p>{!data&&<button type="button" disabled={busy} onClick={()=>void load()}>{r.loadHistory}</button>}{error&&<p role="alert">{r.historyError} <button type="button" disabled={busy} onClick={()=>void load(Boolean(data))}>{locale==='he'?'ניסיון חוזר':'Retry'}</button></p>}{data?.revisions.map(saved=><details key={saved.revision}><summary>{r.version} {saved.revision} · <time dateTime={saved.savedAt}>{new Date(saved.savedAt).toLocaleString(locale==='he'?'he-IL':'en-GB')}</time></summary><ReportReadout locale={locale} review={{...review,revision:saved.revision,state:'draft',narrative:saved.narrative}}/></details>)}{data?.hasMore&&<button type="button" disabled={busy} onClick={()=>void load(true)}>{r.more}</button>}</details>;
}
export function ReportReadout({ locale, review }: { locale: Locale; review: Review }) { const t = words[locale], n = review.narrative; const sections = [[t.taught,n.taughtAndPractised],[t.observations,n.practitionerObservations],[locale === "he" ? "דיווחי הורים מיוחסים" : "Attributed parent reports",n.parentReportedExamples],[t.useful,n.usefulChanges],[t.difficulty,n.continuingDifficulty],[t.uncertainty,[n.uncertainty]],[t.next,[n.nextAdjustment]],[t.limits,[n.informationLimits]]] as const; return <article className="lsw-card"><h2>{review.periodStart}–{review.periodEnd} · {review.state === "published" ? t.published : t.draft}</h2><p>{t.attended}: {review.attendedSessionCount}</p>{sections.filter(([,values]) => values.length).map(([label,values]) => <section key={label}><h3>{label}</h3>{values.map((text,index) => <p key={index}>{text}</p>)}</section>)}</article>; }
