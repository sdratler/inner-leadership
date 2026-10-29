"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import type {BnaInquiryStore} from "./store.ts";
import {bnaFollowupCommandSchema,type BnaFollowupCommand} from "./contract.ts";

type Page=Awaited<ReturnType<BnaInquiryStore["list"]>>;
type Detail=Awaited<ReturnType<BnaInquiryStore["read"]>>;
class RequestError extends Error{constructor(readonly status:number){super("BNA_INQUIRY_REQUEST_FAILED");}}
async function get<T>(id?:string,before?:string):Promise<T>{
 const query=id?new URLSearchParams({id}):before?new URLSearchParams({before}):null;
 const response=await fetch("/api/private/bna-inquiries"+(query?"?"+query:""),
  {credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw new RequestError(response.status);
 return body.data as T;
}
/** Add this section to the existing People route. No separate CRM or identity. */
export function BnaInquiryOwnerPanel({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [page,setPage]=useState<Page|null>(null),[detail,setDetail]=useState<Detail|null>(null);
 const [error,setError]=useState<number|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[loadingMore,setLoadingMore]=useState(false);
 const [pending,setPending]=useState<BnaFollowupCommand|null>(null),[status,setStatus]=useState<"new"|"contacted"|"waiting"|"closed">("new");
 const [note,setNote]=useState(""),[nextAction,setNextAction]=useState(""),[dueDate,setDueDate]=useState(""),[waiting,setWaiting]=useState("");
 const serial=useRef(0),active=useRef(true);
 const clearPrivate=useCallback(()=>{setPage(null);setDetail(null);setPending(null);setNote("");setNextAction("");setWaiting("");},[]);
 const load=useCallback(async(before?:string)=>{const n=++serial.current;if(before)setLoadingMore(true);
  try{const value=await get<Page>(undefined,before);if(active.current&&serial.current===n){setPage(current=>before&&current&&current.nextCursor===before?{...value,items:[...new Map([...current.items,...value.items].map(item=>[item.id,item])).values()]}:before?current:value);setError(null);}}
  catch(cause){if(active.current&&serial.current===n){const code=cause instanceof RequestError?cause.status:503;setError(code);
   if([401,403,404].includes(code))clearPrivate();}}finally{if(active.current&&before)setLoadingMore(false);}
 },[clearPrivate]);
 const open=useCallback(async(id:string)=>{const n=++serial.current;
  try{const value=await get<Detail>(id);if(!active.current||serial.current!==n)return;
   setDetail(value);setError(null);setStatus(value.followup.status);setNote("");setNextAction(value.followup.nextAction??"");
   setDueDate(value.followup.dueDate??"");setWaiting(value.followup.waitingCondition??"");}
  catch(cause){if(active.current&&serial.current===n){const code=cause instanceof RequestError?cause.status:503;setError(code);
   if([401,403,404].includes(code))clearPrivate();}}
 },[clearPrivate]);
 useEffect(()=>{active.current=true;const timer=window.setTimeout(()=>void load(),0);
  return()=>{window.clearTimeout(timer);active.current=false;};},[load]);
 async function save(command:BnaFollowupCommand){
  if(busy)return;setBusy(true);setError(null);setMessage("");setPending(command);
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new RequestError(403);
   const response=await fetch("/api/private/bna-inquiries",{method:"POST",credentials:"same-origin",cache:"no-store",
    redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},
    body:JSON.stringify(command)});
   const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw new RequestError(response.status);
   setPending(null);await load();await open(command.inquiryId);setMessage(t("Follow-up saved.","המעקב נשמר."));
  }catch(cause){const code=cause instanceof RequestError?cause.status:503;setError(code);
   if([400,401,403,404,409].includes(code))setPending(null);
   if([401,403,404].includes(code))clearPrivate();
  }finally{setBusy(false);}
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!detail||pending)return;
  const parsed=bnaFollowupCommandSchema.safeParse({operationId:crypto.randomUUID(),inquiryId:detail.id,
   expectedVersion:detail.followup.version,status,note,nextAction:nextAction.trim()||null,dueDate:dueDate||null,
   waitingCondition:waiting.trim()||null});
  if(!parsed.success){setError(400);return;}void save(parsed.data);
 }
 if(error===404)return null;
 return <section className="lsw-card" lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-label={t("BNA Torah inquiries","פניות לתוכנית התורה של בני נביאים")}>
  <h2>{t("BNA Torah inquiries","פניות לתוכנית התורה של בני נביאים")}</h2>
  <p>{t("Separate from Fishing. An inquiry is not enrollment or a booked place.","נפרד מתוכנית הדיג. פנייה אינה הרשמה או שמירת מקום.")}</p>
  {error!==null&&<div role="alert" className="lsw-alert"><p>{error===401?t("Sign in again to view inquiries.","יש להיכנס מחדש כדי לצפות בפניות."):
   error===403?t("This account cannot view BNA inquiries.","לחשבון זה אין גישה לפניות בני נביאים."):
   error===409?t("This inquiry changed. Reload it before saving.","הפנייה השתנתה. יש לרענן לפני שמירה."):
   error===400?t("Add a note and either a dated next action or a waiting condition.","יש להוסיף הערה ופעולה הבאה עם תאריך או תנאי המתנה."):
   t("Inquiries could not be read. Saved records have not been shown as an empty list.","לא ניתן לקרוא את הפניות. רשומות שמורות אינן מוצגות כרשימה ריקה.")}</p>
   {error===401?<a href={`/${locale}/login`}>{t("Sign in","כניסה")}</a>:<button type="button" onClick={()=>void load()}>{t("Retry read","ניסיון קריאה נוסף")}</button>}</div>}
  {message&&<p role="status">{message}</p>}
  {pending&&!busy&&<div role="status" className="lsw-alert"><p>{t("Save outcome unknown. Retry the same operation.","תוצאת השמירה אינה ידועה. יש לנסות שוב את אותה פעולה.")}</p>
   <button type="button" onClick={()=>void save(pending)}>{t("Retry same save","ניסיון חוזר לאותה שמירה")}</button></div>}
  {!page&&error===null&&<p role="status">{t("Loading BNA inquiries…","טוען את פניות בני נביאים…")}</p>}
  {page&&<div className="lsw-stack"><p>{page.items.length===0?t("No BNA inquiries saved yet.","עדיין לא נשמרו פניות לבני נביאים."):
   t(`${page.items.length} inquiries shown`,`${page.items.length} פניות מוצגות`)}</p>
   <ul>{page.items.map(item=><li key={item.id}><button type="button" disabled={busy||!!pending} onClick={()=>void open(item.id)}>
    {item.fields.name} · {item.program==="bna_learning_coop"?t("Learning co-op","קואופרטיב הלמידה"):t("Torah mornings","בקרים של תורה")} · {item.fields.townOrZip} · {item.followup.status} · <bdi dir="ltr">{item.id}</bdi></button></li>)}</ul>
   {page.nextCursor&&<button type="button" disabled={loadingMore||busy||!!pending} onClick={()=>void load(page.nextCursor!)}>{loadingMore?t("Loading…","טוען…"):t("Load older inquiries","טעינת פניות קודמות")}</button>}</div>}
  {detail&&<article className="lsw-stack" aria-label={t("BNA inquiry detail","פרטי פניית בני נביאים")}>
   <h3>{detail.fields.name}</h3><p>{detail.program==="bna_learning_coop"?t("Learning co-op interest","התעניינות בקואופרטיב הלמידה"):t("Torah-morning interest","התעניינות בבקרים של תורה")}</p><p><bdi dir="ltr">{detail.fields.contact}</bdi> · {detail.fields.contactChannel}</p>
   <p>{t("Ages","גילים")}: {detail.fields.childAges.join(", ")} · {detail.fields.townOrZip} · {detail.fields.language.toUpperCase()}</p>
   {detail.fields.question&&<p>{detail.fields.question}</p>}
   {detail.program==="bna_learning_coop"&&<><p>{t("Page language","שפת הדף")}: {detail.fields.siteLanguage.toUpperCase()} · {t("Email updates","עדכוני דוא״ל")}: {detail.fields.emailUpdates?t("requested","התבקשו"):t("not requested","לא התבקשו")}</p>{detail.fields.secondaryContact&&<p><bdi dir="ltr">{detail.fields.secondaryContact.value}</bdi> · {detail.fields.secondaryContact.channel}</p>}</>}
   <p>{t("Source","מקור")}: {detail.attribution?.source??t("Unknown","לא ידוע")}</p>
   <p>{t("Owner","אחראי")}: <bdi dir="ltr">{detail.ownerAccountId}</bdi></p>
   <form onSubmit={submit} className="lsw-stack"><label>{t("Stage","שלב")}<select value={status} onChange={event=>setStatus(event.target.value as typeof status)}>
    <option value="new">{t("New","חדש")}</option><option value="contacted">{t("Contacted","נוצר קשר")}</option>
    <option value="waiting">{t("Waiting","ממתין")}</option><option value="closed">{t("Closed","סגור")}</option></select></label>
    <label>{t("Note","הערה")}<textarea required value={note} onChange={event=>setNote(event.target.value)} maxLength={5000}/></label>
    <label>{t("Next action","פעולה הבאה")}<input value={nextAction} onChange={event=>setNextAction(event.target.value)} maxLength={500}/></label>
    <label>{t("Due date","תאריך יעד")}<input type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label>
    <label>{t("Waiting condition","תנאי המתנה")}<input value={waiting} onChange={event=>setWaiting(event.target.value)} maxLength={500}/></label>
    <button type="submit" disabled={busy||!!pending}>{t("Save follow-up","שמירת המשך טיפול")}</button></form>
   <h4>{t("Saved history","היסטוריה שמורה")}</h4><ol>{detail.history.map(event=><li key={event.operationId}>
    <time dateTime={event.recordedAt}>{event.recordedAt}</time> · {event.status} · {event.note}
    {event.nextAction&&<> · {event.nextAction}{event.dueDate&&<> ({event.dueDate})</>}</>}{event.waitingCondition&&<> · {event.waitingCondition}</>}
   </li>)}</ol>
  </article>}
 </section>;
}
