"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {conversationCommandSchema,CONVERSATION_305_LINE,type ConversationCommand} from "./contract.ts";
import type {Owner305ConversationStore} from "./store.ts";
import {Owner305InboundPanel} from "./inbound-panel.tsx";
import {InquiryLinkPanel} from "./inquiry-link-panel.tsx";


type Page=Awaited<ReturnType<Owner305ConversationStore["list"]>>;
type Detail=Awaited<ReturnType<Owner305ConversationStore["read"]>>;
type Classification="fishing"|"bna"|"both"|"support"|"provider"|"support_provider"|"unclassified";
type Channel="phone"|"whatsapp"|"sms"|"other";
type Draft={channel:Channel;contactHint:string;classification:Classification;note:string;nextAction:string;dueDate:string;waitingCondition:string};
const empty:Draft={channel:"phone",contactHint:"",classification:"unclassified",note:"",nextAction:"",dueDate:"",waitingCondition:""};
class RequestError extends Error{constructor(readonly status:number){super("OWNER_305_REQUEST_FAILED");}}
async function get<T>(id?:string,before?:string,historyBefore?:number):Promise<T>{const query=id?new URLSearchParams({id,...(historyBefore===undefined?{}:{historyBefore:String(historyBefore)})}):before?new URLSearchParams({before}):null;const response=await fetch("/api/private/owner-305-conversations"+(query?"?"+query:""),
 {credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw new RequestError(response.status);return body.data as T;}
/** Owner-entered records only; no provider history scan or Person association. */
export function Owner305ConversationPanel({locale,initialId,onOperationPending,linksEnabled=false,inboundEnabled=false}:{locale:Locale;initialId?:string|undefined;onOperationPending?:(pending:boolean)=>void;linksEnabled?:boolean;inboundEnabled?:boolean}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [page,setPage]=useState<Page|null>(null),[detail,setDetail]=useState<Detail|null>(null),[draft,setDraft]=useState<Draft>(empty);
 const [pending,setPending]=useState<ConversationCommand|null>(null),[busy,setBusy]=useState(false),[opening,setOpening]=useState(false),[loadingMore,setLoadingMore]=useState(false),[loadingHistory,setLoadingHistory]=useState(false),[error,setError]=useState<number|null>(null),[message,setMessage]=useState("");
 const [linkPending,setLinkPending]=useState(false);
 const [sourceReceiptKey,setSourceReceiptKey]=useState<string|null>(null),[inboundRefresh,setInboundRefresh]=useState(0);
 const active=useRef(true),serial=useRef(0);
 const clearPrivate=useCallback(()=>{setPage(null);setDetail(null);setDraft(empty);setPending(null);setOpening(false);setSourceReceiptKey(null);},[]);
 const load=useCallback(async(before?:string)=>{const seq=++serial.current;setOpening(false);if(before)setLoadingMore(true);try{const value=await get<Page>(undefined,before);if(active.current&&serial.current===seq){setPage(current=>before&&current&&current.nextCursor===before?{...value,items:[...new Map([...current.items,...value.items].map(item=>[item.id,item])).values()]}:before?current:value);setError(null);}}
  catch(cause){if(active.current&&serial.current===seq){const code=cause instanceof RequestError?cause.status:503;setError(code);if([401,403,404].includes(code))clearPrivate();}}finally{if(active.current&&before)setLoadingMore(false);}},[clearPrivate]);
 const open=useCallback(async(id:string)=>{const seq=++serial.current;setDetail(null);setDraft(empty);setMessage("");setOpening(true);try{const value=await get<Detail>(id);if(!active.current||serial.current!==seq)return false;
   setDetail(value);setSourceReceiptKey(null);setDraft({channel:value.channel,contactHint:value.contactHint,classification:value.followup.classification,
    note:"",nextAction:value.followup.nextAction??"",dueDate:value.followup.dueDate??"",waitingCondition:value.followup.waitingCondition??""});setError(null);return true;
  }catch(cause){if(active.current&&serial.current===seq){const code=cause instanceof RequestError?cause.status:503;setError(code);if([401,403,404].includes(code))clearPrivate();}return false;}
  finally{if(active.current&&serial.current===seq)setOpening(false);}},[clearPrivate]);
 useEffect(()=>{let cancelled=false;const sequence=serial;active.current=true;const timer=window.setTimeout(()=>{void load().then(()=>{if(!cancelled&&active.current&&initialId)void open(initialId);});},0);return()=>{cancelled=true;window.clearTimeout(timer);active.current=false;sequence.current++;};},[load,open,initialId]);
 useEffect(()=>{onOperationPending?.(pending!==null||linkPending);},[pending,linkPending,onOperationPending]);
 async function loadHistory(){if(!detail||busy||pending||linkPending||loadingHistory||!detail.hasMoreHistory||!detail.history.length)return;
  const id=detail.id,before=detail.history[detail.history.length-1]!.version,seq=++serial.current;setLoadingHistory(true);
  try{const page=await get<Detail>(id,undefined,before);if(active.current&&serial.current===seq){
   if(page.followup.version!==detail.followup.version){setError(409);return;}
   setDetail(current=>current?.id===id&&current.followup.version===detail.followup.version?{...current,history:[...current.history,...page.history],hasMoreHistory:page.hasMoreHistory}:current);setError(null);}}
  catch(cause){if(active.current&&serial.current===seq){const code=cause instanceof RequestError?cause.status:503;setError(code);if([401,403,404].includes(code))clearPrivate();}}
  finally{if(active.current)setLoadingHistory(false);}}
 async function save(command:ConversationCommand){if(busy)return;const previouslyUnknown=pending!==null;setBusy(true);setPending(command);setError(null);setMessage("");

  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new RequestError(403);
   const response=await fetch("/api/private/owner-305-conversations",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",
    headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(command)});
   const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw new RequestError(response.status);
   setPending(null);setInboundRefresh(value=>value+1);await load();if(await open(body.data.id as string))setMessage(t("Conversation saved and read back.","השיחה נשמרה ונקראה מחדש."));
  }catch(cause){const code=cause instanceof RequestError?cause.status:503;setError(code);if(!previouslyUnknown&&[400,401,403,404,409].includes(code))setPending(null);

   if([401,403,404].includes(code))clearPrivate();}finally{setBusy(false);}}
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(pending||opening||linkPending||loadingHistory)return;
  const followup={classification:draft.classification,note:draft.note,nextAction:draft.nextAction.trim()||null,
   dueDate:draft.dueDate||null,waitingCondition:draft.waitingCondition.trim()||null};
  const raw=detail?{kind:"revise",operationId:crypto.randomUUID(),conversationId:detail.id,expectedVersion:detail.followup.version,followup}:
   {kind:"create",operationId:crypto.randomUUID(),channel:draft.channel,contactHint:draft.contactHint,...(sourceReceiptKey?{sourceReceiptKey}:{}),followup};
  if(draft.classification==="support_provider"){setError(400);return;}

  const parsed=conversationCommandSchema.safeParse(raw);if(!parsed.success){setError(400);return;}void save(parsed.data);
 }
 const labels:Record<Classification,[string,string]>={fishing:["Fishing","דיג"],bna:["BNA Torah","תורה בבני נביאים"],both:["Both","שניהם"],
  support:["Support","תמיכה"],provider:["Provider","ספק"],support_provider:["Support or provider — choose one","תמיכה או ספק — יש לבחור אחד"],unclassified:["Unclassified","טרם סווג"]};
 if(error===404)return null;
 return <section className="lsw-card" lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-label={t("305 conversations","שיחות קו 305")}>
  {inboundEnabled&&page&&<Owner305InboundPanel locale={locale} disabled={busy||!!pending||linkPending||opening||loadingHistory} refreshKey={inboundRefresh} onRecord={item=>{if(item.linkedConversationId){void open(item.linkedConversationId);return;}setDetail(null);setSourceReceiptKey(item.id);setDraft({...empty,channel:"whatsapp",contactHint:item.fromNumber??item.pushName??""});setError(null);}}/>}
  <h2>{t("305 conversations","שיחות קו 305")}</h2>
  <p><bdi dir="ltr">{CONVERSATION_305_LINE}</bdi> · {t("Enter conversations you handled manually. This does not import or merge a contact, capture provider history, or send a message.","תיעוד ידני של שיחות שטיפלת בהן. אין כאן יבוא או מיזוג אנשי קשר, קליטת היסטוריית ספק או שליחת הודעה.")}</p>
  {error!==null&&<div role="alert" className="lsw-alert"><p>{error===401?t("Sign in again.","יש להיכנס מחדש."):
   error===403?t("This account cannot view the 305 register.","לחשבון זה אין גישה ליומן שיחות 305."):
   error===409&&!pending?t("The record changed. Reload it before saving.","הרשומה השתנתה. יש לרענן לפני שמירה."):
   error===400&&!pending?t("Add a note and either a dated next action or a waiting condition.","יש להוסיף הערה ופעולה הבאה עם תאריך או תנאי המתנה."):
   t("Read or save could not be confirmed. The register is not shown as empty.","לא ניתן לאשר קריאה או שמירה. היומן אינו מוצג כריק.")}</p>
   {error===401?<a href={`/${locale}/login`}>{t("Sign in","כניסה")}</a>:<button type="button" onClick={()=>void load()}>{t("Retry read","ניסיון קריאה נוסף")}</button>}</div>}
  {message&&<p role="status">{message}</p>}
  {pending&&!busy&&<div role="status" className="lsw-alert"><p>{t("Save outcome unknown. Retry this exact operation.","תוצאת השמירה אינה ידועה. יש לנסות שוב את אותה פעולה בדיוק.")}</p>
   <button type="button" onClick={()=>void save(pending)}>{t("Retry same save","ניסיון חוזר לאותה שמירה")}</button></div>}
  {!page&&error===null&&<p role="status">{t("Loading…","טוען…")}</p>}
  {page&&<div className="lsw-stack"><p>{page.items.length===0?t("No conversations recorded yet.","עדיין לא תועדו שיחות."):
   t(`${page.items.length} conversations shown`,`${page.items.length} שיחות מוצגות`)}</p>
   <ul>{page.items.map(item=><li key={item.id}><button type="button" disabled={busy||!!pending||linkPending} onClick={()=>void open(item.id)}>
    {item.contactHint} · {t(...labels[item.followup.classification])} · {item.createdAt}</button></li>)}</ul>
   {page.nextCursor&&<button type="button" disabled={loadingMore||busy||!!pending||linkPending} onClick={()=>void load(page.nextCursor!)}>{loadingMore?t("Loading…","טוען…"):t("Load older conversations","טעינת שיחות קודמות")}</button>}</div>}
  <button type="button" disabled={busy||!!pending||linkPending} onClick={()=>{++serial.current;setOpening(false);setDetail(null);setSourceReceiptKey(null);setDraft(empty);setError(null);setMessage("");}}>{t("New 305 conversation","שיחת 305 חדשה")}</button>
  {opening&&<p role="status">{t("Loading conversation…","טוען שיחה…")}</p>}

  {detail&&<div className="lsw-stack"><h3>{detail.contactHint}</h3><p>{t("Channel","ערוץ")}: {detail.channel} · {t("Recorded","תועד")}: {detail.createdAt}</p>
   {detail.sourceReceiptKey&&<p>{t("Linked to a received 305 WhatsApp message.","מקושר להודעת WhatsApp שהתקבלה בקו 305.")}</p>}
   <p>{t("Current classification","סיווג נוכחי")}: {t(...labels[detail.followup.classification])}</p>
   <ol>{detail.history.map(item=><li key={item.operationId}><time dateTime={item.recordedAt}>{item.recordedAt}</time> · {t(...labels[item.classification])} · {item.note}
    {item.nextAction&&<> · {item.nextAction} ({item.dueDate})</>}{item.waitingCondition&&<> · {item.waitingCondition}</>}</li>)}</ol>
   {detail.hasMoreHistory&&<button type="button" disabled={loadingHistory||busy||!!pending||linkPending} onClick={()=>void loadHistory()}>{t("Load older history","טעינת היסטוריה קודמת")}</button>}
   {linksEnabled&&<InquiryLinkPanel key={detail.id} locale={locale} conversationId={detail.id} onPending={setLinkPending} disabled={busy||!!pending}/>}</div>}
  {!opening&&<form onSubmit={submit} className="lsw-stack"><h3>{detail?t("Update classification and follow-up","עדכון סיווג ומעקב"):t("Record a conversation","תיעוד שיחה")}</h3>
   {!detail&&<><label>{t("Channel","ערוץ")}<select value={draft.channel} onChange={event=>setDraft({...draft,channel:event.target.value as Channel})}>

    <option value="phone">{t("Phone","טלפון")}</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="other">{t("Other","אחר")}</option></select></label>
    <label>{t("Contact hint you recognize","פרט מזהה לזיהוי השיחה")}<input required maxLength={160} value={draft.contactHint} onChange={event=>setDraft({...draft,contactHint:event.target.value})}/></label></>}
   {draft.classification==="support_provider"&&<p role="status">{t("This older record combines support and provider. Choose its actual purpose before saving an update.","רשומה קודמת זו משלבת תמיכה וספק. בחרו את המטרה המתאימה לפני שמירת עדכון.")}</p>}
   <label>{t("Classification","סיווג")}<select value={draft.classification} onChange={event=>setDraft({...draft,classification:event.target.value as Classification})}>
    {(Object.keys(labels) as Classification[]).map(value=><option key={value} value={value} disabled={value==="support_provider"}>{t(...labels[value])}</option>)}</select></label>
   <label>{t("Private note","הערה פרטית")}<textarea required maxLength={5000} value={draft.note} onChange={event=>setDraft({...draft,note:event.target.value})}/></label>
   <label>{t("Next action","פעולה הבאה")}<input maxLength={500} value={draft.nextAction} onChange={event=>setDraft({...draft,nextAction:event.target.value})}/></label>
   <label>{t("Action date","תאריך פעולה")}<input type="date" value={draft.dueDate} onChange={event=>setDraft({...draft,dueDate:event.target.value})}/></label>
   <label>{t("Or waiting condition","או תנאי המתנה")}<input maxLength={500} value={draft.waitingCondition} onChange={event=>setDraft({...draft,waitingCondition:event.target.value})}/></label>
   <button type="submit" disabled={busy||!!pending||linkPending||loadingHistory}>{detail?t("Save update","שמירת עדכון"):t("Save conversation","שמירת שיחה")}</button>
  </form>}
 </section>;
}
