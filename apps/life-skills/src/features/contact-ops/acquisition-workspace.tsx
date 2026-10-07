"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo,IdentityClientError} from "../identity/client.ts";
import {loginHref,practitionerReturnPath} from "../identity/login-return.ts";
import {acquisitionDecisionSchema,acquisitionPageSchema,acquisitionDecisionResultSchema,type AcquisitionDecision,type AcquisitionDecisionResult,type AcquisitionPage,type AcquisitionReviewItem} from "./core/acquisition.ts";
import {PeopleRequestError} from "./native-people-workspace.tsx";
import "./native-people.css";
type Fields=Extract<AcquisitionDecision,{action:"promote"}>["fields"];
type Draft={fields:Fields;person:string;pending:AcquisitionDecision|null;conflict:boolean};
export function AcquisitionSignIn({locale,page,search}:{locale:Locale;page:string;search:string}){
 return <a className="lsw-button lsw-button--secondary" href={loginHref(locale,practitionerReturnPath(locale,"clients",{section:"needs_review",search,page}))}>{locale==="he"?"כניסה":"Sign in"}</a>;
}
const initialFields=(item:AcquisitionReviewItem):Fields=>({name:item.displayName||item.phone,stage:"New inquiry",language:"",note:"",nextAction:"",dueDate:""});
async function responseData(response:Response){
 let body;try{body=await response.json();}catch{throw new PeopleRequestError(response.status||503);}
 if(!response.ok||!body?.ok)throw new PeopleRequestError(response.status);return body.data;
}
/** An ordinary practitioner view. No role switch, sample data, provider-history
 * fetch or promotion of unknown numbers merely because they sent a message. */
export function AcquisitionWorkspace({locale,mode}:{locale:Locale;mode?:string|undefined}){
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const [data,setData]=useState<AcquisitionPage|null>(null),[source,setSource]=useState<"sheet"|"native"|null>(null),
  [busy,setBusy]=useState(false),[failure,setFailure]=useState<number|null>(null),[query,setQuery]=useState(""),[page,setPage]=useState("1"),[saved,setSaved]=useState<AcquisitionDecisionResult|null>(null);
 const lifecycle=useRef({alive:true,serial:0}),[drafts,setDrafts]=useState(()=>new Map<string,Draft>());
 const load=useCallback(async()=>{
  const current=++lifecycle.current.serial;setBusy(true);setFailure(null);setData(null);setSource(null);
  const params=new URLSearchParams(window.location.search),raw=params.get("page")??"1",search=params.get("search")??"";
  setQuery(search.length<=200?search:"");setPage(params.getAll("page").length===1&&/^[1-9]\d{0,4}$/.test(raw)?raw:"1");
  try{
   const result=await responseData(await fetch("/api/private/contact-acquisition?"+new URLSearchParams({page:/^[1-9]\d{0,4}$/.test(raw)?raw:"1",search:search.length<=200?search:""}),
    {credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"}));
   if(!lifecycle.current.alive||current!==lifecycle.current.serial)return;
   if(result.source==="sheet"){setSource("sheet");return;}
   const {source:kind,...native}=result;if(kind!=="native")throw new PeopleRequestError(503);
   const parsed=acquisitionPageSchema.safeParse(native);if(!parsed.success)throw new PeopleRequestError(503);
   setSource("native");setData(parsed.data);
  }catch(error){if(lifecycle.current.alive&&current===lifecycle.current.serial){const status=error instanceof PeopleRequestError?error.status:503;
   setFailure(status);if(status===401||status===403){setDrafts(new Map());setSaved(null);setQuery("");}
  }}finally{if(lifecycle.current.alive&&current===lifecycle.current.serial)setBusy(false);}
 },[]);
 useEffect(()=>{const state=lifecycle.current;state.alive=true;const start=()=>{if(mode!=="demo")void load();};queueMicrotask(start);
  window.addEventListener("popstate",start);return()=>{state.alive=false;state.serial++;window.removeEventListener("popstate",start);};},[load,mode]);
 function navigate(page:number,search=query){const url=new URL(window.location.href);url.searchParams.set("section","needs_review");
  for(const key of ["personId","leadId","filter","stage","language","due"])url.searchParams.delete(key);
  if(page===1)url.searchParams.delete("page");else url.searchParams.set("page",String(page));
  if(search)url.searchParams.set("search",search);else url.searchParams.delete("search");window.history.pushState(null,"",url);void load();
 }
 const denied=failure===401||failure===403;
 return <main className="lsw-main lsu-clients-directory" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><h1>{text("People — Needs review","אנשים — לבדיקה")}</h1>
   <p>{text("Unknown messages are not active leads. Review metadata before promoting or matching a person. No message is sent by these actions.","הודעות לא מסווגות אינן פניות פעילות. יש לבדוק את פרטי הפנייה לפני קידום או שיוך לאיש קשר. הפעולות האלה אינן שולחות הודעה.")}</p></header>
  {mode==="demo"?<p role="status">{text("Live inbound candidates are not shown in DEMO. No live record is changed.","פניות נכנסות חיות אינן מוצגות ב-DEMO. אף רשומה חיה אינה משתנה.")}</p>:<section className="lsu-native-people" aria-busy={busy}>
   {failure!==null&&<div className="lsw-alert" role="alert"><p>{failure===401?text("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):failure===403?text("This account cannot review practitioner acquisition records.","לחשבון הזה אין גישה לבדיקת פניות של המטפל/ת."):failure===409?text("The contact authority changed or is frozen. No fallback records were used.","מקור אנשי הקשר השתנה או מוקפא. לא הוצגו רשומות חלופיות."):text("The review records could not be loaded. Your authorized draft is preserved; this is not an empty list.","לא ניתן לטעון את הרשומות לבדיקה. הטיוטה המורשית נשמרה; אין להסיק שהרשימה ריקה.")}</p>
    {failure===401?<AcquisitionSignIn locale={locale} page={page} search={query}/>:!denied&&<button className="lsw-button lsw-button--secondary" onClick={()=>void load()}>{text("Retry","ניסיון חוזר")}</button>}</div>}
   {source==="sheet"&&<p role="status">{text("Native acquisition review is awaiting the verified CRM cutover. The existing Sheet remains authoritative; no native shadow or duplicate writer is exposed.","בדיקת הפניות המקומית ממתינה למעבר המאומת של מערכת אנשי הקשר. הגיליון הקיים נשאר המקור הקובע; לא מוצגים נתוני צל ולא מופעל כותב נוסף.")}</p>}
   {!denied&&source!=="sheet"&&<><form className="lsw-card lsu-people-toolbar" aria-label={text("Review search","חיפוש פניות לבדיקה")} onSubmit={event=>{event.preventDefault();navigate(1);}}>
    <label className="lsw-field">{text("Search name or number","חיפוש שם או מספר")}<input className="lsw-input" type="search" maxLength={200} value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <button className="lsw-button lsw-button--primary" disabled={busy}>{text("Search","חיפוש")}</button></form>
    {saved&&<div className="lsw-card" role="status"><p>{saved.state==="NOT_A_LEAD"?text("Marked not a lead. Original receipt metadata was retained.","סומנה כלא פנייה עסקית. פרטי הקבלה המקוריים נשמרו."):text("Owner decision saved without sending anything or creating a login.","החלטת הבעלים נשמרה בלי לשלוח דבר ובלי ליצור חשבון כניסה.")}</p>
     {saved.personId&&<><a href={`/${locale}/app/clients?personId=${saved.personId}`}>{text("Open person","פתיחת איש הקשר")}</a><p>{text("Google Life Skills Lead: pending · WhatsApp LS • Lead: pending. Provider connection/write is not verified.","Google Life Skills Lead: ממתין · WhatsApp LS • Lead: ממתין. החיבור והשינוי אצל הספק לא אומתו.")}</p></>}</div>}
    {busy&&<p role="status">{text("Loading authorized review records…","טוען רשומות מורשות לבדיקה…")}</p>}
    {data&&<><AcquisitionWindowSummary locale={locale} total={data.total} hasMore={data.hasMore}/><div className="lsw-stack">{data.items.map(item=><AcquisitionReviewCard key={item.id} item={item} epoch={data.authorityEpoch} locale={locale} draft={drafts.get(item.id)}
     remember={draft=>setDrafts(previous=>new Map(previous).set(item.id,draft))} saved={result=>{if(lifecycle.current.alive){setDrafts(previous=>{const next=new Map(previous);next.delete(item.id);return next;});setSaved(result);void load();}}}
     denied={status=>{if(lifecycle.current.alive){lifecycle.current.serial++;setData(null);setSource(null);setBusy(false);setFailure(status);setDrafts(new Map());setSaved(null);setQuery("");}}}
     refresh={()=>void load()}/>)}</div>
     {!data.total&&<p className="lsw-empty">{text("No inbound candidates match this review view.","אין פניות נכנסות שמתאימות לתצוגת הבדיקה.")}</p>}
     <nav className="lsw-actions" aria-label={text("Review pagination","דפדוף בפניות לבדיקה")}><button className="lsw-button lsw-button--secondary" disabled={busy||data.page<=1} onClick={()=>navigate(data.page-1)}>{text("Previous","הקודם")}</button><span>{data.page} / {data.pages}</span><button className="lsw-button lsw-button--secondary" disabled={busy||data.page>=data.pages} onClick={()=>navigate(data.page+1)}>{text("Next","הבא")}</button></nav></>}
   </>}
  </section>}
 </main>;
}
export function AcquisitionWindowSummary({locale,total,hasMore}:{locale:Locale;total:number;hasMore:boolean}){
 const text=(en:string,he:string)=>locale==='he'?he:en;
 return <><p>{total} {text("needs review — not active prospects","לבדיקה — לא מתעניינים פעילים")}</p>
  {hasMore&&<p className="lsw-help" role="status">{text("Showing the latest 1,000 pending records only. Search and counts apply to this window; older pending records appear as decisions are saved.","מוצגות רק 1,000 הרשומות האחרונות שממתינות לבדיקה. החיפוש והספירה מתייחסים לחלון הזה; רשומות קודמות יופיעו ככל שהחלטות יישמרו.")}</p>}</>;
}
export function AcquisitionReviewCard({item,epoch,locale,draft,remember,saved,denied,refresh}:{item:AcquisitionReviewItem;epoch:number;locale:Locale;draft?:Draft|undefined;
 remember:(draft:Draft)=>void;saved:(result:AcquisitionDecisionResult)=>void;denied:(status:number)=>void;refresh:()=>void}){
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const [fields,setFields]=useState(draft?.fields??initialFields(item)),[pending,setPending]=useState<AcquisitionDecision|null>(draft?.pending??null),
  [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[conflict,setConflict]=useState(draft?.conflict??false),[confirm,setConfirm]=useState(draft?.pending?.action==="not_lead"),[person,setPerson]=useState(draft?.person??(draft?.pending?.action==="match"?draft.pending.personId:""));
 const guard=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function edit(patch:Partial<Fields>){const next={...fields,...patch};setFields(next);remember({fields:next,person,pending,conflict});}
 async function decide(action:"promote"|"match"|"not_lead"){
  if(guard.current||conflict)return;let operation:AcquisitionDecision;
  try{const match=item.matching.people.find(value=>value.personId===person&&value.eligible);
   operation=pending??acquisitionDecisionSchema.parse({action,candidateId:item.id,operationId:crypto.randomUUID(),expectedEpoch:epoch,
    ...(action==="promote"?{fields}:action==="match"?{personId:person,expectedVersion:match?.version}:{})});
  }catch{setMessage(text("Check the name, status, date or selected person. Your draft is preserved.","יש לבדוק את השם, המצב, התאריך או איש הקשר שנבחר. הטיוטה נשמרה."));return;}
  guard.current=true;setBusy(true);setPending(operation);setMessage("");remember({fields,person,pending:operation,conflict:false});
  try{
   const session=await sessionInfo(),parsed=acquisitionDecisionResultSchema.safeParse(await responseData(await fetch("/api/private/contact-acquisition",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",
    headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(operation)})));
   if(!parsed.success)throw new PeopleRequestError(503);const result=parsed.data;
   if(result.candidateId!==item.id||result.authorityEpoch!==epoch||result.state!==(operation.action==="promote"?"PROMOTED":operation.action==="match"?"MATCHED":"NOT_A_LEAD")||
    operation.action==="match"&&result.personId!==operation.personId)throw new PeopleRequestError(503);
   if(alive.current)saved(result);
  }catch(error){if(alive.current){const status=error instanceof PeopleRequestError?error.status:error instanceof IdentityClientError&&error.code==="UNAUTHENTICATED"?401:error instanceof IdentityClientError&&error.code==="FORBIDDEN"?403:503;
   if(status===401||status===403){denied(status);return;}
   if(status===400||status===409){setPending(null);setConflict(status===409);remember({fields,person,pending:null,conflict:status===409});}
   setMessage(status===409?text("The record, phone match or CRM authority changed. Your draft is preserved. Refresh before deciding again.","הרשומה, שיוך הטלפון או מקור אנשי הקשר השתנו. הטיוטה נשמרה. יש לרענן לפני החלטה נוספת."):status===400?text("The request was not accepted. Check the fields; your draft is preserved.","הבקשה לא התקבלה. יש לבדוק את השדות; הטיוטה נשמרה."):text("The save could not be confirmed. Retry the same decision to reconcile its outcome without duplicating a lead.","לא ניתן לאשר את השמירה. יש לנסות שוב את אותה החלטה כדי לבדוק את התוצאה בלי ליצור כפילות."));
  }}finally{guard.current=false;if(alive.current)setBusy(false);}
 }
 const locked=busy||pending!==null||conflict;
 return <article className="lsw-card"><h2>{item.displayName||item.phone}</h2><p><bdi>{item.phone}</bdi> · {text("Organic WhatsApp","WhatsApp לא מסווג")} · <time dateTime={item.occurredAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.occurredAt))}</time></p>
  <p>{item.matching.state==="unmatched"?text("No existing endpoint match","אין התאמה קיימת למספר"):item.matching.state==="existing"?text("Existing person found — match instead of creating a duplicate","נמצא איש קשר קיים — יש לשייך במקום ליצור כפילות"):item.matching.state==="ambiguous"?text("More than one person matches. Select the intended person explicitly.","נמצאה התאמה ליותר מאיש קשר אחד. יש לבחור במפורש את האדם המתאים."):text("This number has a reserved account or DEMO claim. Review the identity separately; promotion is blocked.","המספר משויך לחשבון שמור או ל-DEMO. יש לבדוק את הזהות בנפרד; הקידום חסום.")}</p>
  <details><summary>{text("Review actions","פעולות בדיקה")}</summary>
   {item.matching.state==="unmatched"&&<form className="lsw-stack" onSubmit={event=>{event.preventDefault();void decide("promote");}}>
    <fieldset className="lsw-stack" disabled={locked}><legend>{text("Promote to lead — administrative fields only","קידום לפנייה — פרטים מנהליים בלבד")}</legend>
     <label className="lsw-field">{text("Name","שם")}<input className="lsw-input" required maxLength={120} value={fields.name} onChange={event=>edit({name:event.target.value})}/></label>
     <label className="lsw-field">{text("Status","מצב")}<input className="lsw-input" required maxLength={120} value={fields.stage} onChange={event=>edit({stage:event.target.value})}/></label>
     <label className="lsw-field">{text("Language","שפה")}<select className="lsw-input" value={fields.language} onChange={event=>edit({language:event.target.value as Fields["language"]})}><option value="">{text("Not specified","לא צוין")}</option><option value="he">עברית</option><option value="en">English</option></select></label>
     <label className="lsw-field">{text("Owner note — no clinical information","הערת בעלים — בלי מידע טיפולי")}<textarea className="lsw-input" maxLength={5000} value={fields.note} onChange={event=>edit({note:event.target.value})}/></label>
     <label className="lsw-field">{text("Next action","הפעולה הבאה")}<input className="lsw-input" maxLength={500} value={fields.nextAction} onChange={event=>edit({nextAction:event.target.value})}/></label>
     <label className="lsw-field">{text("Due date","תאריך יעד")}<input className="lsw-input" type="date" value={fields.dueDate} onChange={event=>edit({dueDate:event.target.value})}/></label>
    </fieldset><button className="lsw-button lsw-button--primary" disabled={busy||conflict||pending!==null&&pending.action!=="promote"}>{text(pending?"Retry this decision":"Promote to lead",pending?"ניסיון חוזר של ההחלטה":"קידום לפנייה")}</button>
   </form>}
   {item.matching.people.some(match=>match.eligible)&&<div className="lsw-stack"><label className="lsw-field">{text("Existing person","איש קשר קיים")}<select className="lsw-input" disabled={locked} value={person} onChange={event=>{setPerson(event.target.value);remember({fields,person:event.target.value,pending,conflict});}}><option value="">{text("Select a person","בחירת איש קשר")}</option>{item.matching.people.filter(match=>match.eligible).map(match=><option key={match.personId} value={match.personId}>{match.displayName}</option>)}</select></label>
    <p>{text("Matching preserves the existing name, notes and status. It creates no account or clinical access.","השיוך שומר על השם, ההערות והמצב הקיימים. הוא אינו יוצר חשבון או גישה למידע טיפולי.")}</p><button className="lsw-button lsw-button--primary" disabled={busy||conflict||!person||pending!==null&&pending.action!=="match"} onClick={()=>void decide("match")}>{text(pending?"Retry this decision":"Match existing person",pending?"ניסיון חוזר של ההחלטה":"שיוך לאיש קשר קיים")}</button></div>}
   {!confirm?<button className="lsw-button lsw-button--secondary" disabled={locked} onClick={()=>setConfirm(true)}>{text("Not a lead","לא פנייה עסקית")}</button>:<div className="lsw-stack"><p>{text("Mark this event not a lead? The original receipt will be retained.","לסמן את האירוע הזה כלא פנייה עסקית? הקבלה המקורית תישמר.")}</p><div className="lsw-actions"><button className="lsw-button lsw-button--secondary" disabled={busy||pending!==null} onClick={()=>setConfirm(false)}>{text("Cancel","ביטול")}</button><button className="lsw-button lsw-button--primary" disabled={busy||conflict||pending!==null&&pending.action!=="not_lead"} onClick={()=>void decide("not_lead")}>{text(pending?"Retry this decision":"Mark not a lead",pending?"ניסיון חוזר של ההחלטה":"סימון כלא פנייה עסקית")}</button></div></div>}
  </details>{message&&<p role="alert">{message}</p>}{conflict&&<button className="lsw-button lsw-button--secondary" onClick={()=>{remember({fields,person,pending:null,conflict:false});refresh();}}>{text("Refresh and review again","רענון ובדיקה מחדש")}</button>}
 </article>;
}
