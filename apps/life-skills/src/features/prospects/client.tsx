"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {loginHref} from "../identity/login-return.ts";
import type {Prospect} from "./bridge.ts";
import {ProspectApiError,prospectReadFailure} from "./api-error.ts";
import {activeProspect,paidAwaitingBooking} from "./view-state.ts";
import {crmDueCivilDate} from "./due-date.ts";
import {applyNativeProspectUpdate,nativeProspectUpdateKey,prepareProspectUpdate,prospectEditContext,
 prospectUpdateFieldsSchema,type NativeProspectUpdate,type NativeProspectUpdateResult,type ProspectUpdateFields,type ProspectEditContext} from "./native-edit.ts";
import {changedProspectFollowUp,prospectFollowUpDraft,prospectContactSuppressed,reconcileProspectFollowUp} from "./native-edit.ts";

/* Remote state is loaded once per refresh and filter changes reset pagination. */
/* eslint-disable react-hooks/set-state-in-effect */
type State="loading"|"ready"|"error"|"auth"|"forbidden";
export type Preset="all"|"today"|"new"|"intake"|"payment"|"booking"|"archived";
export function workflowDestination(locale:Locale,preset:Preset):string{
 const section=preset==="booking"?"paid":preset==="archived"?"archived":preset==="all"?"all":"prospects";
 const filter=preset==="all"||preset==="booking"||preset==="archived"?"":`&filter=${preset}`;
 return `/${locale}/app/clients?section=${section}${filter}`;
}
export type ClientCase={id:string;kind:"minor"|"adult";state:string;displayName:string};
/** A linked minor case is a different person from its parent lead; a linked adult case is the same adult. */
export function visibleClientCases(cases:readonly ClientCase[],prospects:readonly Pick<Prospect,"caseId">[],query:string):ClientCase[]{
 const needle=query.trim().toLocaleLowerCase();
 return cases.filter(row=>row.displayName.toLocaleLowerCase().includes(needle)&&(row.kind==="minor"||!prospects.some(prospect=>prospect.caseId===row.id)));
}
const PAGE_SIZE=12;
export function paginateDirectory<T>(items:readonly T[],requestedPage:number,pageSize=PAGE_SIZE):{items:T[];page:number;pages:number}{
 const pages=Math.max(1,Math.ceil(items.length/pageSize));
 const page=Math.min(Math.max(1,requestedPage),pages);
 return {items:items.slice((page-1)*pageSize,page*pageSize),page,pages};
}
const copy={
 en:{title:"Clients & prospects",lead:"Follow each inquiry from first contact through intake, verified payment and a confirmed first appointment.",clients:"Clients",prospects:"Prospects / intake",all:"All open",today:"Due today",newLead:"New inquiries",intake:"Intake",payment:"Awaiting verified payment",booking:"Paid — awaiting booking",archived:"Archived",empty:"No prospects match these filters.",retry:"Try again",save:"Save follow-up",send:"Send WhatsApp",sendIntake:"Send intake form",bookingLink:"Secure booking link",sendBooking:"Send booking link",children:"Children on form",notes:"Administrative note",next:"Next action",due:"Due date",owner:"Owner",loading:"Loading the private CRM…",failed:"The CRM could not be loaded. Try again.",auth:"Your session has ended. Sign in to reopen this private directory.",forbidden:"This account is not authorized to view the practitioner directory.",signIn:"Sign in",saved:"Saved.",created:"Prospect saved without sending anything.",sent:"WhatsApp delivery confirmed.",sentPending:"WhatsApp delivery confirmed, but the CRM update is pending. Check this record before retrying; do not resend the message.",saveFailed:"The save could not be confirmed. Your edits are still here; check the record before retrying.",sendFailed:"Delivery could not be confirmed. Check recorded activity before sending again.",paymentGate:"Booking is available only after an authenticated payment is verified.",intakeHelp:"This sends the existing private intake form. Submitting it moves the inquiry directly to payment; there is no second acceptance step.",search:"Search name or phone",stage:"Stage",language:"Language",dueFilter:"Due",any:"Any",overdue:"Overdue",add:"Add prospect",name:"Name (optional)",phone:"Phone",source:"Source",previous:"Previous",nextPage:"Next",page:"Page"},
 he:{title:"לקוחות ומתעניינים",lead:"מעקב אחר כל פנייה מהקשר הראשון, דרך טופס ההיכרות והתשלום המאומת, ועד לקביעת פגישה ראשונה.",clients:"לקוחות",prospects:"מתעניינים / קליטה",all:"כל הפניות הפתוחות",today:"לטיפול היום",newLead:"פניות חדשות",intake:"טופס היכרות",payment:"ממתינים לתשלום מאומת",booking:"שולם — ממתינים לקביעת מועד",archived:"בארכיון",empty:"אין פניות שמתאימות למסננים.",retry:"ניסיון נוסף",save:"שמירת המשך טיפול",send:"שליחת WhatsApp",sendIntake:"שליחת טופס היכרות",bookingLink:"קישור מאובטח לקביעת מועד",sendBooking:"שליחת קישור לקביעת מועד",children:"מספר ילדים בטופס",notes:"הערה מנהלית",next:"הפעולה הבאה",due:"תאריך יעד",owner:"אחראי/ת",loading:"טוען את ה-CRM הפרטי…",failed:"לא ניתן לטעון את ה-CRM. אפשר לנסות שוב.",auth:"פג תוקף החיבור שלך. יש להיכנס מחדש כדי לפתוח את רשימת האנשים הפרטית.",forbidden:"לחשבון הזה אין הרשאה לצפות ברשימת האנשים של המטפל/ת.",signIn:"כניסה",saved:"נשמר.",created:"המתעניין נשמר בלי לשלוח דבר.",sent:"השליחה ב-WhatsApp אושרה.",sentPending:"השליחה ב-WhatsApp אושרה, אך עדכון ה-CRM ממתין. יש לבדוק את הרשומה לפני ניסיון נוסף; אין לשלוח את ההודעה שוב.",saveFailed:"לא ניתן לאשר את השמירה. העריכה נשארה כאן; כדאי לבדוק את הרשומה לפני ניסיון נוסף.",sendFailed:"לא ניתן לאשר את המסירה. יש לבדוק את הפעילות המתועדת לפני שליחה נוספת.",paymentGate:"אפשר לשלוח קישור לקביעת מועד רק לאחר אימות תשלום מאובטח.",intakeHelp:"הפעולה שולחת את טופס ההיכרות הפרטי הקיים. לאחר ההגשה עוברים ישירות לתשלום; אין שלב קבלה נוסף.",search:"חיפוש לפי שם או טלפון",stage:"שלב",language:"שפה",dueFilter:"מועד טיפול",any:"הכול",overdue:"באיחור",add:"הוספת מתעניין",name:"שם (לא חובה)",phone:"טלפון",source:"מקור",previous:"הקודם",nextPage:"הבא",page:"עמוד"}
} as const;

export function prospectActionStatus(kind:string,result:{projectionPending?:boolean;receiptPersistencePending?:boolean}|undefined,locale:Locale):string{
 const t=copy[locale];
 if(result?.receiptPersistencePending)return locale==="he"?
  "השליחה ב-WhatsApp אושרה, אך רישום המסירה דורש בירור. אין לשלוח שוב; יש לבדוק את רשומת ההמתנה והספק.":
  "WhatsApp delivery was confirmed, but its receipt needs reconciliation. Do not resend; check the pending record and provider.";
 return kind==="add"?t.created:result?.projectionPending?t.sentPending:t.sent;
}
async function api<T>(init?:RequestInit):Promise<T>{
 const headers:{[key:string]:string}={"Content-Type":"application/json"};
 if(init?.method&&init.method!=="GET"){const s=await sessionInfo();headers["X-CSRF-Token"]=s.csrfToken;}
 const response=await fetch("/api/prospects",{...init,credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{...headers,...init?.headers}});
 let body:{ok?:boolean;data?:T};
 try{body=await response.json() as {ok?:boolean;data?:T};}
 catch{throw new ProspectApiError(prospectReadFailure(response.status,null));}
 if(!response.ok||!body?.ok)throw new ProspectApiError(prospectReadFailure(response.status,body));
 return body.data as T;
}
function firstName(row:Prospect){return row.name.trim().split(/\s+/)[0]||row.name||"";}
function knownLanguage(row:Prospect):""|"he"|"en"{return /hebrew|עברית|^he$/i.test(row.language)?"he":/english|^en$/i.test(row.language)?"en":"";}
function template(row:Prospect,kind:"return"|"missed",language:""|"he"|"en"=knownLanguage(row)){
 const name=firstName(row),heGreeting=name?`שלום ${name},`:`שלום,`,enGreeting=name?`Hi ${name},`:`Hi,`;
 if(!language)return "";
 if(kind==="missed")return language==="he"?`${heGreeting} זה שלמה דרטלר. ניסיתי לחזור כפי שסיכמנו. מתי נוח לדבר?`:`${enGreeting} this is Shlomo Dratler. I tried calling back as we arranged. When would be a convenient time to speak?`;
 return language==="he"?`${heGreeting} זה שלמה דרטלר מכישורי חיים. חוזר לפנייה שלך. מתי נוח לשיחה קצרה?`:`${enGreeting} this is Shlomo Dratler from Life Skills, following up on your inquiry. When is a convenient time for a brief call?`;
}
function closed(row:Prospect){return /archive/i.test(`${row.stage} ${row.outcome}`)||prospectContactSuppressed(row);}
function active(row:Prospect){return activeProspect(row)||row.bookingConfirmed===true;}
function whatsappNumber(phone:string):string|null{
 const digits=phone.replace(/\D/g,"");
 if(/^972\d{8,9}$/.test(digits))return digits;
 if(/^0\d{8,9}$/.test(digits))return `972${digits.slice(1)}`;
 if(phone.trim().startsWith("+")&&/^\d{10,15}$/.test(digits))return digits;
 return null;
}

export function ProspectsClient({locale,initialFilter="all",focusLeadId="",embedded=false,clientCases=[],caseState=null,onRetryCases,showProspects=true,returnPath}:{locale:Locale;initialFilter?:Preset;focusLeadId?:string|undefined;embedded?:boolean;clientCases?:readonly ClientCase[];caseState?:State|null;onRetryCases?:()=>void;showProspects?:boolean;returnPath?:string}){
 const focused=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/.test(focusLeadId)?focusLeadId:"";
 const t=copy[locale],[rows,setRows]=useState<Prospect[]>([]),[state,setState]=useState<State>("loading"),preset=initialFilter,[query,setQuery]=useState(""),[stage,setStage]=useState(""),[language,setLanguage]=useState(""),[due,setDue]=useState(""),[page,setPage]=useState(1),[status,setStatus]=useState(""),[openLeads,setOpenLeads]=useState<string[]>(focused?[focused]:[]);
 const mounted=useRef(true),addRef=useRef<HTMLDetailsElement>(null);
 const pendingUpdates=useRef(new Map<string,{key:string;request:NativeProspectUpdate}>()),saving=useRef(new Set<string>());
 const load=()=>{setState("loading");void api<Prospect[]>({method:"GET"}).then(value=>{if(mounted.current){setRows(value);setState("ready")}}).catch(error=>{if(mounted.current){setRows([]);setState(error instanceof ProspectApiError?error.kind:"error")}})};
 useEffect(()=>{mounted.current=true;if(showProspects)queueMicrotask(load);return()=>{mounted.current=false}},[showProspects]);
 useEffect(()=>setPage(1),[preset,query,stage,language,due]);
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(new Date());
 const stages=useMemo(()=>[...new Set(rows.map(row=>row.stage).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[rows]);
 const shown=useMemo(()=>rows.filter(row=>{
  const dueDate=crmDueCivilDate(row.dueDate);
  if(preset==="today"&&(!dueDate||dueDate>today))return false;
  if(preset==="new"&&(row.formSent||row.formSubmitted||row.paymentVerified||active(row)))return false;
  if(preset==="intake"&&(!row.formSent||Boolean(row.formSubmitted)))return false;
  if(preset==="payment"&&(!row.formSubmitted||row.paymentVerified))return false;
  if(preset==="booking"&&!paidAwaitingBooking(row))return false;
  if(preset==="archived"&&!closed(row))return false;
  if(preset==="all"&&closed(row))return false;
  if(stage&&row.stage!==stage)return false;
  if(language&&!row.language.toLocaleLowerCase().startsWith(language))return false;
  if(due==="today"&&(!dueDate||dueDate>today))return false;
  if(due==="overdue"&&(!dueDate||dueDate>=today))return false;
  const needle=query.trim().toLocaleLowerCase();return !needle||`${row.name} ${row.phone}`.toLocaleLowerCase().includes(needle);
 }).sort((a,b)=>(crmDueCivilDate(a.dueDate)||"9999").localeCompare(crmDueCivilDate(b.dueDate)||"9999")||a.receivedAt.localeCompare(b.receivedAt)||a.leadId.localeCompare(b.leadId)),[rows,preset,stage,language,due,query,today]);
 const casesShown=(preset==="all"||preset==="archived")&&!stage&&!language&&!due
  ?visibleClientCases(clientCases,shown,query):[];
 const accessBlocked=state==="auth"||state==="forbidden"||caseState==="auth"||caseState==="forbidden";
 const allEntries=accessBlocked?[]:[...(caseState==="ready"?casesShown:[]).map(row=>({kind:"case" as const,id:row.id,name:row.displayName,row})),...(showProspects&&state==="ready"?shown:[]).map(row=>({kind:"prospect" as const,id:row.leadId,name:row.name||row.phone,row}))].sort((a,b)=>a.name.localeCompare(b.name,locale)||a.id.localeCompare(b.id));
 const focusIndex=focused?allEntries.findIndex(entry=>entry.kind==="prospect"&&entry.id===focused):-1;
 const focusPage=focusIndex<0?0:Math.floor(focusIndex/PAGE_SIZE)+1;
 useEffect(()=>{if(focusPage>0)setPage(focusPage)},[focusPage]);
 const {items:entries,page:currentPage,pages}=paginateDirectory(allEntries,page);
 const sourcesReady=(!showProspects||state==="ready")&&(!caseState||caseState==="ready");
 // A slow second source must not trap ready rows beyond the first page.
 const paginationReady=(showProspects&&state==="ready")||caseState==="ready";
 async function action(payload:unknown){
  setStatus("");const input=payload as {action:string;leadId?:string;fields?:ProspectUpdateFields;editContext?:ProspectEditContext},kind=input.action;
  let lock:string|undefined;
  try{
   const row=kind==="update"?rows.find(r=>r.leadId===input.leadId):undefined;
   if(kind==="update"){
    if(!row||!input.fields||!input.editContext)throw Error("INVALID_UPDATE");
    const fields=prospectUpdateFieldsSchema.parse(input.fields);
    const target=row.nativeEdit?.personId??row.leadId;if(saving.current.has(target))return;lock=target;saving.current.add(lock);
    const prepared=prepareProspectUpdate(row,fields,crypto.randomUUID(),input.editContext);
    if("expectedEpoch" in prepared){
     const observed={...row,nativeEdit:input.editContext.source==="native"?input.editContext.nativeEdit:row.nativeEdit!};
     const key=nativeProspectUpdateKey(observed,fields),prior=pendingUpdates.current.get(row.leadId);
     const request=prior?.key===key?prior.request:prepared;
     pendingUpdates.current.set(row.leadId,{key,request});
     const result=await api<NativeProspectUpdateResult>({method:"POST",body:JSON.stringify(request)});
     applyNativeProspectUpdate(rows,request,result);
     if(mounted.current){setRows(current=>current.some(r=>r.leadId===request.leadId&&r.nativeEdit?.personId===result.personId)
      ?applyNativeProspectUpdate(current,request,result):current);setStatus(t.saved);}
     pendingUpdates.current.delete(row.leadId);
    }else{
     await api({method:"POST",body:JSON.stringify(prepared)});
     // Keep the same cards mounted, including unrelated unsaved follow-ups.
     const changes=Object.fromEntries(Object.entries(fields).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
     if(mounted.current){setRows(current=>current.map(r=>r.leadId===row.leadId?{...r,...changes}:r));setStatus(t.saved);}
    }
    return;
   }
   const result=await api<{projectionPending?:boolean;receiptPersistencePending?:boolean}>({method:"POST",body:JSON.stringify(payload)});
   if(mounted.current){setStatus(prospectActionStatus(kind,result,locale));load();}
  }catch{if(mounted.current)setStatus(kind==="update"||kind==="add"?t.saveFailed:t.sendFailed);}
  finally{if(lock)saving.current.delete(lock);}
 }
 const content=<>
  {showProspects&&<header className={embedded?"lsw-section-header":"lsw-page-header"}><div>{!embedded&&<><p className="lsw-eyebrow">{locale==="he"?"CRM פרטי":"Private CRM"}</p><h1>{t.title}</h1><p>{t.lead}</p></>}</div>{!accessBlocked&&<button type="button" className="lsw-button lsw-button--secondary" onClick={()=>{if(addRef.current){addRef.current.open=true;addRef.current.scrollIntoView({behavior:"smooth",block:"start"});addRef.current.querySelector<HTMLInputElement>("input")?.focus()}}}>{t.add}</button>}</header>}
  {!embedded&&<nav className="lsw-tabs" aria-label={t.title}><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/clients`}>{t.clients}</a><a className="lsw-button lsw-button--primary" aria-current="page" href={`/${locale}/app/clients?section=prospects`}>{t.prospects}</a></nav>}
  <section className="lsw-card lsu-people-toolbar" aria-label={locale==="he"?"חיפוש ומסננים":"Search and filters"}><label className="lsw-field">{showProspects?t.search:locale==="he"?"חיפוש לקוחות":"Search clients"}<input className="lsw-input" type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label>{showProspects&&<><label className="lsw-field">{locale==="he"?"תהליך קליטה":"Intake workflow"}<select className="lsw-input" value={preset} onChange={event=>window.location.assign(workflowDestination(locale,event.target.value as Preset))}><option value="all">{t.all}</option><option value="today">{t.today}</option><option value="new">{t.newLead}</option><option value="intake">{t.intake}</option><option value="payment">{t.payment}</option><option value="booking">{t.booking}</option><option value="archived">{t.archived}</option></select></label><label className="lsw-field">{t.stage}<select className="lsw-input" value={stage} onChange={event=>setStage(event.target.value)}><option value="">{t.any}</option>{stages.map(value=><option key={value}>{value}</option>)}</select></label><label className="lsw-field">{t.language}<select className="lsw-input" value={language} onChange={event=>setLanguage(event.target.value)}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><label className="lsw-field">{t.dueFilter}<select className="lsw-input" value={due} onChange={event=>setDue(event.target.value)}><option value="">{t.any}</option><option value="today">{t.today}</option><option value="overdue">{t.overdue}</option></select></label></>}</section>
  {caseState==="loading"&&<p role="status">{locale==="he"?"טוען תיקים מורשים…":"Loading authorized cases…"}</p>}
  {caseState==="error"&&<div className="lsw-alert" role="alert"><p>{locale==="he"?"תיקי הלקוחות לא נטענו. רשימת הפניות עדיין זמינה.":"Client cases could not be loaded. The CRM may still be available."}</p><button className="lsw-button lsw-button--secondary" onClick={onRetryCases}>{t.retry}</button></div>}
  {(caseState==="auth"||caseState==="forbidden")&&<div className="lsw-alert" role="alert"><p>{t[caseState]}</p>{caseState==="auth"&&<a className="lsw-button lsw-button--secondary" href={loginHref(locale,returnPath??`/${locale}/app/clients`)}>{t.signIn}</a>}</div>}
  {showProspects&&state==="loading"&&<p role="status">{t.loading}</p>}{showProspects&&state==="error"&&<div className="lsw-alert" role="alert"><p>{t.failed}</p><button className="lsw-button lsw-button--secondary" onClick={load}>{t.retry}</button></div>}
  {showProspects&&(state==="auth"||state==="forbidden")&&caseState!==state&&<div className="lsw-alert" role="alert"><p>{t[state]}</p>{state==="auth"&&<a className="lsw-button lsw-button--secondary" href={loginHref(locale,returnPath??`/${locale}/app/clients`)}>{t.signIn}</a>}</div>}
  {showProspects&&rows.some(row=>row.projectionPending)&&<p className="lsw-alert" role="status">{locale==="he"?
   "לכמה פניות יש שליחה או עדכון CRM שממתינים לבירור. אין לשלוח שוב דרך האפליקציה עד לבדיקת הרשומה והמסירה.":
   "Some inquiries have an unresolved send or CRM update. Do not send again through the app until delivery and the record are reconciled."}</p>}
  <section className="lsu-people-results" aria-live="polite">{entries.map(entry=>entry.kind==="case"?<a className="lsw-card lsu-person-row" key={`case:${entry.id}`} href={`/${locale}/app/cases/${encodeURIComponent(entry.id)}`}><strong>{entry.row.displayName}</strong><span>{entry.row.kind==="minor"?(locale==="he"?"תיק ילד/ה":"Child case"):(locale==="he"?"תיק מבוגר/ת":"Adult case")} · {entry.row.state}</span></a>:<details className="lsw-card lsu-person-details" key={`prospect:${entry.id}`} open={openLeads.includes(entry.id)} onToggle={event=>{const isOpen=event.currentTarget.open;setOpenLeads(current=>isOpen?current.includes(entry.id)?current:[...current,entry.id]:current.filter(id=>id!==entry.id))}} data-focused={entry.id===focused}><summary><strong>{entry.name}</strong><span>{locale==="he"?"פנייה":"Inquiry"} · {entry.row.stage||t.newLead}</span><span>{entry.row.nextAction||"—"}</span><span>{entry.row.dueDate||"—"}</span></summary><ProspectCard row={entry.row} locale={locale} action={action}/></details>)}{!entries.length&&sourcesReady&&!accessBlocked&&<p className="lsw-empty">{showProspects?t.empty:locale==="he"?"אין תיקי לקוחות שמתאימים לחיפוש.":"No client cases match this search."}</p>}</section>
  {paginationReady&&!accessBlocked&&pages>1&&<nav className="lsw-actions" aria-label={t.page}><button className="lsw-button lsw-button--secondary" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>{t.previous}</button><span>{t.page} {currentPage} / {pages}</span><button className="lsw-button lsw-button--secondary" disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)}>{t.nextPage}</button></nav>}
  {showProspects&&!accessBlocked&&<><details ref={addRef} id="add-prospect" className="lsw-card lsu-inline-create"><summary>{t.add}</summary><AddProspect locale={locale} action={action}/></details><p className="lsw-save-result" role="status">{status}</p></>}
 </>;
 return embedded?<section className="lsu-crm-embedded" lang={locale} dir={locale==="he"?"rtl":"ltr"}>{content}</section>:<main className="lsw-main" lang={locale} dir={locale==="he"?"rtl":"ltr"}>{content}</main>;
}

function AddProspect({locale,action}:{locale:Locale;action:(payload:unknown)=>Promise<void>}){
 const t=copy[locale],[name,setName]=useState(""),[phone,setPhone]=useState(""),[language,setLanguage]=useState<""|"he"|"en">(""),[source,setSource]=useState(""),[notes,setNotes]=useState(""),[next,setNext]=useState(""),[due,setDue]=useState("");
 return <div className="lsw-stack"><div className="lsw-two-fields"><label className="lsw-field">{t.name}<input className="lsw-input" value={name} onChange={event=>setName(event.target.value)}/></label><label className="lsw-field">{t.phone}<input className="lsw-input" inputMode="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></label><label className="lsw-field">{t.language}<select className="lsw-input" value={language} onChange={event=>setLanguage(event.target.value as ""|"he"|"en")}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><label className="lsw-field">{t.source}<input className="lsw-input" value={source} onChange={event=>setSource(event.target.value)}/></label><label className="lsw-field">{t.next}<input className="lsw-input" value={next} onChange={event=>setNext(event.target.value)}/></label><label className="lsw-field">{t.due}<input className="lsw-input" type="date" value={due} onChange={event=>setDue(event.target.value)}/></label></div><label className="lsw-field">{t.notes}<textarea className="lsw-input" value={notes} onChange={event=>setNotes(event.target.value)}/></label><button className="lsw-button lsw-button--primary" disabled={phone.trim().length<8} onClick={()=>action({action:"add",name,phone,language,source,notes,nextAction:next,dueDate:due})}>{t.add}</button></div>;
}

function ProspectCard({row,locale,action}:{row:Prospect;locale:Locale;action:(payload:unknown)=>Promise<void>}){
 const initialLanguage=knownLanguage(row),t=copy[locale],[messageLanguage,setMessageLanguage]=useState<""|"he"|"en">(initialLanguage),[message,setMessage]=useState(template(row,"return",initialLanguage)),[draft,setDraft]=useState(()=>prospectFollowUpDraft(row)),[children,setChildren]=useState(1),[booking,setBooking]=useState("");
 useEffect(()=>setDraft(current=>reconcileProspectFollowUp(current,row)),[row]);
 const {notes,nextAction:next,dueDate:due,owner}=draft.values;
 const setField=(key:keyof typeof draft.values,value:string)=>setDraft(current=>reconcileProspectFollowUp({...current,values:{...current.values,[key]:value}},row));
 const changedFields=changedProspectFollowUp(draft);
 const paid=row.paymentVerified===true,wa=whatsappNumber(row.phone);
 const activity=[
  [locale==="he"?"פנייה ראשונה":"First inquiry",row.receivedAt],
  [locale==="he"?"הודעת WhatsApp נכנסת ראשונה":"First inbound WhatsApp",row.firstInboundAt],
  [locale==="he"?"הודעת WhatsApp נכנסת אחרונה":"Latest inbound WhatsApp",row.lastInboundAt],
  [locale==="he"?"טופס היכרות נשלח":"Intake form sent",row.formSent],
  [locale==="he"?"טופס היכרות הוגש":"Intake form submitted",row.formSubmitted],
  [locale==="he"?"קשר אחרון":"Last recorded contact",row.lastContact],
  [locale==="he"?"אסמכתת הודעה":"Message receipt",row.messageReceipt],
 ].filter((entry):entry is [string,string]=>Boolean(entry[1]));
 return <article className="lsw-card"><div className="lsw-section-header"><div><h2>{row.name||row.phone}</h2><p>{row.phone} · {row.language||"—"}</p></div><span className="lsw-status">{row.stage||"New inquiry"}</span></div><div className="lsw-inline-meta"><div>{t.next}: {row.nextAction||"—"}</div><div>{t.due}: {row.dueDate||"—"}</div><div>{t.owner}: {row.owner||"—"}</div></div><div className="lsw-actions">{wa&&<a className="lsw-button lsw-button--secondary" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">{locale==="he"?"פתיחת WhatsApp":"Open WhatsApp"}</a>}{row.caseId&&<><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/cases/${encodeURIComponent(row.caseId)}`}>{locale==="he"?"פתיחת תיק הלקוח":"Open client"}</a><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/feedback?caseId=${encodeURIComponent(row.caseId)}`}>{locale==="he"?"תקשורת באפליקציה":"App communications"}</a></>}</div><details className="lsw-details"><summary>{locale==="he"?"פעילות ותקשורת מתועדת":"Recorded activity and communications"}</summary><ul className="lsw-timeline">{activity.map(([label,value],index)=><li key={`${index}:${label}`}><strong>{label}</strong><span>{value}</span></li>)}</ul><p className="lsw-help">{locale==="he"?"מוצגות רשומות שנשמרו במערכת בלבד. תוכן שיחות WhatsApp אינו נטען כאן.":"Only saved app and CRM records appear here. WhatsApp conversation contents are not imported."}</p></details><details className="lsw-details"><summary>{locale==="he"?"המשך טיפול והערות":"Follow-up and notes"}</summary><div className="lsw-stack"><label className="lsw-field">{t.notes}<textarea className="lsw-input" value={notes} onChange={event=>setField("notes",event.target.value)}/></label><label className="lsw-field">{t.next}<input className="lsw-input" value={next} onChange={event=>setField("nextAction",event.target.value)}/></label><div className="lsw-two-fields"><label className="lsw-field">{t.due}<input className="lsw-input" type="date" value={due} onChange={event=>setField("dueDate",event.target.value)}/></label><label className="lsw-field">{t.owner}<input className="lsw-input" value={owner} onChange={event=>setField("owner",event.target.value)}/></label></div><button className="lsw-button lsw-button--secondary" disabled={!Object.keys(changedFields).length} onClick={()=>action({action:"update",leadId:row.leadId,fields:changedFields,editContext:prospectEditContext(draft.baseline)})}>{t.save}</button></div></details><details className="lsw-details"><summary>WhatsApp</summary><div className="lsw-stack"><label className="lsw-field">{t.language}<select className="lsw-input" value={messageLanguage} onChange={event=>{const value=event.target.value as ""|"he"|"en";setMessageLanguage(value);setMessage(template(row,"return",value))}}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><div className="lsw-actions"><button className="lsw-button lsw-button--quiet" disabled={!messageLanguage} onClick={()=>setMessage(template(row,"return",messageLanguage))}>{locale==="he"?"חזרה לפנייה":"Return inquiry"}</button><button className="lsw-button lsw-button--quiet" disabled={!messageLanguage} onClick={()=>setMessage(template(row,"missed",messageLanguage))}>{locale==="he"?"שיחה שלא נענתה":"Missed call"}</button></div><textarea className="lsw-input" value={message} onChange={event=>setMessage(event.target.value)} aria-label="WhatsApp message"/><button className="lsw-button lsw-button--primary" disabled={!messageLanguage||!message.trim()||closed(row)} onClick={()=>action({action:"send_message",leadId:row.leadId,message,nextAction:next,dueDate:due})}>{t.send}</button></div></details><details className="lsw-details"><summary>{t.sendIntake}</summary><div className="lsw-stack"><p className="lsw-help">{t.intakeHelp}</p><label className="lsw-field">{t.children}<input className="lsw-input" type="number" min="1" max="8" value={children} onChange={event=>setChildren(Number(event.target.value))}/></label><button className="lsw-button lsw-button--primary" disabled={!messageLanguage||Boolean(row.formSubmitted)||paid||closed(row)} onClick={()=>action({action:"send_intake",leadId:row.leadId,firstName:firstName(row),locale:messageLanguage,childCount:children})}>{t.sendIntake}</button></div></details><details className="lsw-details"><summary>{t.sendBooking}</summary><div className="lsw-stack">{paid?<><label className="lsw-field">{t.bookingLink}<input className="lsw-input" type="url" inputMode="url" value={booking} onChange={event=>setBooking(event.target.value)} placeholder="https://"/></label><button className="lsw-button lsw-button--primary" disabled={!messageLanguage||!booking.startsWith("https://")||!paidAwaitingBooking(row)||closed(row)} onClick={()=>action({action:"send_booking",leadId:row.leadId,firstName:firstName(row),locale:messageLanguage,bookingLink:booking})}>{t.sendBooking}</button></>:<p className="lsw-help">{t.paymentGate}</p>}</div></details></article>;
}
