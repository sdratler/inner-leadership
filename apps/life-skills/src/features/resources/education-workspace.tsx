"use client";
import Link from "next/link";
import styles from "./education-workspace.module.css";
import {usePathname,useRouter} from "next/navigation";
import {useEffect,useRef,useState,type MouseEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {FishingLessonCard} from "./fishing-lesson-card.tsx";
import {educationSearch,type EducationSection} from "./education-query.ts";
import {LessonClientError,pendingLessonOperation,readEducationLesson,saveEducationLesson,type EducationRole,type LessonCommand,type PendingLessonOperation} from "./education-client.ts";
import type {LessonReference,LessonLearnerRead,LessonTeacherRead,LessonParentRead} from "./fishing-lesson-journey.ts";
type Data=LessonLearnerRead|LessonTeacherRead|LessonParentRead;
const isTeacher=(value:Data):value is LessonTeacherRead=>"observations"in value&&"summaryRecipients"in value&&Array.isArray(value.observations)&&Array.isArray(value.summaryRecipients);
type Assistance=Extract<LessonCommand,{action:"observe"}>["assistance"];
type DraftSection="lesson"|"review"|"publication";
const copy={
 en:{home:"Home",materials:"Materials & exercises",title:"Lesson workspace",lesson:"Lesson",portfolio:"Published summary",review:"Teacher review",publication:"Publish summary",tabs:"Lesson views",
  loading:"Loading authorized lesson…",reload:"Reload lesson",failed:"The lesson could not be loaded. Your draft is retained. Reload to try again.",forbidden:"This action cannot be authorized. Reload access before making changes.",signin:"Sign in",ended:"Your session ended. Sign in again to confirm authorized access.",invalid:"Check the required fields and try again.",large:"This response is too large. Shorten the text and try again.",
  conflict:"The lesson changed. Your draft is retained. Reload and review the current version before saving.",useVersion:"Use the current version and keep my draft",uncertain:"The save result is unknown. Keep this page open and retry the same operation to confirm it.",retry:"Retry the same operation",saved:"Saved in the app. No message was sent.",confirmed:"The previously saved operation is confirmed. No duplicate was created.",
  parentHelp:"Practice together and record parent-assisted work. This is not a child account or activity clearance.",teacherHelp:"Private observations stay private. A parent receives only a summary you deliberately publish.",
  submitted:"Submitted learner work",noSubmission:"No work has been submitted for this lesson.",observations:"Previous private observations",knowledge:"Knowledge assessment",knowledgeNotRecorded:"Knowledge assessment not recorded",knowledgeNotAssessed:"Not assessed",knowledgeRecorded:"Record a factual assessment",knowledgeText:"Factual knowledge assessment",task:"Observed task",assistance:"Assistance",choose:"Choose assistance",notObserved:"Not observed",guidance:"With guidance",independent:"Independent",noteDetails:"Optional private note",privateNote:"Private teacher note",saveObservation:"Save private observation",
  summary:"Parent-safe summary",recipients:"Authorized parent recipients",noRecipients:"No eligible parent recipient is currently available for this lesson.",needObservation:"Review the current submission before publishing a summary.",publish:"Publish selected summary",privacy:"Do not include private teacher notes or answer keys. Publication is in-app only.",emptyPortfolio:"No summary has been published for you for this lesson.",published:"Published",source:"Source version",
  leaveTitle:"Leave unsaved work?",leaveHelp:"Your unsaved draft will be lost. Leaving does not undo a save whose result is unknown.",stay:"Stay here",leave:"Leave",working:"Saving…"},
 he:{home:"בית",materials:"חומרים ותרגילים",title:"מרחב השיעור",lesson:"שיעור",portfolio:"סיכום שפורסם",review:"עיון המדריך",publication:"פרסום סיכום",tabs:"תצוגות השיעור",
  loading:"טעינת שיעור מורשה…",reload:"טעינת השיעור מחדש",failed:"לא ניתן לטעון את השיעור. הטיוטה נשמרת במסך. טענו מחדש לניסיון נוסף.",forbidden:"לא ניתן לאשר פעולה זו. טענו מחדש את ההרשאות לפני שינוי.",signin:"כניסה",ended:"הכניסה פגה. היכנסו שוב כדי לאמת הרשאה.",invalid:"בדקו את שדות החובה ונסו שוב.",large:"התשובה ארוכה מדי. קצרו את הטקסט ונסו שוב.",
  conflict:"השיעור השתנה. הטיוטה נשמרת במסך. טענו ועיינו בגרסה הנוכחית לפני שמירה.",useVersion:"שימוש בגרסה הנוכחית תוך שמירת הטיוטה",uncertain:"תוצאת השמירה אינה ידועה. השאירו מסך זה פתוח ונסו שוב את אותה פעולה כדי לאמת אותה.",retry:"ניסיון נוסף לאותה פעולה",saved:"נשמר במערכת. לא נשלחה הודעה.",confirmed:"הפעולה שנשמרה אומתה. לא נוצרה כפילות.",
  parentHelp:"תרגלו יחד ותעדו עבודה בסיוע ההורה. אין בכך חשבון ילד או אישור לפעילות.",teacherHelp:"תצפיות פרטיות נשארות פרטיות. הורה יקבל רק סיכום שתפרסמו במכוון.",
  submitted:"עבודה שהוגשה",noSubmission:"טרם הוגשה עבודה לשיעור זה.",observations:"תצפיות פרטיות קודמות",knowledge:"הערכת ידע",knowledgeNotRecorded:"לא נרשמה הערכת ידע",knowledgeNotAssessed:"טרם הוערך",knowledgeRecorded:"רישום הערכה עובדתית",knowledgeText:"הערכת ידע עובדתית",task:"המשימה שנצפתה",assistance:"סיוע",choose:"בחירת סיוע",notObserved:"לא נצפה",guidance:"עם הנחיה",independent:"עצמאי",noteDetails:"הערה פרטית אופציונלית",privateNote:"הערת מדריך פרטית",saveObservation:"שמירת תצפית פרטית",
  summary:"סיכום המתאים להורה",recipients:"הורים מורשים לקבלת הסיכום",noRecipients:"אין כרגע הורה בעל הרשאה מתאימה לקבלת סיכום השיעור.",needObservation:"יש לעיין בהגשה הנוכחית לפני פרסום סיכום.",publish:"פרסום הסיכום שנבחר",privacy:"אין לכלול הערות מדריך פרטיות או תשובות מוגנות. הפרסום הוא במערכת בלבד.",emptyPortfolio:"טרם פורסם עבורכם סיכום לשיעור זה.",published:"פורסם",source:"גרסת מקור",
  leaveTitle:"לצאת בלי לשמור?",leaveHelp:"הטיוטה שלא נשמרה תאבד. יציאה אינה מבטלת שמירה שתוצאתה אינה ידועה.",stay:"להישאר כאן",leave:"יציאה",working:"שמירה…"},
}as const;
export function EducationWorkspace({locale,role,reference,section}:{locale:Locale;role:EducationRole;reference:LessonReference;section:EducationSection}){
 const w=copy[locale],router=useRouter(),pathname=usePathname(),root=role==="parent"?"family":"app";
 const sections:EducationSection[]=role==="parent"?["lesson","portfolio"]:["review","publication"];
 const view=role==="practitioner"?"teacher":section==="portfolio"?"parent":"learner",refKey=JSON.stringify(reference);
 const [storedData,setData]=useState<Data|null>(null),[loadedKey,setLoadedKey]=useState<string|null>(null),[revision,setRevision]=useState(0),[editRevision,setEditRevision]=useState<string|null>(null);
 const [answers,setAnswers]=useState<Record<string,string>>({}),[task,setTask]=useState(""),[assistance,setAssistance]=useState<Assistance|"">(""),[privateNote,setPrivateNote]=useState(""),[summary,setSummary]=useState(""),[recipients,setRecipients]=useState<string[]>([]);
 const [knowledgeState,setKnowledgeState]=useState<"not_assessed"|"recorded">("not_assessed"),[knowledgeText,setKnowledgeText]=useState("");
 const [draftDirty,setDraftDirty]=useState({lesson:false,review:false,publication:false}),draftDirtyRef=useRef(draftDirty),dirtyRef=useRef(false);
 const dirty=Object.values(draftDirty).some(Boolean),[busy,setBusy]=useState(false),[pending,setPending]=useState<PendingLessonOperation|null>(null);
 const pendingRef=useRef<PendingLessonOperation|null>(null),pendingScope=useRef<DraftSection>("lesson"),sendingRef=useRef(false);
 const [failureState,setFailureState]=useState<{key:string;error:LessonClientError}|null>(null),[status,setStatus]=useState(""),[leaveTarget,setLeaveTarget]=useState<string|null>(null);
 const requestKey=JSON.stringify([refKey,view,role,section,revision]);
 const error=failureState?.key===requestKey?failureState.error:null,data=loadedKey===requestKey?storedData:null,loading=loadedKey!==requestKey&&!error;
 const setError=(failure:LessonClientError|null)=>setFailureState(failure?{key:requestKey,error:failure}:null);
 const stayRef=useRef<HTMLButtonElement>(null),leaveOrigin=useRef<HTMLAnchorElement|null>(null),tabs=useRef<(HTMLButtonElement|null)[]>([]);
 function scopeDirty(scope:DraftSection,value:boolean){const next={...draftDirtyRef.current,[scope]:value};draftDirtyRef.current=next;dirtyRef.current=Object.values(next).some(Boolean);setDraftDirty(next);}
 const markDirty=(scope:DraftSection)=>{scopeDirty(scope,true);setStatus("");};
 function clearPrivate(){setData(null);setAnswers({});setTask("");setPrivateNote("");setKnowledgeState("not_assessed");setKnowledgeText("");setSummary("");setRecipients([]);setPending(null);pendingRef.current=null;setStatus("");dirtyRef.current=false;const clean={lesson:false,review:false,publication:false};draftDirtyRef.current=clean;setDraftDirty(clean);}
 useEffect(()=>{
  const abort=new AbortController();
  void readEducationLesson(JSON.parse(refKey)as LessonReference,view,role,abort.signal).then(value=>{
   if(abort.signal.aborted)return;setData(value);setLoadedKey(requestKey);
   if("revisionId"in value&&!dirtyRef.current)setEditRevision(value.revisionId);
   if("submission"in value&&view==="learner"&&!dirtyRef.current)setAnswers(Object.fromEntries((("draft"in value&&value.draft)?value.draft.answers:value.submission?.answers??[]).map(a=>[a.questionId,a.value])));
   if("summaryRecipients"in value)setRecipients(old=>old.filter(id=>value.summaryRecipients.some(parent=>parent.accountId===id)));
  }).catch(cause=>{if(abort.signal.aborted)return;const failure=cause instanceof LessonClientError?cause:new LessonClientError("UNAVAILABLE");
   if(failure.code==="UNAUTHENTICATED"||failure.code==="FORBIDDEN")clearPrivate();setLoadedKey(requestKey);setFailureState({key:requestKey,error:failure});});
  return()=>abort.abort();
 },[refKey,view,role,requestKey]);
 useEffect(()=>{if(!dirty&&!pending)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty,pending]);
 useEffect(()=>{if(leaveTarget)stayRef.current?.focus();},[leaveTarget]);
 useEffect(()=>{const index=role==="parent"?(section==="lesson"?0:1):(section==="review"?0:1);tabs.current[index]?.scrollIntoView({block:"nearest",inline:"nearest"});},[section,role]);
 const locked=busy||pending!==null||leaveTarget!==null,teacherData=data&&isTeacher(data)?data:null,learnerData=data&&"lesson"in data?data:null;
 const savedDraft=learnerData&&"draft"in learnerData?learnerData.draft:null;
 const currentObservation=teacherData?.observations.at(-1),canPublish=currentObservation?.command.action==="observe"&&currentObservation.command.submissionId===teacherData?.submission?.revisionId;
 const message=error?.uncertain?w.uncertain:error?.code==="UNAUTHENTICATED"?w.ended:error?.code==="FORBIDDEN"?w.forbidden:error?.code==="CONFLICT"?w.conflict:error?.code==="INVALID_REQUEST"?w.invalid:error?.code==="PAYLOAD_TOO_LARGE"?w.large:w.failed;
 const time=(value:string)=>new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{timeZone:"Asia/Jerusalem",dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
 async function send(operation:PendingLessonOperation){
  if(sendingRef.current)return;sendingRef.current=true;
  setBusy(true);setError(null);setStatus("");
  try{const result=await saveEducationLesson(operation,role);setPending(null);pendingRef.current=null;scopeDirty(pendingScope.current,false);setEditRevision(result.revisionId);setStatus(result.duplicate?w.confirmed:w.saved);setRevision(n=>n+1);}
  catch(cause){const failure=cause instanceof LessonClientError?cause:new LessonClientError("UNAVAILABLE",true);
   if(failure.code==="UNAUTHENTICATED")clearPrivate();else if(!failure.uncertain){
    if(failure.code==="FORBIDDEN")setData(null); // Retain hidden drafts until a fresh authorized read; a recipient may have been withdrawn.
    setPending(null);pendingRef.current=null;
   }
   setError(failure);
  }finally{sendingRef.current=false;setBusy(false);}
 }
 function save(command:LessonCommand){
  if(locked||pendingRef.current||sendingRef.current)return;try{const operation=pendingLessonOperation(reference,command);pendingScope.current=command.action==="submit"||command.action==="save_draft"?"lesson":command.action==="observe"?"review":"publication";pendingRef.current=operation;setPending(operation);void send(operation);}
  catch(cause){setError(cause instanceof LessonClientError?cause:new LessonClientError("INVALID_REQUEST"));}
 }
 const sectionLabel=(value:EducationSection)=>w[value];
 function changeSection(next:EducationSection){if(!locked&&sections.includes(next)){setError(null);router.push(pathname+"?"+educationSearch(reference,next),{scroll:false});}}
 function leaving(event:MouseEvent<HTMLAnchorElement>,href:string){if(dirty||pending){event.preventDefault();leaveOrigin.current=event.currentTarget;setLeaveTarget(href);}}
 return <section className={`lsw-stack lsw-feature-page ${styles.frame}`} lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <nav aria-label={locale==="he"?"מיקום השיעור":"Lesson location"}>
   <ol className={styles.breadcrumb}>
    <li><Link href={`/${locale}/${root}/resources`} onClick={event=>leaving(event,`/${locale}/${root}/resources`)}>{w.materials}</Link></li>
    <li aria-hidden>›</li><li aria-current="page"><bdi>{reference.moduleId}</bdi></li>
   </ol>
  </nav>
  <header><h1>{w.title}</h1><p><bdi>{reference.moduleId} · {reference.version}</bdi></p><p>{role==="parent"?w.parentHelp:w.teacherHelp}</p></header>
  <div role="tablist" aria-label={w.tabs} className={styles.tabs}>
   {sections.map((tab,i)=><button key={tab} id={`education-tab-${tab}`} role="tab" aria-selected={section===tab} aria-controls="education-panel" tabIndex={section===tab?0:-1}
    className={`lsw-button ${styles.tab}${section===tab?" lsw-button--primary":""}`} disabled={locked}
    ref={node=>{tabs.current[i]=node;}} onClick={()=>changeSection(tab)} onKeyDown={event=>{
     if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();
     const delta=(event.key==="ArrowRight"?1:-1)*(locale==="he"?-1:1),next=event.key==="Home"?0:event.key==="End"?sections.length-1:(i+delta+sections.length)%sections.length;
     tabs.current[next]?.focus();changeSection(sections[next]!);
    }}>{sectionLabel(tab)}</button>)}
  </div>
  {leaveTarget&&<div role="alert" className="lsw-card"><h2>{w.leaveTitle}</h2><p>{w.leaveHelp}</p>
   <button className="lsw-button" ref={stayRef} onClick={()=>{setLeaveTarget(null);leaveOrigin.current?.focus();}}>{w.stay}</button>
   <button className="lsw-button" onClick={()=>{clearPrivate();router.push(leaveTarget);}}>{w.leave}</button></div>}
  {error&&<div role="alert" className="lsw-card"><p>{message}</p>
   {error.code==="UNAUTHENTICATED"?<Link href={`/${locale}/login?next=${encodeURIComponent(pathname+"?"+educationSearch(reference,section))}`}>{w.signin}</Link>
    :error.uncertain&&pending?<button className="lsw-button" disabled={busy} onClick={()=>void send(pending)}>{w.retry}</button>
    :<button className="lsw-button" disabled={busy} onClick={()=>{setError(null);setRevision(n=>n+1);}}>{w.reload}</button>}
  </div>}
  {status&&<p role="status">{status}</p>}
  {loading?<p role="status">{w.loading}</p>:data&&<div id="education-panel" role="tabpanel" aria-labelledby={`education-tab-${section}`} className="lsw-card">
   {dirty&&"revisionId"in data&&editRevision!==data.revisionId&&!pending&&<div role="alert"><p>{w.conflict}</p><button className="lsw-button" onClick={()=>{setEditRevision(data.revisionId);setError(null);}}>{w.useVersion}</button></div>}
   {role==="parent"&&section==="lesson"&&learnerData&&<FishingLessonCard locale={locale} lesson={learnerData.lesson} answers={answers} busy={locked} canSubmit={draftDirty.lesson||Boolean(savedDraft)} canSaveDraft={draftDirty.lesson} draftSaved={Boolean(savedDraft)&&!draftDirty.lesson} saved={Boolean(learnerData.submission)&&!savedDraft&&!draftDirty.lesson}
    onAnswer={(id,value)=>{setAnswers(old=>({...old,[id]:value}));markDirty("lesson");}}
    onSaveDraft={()=>{if(!draftDirty.lesson)return;save({action:"save_draft",operationId:crypto.randomUUID(),expectedRevisionId:editRevision,answers:learnerData.lesson.questions.map(q=>({questionId:q.id,value:answers[q.id]??""}))});}}
    onSubmit={()=>{if(!draftDirty.lesson&&!savedDraft)return;save({action:"submit",operationId:crypto.randomUUID(),expectedRevisionId:editRevision,answers:learnerData.lesson.questions.map(q=>({questionId:q.id,value:answers[q.id]??""}))});}}/>}
   {role==="parent"&&section==="portfolio"&&"portfolio"in data&&<><h2>{w.portfolio}</h2>{data.portfolio?<>
    <p className={styles.text}>{data.portfolio.summary}</p><p>{w.published}: <bdi>{time(data.portfolio.publishedAt)}</bdi></p><details><summary>{w.source}</summary><bdi>{data.version} · {data.portfolio.sourceSha256}</bdi></details>
   </>:<p>{w.emptyPortfolio}</p>}</>}
   {role==="practitioner"&&section==="review"&&teacherData&&<><h2>{w.review}</h2>
    {teacherData.submission?<><details><summary>{w.submitted}</summary><dl>{teacherData.submission.answers.map(a=><div key={a.questionId}><dt><bdi>{a.questionId}</bdi></dt><dd className={styles.text}>{a.value}</dd></div>)}</dl><bdi>{time(teacherData.submission.submittedAt)}</bdi></details>
     <form className={styles.fields} onSubmit={event=>{event.preventDefault();if(!teacherData.submission||!assistance)return;save({action:"observe",operationId:crypto.randomUUID(),expectedRevisionId:editRevision,submissionId:teacherData.submission.revisionId,task,assistance,...(privateNote.trim()?{privateNote}:{}),knowledgeAssessment:knowledgeState==="recorded"?{state:"recorded",assessment:knowledgeText}:{state:"not_assessed"}});}}>
      <fieldset disabled={locked} className={styles.fields}><div className="lsw-field"><label htmlFor="education-knowledge-state">{w.knowledge}</label><select id="education-knowledge-state" className="lsw-input" value={knowledgeState} onChange={e=>{setKnowledgeState(e.target.value as "not_assessed"|"recorded");markDirty("review");}}><option value="not_assessed">{w.knowledgeNotAssessed}</option><option value="recorded">{w.knowledgeRecorded}</option></select></div>
       {knowledgeState==="recorded"&&<div className="lsw-field"><label htmlFor="education-knowledge-text">{w.knowledgeText}</label><textarea id="education-knowledge-text" className="lsw-input" required maxLength={2000} value={knowledgeText} onChange={e=>{setKnowledgeText(e.target.value);markDirty("review");}}/></div>}
       <div className="lsw-field"><label htmlFor="education-task">{w.task}</label><textarea id="education-task" className="lsw-input" required maxLength={2000} value={task} onChange={e=>{setTask(e.target.value);markDirty("review");}}/></div>
       <div className="lsw-field"><label htmlFor="education-assistance">{w.assistance}</label><select id="education-assistance" className="lsw-input" required value={assistance} onChange={e=>{setAssistance(e.target.value as Assistance|"");markDirty("review");}}><option value="">{w.choose}</option><option value="not_observed">{w.notObserved}</option><option value="with_guidance">{w.guidance}</option><option value="independent">{w.independent}</option></select></div>
       <details><summary>{w.noteDetails}</summary><div className="lsw-field"><label htmlFor="education-private-note">{w.privateNote}</label><textarea id="education-private-note" className="lsw-input" maxLength={2000} value={privateNote} onChange={e=>{setPrivateNote(e.target.value);markDirty("review");}}/></div></details>
       <button className="lsw-button lsw-button--primary" type="submit" disabled={!draftDirty.review}>{busy?w.working:w.saveObservation}</button></fieldset>
     </form></>:<p>{w.noSubmission}</p>}
    <details><summary>{w.observations}</summary>{teacherData.observations.map(event=><article key={event.id}><bdi>{time(event.at)}</bdi>{event.command.action==="observe"&&<><p className={styles.text}><strong>{w.knowledge}: </strong>{event.command.knowledgeAssessment?.state==="recorded"?event.command.knowledgeAssessment.assessment:event.command.knowledgeAssessment?.state==="not_assessed"?w.knowledgeNotAssessed:w.knowledgeNotRecorded}</p><p>{event.command.task}</p><p>{event.command.assistance==="with_guidance"?w.guidance:event.command.assistance==="independent"?w.independent:w.notObserved}</p>{event.command.privateNote&&<p className={styles.text}>{event.command.privateNote}</p>}</>}</article>)}</details>
   </>}
   {role==="practitioner"&&section==="publication"&&teacherData&&<><h2>{w.publication}</h2><p>{w.privacy}</p>{!canPublish&&<p>{w.needObservation}</p>}
    <form className={styles.fields} onSubmit={event=>{event.preventDefault();if(!currentObservation||!canPublish)return;save({action:"publish_parent_summary",operationId:crypto.randomUUID(),expectedRevisionId:editRevision,observationId:currentObservation.id,summary,parentAccountIds:recipients});}}>
     <fieldset disabled={locked||!canPublish} className={styles.fields}><div className="lsw-field"><label htmlFor="education-summary">{w.summary}</label><textarea id="education-summary" className="lsw-input" required maxLength={2000} value={summary} onChange={e=>{setSummary(e.target.value);markDirty("publication");}}/></div>
      <fieldset><legend>{w.recipients}</legend>{teacherData.summaryRecipients.length?teacherData.summaryRecipients.map(parent=><label className={`lsw-choice ${styles.choice}`} key={parent.accountId}><input type="checkbox" checked={recipients.includes(parent.accountId)} onChange={e=>{setRecipients(old=>e.target.checked?[...old,parent.accountId]:old.filter(id=>id!==parent.accountId));markDirty("publication");}}/><bdi>{parent.label}</bdi></label>):<p>{w.noRecipients}</p>}</fieldset>
      <button className="lsw-button lsw-button--primary" type="submit" disabled={!recipients.length||!draftDirty.publication}>{busy?w.working:w.publish}</button></fieldset>
    </form></>}
  </div>}
 </section>;
}
