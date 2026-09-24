"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import type {Prospect} from "./bridge.ts";

/* Remote state is loaded once per refresh and filter changes reset pagination. */
/* eslint-disable react-hooks/set-state-in-effect */
type State="loading"|"ready"|"error";
export type Preset="all"|"today"|"new"|"intake"|"payment"|"booking"|"archived";
const PAGE_SIZE=12;
const copy={
 en:{title:"Clients & prospects",lead:"Follow each inquiry from first contact through intake, verified payment and a confirmed first appointment.",clients:"Clients",prospects:"Prospects / intake",all:"All open",today:"Due today",newLead:"New inquiries",intake:"Intake",payment:"Awaiting verified payment",booking:"Paid — awaiting booking",archived:"Archived",empty:"No prospects match these filters.",retry:"Try again",save:"Save follow-up",send:"Send WhatsApp",sendIntake:"Send intake form",bookingLink:"Secure booking link",sendBooking:"Send booking link",children:"Children on form",notes:"Administrative note",next:"Next action",due:"Due date",owner:"Owner",loading:"Loading the private CRM…",failed:"The CRM could not be loaded. Try again.",saved:"Saved.",created:"Prospect saved without sending anything.",sent:"WhatsApp delivery confirmed.",sendFailed:"The action could not be confirmed. Nothing was marked sent.",paymentGate:"Booking is available only after an authenticated payment is verified.",intakeHelp:"This sends the existing private intake form. Submitting it moves the inquiry directly to payment; there is no second acceptance step.",search:"Search name or phone",stage:"Stage",language:"Language",dueFilter:"Due",any:"Any",overdue:"Overdue",add:"Add prospect",name:"Name (optional)",phone:"Phone",source:"Source",previous:"Previous",nextPage:"Next",page:"Page"},
 he:{title:"לקוחות ומתעניינים",lead:"מעקב אחר כל פנייה מהקשר הראשון, דרך טופס ההיכרות והתשלום המאומת, ועד לקביעת פגישה ראשונה.",clients:"לקוחות",prospects:"מתעניינים / קליטה",all:"כל הפניות הפתוחות",today:"לטיפול היום",newLead:"פניות חדשות",intake:"טופס היכרות",payment:"ממתינים לתשלום מאומת",booking:"שולם — ממתינים לקביעת מועד",archived:"בארכיון",empty:"אין פניות שמתאימות למסננים.",retry:"ניסיון נוסף",save:"שמירת המשך טיפול",send:"שליחת WhatsApp",sendIntake:"שליחת טופס היכרות",bookingLink:"קישור מאובטח לקביעת מועד",sendBooking:"שליחת קישור לקביעת מועד",children:"מספר ילדים בטופס",notes:"הערה מנהלית",next:"הפעולה הבאה",due:"תאריך יעד",owner:"אחראי/ת",loading:"טוען את ה-CRM הפרטי…",failed:"לא ניתן לטעון את ה-CRM. אפשר לנסות שוב.",saved:"נשמר.",created:"המתעניין נשמר בלי לשלוח דבר.",sent:"השליחה ב-WhatsApp אושרה.",sendFailed:"לא ניתן לאשר את הפעולה. דבר לא סומן כנשלח.",paymentGate:"אפשר לשלוח קישור לקביעת מועד רק לאחר אימות תשלום מאובטח.",intakeHelp:"הפעולה שולחת את טופס ההיכרות הפרטי הקיים. לאחר ההגשה עוברים ישירות לתשלום; אין שלב קבלה נוסף.",search:"חיפוש לפי שם או טלפון",stage:"שלב",language:"שפה",dueFilter:"מועד טיפול",any:"הכול",overdue:"באיחור",add:"הוספת מתעניין",name:"שם (לא חובה)",phone:"טלפון",source:"מקור",previous:"הקודם",nextPage:"הבא",page:"עמוד"}
} as const;

async function api<T>(init?:RequestInit):Promise<T>{
 const headers:{[key:string]:string}={"Content-Type":"application/json"};
 if(init?.method&&init.method!=="GET"){const s=await sessionInfo();headers["X-CSRF-Token"]=s.csrfToken;}
 const response=await fetch("/api/prospects",{...init,credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{...headers,...init?.headers}});
 const body=await response.json() as {ok?:boolean;data?:T};
 if(!response.ok||!body.ok)throw Error("unavailable");
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
function closed(row:Prospect){return /archive|do not contact/i.test(`${row.stage} ${row.outcome}`);}
function active(row:Prospect){return row.journeyState==="active"||/confirmed|active/i.test(row.bookingStatus);}
function whatsappNumber(phone:string):string|null{
 const digits=phone.replace(/\D/g,"");
 if(/^972\d{8,9}$/.test(digits))return digits;
 if(/^0\d{8,9}$/.test(digits))return `972${digits.slice(1)}`;
 if(phone.trim().startsWith("+")&&/^\d{10,15}$/.test(digits))return digits;
 return null;
}

export function ProspectsClient({locale,initialFilter="all",embedded=false}:{locale:Locale;initialFilter?:Preset;embedded?:boolean}){
 const t=copy[locale],[rows,setRows]=useState<Prospect[]>([]),[state,setState]=useState<State>("loading"),[preset,setPreset]=useState<Preset>(initialFilter),[query,setQuery]=useState(""),[stage,setStage]=useState(""),[language,setLanguage]=useState(""),[due,setDue]=useState(""),[page,setPage]=useState(1),[status,setStatus]=useState("");
 const mounted=useRef(true),addRef=useRef<HTMLDetailsElement>(null);
 const load=()=>{setState("loading");void api<Prospect[]>({method:"GET"}).then(value=>{if(mounted.current){setRows(value);setState("ready")}}).catch(()=>{if(mounted.current)setState("error")})};
 useEffect(()=>{mounted.current=true;queueMicrotask(load);return()=>{mounted.current=false}},[]);
 useEffect(()=>setPage(1),[preset,query,stage,language,due]);
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(new Date());
 const stages=useMemo(()=>[...new Set(rows.map(row=>row.stage).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[rows]);
 const shown=useMemo(()=>rows.filter(row=>{
  if(preset==="today"&&(!row.dueDate||row.dueDate>today))return false;
  if(preset==="new"&&(row.formSent||row.formSubmitted||row.paymentVerified||active(row)))return false;
  if(preset==="intake"&&(!row.formSent||Boolean(row.formSubmitted)))return false;
  if(preset==="payment"&&(!row.formSubmitted||row.paymentVerified))return false;
  if(preset==="booking"&&(!row.paymentVerified||active(row)))return false;
  if(preset==="archived"&&!closed(row))return false;
  if(preset==="all"&&(closed(row)||active(row)))return false;
  if(stage&&row.stage!==stage)return false;
  if(language&&!row.language.toLocaleLowerCase().startsWith(language))return false;
  if(due==="today"&&(!row.dueDate||row.dueDate>today))return false;
  if(due==="overdue"&&(!row.dueDate||row.dueDate>=today))return false;
  const needle=query.trim().toLocaleLowerCase();return !needle||`${row.name} ${row.phone}`.toLocaleLowerCase().includes(needle);
 }).sort((a,b)=>(a.dueDate||"9999").localeCompare(b.dueDate||"9999")||a.receivedAt.localeCompare(b.receivedAt)||a.leadId.localeCompare(b.leadId)),[rows,preset,stage,language,due,query,today]);
 const pages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE)),visible=shown.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
 async function action(payload:unknown){setStatus("");try{await api({method:"POST",body:JSON.stringify(payload)});const kind=(payload as {action:string}).action;setStatus(kind==="update"?t.saved:kind==="add"?t.created:t.sent);load()}catch{setStatus(t.sendFailed)}}
 const filters:readonly (readonly [Preset,string])[]=[["all",t.all],["today",t.today],["new",t.newLead],["intake",t.intake],["payment",t.payment],["booking",t.booking],["archived",t.archived]];
 const content=<>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale==="he"?"CRM פרטי":"Private CRM"}</p>{embedded?<h2>{t.prospects}</h2>:<h1>{t.title}</h1>}<p>{t.lead}</p></div><button type="button" className="lsw-button lsw-button--secondary" onClick={()=>{if(addRef.current){addRef.current.open=true;addRef.current.scrollIntoView({behavior:"smooth",block:"start"});addRef.current.querySelector<HTMLInputElement>("input")?.focus()}}}>{t.add}</button></header>
  {!embedded&&<nav className="lsw-tabs" aria-label={t.title}><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/clients`}>{t.clients}</a><a className="lsw-button lsw-button--primary" aria-current="page" href={`/${locale}/app/clients?section=prospects`}>{t.prospects}</a></nav>}
  <div className="lsw-tabs" role="tablist">{filters.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={preset===key} onClick={()=>setPreset(key)}>{label}</button>)}</div>
  <section className="lsw-card" aria-label={locale==="he"?"מסננים":"Filters"}><div className="lsw-two-fields"><label className="lsw-field">{t.search}<input className="lsw-input" type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label><label className="lsw-field">{t.stage}<select className="lsw-input" value={stage} onChange={event=>setStage(event.target.value)}><option value="">{t.any}</option>{stages.map(value=><option key={value}>{value}</option>)}</select></label><label className="lsw-field">{t.language}<select className="lsw-input" value={language} onChange={event=>setLanguage(event.target.value)}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><label className="lsw-field">{t.dueFilter}<select className="lsw-input" value={due} onChange={event=>setDue(event.target.value)}><option value="">{t.any}</option><option value="today">{t.today}</option><option value="overdue">{t.overdue}</option></select></label></div></section>
  {state==="loading"&&<p role="status">{t.loading}</p>}{state==="error"&&<div className="lsw-alert" role="alert"><p>{t.failed}</p><button className="lsw-button lsw-button--secondary" onClick={load}>{t.retry}</button></div>}
  {state==="ready"&&<section className="lsw-stack" aria-live="polite">{visible.length?visible.map(row=><ProspectCard key={row.leadId} row={row} locale={locale} action={action}/>):<p className="lsw-empty">{t.empty}</p>}</section>}
  {state==="ready"&&pages>1&&<nav className="lsw-actions" aria-label={t.page}><button className="lsw-button lsw-button--secondary" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>{t.previous}</button><span>{t.page} {page} / {pages}</span><button className="lsw-button lsw-button--secondary" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>{t.nextPage}</button></nav>}
  <details ref={addRef} id="add-prospect" className="lsw-card lsu-inline-create"><summary>{t.add}</summary><AddProspect locale={locale} action={action}/></details>
  <p className="lsw-save-result" role="status">{status}</p>
 </>;
 return embedded?<section className="lsw-main lsu-crm-embedded" lang={locale} dir={locale==="he"?"rtl":"ltr"}>{content}</section>:<main className="lsw-main" lang={locale} dir={locale==="he"?"rtl":"ltr"}>{content}</main>;
}

function AddProspect({locale,action}:{locale:Locale;action:(payload:unknown)=>Promise<void>}){
 const t=copy[locale],[name,setName]=useState(""),[phone,setPhone]=useState(""),[language,setLanguage]=useState<""|"he"|"en">(""),[source,setSource]=useState(""),[notes,setNotes]=useState(""),[next,setNext]=useState(""),[due,setDue]=useState("");
 return <div className="lsw-stack"><div className="lsw-two-fields"><label className="lsw-field">{t.name}<input className="lsw-input" value={name} onChange={event=>setName(event.target.value)}/></label><label className="lsw-field">{t.phone}<input className="lsw-input" inputMode="tel" required value={phone} onChange={event=>setPhone(event.target.value)}/></label><label className="lsw-field">{t.language}<select className="lsw-input" value={language} onChange={event=>setLanguage(event.target.value as ""|"he"|"en")}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><label className="lsw-field">{t.source}<input className="lsw-input" value={source} onChange={event=>setSource(event.target.value)}/></label><label className="lsw-field">{t.next}<input className="lsw-input" value={next} onChange={event=>setNext(event.target.value)}/></label><label className="lsw-field">{t.due}<input className="lsw-input" type="date" value={due} onChange={event=>setDue(event.target.value)}/></label></div><label className="lsw-field">{t.notes}<textarea className="lsw-input" value={notes} onChange={event=>setNotes(event.target.value)}/></label><button className="lsw-button lsw-button--primary" disabled={phone.trim().length<8} onClick={()=>action({action:"add",name,phone,language,source,notes,nextAction:next,dueDate:due})}>{t.add}</button></div>;
}

function ProspectCard({row,locale,action}:{row:Prospect;locale:Locale;action:(payload:unknown)=>Promise<void>}){
 const initialLanguage=knownLanguage(row),t=copy[locale],[messageLanguage,setMessageLanguage]=useState<""|"he"|"en">(initialLanguage),[message,setMessage]=useState(template(row,"return",initialLanguage)),[notes,setNotes]=useState(row.notes),[next,setNext]=useState(row.nextAction),[due,setDue]=useState(row.dueDate),[owner,setOwner]=useState(row.owner),[children,setChildren]=useState(1),[booking,setBooking]=useState("");
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
 return <article className="lsw-card"><div className="lsw-section-header"><div><h2>{row.name||row.phone}</h2><p>{row.phone} · {row.language||"—"}</p></div><span className="lsw-status">{row.stage||"New inquiry"}</span></div><div className="lsw-inline-meta"><div>{t.next}: {row.nextAction||"—"}</div><div>{t.due}: {row.dueDate||"—"}</div><div>{t.owner}: {row.owner||"—"}</div></div><div className="lsw-actions">{wa&&<a className="lsw-button lsw-button--secondary" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">{locale==="he"?"פתיחת WhatsApp":"Open WhatsApp"}</a>}{row.caseId&&<><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/cases/${encodeURIComponent(row.caseId)}`}>{locale==="he"?"פתיחת תיק הלקוח":"Open client"}</a><a className="lsw-button lsw-button--quiet" href={`/${locale}/app/feedback?caseId=${encodeURIComponent(row.caseId)}`}>{locale==="he"?"תקשורת באפליקציה":"App communications"}</a></>}</div><details className="lsw-details"><summary>{locale==="he"?"פעילות ותקשורת מתועדת":"Recorded activity and communications"}</summary><ul className="lsw-timeline">{activity.map(([label,value],index)=><li key={`${index}:${label}`}><strong>{label}</strong><span>{value}</span></li>)}</ul><p className="lsw-help">{locale==="he"?"מוצגות רשומות שנשמרו במערכת בלבד. תוכן שיחות WhatsApp אינו נטען כאן.":"Only saved app and CRM records appear here. WhatsApp conversation contents are not imported."}</p></details><details className="lsw-details"><summary>{locale==="he"?"המשך טיפול והערות":"Follow-up and notes"}</summary><div className="lsw-stack"><label className="lsw-field">{t.notes}<textarea className="lsw-input" value={notes} onChange={event=>setNotes(event.target.value)}/></label><label className="lsw-field">{t.next}<input className="lsw-input" value={next} onChange={event=>setNext(event.target.value)}/></label><div className="lsw-two-fields"><label className="lsw-field">{t.due}<input className="lsw-input" type="date" value={due} onChange={event=>setDue(event.target.value)}/></label><label className="lsw-field">{t.owner}<input className="lsw-input" value={owner} onChange={event=>setOwner(event.target.value)}/></label></div><button className="lsw-button lsw-button--secondary" onClick={()=>action({action:"update",leadId:row.leadId,fields:{notes,nextAction:next,dueDate:due,owner}})}>{t.save}</button></div></details><details className="lsw-details"><summary>WhatsApp</summary><div className="lsw-stack"><label className="lsw-field">{t.language}<select className="lsw-input" value={messageLanguage} onChange={event=>{const value=event.target.value as ""|"he"|"en";setMessageLanguage(value);setMessage(template(row,"return",value))}}><option value="">{t.any}</option><option value="he">עברית</option><option value="en">English</option></select></label><div className="lsw-actions"><button className="lsw-button lsw-button--quiet" disabled={!messageLanguage} onClick={()=>setMessage(template(row,"return",messageLanguage))}>{locale==="he"?"חזרה לפנייה":"Return inquiry"}</button><button className="lsw-button lsw-button--quiet" disabled={!messageLanguage} onClick={()=>setMessage(template(row,"missed",messageLanguage))}>{locale==="he"?"שיחה שלא נענתה":"Missed call"}</button></div><textarea className="lsw-input" value={message} onChange={event=>setMessage(event.target.value)} aria-label="WhatsApp message"/><button className="lsw-button lsw-button--primary" disabled={!messageLanguage||!message.trim()||closed(row)} onClick={()=>action({action:"send_message",leadId:row.leadId,message,nextAction:next,dueDate:due})}>{t.send}</button></div></details><details className="lsw-details"><summary>{t.sendIntake}</summary><div className="lsw-stack"><p className="lsw-help">{t.intakeHelp}</p><label className="lsw-field">{t.children}<input className="lsw-input" type="number" min="1" max="8" value={children} onChange={event=>setChildren(Number(event.target.value))}/></label><button className="lsw-button lsw-button--primary" disabled={!messageLanguage||Boolean(row.formSubmitted)||paid||closed(row)} onClick={()=>action({action:"send_intake",leadId:row.leadId,firstName:firstName(row),locale:messageLanguage,childCount:children})}>{t.sendIntake}</button></div></details><details className="lsw-details"><summary>{t.sendBooking}</summary><div className="lsw-stack">{paid?<><label className="lsw-field">{t.bookingLink}<input className="lsw-input" type="url" inputMode="url" value={booking} onChange={event=>setBooking(event.target.value)} placeholder="https://"/></label><button className="lsw-button lsw-button--primary" disabled={!messageLanguage||!booking.startsWith("https://")||active(row)||closed(row)} onClick={()=>action({action:"send_booking",leadId:row.leadId,firstName:firstName(row),locale:messageLanguage,bookingLink:booking})}>{t.sendBooking}</button></>:<p className="lsw-help">{t.paymentGate}</p>}</div></details></article>;
}
