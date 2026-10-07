"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {loginHref} from "../identity/login-return.ts";
import type {Prospect} from "./bridge.ts";
import {ProspectApiError,prospectReadFailure} from "./api-error.ts";
import {activeProspect,paidAwaitingBooking} from "./view-state.ts";
import {crmDueCivilDate} from "./due-date.ts";
import {administrativeActionLabel,administrativeStageLabel} from "./admin-display.ts";
import {applyNativeProspectUpdate,nativeProspectUpdateKey,prepareProspectUpdate,prospectEditContext,
 prospectUpdateFieldsSchema,type NativeProspectUpdate,type NativeProspectUpdateResult,type ProspectUpdateFields,type ProspectEditContext} from "./native-edit.ts";
import {changedProspectFollowUp,prospectFollowUpDraft,prospectContactSuppressed,reconcileProspectFollowUp} from "./native-edit.ts";
import {directoryQuery,peopleFiltersFromQuery,peoplePageFromQuery,type DirectoryFilters} from "./directory-query.ts";

/* Remote state is loaded once per refresh and filter changes reset pagination. */
/* eslint-disable react-hooks/set-state-in-effect */
type State="loading"|"ready"|"error"|"auth"|"forbidden";
type PendingOperation={leadId:string;operationId:string;state:"prepared"|"sent_pending";message:string;createdAt:string};
type DirectoryPage={rows:Prospect[];pendingOperations:PendingOperation[];pendingNext:string|null;ledgerReady:boolean};
export type Preset="all"|"today"|"new"|"intake"|"payment"|"booking"|"archived";
export function workflowDestination(locale:Locale,preset:Preset,context?:URLSearchParams):string{
 const section=preset==="booking"?"paid":preset==="archived"?"archived":preset==="all"?"all":"prospects";
 const filter=preset==="all"||preset==="booking"||preset==="archived"?"":`&filter=${preset}`;
 const params=new URLSearchParams(`section=${section}${filter}`);
 if(context){const retained=directoryQuery(params,peopleFiltersFromQuery(context));return `/${locale}/app/clients?${retained}`;}
 return `/${locale}/app/clients?${params}`;
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

export function prospectActionStatus(kind:string,result:{projectionPending?:boolean}|undefined,locale:Locale):string{
 const t=copy[locale];
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
async function readDirectory(after?:string):Promise<DirectoryPage>{
 const url=after?`/api/prospects?pendingAfter=${encodeURIComponent(after)}`:"/api/prospects";
 const response=await fetch(url,{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 let body:{ok?:boolean;data?:Prospect[];pendingOperations?:PendingOperation[];pendingNext?:string|null;ledgerReady?:boolean};
 try{body=await response.json() as typeof body;}catch{throw new ProspectApiError(prospectReadFailure(response.status,null));}
 if(!response.ok||body?.ok!==true||!Array.isArray(body.data)||!Array.isArray(body.pendingOperations)||typeof body.ledgerReady!=="boolean"||
  (body.pendingNext!==null&&typeof body.pendingNext!=="string"))throw new ProspectApiError(prospectReadFailure(response.status,body));
 return {rows:body.data,pendingOperations:body.pendingOperations,pendingNext:body.pendingNext,ledgerReady:body.ledgerReady};
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

export function ProspectsClient({locale,initialFilter="all",initialFilters,initialPage=1,focusLeadId="",embedded=false,clientCases=[],caseState=null,onRetryCases,showProspects=true,returnPath}:{locale:Locale;initialFilter?:Preset;initialFilters?:DirectoryFilters;initialPage?:number;focusLeadId?:string|undefined;embedded?:boolean;clientCases?:readonly ClientCase[];caseState?:State|null;onRetryCases?:()=>void;showProspects?:boolean;returnPath?:string}){
 const focused=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/.test(focusLeadId)?focusLeadId:"";
 const t=copy[locale],[rows,setRows]=useState<Prospect[]>([]),[state,setState]=useState<State>("loading"),preset=initialFilter,[query,setQuery]=useState(initialFilters?.query??""),[stage,setStage]=useState(initialFilters?.stage??""),[language,setLanguage]=useState(initialFilters?.language??""),[due,setDue]=useState(initialFilters?.due==="any"?"":initialFilters?.due??""),[page,setPage]=useState(initialPage),[status,setStatus]=useState(""),[openLeads,setOpenLeads]=useState<string[]>(focused?[focused]:[]);
 const [pendingOperations,setPendingOperations]=useState<PendingOperation[]>([]),[pendingNext,setPendingNext]=useState<string|null>(null),
  [pendingMoreState,setPendingMoreState]=useState<"idle"|"loading"|"error">("idle"),[ledgerReady,setLedgerReady]=useState(false);
 const mounted=useRef(true),addRef=useRef<HTMLElement>(null),addButton=useRef<HTMLButtonElement>(null),[addOpen,setAddOpen]=useState(false);
 const pendingUpdates=useRef(new Map<string,{key:string;request:NativeProspectUpdate}>()),saving=useRef(new Set<string>());
 const load=()=>{setState("loading");setLedgerReady(false);void readDirectory().then(value=>{if(mounted.current){setRows(value.rows);setPendingOperations(value.pendingOperations);setPendingNext(value.pendingNext);setLedgerReady(value.ledgerReady);setPendingMoreState("idle");setState("ready")}}).catch(error=>{if(mounted.current){setRows([]);setPendingOperations([]);setPendingNext(null);setLedgerReady(false);setState(error instanceof ProspectApiError?error.kind:"error")}})};
 async function loadMorePending(){if(!pendingNext||pendingMoreState==="loading")return;
  setPendingMoreState("loading");try{const value=await readDirectory(pendingNext);if(mounted.current){setPendingOperations(current=>[
   ...current,...value.pendingOperations.filter(item=>!current.some(previous=>previous.operationId===item.operationId))]);
   setPendingNext(value.pendingNext);setPendingMoreState("idle");}}
  catch{if(mounted.current)setPendingMoreState("error");}
 }
 useEffect(()=>{mounted.current=true;if(showProspects)queueMicrotask(load);return()=>{mounted.current=false}},[showProspects]);
 useEffect(()=>{const restore=()=>{const p=new URLSearchParams(window.location.search),f=peopleFiltersFromQuery(p);setQuery(f.query);setStage(f.stage);setLanguage(f.language);setDue(f.due==="any"?"":f.due);setPage(peoplePageFromQuery(p));};window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);},[]);
 useEffect(()=>{if(addOpen)addRef.current?.querySelector<HTMLInputElement>("input")?.focus();},[addOpen]);
 const appliedFilters=():DirectoryFilters=>({query,stage,language,due:due==="today"||due==="overdue"?due:"any"});
 function writeLocation(fields:DirectoryFilters,nextPage:number,push=false){const url=new URL(window.location.href);url.search=directoryQuery(url.searchParams,fields,nextPage).toString();if(url.href!==window.location.href){if(push)window.history.pushState(window.history.state,"",url);else window.history.replaceState(window.history.state,"",url);}}
 function changeFilter(key:keyof DirectoryFilters,value:string){const next={...appliedFilters(),[key]:value} as DirectoryFilters;setQuery(next.query);setStage(next.stage);setLanguage(next.language);setDue(next.due==="any"?"":next.due);setPage(1);writeLocation(next,1);}
 function changePage(next:number){setPage(next);writeLocation(appliedFilters(),next,true);}
 function closeAdd(){setAddOpen(false);addButton.current?.focus();}
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
 const orphanPending=state==="ready"?pendingOperations.filter(item=>!rows.some(row=>row.leadId===item.leadId)):[];
 // A slow second source must not trap ready rows beyond the first page.
 const paginationReady=(showProspects&&state==="ready")||caseState==="ready";
 async function action(payload:unknown):Promise<boolean>{
  setStatus("");const input=payload as {action:string;leadId?:string;operationId?:string;fields?:ProspectUpdateFields;editContext?:ProspectEditContext},kind=input.action;
  let lock:string|undefined;
  try{
   const row=kind==="update"?rows.find(r=>r.leadId===input.leadId):undefined;
   if(kind==="update"){
    if(!row||!input.fields||!input.editContext)throw Error("INVALID_UPDATE");
    const fields=prospectUpdateFieldsSchema.parse(input.fields);
    const target=row.nativeEdit?.personId??row.leadId;if(saving.current.has(target))return false;lock=target;saving.current.add(lock);
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
    return true;
   }
   if(kind==="reconcile_projection"||kind==="resolve_prepared"){
    if(!input.operationId||saving.current.has(input.operationId))return false;
    lock=input.operationId;saving.current.add(lock);
   }
   const pendingRow=kind.startsWith("send_")?rows.find(row=>row.leadId===input.leadId&&row.projectionPending):undefined;
   if(kind.startsWith("send_")&&!ledgerReady){setStatus(locale==="he"?"שליחת WhatsApp מושהית עד לאימות יומן השליחות הפרטי.":"WhatsApp sending is paused until the private outbound ledger is verified.");return false;}
   if(pendingRow){
    setStatus(pendingRow.projectionState==="prepared"?(locale==="he"?
     "תוצאת המסירה אינה ודאית. יש לבדוק מול הספק לפני ניסיון שליחה נוסף.":
     "Delivery outcome is uncertain. Verify with the provider before another send."):t.sentPending);return false;
   }
   const result=await api<{projectionPending?:boolean}>({method:"POST",body:JSON.stringify(payload)});
   if(mounted.current){setStatus(kind==="resolve_prepared"?(locale==="he"?
    "תוצאת הספק נרשמה; לא נשלחה הודעה נוספת. יש לבדוק את מצב ה-CRM המעודכן.":
    "Provider outcome recorded; no message was resent. Check the updated CRM state."):kind==="reconcile_projection"?(locale==="he"?
    "עדכון ה-CRM אומת ונרשם; לא נשלחה הודעה נוספת.":"CRM readback verified and recorded; no message was resent."):
    prospectActionStatus(kind,result,locale));load();}return true;
  }catch{if(mounted.current){setStatus(kind==="resolve_prepared"?(locale==="he"?
   "לא ניתן לאמת ולרשום את תוצאת הספק. הרשומה נשארה ממתינה; אין לשלוח שוב.":
   "Provider outcome could not be recorded. The hold remains; do not resend."):kind==="reconcile_projection"?(locale==="he"?
   "עדכון ה-CRM לא אומת. הרשומה עדיין ממתינה; אין לשלוח שוב.":
   "CRM readback was not verified. This record remains pending; do not resend."):
   kind==="update"||kind==="add"?t.saveFailed:t.sendFailed);
   if(kind.startsWith("send_")||kind==="resolve_prepared"||kind==="reconcile_projection")load();}return false;}
  finally{if(lock)saving.current.delete(lock);}
 }
 const content=<>
  {showProspects&&<header className={embedded?"lsw-section-header":"lsw-page-header"}><div>{!embedded&&<><p className="lsw-eyebrow">{locale==="he"?"CRM פרטי":"Private CRM"}</p><h1>{t.title}</h1><p>{t.lead}</p></>}</div>{!accessBlocked&&<button ref={addButton} type="button" className="lsw-button lsw-button--secondary" aria-expanded={addOpen} aria-controls="add-prospect" onClick={()=>setAddOpen(!addOpen)}>{t.add}</button>}</header>}
  {showProspects&&!accessBlocked&&<section ref={addRef} id="add-prospect" className="lsw-card lsu-inline-create" hidden={!addOpen} aria-label={t.add} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();closeAdd();}}}><div className="lsw-section-header"><h2>{t.add}</h2><button type="button" className="lsw-button lsw-button--quiet" onClick={closeAdd}>{locale==="he"?"סגירה":"Close"}</button></div><AddProspect locale={locale} action={action} onCreated={closeAdd}/></section>}
  {!embedded&&<nav className="lsw-tabs" aria-label={t.title}><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/clients`}>{t.clients}</a><a className="lsw-button lsw-button--primary" aria-current="page" href={`/${locale}/app/clients?section=prospects`}>{t.prospects}</a></nav>}
  <section className="lsw-card lsu-people-toolbar" aria-label={locale==="he"?"חיפוש ומסננים":"Search and filters"}><label className="lsw-field">{showProspects?t.search:locale==="he"?"חיפוש לקוחות":"Search clients"}<input className="lsw-input" type="search" maxLength={200} value={query} onChange={event=>changeFilter("query",event.target.value)}/></label>{showProspects&&<><label className="lsw-field">{locale==="he"?"תהליך קליטה":"Intake workflow"}<select className="lsw-input" value={preset} onChange={event=>window.location.assign(workflowDestination(locale,event.target.value as Preset,new URLSearchParams(window.location.search)))}><option value="all">{t.all}</option><option value="today">{t.today}</option><option value="new">{t.newLead}</option><option value="intake">{t.intake}</option><option value="payment">{t.payment}</option><option value="booking">{t.booking}</option><option value="archived">{t.archived}</option></select></label><label className="lsw-field">{t.stage}<select className="lsw-input" value={stage} onChange={event=>changeFilter("stage",event.target.value)}><option value="">{t.any}</option>{stages.map(value=><option key={value} value={value}>{administrativeStageLabel(value,locale)}</option>)}</select></label><label className="lsw-field">{t.language}<select className="lsw-input" value={language} onChange={event=>changeFilter("language",event.target.value)}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><label className="lsw-field">{t.dueFilter}<select className="lsw-input" value={due} onChange={event=>changeFilter("due",event.target.value)}><option value="">{t.any}</option><option value="today">{t.today}</option><option value="overdue">{t.overdue}</option></select></label></>}</section>
  {caseState==="loading"&&<p role="status">{locale==="he"?"טוען תיקים מורשים…":"Loading authorized cases…"}</p>}
  {caseState==="error"&&<div className="lsw-alert" role="alert"><p>{locale==="he"?"תיקי הלקוחות לא נטענו. רשימת הפניות עדיין זמינה.":"Client cases could not be loaded. The CRM may still be available."}</p><button className="lsw-button lsw-button--secondary" onClick={onRetryCases}>{t.retry}</button></div>}
  {(caseState==="auth"||caseState==="forbidden")&&<div className="lsw-alert" role="alert"><p>{t[caseState]}</p>{caseState==="auth"&&<a className="lsw-button lsw-button--secondary" href={loginHref(locale,returnPath??`/${locale}/app/clients`)}>{t.signIn}</a>}</div>}
  {showProspects&&state==="loading"&&<p role="status">{t.loading}</p>}{showProspects&&state==="error"&&<div className="lsw-alert" role="alert"><p>{t.failed}</p><button className="lsw-button lsw-button--secondary" onClick={load}>{t.retry}</button></div>}
  {showProspects&&state==="ready"&&!ledgerReady&&<div className="lsw-alert" role="alert"><p>{locale==="he"?
   "יומן השליחות הפרטי אינו זמין. אפשר לעיין ולעדכן פניות, אך שליחת WhatsApp מושהית עד לבדיקת היומן. אין לנסות לשלוח בדרך עוקפת.":
   "The private outbound ledger is unavailable. You can read and update prospects, but WhatsApp sending is paused until the ledger is verified. Do not work around this hold."}</p></div>}
  {showProspects&&(state==="auth"||state==="forbidden")&&caseState!==state&&<div className="lsw-alert" role="alert"><p>{t[state]}</p>{state==="auth"&&<a className="lsw-button lsw-button--secondary" href={loginHref(locale,returnPath??`/${locale}/app/clients`)}>{t.signIn}</a>}</div>}
  {showProspects&&rows.some(row=>row.projectionPending)&&<section className="lsw-alert" role="status" aria-label={locale==="he"?"שליחות ממתינות לבירור":"Pending delivery reconciliation"}>
   <p>{locale==="he"?"יש שליחות או עדכוני CRM שממתינים לבירור. אין לשלוח שוב עד לבדיקת הרשומה והמסירה.":
    "Some sends or CRM updates need reconciliation. Do not resend until delivery and the record are checked."}</p>
   <ul>{rows.filter(row=>row.projectionPending).map(row=><li key={row.leadId}>
    <strong>{row.name||row.phone}</strong>{" — "}{row.projectionState==="sent_pending"?
     <button type="button" className="lsw-button lsw-button--secondary" onClick={()=>action({action:"reconcile_projection",operationId:row.projectionOperationId})}>
      {locale==="he"?"אימות ועדכון ה-CRM (ללא שליחה)":"Verify and update CRM (no resend)"}</button>:
     <PreparedResolution row={row} locale={locale} action={action}/>}</li>)}</ul>
  </section>}
  {showProspects&&orphanPending.length>0&&<section className="lsw-alert" role="alert" aria-label={locale==="he"?"שליחות ממתינות ללא רשומת פנייה":"Pending sends with missing CRM leads"}>
   <p>{locale==="he"?
    "ניסיון שליחה שמור, אך מזהה הפנייה חסר כרגע ב-CRM. אין לשלוח שוב או ליצור פנייה חדשה כתחליף. יש לשחזר את אותה רשומת מקור ומזהה פנייה מתוך מקור מוסמך, ואז לאמת את העדכון ללא שליחה נוספת.":
    "A send attempt is preserved, but its lead ID is missing from the authoritative CRM. Do not resend or create a replacement lead. Restore the exact source record and lead ID from an authoritative backup, then verify the projection without another send."}</p>
   <ul>{orphanPending.map(item=><li key={item.operationId}><strong>{item.leadId}</strong>{" — "}{item.state==="sent_pending"?
    <button type="button" className="lsw-button lsw-button--secondary" onClick={()=>action({action:"reconcile_projection",operationId:item.operationId})}>
     {locale==="he"?"בדיקת הרשומה ששוחזרה ועדכון ה-CRM (ללא שליחה)":"Verify restored lead and update CRM (no resend)"}</button>:
    <PreparedResolution row={{projectionOperationId:item.operationId,projectionMessage:item.message,projectionCreatedAt:item.createdAt}} locale={locale} action={action}/>}</li>)}</ul>
  </section>}
  {showProspects&&state==="ready"&&pendingNext&&<button type="button" className="lsw-button lsw-button--secondary" disabled={pendingMoreState==="loading"} onClick={loadMorePending}>
   {locale==="he"?"טעינת ניסיונות שליחה ממתינים נוספים":"Load more pending send attempts"}</button>}
  {showProspects&&pendingMoreState==="error"&&<p role="alert">{locale==="he"?"טעינת ניסיונות נוספים נכשלה. אפשר לנסות שוב.":"More pending attempts could not be loaded. Try again."}</p>}
  <section className="lsu-people-results" aria-live="polite">{entries.map(entry=>entry.kind==="case"?<a className="lsw-card lsu-person-row" key={`case:${entry.id}`} href={`/${locale}/app/cases/${encodeURIComponent(entry.id)}`}><strong>{entry.row.displayName}</strong><span>{entry.row.kind==="minor"?(locale==="he"?"תיק ילד/ה":"Child case"):(locale==="he"?"תיק מבוגר/ת":"Adult case")} · {entry.row.state}</span></a>:<details className="lsw-card lsu-person-details" key={`prospect:${entry.id}`} open={openLeads.includes(entry.id)} onToggle={event=>{const isOpen=event.currentTarget.open;setOpenLeads(current=>isOpen?current.includes(entry.id)?current:[...current,entry.id]:current.filter(id=>id!==entry.id))}} data-focused={entry.id===focused}><summary><strong>{entry.name}</strong><span>{locale==="he"?"פנייה":"Inquiry"} · {administrativeStageLabel(entry.row.stage||"New inquiry",locale)}</span><span>{administrativeActionLabel(entry.row.nextAction||"—",locale)}</span><span>{entry.row.dueDate||"—"}</span></summary><ProspectCard row={entry.row} locale={locale} action={action} sendsReady={ledgerReady}/></details>)}{!entries.length&&sourcesReady&&!accessBlocked&&<p className="lsw-empty">{showProspects?t.empty:locale==="he"?"אין תיקי לקוחות שמתאימים לחיפוש.":"No client cases match this search."}</p>}</section>
  {paginationReady&&!accessBlocked&&pages>1&&<nav className="lsw-actions" aria-label={t.page}><button className="lsw-button lsw-button--secondary" disabled={currentPage<=1} onClick={()=>changePage(currentPage-1)}>{t.previous}</button><span>{t.page} {currentPage} / {pages}</span><button className="lsw-button lsw-button--secondary" disabled={currentPage>=pages} onClick={()=>changePage(currentPage+1)}>{t.nextPage}</button></nav>}
  {showProspects&&!accessBlocked&&<p className="lsw-save-result" role="status">{status}</p>}
 </>;
 return embedded?<section className="lsu-crm-embedded" lang={locale} dir={locale==="he"?"rtl":"ltr"}>{content}</section>:<main className="lsw-main" lang={locale} dir={locale==="he"?"rtl":"ltr"}>{content}</main>;
}

export function AddProspect({locale,action,onCreated}:{locale:Locale;action:(payload:unknown)=>Promise<boolean>;onCreated:()=>void}){
 const t=copy[locale],[name,setName]=useState(""),[phone,setPhone]=useState(""),[language,setLanguage]=useState<""|"he"|"en">(""),[source,setSource]=useState(""),[notes,setNotes]=useState(""),[next,setNext]=useState(""),[due,setDue]=useState(""),[submitting,setSubmitting]=useState(false),submittingRef=useRef(false);
 async function save(){if(submittingRef.current)return;submittingRef.current=true;setSubmitting(true);try{if(!await action({action:"add",name,phone,language,source,notes,nextAction:next,dueDate:due}))return;setName("");setPhone("");setLanguage("");setSource("");setNotes("");setNext("");setDue("");onCreated();}finally{submittingRef.current=false;setSubmitting(false);}}
 return <div className="lsw-stack" aria-busy={submitting}><div className="lsw-two-fields"><label className="lsw-field">{t.name}<input className="lsw-input" value={name} onChange={event=>setName(event.target.value)}/></label><label className="lsw-field">{t.phone}<input className="lsw-input" inputMode="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></label><label className="lsw-field">{t.language}<select className="lsw-input" value={language} onChange={event=>setLanguage(event.target.value as ""|"he"|"en")}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><label className="lsw-field">{t.source}<input className="lsw-input" value={source} onChange={event=>setSource(event.target.value)}/></label><label className="lsw-field">{t.next}<input className="lsw-input" value={next} onChange={event=>setNext(event.target.value)}/></label><label className="lsw-field">{t.due}<input className="lsw-input" type="date" value={due} onChange={event=>setDue(event.target.value)}/></label></div><label className="lsw-field">{t.notes}<textarea className="lsw-input" value={notes} onChange={event=>setNotes(event.target.value)}/></label><button type="button" className="lsw-button lsw-button--primary" disabled={submitting||phone.trim().length<8} onClick={save}>{submitting?(locale==="he"?"שומר…":"Saving…"):(locale==="he"?"שמירת מתעניין":"Save prospect")}</button></div>;
}

function PreparedResolution({row,locale,action}:{row:Pick<Prospect,"projectionOperationId"|"projectionMessage"|"projectionCreatedAt">;locale:Locale;action:(payload:unknown)=>Promise<boolean>}){
 const [outcome,setOutcome]=useState<"delivered"|"not_delivered">("delivered"),[source,setSource]=useState<"provider_delivery_log"|"provider_support_case">("provider_delivery_log"),
  [reference,setReference]=useState(""),[providerMessageId,setProviderMessageId]=useState(""),[sentAt,setSentAt]=useState(""),[verified,setVerified]=useState(false),[now,setNow]=useState(0);
 useEffect(()=>{setNow(Date.now());const timer=window.setInterval(()=>setNow(Date.now()),60000);return()=>window.clearInterval(timer)},[]);
 const coolingComplete=Boolean(row.projectionCreatedAt)&&now-Date.parse(row.projectionCreatedAt!)>=900000;
 const ready=Boolean(row.projectionOperationId&&row.projectionMessage&&
  /^[A-Za-z0-9][A-Za-z0-9:._@/-]{7,199}$/.test(reference.trim())&&verified&&
  (outcome==="delivered"?/^[^\s]{8,200}$/.test(providerMessageId.trim())&&Number.isFinite(Date.parse(sentAt)):coolingComplete));
 return <details className="lsw-details"><summary>{locale==="he"?"בירור מסירה מול הספק (ללא שליחה נוספת)":"Review provider delivery (no resend)"}</summary>
  <div className="lsw-stack"><p className="lsw-help">{locale==="he"?
   "הפעולה מיועדת רק לאחר בדיקה ידנית של ההודעה המדויקת ברשומת המסירה של Whapi או בפניית תמיכה מתועדת. זו עדות מטפל/ת, לא אימות אוטומטי מול הספק.":
   "Use only after manually checking this exact message in Whapi's delivery log or a documented support case. This is a practitioner attestation, not an automatic provider lookup."}</p>
   <p><strong>{locale==="he"?"ההודעה שנשמרה לפני ניסיון השליחה":"Message saved before the send attempt"}</strong><br/>
    <span style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{row.projectionMessage}</span></p>
   <p className="lsw-help">{locale==="he"?"הניסיון נרשם":"Attempt recorded"}: {row.projectionCreatedAt||"—"}</p>
   <label className="lsw-field">{locale==="he"?"תוצאה מאומתת ידנית":"Manually verified outcome"}<select className="lsw-input" value={outcome} onChange={event=>setOutcome(event.target.value as typeof outcome)}>
    <option value="delivered">{locale==="he"?"נמסר — יש אסמכתת ספק":"Delivered — provider receipt found"}</option>
    <option value="not_delivered">{locale==="he"?"לא נמסר — יש אישור ספק":"Not delivered — provider confirmed"}</option></select></label>
   <label className="lsw-field">{locale==="he"?"מקור הבדיקה":"Evidence source"}<select className="lsw-input" value={source} onChange={event=>setSource(event.target.value as typeof source)}>
    <option value="provider_delivery_log">{locale==="he"?"רשומת מסירה של הספק":"Provider delivery log"}</option>
    <option value="provider_support_case">{locale==="he"?"פניית תמיכה של הספק":"Provider support case"}</option></select></label>
   <label className="lsw-field">{locale==="he"?"מזהה רשומה/פנייה בספק":"Provider record/case reference"}<input className="lsw-input" value={reference} onChange={event=>setReference(event.target.value)} autoComplete="off"/></label>
   {outcome==="delivered"&&<div className="lsw-two-fields"><label className="lsw-field">{locale==="he"?"מזהה הודעה בספק":"Provider message ID"}<input className="lsw-input" value={providerMessageId} onChange={event=>setProviderMessageId(event.target.value)} autoComplete="off"/></label>
    <label className="lsw-field">{locale==="he"?"מועד שליחה מדויק — ISO/UTC":"Exact send time — ISO/UTC"}<input className="lsw-input" value={sentAt} onChange={event=>setSentAt(event.target.value)} placeholder="2026-09-30T12:00:00Z" autoComplete="off"/></label></div>}
   {outcome==="not_delivered"&&!coolingComplete&&<p className="lsw-help">{locale==="he"?"סגירת ניסיון כלא נמסר אפשרית רק אחרי 15 דקות ובדיקת הספק.":
    "A not-delivered attestation is available only after 15 minutes and a provider check."}</p>}
   <label className="lsw-field"><input type="checkbox" checked={verified} onChange={event=>setVerified(event.target.checked)}/>{locale==="he"?
    "בדקתי את הנמען וההודעה המדויקים אצל הספק ואת תוצאת המסירה.":
    "I checked this exact recipient and message with the provider and verified the delivery outcome."}</label>
   <button type="button" className="lsw-button lsw-button--secondary" disabled={!ready} onClick={()=>action({action:"resolve_prepared",operationId:row.projectionOperationId,
    outcome,source,reference:reference.trim(),checkedAt:new Date().toISOString(),verifiedExactMessage:true,
    ...(outcome==="delivered"?{providerMessageId:providerMessageId.trim(),sentAt}: {})})}>{locale==="he"?
     "רישום התוצאה ועדכון ה-CRM — ללא שליחה":"Record outcome and reconcile CRM — no resend"}</button>
  </div></details>;
}

function ProspectCard({row,locale,action,sendsReady}:{row:Prospect;locale:Locale;action:(payload:unknown)=>Promise<boolean>;sendsReady:boolean}){
 const initialLanguage=knownLanguage(row),t=copy[locale],[messageLanguage,setMessageLanguage]=useState<""|"he"|"en">(initialLanguage),[message,setMessage]=useState(template(row,"return",initialLanguage)),[draft,setDraft]=useState(()=>prospectFollowUpDraft(row)),[children,setChildren]=useState(1),[booking,setBooking]=useState("");
 useEffect(()=>setDraft(current=>reconcileProspectFollowUp(current,row)),[row]);
 const {notes,nextAction:next,dueDate:due,owner}=draft.values;
 const setField=(key:keyof typeof draft.values,value:string)=>setDraft(current=>reconcileProspectFollowUp({...current,values:{...current.values,[key]:value}},row));
 const changedFields=changedProspectFollowUp(draft);
 const paid=row.paymentVerified===true,wa=whatsappNumber(row.phone);
 const setContactLanguage=(value:""|"he"|"en")=>{setMessageLanguage(value);setMessage(template(row,"return",value));};
 const activity=[
  [locale==="he"?"פנייה ראשונה":"First inquiry",row.receivedAt],
  [locale==="he"?"הודעת WhatsApp נכנסת ראשונה":"First inbound WhatsApp",row.firstInboundAt],
  [locale==="he"?"הודעת WhatsApp נכנסת אחרונה":"Latest inbound WhatsApp",row.lastInboundAt],
  [locale==="he"?"טופס היכרות נשלח":"Intake form sent",row.formSent],
  [locale==="he"?"טופס היכרות הוגש":"Intake form submitted",row.formSubmitted],
  [locale==="he"?"קשר אחרון":"Last recorded contact",row.lastContact],
  [locale==="he"?"אסמכתת הודעה":"Message receipt",row.messageReceipt],
 ].filter((entry):entry is [string,string]=>Boolean(entry[1]));
 return <article className="lsw-card"><div className="lsw-section-header"><div><h2>{row.name||row.phone}</h2><p>{row.phone} · {row.language||"—"}</p></div><span className="lsw-status">{administrativeStageLabel(row.stage||"New inquiry",locale)}</span></div><div className="lsw-inline-meta"><div>{t.next}: {administrativeActionLabel(row.nextAction||"—",locale)}</div><div>{t.due}: {row.dueDate||"—"}</div><div>{t.owner}: {row.owner||"—"}</div></div><div className="lsw-actions">{wa&&<a className="lsw-button lsw-button--secondary" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">{locale==="he"?"פתיחת WhatsApp":"Open WhatsApp"}</a>}{row.caseId&&<><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/cases/${encodeURIComponent(row.caseId)}`}>{locale==="he"?"פתיחת תיק הלקוח":"Open client"}</a><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/feedback?caseId=${encodeURIComponent(row.caseId)}`}>{locale==="he"?"תקשורת באפליקציה":"App communications"}</a></>}</div><details className="lsw-details"><summary>{locale==="he"?"פעילות ותקשורת מתועדת":"Recorded activity and communications"}</summary><ul className="lsw-timeline">{activity.map(([label,value],index)=><li key={`${index}:${label}`}><strong>{label}</strong><span>{value}</span></li>)}</ul><p className="lsw-help">{locale==="he"?"מוצגות רשומות שנשמרו במערכת בלבד. תוכן שיחות WhatsApp אינו נטען כאן.":"Only saved app and CRM records appear here. WhatsApp conversation contents are not imported."}</p></details><details className="lsw-details"><summary>{locale==="he"?"המשך טיפול והערות":"Follow-up and notes"}</summary><div className="lsw-stack"><label className="lsw-field">{t.notes}<textarea className="lsw-input" value={notes} onChange={event=>setField("notes",event.target.value)}/></label><label className="lsw-field">{t.next}<input className="lsw-input" value={next} onChange={event=>setField("nextAction",event.target.value)}/></label><div className="lsw-two-fields"><label className="lsw-field">{t.due}<input className="lsw-input" type="date" value={due} onChange={event=>setField("dueDate",event.target.value)}/></label><label className="lsw-field">{t.owner}<input className="lsw-input" value={owner} onChange={event=>setField("owner",event.target.value)}/></label></div><button className="lsw-button lsw-button--secondary" disabled={!Object.keys(changedFields).length} onClick={()=>action({action:"update",leadId:row.leadId,fields:changedFields,editContext:prospectEditContext(draft.baseline)})}>{t.save}</button></div></details><details className="lsw-details"><summary>WhatsApp</summary><div className="lsw-stack"><label className="lsw-field">{t.language}<select className="lsw-input" value={messageLanguage} onChange={event=>setContactLanguage(event.target.value as ""|"he"|"en")}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><div className="lsw-actions"><button className="lsw-button lsw-button--quiet" disabled={!messageLanguage} onClick={()=>setMessage(template(row,"return",messageLanguage))}>{locale==="he"?"חזרה לפנייה":"Return inquiry"}</button><button className="lsw-button lsw-button--quiet" disabled={!messageLanguage} onClick={()=>setMessage(template(row,"missed",messageLanguage))}>{locale==="he"?"שיחה שלא נענתה":"Missed call"}</button></div><textarea className="lsw-input" value={message} onChange={event=>setMessage(event.target.value)} aria-label="WhatsApp message"/><button className="lsw-button lsw-button--primary" disabled={!sendsReady||!messageLanguage||!message.trim()||closed(row)||row.projectionPending} onClick={()=>action({action:"send_message",leadId:row.leadId,message,nextAction:next,dueDate:due})}>{t.send}</button></div></details><details className="lsw-details"><summary>{t.sendIntake}</summary><div className="lsw-stack"><p className="lsw-help">{t.intakeHelp}</p><label className="lsw-field">{t.language}<select className="lsw-input" value={messageLanguage} onChange={event=>setContactLanguage(event.target.value as ""|"he"|"en")}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><label className="lsw-field">{t.children}<input className="lsw-input" type="number" min="1" max="8" value={children} onChange={event=>setChildren(Number(event.target.value))}/></label><button className="lsw-button lsw-button--primary" disabled={!sendsReady||!messageLanguage||Boolean(row.formSubmitted)||paid||closed(row)||row.projectionPending} onClick={()=>action({action:"send_intake",leadId:row.leadId,firstName:firstName(row),locale:messageLanguage,childCount:children})}>{t.sendIntake}</button></div></details><details className="lsw-details"><summary>{t.sendBooking}</summary><div className="lsw-stack">{paid?<><label className="lsw-field">{t.bookingLink}<input className="lsw-input" type="url" inputMode="url" value={booking} onChange={event=>setBooking(event.target.value)} placeholder="https://"/></label><button className="lsw-button lsw-button--primary" disabled={!sendsReady||!messageLanguage||!booking.startsWith("https://")||!paidAwaitingBooking(row)||closed(row)||row.projectionPending} onClick={()=>action({action:"send_booking",leadId:row.leadId,firstName:firstName(row),locale:messageLanguage,bookingLink:booking})}>{t.sendBooking}</button></>:<p className="lsw-help">{t.paymentGate}</p>}</div></details></article>;
}
