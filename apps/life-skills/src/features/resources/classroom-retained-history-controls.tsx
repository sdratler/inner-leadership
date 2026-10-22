"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo,IdentityClientError} from "../identity/client.ts";
import {classroomFamilyRetainedHistoryPath,classroomFamilyRetainedHistoryRequestSchema,classroomFamilyRetainedHistoryReviewSchema,classroomRetainedHistoryPayloadSchema,type ClassroomFamilyRetainedHistoryReview,type ClassroomRetainedHistoryPayload} from "./classroom-family-retained-history-contract.ts";
class HistoryRequestError extends Error{constructor(readonly status:number){super("CLASSROOM_HISTORY_REQUEST_FAILED");}}
type Props={applicationId:string;stageId:string;locale:Locale;withdrawalOperationId?:string|undefined;disabled?:boolean;onLockedChange?:(locked:boolean)=>void;denied?:((status:number)=>void)|undefined};
/** Display only: no draft, publication, export, deletion or access-restoration. */
export function ClassroomRetainedHistoryView({history,locale}:{history:ClassroomRetainedHistoryPayload;locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <article data-classroom-retained-content><h4>{history.lesson.title}</h4><p>{t("Saved submitted work and instructor observations. Read only; family classroom access remains ended.","עבודות שנשלחו ותצפיות מדריך שמורות. לקריאה בלבד; גישת המשפחה לכיתה נשארת סגורה.")}</p>
  {history.submission?<section><h5>{t("Submitted answers","תשובות שנשלחו")}</h5><time dateTime={history.submission.submittedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(history.submission.submittedAt))}</time><dl>{history.submission.answers.map(answer=><div key={answer.questionId}><dt>{history.lesson.questions.find(q=>q.id===answer.questionId)?.prompt??answer.questionId}</dt><dd style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{answer.value}</dd></div>)}</dl></section>:<p>{t("No submitted answers were saved.","לא נשמרו תשובות שנשלחו.")}</p>}
  <h5>{t("Instructor observations","תצפיות מדריך")}</h5>{history.observations.length===0?<p>{t("No observations were saved.","לא נשמרו תצפיות.")}</p>:<ul>{history.observations.map(o=><li key={o.revisionId}><time dateTime={o.recordedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(o.recordedAt))}</time><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{o.task}</p><p>{t("Assistance","סיוע")}: {o.assistance==="independent"?t("Independent","עצמאי"):o.assistance==="with_guidance"?t("With guidance","עם הכוונה"):t("Not observed","לא נצפה")}</p>{o.privateNote&&<p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{t("Private instructor note","הערת מדריך פרטית")}: {o.privateNote}</p>}{o.knowledgeAssessment&&<p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{t("Knowledge assessment","הערכת ידע")}: {o.knowledgeAssessment.state==="recorded"?o.knowledgeAssessment.assessment:t("Not assessed","לא הוערך")}</p>}</li>)}</ul>}
 </article>;
}
export function ClassroomRetainedHistoryControls({applicationId,stageId,locale,withdrawalOperationId,disabled=false,onLockedChange,denied}:Props){
 const t=(en:string,he:string)=>locale==="he"?he:en,[operation,setOperation]=useState(withdrawalOperationId??""),[review,setReview]=useState<ClassroomFamilyRetainedHistoryReview|null>(null),[selection,setSelection]=useState(""),[history,setHistory]=useState<ClassroomRetainedHistoryPayload|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),epoch=useRef(0),controller=useRef<AbortController|null>(null),scope=JSON.stringify([applicationId,stageId,operation,selection]);
 const currentScope=useRef(scope);
 const invalidate=useCallback(()=>{epoch.current++;controller.current?.abort();},[]);
 useLayoutEffect(()=>{currentScope.current=scope;return invalidate;},[scope,invalidate]);
 const clear=()=>{invalidate();controller.current=null;setHistory(null);setError(false);};
 useEffect(()=>{onLockedChange?.(busy);return()=>onLockedChange?.(false);},[busy,onLockedChange]);
 useEffect(()=>invalidate,[invalidate]);
 // Parent keys by application/stage. This additional binding prevents even a
 // render before effect cleanup from displaying content for changed props.
 const [shownScope,setShownScope]=useState("");
 const send=async(action:"review"|"read")=>{
  if(busy||disabled)return;clear();const id=epoch.current,key=currentScope.current,abort=new AbortController();controller.current=abort;setBusy(true);
  const active=()=>epoch.current===id&&currentScope.current===key&&!abort.signal.aborted;
  try{
   const lesson=review?.children.flatMap(c=>c.lessons.map(l=>({...l,learnerId:c.learnerId}))).find(r=>JSON.stringify(r)===selection),request=classroomFamilyRetainedHistoryRequestSchema.parse({action,applicationId,stageId,withdrawalOperationId:operation,...action==="read"?{reference:lesson}:{}}),session=await sessionInfo();
   if(!active())return;const response=await fetch(classroomFamilyRetainedHistoryPath,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:abort.signal,headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(request)}),body=await response.json() as {ok:boolean;data:unknown};if(!active())return;
   if(!response.ok||body.ok!==true)throw new HistoryRequestError(response.status);
   if(action==="review"){
    const next=classroomFamilyRetainedHistoryReviewSchema.parse(body.data);if(next.applicationId!==applicationId||next.stageId!==stageId||next.withdrawalOperationId!==operation)throw new Error("HISTORY_SCOPE_MISMATCH");setReview(next);setSelection("");
   }else{
    const next=classroomRetainedHistoryPayloadSchema.parse(body.data);if(next.withdrawalOperationId!==operation||JSON.stringify(next.reference)!==JSON.stringify(request.action==="read"?request.reference:null))throw new Error("HISTORY_REFERENCE_MISMATCH");setHistory(next);setShownScope(key);
   }
  }catch(e){if(!active())return;setHistory(null);setError(true);if(e instanceof HistoryRequestError&&[401,403].includes(e.status)||e instanceof IdentityClientError&&["UNAUTHENTICATED","FORBIDDEN"].includes(e.code)){setReview(null);setSelection("");setOperation("");denied?.(e instanceof HistoryRequestError?e.status:e instanceof IdentityClientError&&e.code==="UNAUTHENTICATED"?401:403);}}
  finally{if(epoch.current===id){setBusy(false);controller.current=null;}}
 };
 const submit=(e:FormEvent)=>{e.preventDefault();void send("review");};
 return <section className="lsw-card" data-classroom-retained-history aria-label={t("Retained classroom history","היסטוריית כיתה שמורה")}><h3>{t("Read retained classroom history","קריאת היסטוריית כיתה שמורה")}</h3><p>{t("Use the saved family withdrawal reference. Only the original children and lessons still verified for this group can be read. This does not restore family access or confirm a Drive archive.","השתמשו במזהה השמור של סיום גישת המשפחה. ניתן לקרוא רק את הילדים והשיעורים המקוריים שעדיין מאומתים לקבוצה זו. פעולה זו אינה מחזירה את גישת המשפחה ואינה מאשרת ארכיון ב־Drive.")}</p>
  <form onSubmit={submit}><fieldset className="lsw-fieldset" disabled={busy||disabled}><label className="lsw-field">{t("Saved family withdrawal reference","מזהה שמור של סיום גישת המשפחה")}<input className="lsw-input" required value={operation} onChange={e=>{clear();setOperation(e.target.value.trim());setReview(null);setSelection("");}} autoComplete="off" maxLength={36}/></label><button type="submit" className="lsw-button lsw-button--secondary">{t("Read available children and lessons","קריאת הילדים והשיעורים הזמינים")}</button></fieldset></form>
  {review&&review.applicationId===applicationId&&review.stageId===stageId&&review.withdrawalOperationId===operation&&<label className="lsw-field">{t("Choose saved work","בחירת עבודה שמורה")}<select className="lsw-input" disabled={busy||disabled} value={selection} onChange={e=>{clear();setSelection(e.target.value);}}><option value="">{t("Choose a child and lesson","בחרו ילד ושיעור")}</option>{review.children.flatMap(child=>child.lessons.map(lesson=><option key={child.learnerId+lesson.moduleId+lesson.version} value={JSON.stringify({...lesson,learnerId:child.learnerId})}>{child.displayName} · {lesson.moduleId} · {lesson.version}</option>))}</select></label>}
  {selection&&<button type="button" className="lsw-button" disabled={busy||disabled} onClick={()=>void send("read")}>{t("Read saved submission and observations","קריאת ההגשה והתצפיות השמורות")}</button>}
  {busy&&<p role="status">{t("Reading verified saved history…","קורא היסטוריה שמורה מאומתת…")}</p>}{error&&<p role="alert">{t("History could not be verified. Read the current choices again; access may have changed.","לא ניתן לאמת את ההיסטוריה. קראו שוב את האפשרויות העדכניות; ייתכן שהגישה השתנתה.")}</p>}
  {history&&shownScope===scope&&<ClassroomRetainedHistoryView history={history} locale={locale}/>}
 </section>;
}
