"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {IdentityClientError,sessionInfo} from "../identity/client.ts";
import {loginHref} from "../identity/login-return.ts";
import {normalizePhone} from "./core/contact-resolution.ts";
import {academyCrmCommandSchema,type AcademyActivity,type AcademyContact,type AcademyCrmCommand,
 type AcademyCrmPage,type AcademyCrmResult} from "./core/academy-crm.ts";
import type {AcademyCrmStore} from "./server/academy-crm-store.ts";
import "./academy-crm.css";

type Detail=Awaited<ReturnType<AcademyCrmStore["read"]>>;
type Inquiry=Awaited<ReturnType<AcademyCrmStore["previewInquiry"]>>;
class RequestError extends Error{constructor(readonly status:number){super("ACADEMY_CRM_REQUEST_FAILED");}}
const errorStatus=(cause:unknown)=>cause instanceof RequestError?cause.status:cause instanceof IdentityClientError?
 ({UNAUTHENTICATED:401,FORBIDDEN:403,INVALID_REQUEST:400,NOT_FOUND:404,CONFLICT:409,RATE_LIMITED:429,UNAVAILABLE:503,INTERNAL:503}[cause.code]):503;
async function read<T>(query:Record<string,string>={}):Promise<T>{
 const response=await fetch("/api/private/academy-crm?"+new URLSearchParams(query),
  {credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw new RequestError(response.status);return body.data as T;
}
const blankFields={stage:"New inquiry",nextAction:null,followUpDate:null,notes:""};
export function AcademyCrmWorkspace({locale,initialInquiryId,initialPersonId}:{locale:Locale;initialInquiryId?:string|undefined;initialPersonId?:string|undefined}){
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const [page,setPage]=useState<AcademyCrmPage|null>(null),[search,setSearch]=useState(""),[detail,setDetail]=useState<Detail|null>(null);
 const [inquiry,setInquiry]=useState<Inquiry|null>(null),[error,setError]=useState<number|null>(null),[message,setMessage]=useState("");
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<AcademyCrmCommand|null>(null),[creating,setCreating]=useState(false);
 const [confirmedOperationId,setConfirmedOperationId]=useState<string|null>(null);
 const active=useRef(true),serial=useRef(0),detailSerial=useRef(0);
 const showError=useCallback((cause:unknown)=>{
  const status=errorStatus(cause);if(!active.current)return status;
  setError(status);
  if(status===401||status===403){
   serial.current++;detailSerial.current++;setPage(null);setDetail(null);setInquiry(null);
   setPending(null);setCreating(false);setMessage("");setConfirmedOperationId(null);
  }
  return status;
 },[]);
 const load=useCallback(async(query="",number=1)=>{
  const request=++serial.current;
  try{const value=await read<AcademyCrmPage>({search:query,page:String(number)});
   if(active.current&&serial.current===request){setPage(value);setError(null);}
   return value;
  }catch(cause){if(active.current&&serial.current===request)showError(cause);return null;}
 },[showError]);
 const open=useCallback(async(personId:string,epoch:number)=>{
  const request=++detailSerial.current;
  try{const value=await read<Detail>({personId,expectedEpoch:String(epoch)});if(active.current&&detailSerial.current===request){setDetail(value);setCreating(false);setInquiry(null);setError(null);}}
  catch(cause){if(active.current&&detailSerial.current===request)showError(cause);}
 },[showError]);
 useEffect(()=>{
  const live=active,listRequests=serial,detailRequests=detailSerial;let cancelled=false;live.current=true;
  const timer=window.setTimeout(()=>{void load().then(async value=>{
   if(cancelled||!live.current)return;
   if(value?.state==="ready"&&initialPersonId){await open(initialPersonId,value.authorityEpoch);return;}
   if(value?.state==="ready"&&initialInquiryId){
    try{const preview=await read<Inquiry>({inquiryId:initialInquiryId,expectedEpoch:String(value.authorityEpoch)});
     if(!cancelled&&live.current){if(preview.existingPersonId)await open(preview.existingPersonId,value.authorityEpoch);
      else{detailRequests.current++;setDetail(null);setInquiry(preview);setCreating(true);}}}
    catch(cause){if(!cancelled)showError(cause);}
   }
  });},0);
  return()=>{cancelled=true;window.clearTimeout(timer);live.current=false;listRequests.current++;detailRequests.current++;};
 },[load,initialInquiryId,initialPersonId,open,showError]);
 async function save(command:AcademyCrmCommand){
  if(busy)return;setBusy(true);setMessage("");setError(null);
  let prepared:AcademyCrmCommand;
  try{prepared=academyCrmCommandSchema.parse(command);}catch{setError(400);setBusy(false);return;}
  setPending(prepared);
  try{
   const session=await sessionInfo(),response=await fetch("/api/private/academy-crm",{method:"POST",credentials:"same-origin",
    cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},
    body:JSON.stringify(prepared)});
   const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw new RequestError(response.status);
   const result=body.data as AcademyCrmResult;setPending(null);setConfirmedOperationId(result.operationId);
   await load(search,page?.state==="ready"?page.page:1);await open(result.personId,result.authorityEpoch);
   setMessage(text("Saved.","נשמר."));return true;
  }catch(cause){const status=showError(cause);
   // Unknown outcomes retain the exact operation. A retry cannot create a
   // second person or overwrite a later edit with a new idempotency key.
   if([400,401,403,404,409].includes(status))setPending(null);return false;
  }finally{setBusy(false);}
 }
 const statusText=error===401?text("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):
  error===403?text("This account cannot access the Academy CRM.","לחשבון הזה אין גישה לרשימת האקדמיה."):
  error===404?text("That Academy record is not available.","רשומת האקדמיה הזו אינה זמינה."):
  error===409?text("The saved record changed or this contact already exists. Reload before saving again.","הרשומה השתנתה או שאיש הקשר כבר קיים. יש לרענן לפני שמירה נוספת."):
  error===400?text("Check the name, phone or email, and the date.","יש לבדוק את השם, הטלפון או הדוא״ל ואת התאריך."):
  text("The request could not be confirmed. Your draft is still here.","לא ניתן לאשר שהבקשה הושלמה. הטיוטה עדיין כאן.");
 return <main className="lsw-main academy-crm" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><div><h1>{text("Academy people","אנשי האקדמיה")}</h1>
   <p>{text("Contacts, conversation notes and next actions.","אנשי קשר, סיכומי שיחות ופעולות הבאות.")}</p></div>
   <a href={`/${locale}/app/group-applications?program=sunday_fishing_academy`}>{text("Academy inquiries","פניות לאקדמיה")}</a></header>
  {error!==null&&<div className="lsw-alert" role="alert"><p>{statusText}</p>
   {error===401?<a href={loginHref(locale,`/${locale}/app/clients`)}>{text("Sign in","כניסה")}</a>:
    pending?null:
    <button className="lsw-button" disabled={busy} onClick={()=>{void load(search);if(detail)void open(detail.contact.personId,detail.authorityEpoch);}}>{text("Reload saved records","רענון הרשומות השמורות")}</button>}</div>}
  {message&&<p role="status">{message}</p>}
  {pending&&!busy&&<div role="status" className="lsw-alert"><p>{text("The save is not confirmed yet. Retry to check the same operation.","השמירה עדיין לא אושרה. ניסיון חוזר יבדוק את אותה פעולה.")}</p>
   <button className="lsw-button" onClick={()=>void save(pending)}>{text("Retry the same save","ניסיון חוזר לאותה שמירה")}</button></div>}
  {!page&&error===null&&<p role="status">{text("Loading Academy contacts…","טוען אנשי קשר של האקדמיה…")}</p>}
  {page?.state==="setup_required"&&<section className="lsw-card"><h2>{text("Academy CRM setup is pending","הגדרת רשימת האקדמיה ממתינה")}</h2>
   <p>{text("The fresh Academy contact list is not initialized yet. Your saved Academy inquiries remain available.","רשימת אנשי הקשר החדשה של האקדמיה עדיין לא אותחלה. הפניות השמורות לאקדמיה זמינות.")}</p></section>}
  {page?.state==="ready"&&<>
   <form className="academy-crm-toolbar" onSubmit={event=>{event.preventDefault();void load(search);}}>
    <label>{text("Search Academy contacts","חיפוש באנשי האקדמיה")}<input disabled={busy||pending!==null} value={search} maxLength={200} onChange={event=>setSearch(event.target.value)}/></label>
    <button className="lsw-button" type="submit" disabled={busy||pending!==null}>{text("Search","חיפוש")}</button>
    <button className="lsw-button lsw-button--primary" type="button" disabled={busy||pending!==null} onClick={()=>{detailSerial.current++;setCreating(true);setInquiry(null);setDetail(null);setMessage("");}}>{text("Add contact","הוספת איש קשר")}</button>
   </form>
   <div className="academy-crm-columns"><section aria-label={text("Academy contact list","רשימת אנשי האקדמיה")}>
    <p>{text(`${page.total} contacts`,`${page.total} אנשי קשר`)}</p>
    {page.items.length===0&&<p>{search?text("No Academy contacts match this search.","לא נמצאו אנשי קשר שמתאימים לחיפוש."):text("Your Academy contact list is empty. Add a contact or open a saved Academy inquiry.","רשימת האקדמיה ריקה. אפשר להוסיף איש קשר או לפתוח פנייה שמורה לאקדמיה.")}</p>}
    {page.items.map(row=><article className="lsw-card academy-crm-row" key={row.personId}>
     <h2><button type="button" disabled={busy||pending!==null} onClick={()=>void open(row.personId,page.authorityEpoch)}>{row.name}</button></h2>
     <p><bdi dir="ltr">{row.origin.email??row.origin.phone}</bdi></p><p>{row.fields.stage}</p>
     {row.fields.nextAction&&<p><strong>{text("Next:","הפעולה הבאה:")}</strong> {row.fields.nextAction}</p>}
     {row.fields.followUpDate&&<time dateTime={row.fields.followUpDate}>{row.fields.followUpDate}</time>}
    </article>)}
    <nav className="academy-crm-pages" aria-label={text("Contact pages","עמודי אנשי קשר")}>
     <button disabled={page.page===1||busy||pending!==null} onClick={()=>void load(search,page.page-1)}>{text("Previous","הקודם")}</button>
     <span>{page.page}</span><button disabled={page.page*page.pageSize>=page.total||busy||pending!==null} onClick={()=>void load(search,page.page+1)}>{text("Next","הבא")}</button>
    </nav>
   </section><section className="lsw-card" aria-label={text("Contact details","פרטי איש קשר")}>
    {creating?<ContactEditor key={inquiry?.sourceApplicationId??"new"} locale={locale} inquiry={inquiry} epoch={page.authorityEpoch} busy={busy||pending!==null} save={save}/>:
     detail?<><ContactEditor key={`${detail.contact.personId}:${detail.contact.version}`} locale={locale} contact={detail.contact} epoch={detail.authorityEpoch} busy={busy||pending!==null} save={save}/>
      <ConversationHistory key={detail.contact.personId} locale={locale} detail={detail} confirmedOperationId={confirmedOperationId} busy={busy||pending!==null} save={save}/></>:
     <p>{text("Choose a contact to see its notes and next action.","בחרו איש קשר כדי לראות סיכומי שיחות ואת הפעולה הבאה.")}</p>}
   </section></div>
  </>}
 </main>;
}
function ContactEditor({locale,contact,inquiry,epoch,busy,save}:{locale:Locale;contact?:AcademyContact;inquiry?:Inquiry|null;
 epoch:number;busy:boolean;save:(command:AcademyCrmCommand)=>Promise<boolean|undefined>}){
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const [name,setName]=useState(contact?.name??inquiry?.name??""),[phone,setPhone]=useState(contact?.origin.phone??inquiry?.phone??"");
 const [email,setEmail]=useState(contact?.origin.email??inquiry?.email??""),[relationship,setRelationship]=useState<"guardian"|"adult_partner">("guardian");
 const [fields,setFields]=useState(contact?.fields??blankFields);
 const submit=(event:FormEvent)=>{event.preventDefault();const base={operationId:crypto.randomUUID(),expectedEpoch:epoch};
  const command:AcademyCrmCommand=contact?{...base,action:"update",personId:contact.personId,expectedVersion:contact.version,fields}:
   inquiry?{...base,action:"from_inquiry",sourceApplicationId:inquiry.sourceApplicationId,sourceDigest:inquiry.sourceDigest,fields}:
   {...base,action:"create",fields:{...fields,name,phone:phone.trim()?normalizePhone(phone)??phone.trim():null,
    email:email.trim()?email.trim().toLowerCase():null,language:locale,relationship}};
  void save(command);
 };
 return <form onSubmit={submit}><h2>{contact?contact.name:inquiry?text("Add this Academy inquiry","הוספת הפנייה לאקדמיה"):text("New Academy contact","איש קשר חדש לאקדמיה")}</h2>
  {inquiry&&<p>{text("Review these saved inquiry details before adding the contact.","יש לבדוק את פרטי הפנייה השמורה לפני הוספת איש הקשר.")}</p>}
  <fieldset disabled={busy} className="academy-crm-fields"><legend className="academy-crm-sr">{text("Contact information","פרטי איש הקשר")}</legend>
   <label>{text("Name","שם")}<input value={name} readOnly={Boolean(contact||inquiry)} required maxLength={120} onChange={event=>setName(event.target.value)}/></label>
   <label>{text("Phone","טלפון")}<input type="tel" dir="ltr" value={phone} readOnly={Boolean(contact||inquiry)} maxLength={64} onChange={event=>setPhone(event.target.value)}/></label>
   <label>{text("Email","דוא״ל")}<input type="email" dir="ltr" value={email} readOnly={Boolean(contact||inquiry)} maxLength={254} onChange={event=>setEmail(event.target.value)}/></label>
   {!contact&&!inquiry&&<><p>{text("A phone number or email is required.","נדרש מספר טלפון או דוא״ל.")}</p><label>{text("Relationship","קשר לאקדמיה")}<select value={relationship} onChange={event=>setRelationship(event.target.value as typeof relationship)}><option value="guardian">{text("Parent / guardian","הורה / אפוטרופוס")}</option><option value="adult_partner">{text("Adult / partner","מבוגר / שותף")}</option></select></label></>}
   <label>{text("Status","מצב")}<input required maxLength={120} value={fields.stage} onChange={event=>setFields({...fields,stage:event.target.value})}/></label>
   <label>{text("Next action","הפעולה הבאה")}<input maxLength={500} value={fields.nextAction??""} onChange={event=>setFields({...fields,nextAction:event.target.value||null})}/></label>
   <label>{text("Follow-up date","תאריך מעקב")}<input type="date" value={fields.followUpDate??""} onChange={event=>setFields({...fields,followUpDate:event.target.value||null})}/></label>
   <label>{text("Contact notes","הערות לאיש הקשר")}<textarea rows={4} maxLength={5000} value={fields.notes} onChange={event=>setFields({...fields,notes:event.target.value})}/></label>
   <button className="lsw-button lsw-button--primary" type="submit">{busy?text("Saving…","שומר…"):contact?text("Save changes","שמירת שינויים"):text("Add to Academy CRM","הוספה לרשימת האקדמיה")}</button>
  </fieldset>
  <p className="lsw-help">{text("Saving a contact records it privately. Sending messages is a separate action.","שמירת איש קשר מתעדת אותו באופן פרטי. שליחת הודעות היא פעולה נפרדת.")}</p>
 </form>;
}
function ConversationHistory({locale,detail,confirmedOperationId,busy,save}:{locale:Locale;detail:Detail;confirmedOperationId:string|null;busy:boolean;save:(command:AcademyCrmCommand)=>Promise<boolean|undefined>}){
 const [draft,setDraft]=useState<{text:string;operationId:string|null}>({text:"",operationId:null});
 const note=draft.operationId!==null&&draft.operationId===confirmedOperationId?"":draft.text;
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const label=(kind:AcademyActivity["kind"])=>kind==="note"?text("Conversation note","סיכום שיחה"):kind==="created"?text("Contact added","איש קשר נוסף"):text("Details updated","הפרטים עודכנו");
 return <section className="academy-crm-history"><h2>{text("Conversation history","היסטוריית שיחות")}</h2>
  <form onSubmit={event=>{event.preventDefault();const operationId=crypto.randomUUID();setDraft({text:note,operationId});void save({action:"note",personId:detail.contact.personId,expectedVersion:detail.contact.version,
   expectedEpoch:detail.authorityEpoch,operationId,text:note}).then(saved=>{if(saved)setDraft({text:"",operationId:null});});}}>
   <label>{text("Record a conversation note","תיעוד סיכום שיחה")}<textarea rows={3} required maxLength={5000} disabled={busy} value={note} onChange={event=>setDraft({text:event.target.value,operationId:null})}/></label>
   <button className="lsw-button" disabled={busy||!note.trim()}>{text("Save note","שמירת סיכום")}</button>
  </form>
  {detail.history.map(item=><article key={item.operationId}><h3>{label(item.kind)}</h3><time dateTime={item.recordedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"medium",timeStyle:"short"}).format(new Date(item.recordedAt))}</time>
   {item.text&&<p className="academy-crm-note">{item.text}</p>}{item.fields?.nextAction&&<p>{text("Next action:","הפעולה הבאה:")} {item.fields.nextAction}</p>}</article>)}
  {detail.historyHasMore&&<p>{text("Showing the 50 most recent entries.","מוצגים 50 העדכונים האחרונים.")}</p>}
 </section>;
}
