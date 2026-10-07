"use client";
import {useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo,IdentityClientError} from "../identity/client.ts";
import {UnsavedChangesGuard} from "../../ui/workspace/draft-guard.tsx";
import {administrativeStageLabel} from "../prospects/admin-display.ts";
import {leadPreviewResultSchema,leadCommandResultSchema,type LeadPreviewResult,type LeadCommandResult,type LeadChoice} from "./core/lead-command.ts";

class CommandError extends Error{constructor(readonly status:number){super("LEAD_COMMAND_UNCONFIRMED");}}
async function request(input:unknown):Promise<unknown>{
 const session=await sessionInfo(),r=await fetch("/api/private/contact-lead-command",{method:"POST",credentials:"same-origin",cache:"no-store",
  redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(input)});
 let body;try{body=await r.json();}catch{throw new CommandError(r.status||503);}
 if(!r.ok||!body?.ok)throw new CommandError(r.status);return body.data;
}
/** Same normal practitioner application, no role shortcut, localStorage,
 * model request or provider mutation. Collapsing retains unsaved input. */
export function LeadCommandWorkspace({locale,epoch,personId,candidateId,denied,readBlocked=false}:{locale:Locale;epoch:number;personId?:string|undefined;
 candidateId?:string|undefined;denied:(status:number)=>void;readBlocked?:boolean}){
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const [input,setInput]=useState(""),[preview,setPreview]=useState<LeadPreviewResult|null>(null),[result,setResult]=useState<LeadCommandResult|null>(null),
  [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[stale,setStale]=useState(false),[message,setMessage]=useState("");
 const [activated,setActivated]=useState(false);
 const guard=useRef(false),operation=useRef<string|null>(null);
 const error=(e:unknown)=>{const status=e instanceof CommandError?e.status:e instanceof IdentityClientError&&e.code==="UNAUTHENTICATED"?401:
  e instanceof IdentityClientError&&e.code==="FORBIDDEN"?403:503;if(status===401||status===403){denied(status);return status;}
  setMessage(status===409?text("The person, preview or CRM authority changed. Your text remains here. Preview again before saving.","איש הקשר, הטיוטה או מקור הרשומות השתנו. הטקסט נשאר כאן. יש לבדוק תצוגה מקדימה חדשה לפני שמירה."):
   status===400?text("This request was not accepted. Your text remains here; check the fields and preview again.","הבקשה לא התקבלה. הטקסט נשאר כאן; יש לבדוק את הפרטים וליצור תצוגה מקדימה חדשה."):
   text("The outcome could not be confirmed. Your text is preserved; retry this exact action.","לא ניתן לאשר את התוצאה. הטקסט נשמר; יש לנסות שוב את אותה פעולה."));return status;};
 async function prepare(choice?:LeadChoice){if(guard.current||uncertain||readBlocked)return;guard.current=true;setBusy(true);setMessage("");
  try{operation.current=operation.current??crypto.randomUUID();const context=choice?(choice.candidateId?{candidateId:choice.candidateId}:{personId:choice.personId}):candidateId?{candidateId}:personId?{personId}:{};
   const p=leadPreviewResultSchema.parse(await request({action:"preview",operationId:operation.current,expectedEpoch:epoch,text:input,...context}));
   if(p.state==="ready"&&p.operationId!==operation.current)throw new CommandError(503);setPreview(p);setStale(false);setResult(null);
  }catch(e){setStale(true);error(e);}finally{guard.current=false;setBusy(false);}}
 async function apply(){if(guard.current||preview?.state!=="ready"||stale||readBlocked)return;guard.current=true;setBusy(true);setMessage("");
  try{setUncertain(true);const r=leadCommandResultSchema.parse(await request({action:"apply",token:preview.token}));
   if(r.operationId!==preview.operationId||r.authorityEpoch!==epoch||preview.personId&&r.personId!==preview.personId)throw new CommandError(503);
   setResult(r);setUncertain(false);setPreview(null);setInput("");operation.current=null;
  }catch(e){const status=error(e);if(status===400||status===409){setUncertain(false);setStale(true);operation.current=null;}}
  finally{guard.current=false;setBusy(false);}}
 return <details className="lsw-details lsu-lead-command" onToggle={e=>{if(e.currentTarget.open)setActivated(true);}}><summary>{text("Quick update","עדכון מהיר")}</summary>
  <UnsavedChangesGuard dirty={Boolean(input)||uncertain} message={text("Leave without saving this administrative command?","לצאת בלי לשמור את העדכון המנהלי?")}/>
  {activated&&<>
  <form className="lsw-stack" onSubmit={e=>{e.preventDefault();void prepare();}} aria-label={text("Quick lead update","עדכון פנייה מהיר")}>
   <p className="lsw-help">{text("Preview an administrative lead update in Hebrew or English before confirming. No message, call, case, payment or booking is made.","אפשר לבדוק עדכון מנהלי לפנייה בעברית או באנגלית לפני אישור. לא נשלחת הודעה, לא מתבצעת שיחה ולא נוצרים תיק, תשלום או תור.")}</p>
   <p className="lsw-help">{text("No AI charge. Supported phrases include name, add as a lead, stage, call Sunday, and a final Note: … . Recent caller means one unclassified call within 10 minutes. Other wording asks for clarification.","בלי חיוב AI. נתמכים שם, הוספה כפנייה, שלב, להתקשר ביום ראשון, והערה: … בסוף. מי שהתקשר עכשיו פירושו שיחה לא מסווגת אחת בעשר הדקות האחרונות. ניסוח אחר דורש הבהרה.")}</p>
   <label className="lsw-field">{text("Describe the lead update — no clinical information","תיאור העדכון לפנייה — בלי מידע טיפולי")}<textarea className="lsw-input" required maxLength={2000} value={input} disabled={busy||uncertain}
    onChange={e=>{setInput(e.target.value);setPreview(null);setResult(null);setStale(false);setMessage("");operation.current=null;}}/></label>
   <button className="lsw-button lsw-button--secondary" disabled={busy||uncertain||readBlocked||!input.trim()}>{text("Preview changes","תצוגה מקדימה של השינויים")}</button>
   {readBlocked&&<p role="status">{text("The directory must finish loading successfully before this command can be checked or saved. Your text is preserved.","יש להמתין לטעינה מוצלחת של הרשימה לפני בדיקה או שמירה. הטקסט נשמר.")}</p>}
  </form>
  {preview?.state==="clarify"&&<div className="lsw-stack" role="status"><p>{preview.reason==="unsupported"?text("I could not safely understand every part. Use the supported phrases or the existing manual controls. Nothing was saved.","לא ניתן היה להבין בבטחה את כל הבקשה. אפשר להשתמש בניסוחים הנתמכים או בבקרות הידניות הקיימות. דבר לא נשמר."):
   preview.reason==="reserved"?text("This endpoint is reserved, archived or opted out. No identity was merged or changed.","המספר שמור, בארכיון או ללא הרשאת קשר. זהויות לא אוחדו ולא השתנו."):
   preview.reason==="name"?text("Confirm a normal name before creating this lead. Nothing was saved.","יש לאשר שם רגיל לפני יצירת הפנייה. דבר לא נשמר."):
   text("Choose the intended caller/person, select an existing record, or include the exact phone number. Nothing was saved.","יש לבחור את המתקשר או איש הקשר המתאים, לפתוח רשומה קיימת או לציין מספר טלפון מדויק. דבר לא נשמר.")}</p>
   {preview.choices.map(choice=><button key={choice.candidateId??choice.personId} type="button" className="lsw-button lsw-button--secondary" disabled={busy||readBlocked} onClick={()=>void prepare(choice)}>{choice.name||choice.phone} · <bdi>{choice.phone}</bdi>{choice.occurredAt&&<> · <time dateTime={choice.occurredAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(choice.occurredAt))}</time></>}</button>)}
  </div>}
  {preview?.state==="ready"&&<section className="lsw-card lsw-stack" aria-label={text("Confirm CRM changes","אישור שינויים במערכת אנשי הקשר")}>
   <h3>{preview.name} · <bdi>{preview.phone}</bdi></h3><p>{preview.intent.notLead?text("Mark the unclassified event not a lead; original receipt stays.","סימון האירוע הלא מסווג כלא פנייה עסקית; הקבלה המקורית נשארת."):
    preview.personId?text("Update this existing administrative person; no duplicate is created.","עדכון איש הקשר המנהלי הקיים; לא נוצרת כפילות."):text("Create one administrative lead.","יצירת פנייה מנהלית אחת.")}</p>
   {preview.existingName&&preview.intent.name&&preview.intent.name!==preview.existingName&&<p>{text("Existing name is preserved:","השם הקיים נשמר:")} {preview.existingName}</p>}
   {preview.intent.stage&&<p>{text("Status:","מצב:")} {administrativeStageLabel(preview.intent.stage,locale)}</p>}
   {preview.intent.note&&<p className="lsw-preserve-lines">{text("Append note:","הוספת הערה:")} {preview.intent.note}</p>}
   {preview.intent.nextAction&&<p>{text("Next action:","הפעולה הבאה:")} {preview.intent.nextAction} · <bdi className="lsu-command-date">{preview.intent.dueDate}</bdi></p>}
   {(preview.intent.google||preview.intent.whatsapp)&&<p className="lsw-help">{text("Requested labels are unavailable until their runtime connection/write is verified. Saving CRM does not apply Google or WhatsApp labels.","התוויות המבוקשות אינן זמינות עד לאימות החיבור והשינוי אצל הספק. שמירה במערכת אנשי הקשר אינה מחילה תוויות Google או WhatsApp.")}</p>}
   <div className="lsw-actions"><button type="button" className="lsw-button lsw-button--primary" disabled={busy||stale||readBlocked} onClick={()=>void apply()}>{text(uncertain?"Retry this exact save":"Confirm CRM update",uncertain?"ניסיון חוזר של אותה שמירה":"אישור העדכון")}</button>
    <button type="button" className="lsw-button lsw-button--secondary" disabled={busy||uncertain} onClick={()=>{setPreview(null);setStale(false);operation.current=null;}}>{text("Cancel — keep my text","ביטול — שמירת הטקסט שלי")}</button></div>
  </section>}
  {message&&<p role="alert">{message}</p>}
  {result&&<div className="lsw-card" role="status"><p>{text("CRM save confirmed. Open the saved person to read the current record. No provider action was performed.","השמירה במערכת אנשי הקשר אושרה. אפשר לפתוח את איש הקשר השמור ולקרוא את הרשומה העדכנית. לא בוצעה פעולה אצל ספק.")}</p>
   {result.personId&&<a href={`/${locale}/app/clients?personId=${result.personId}`}>{text("Open saved person","פתיחת איש הקשר השמור")}</a>}
   {result.noteAppended&&<p>{text("Note saved without replacing prior notes.","ההערה נשמרה בלי להחליף הערות קודמות.")}</p>}
   {result.nextActionSaved&&<p>{text("Next action/date saved.","הפעולה הבאה והתאריך נשמרו.")}</p>}
   {result.projections.google==="unavailable"&&<p>Google · Life Skills Lead: {text("unavailable — not applied","לא זמין — לא הוחל")}</p>}
   {result.projections.whatsapp==="unavailable"&&<p>WhatsApp · LS • Lead: {text("unavailable — not applied","לא זמין — לא הוחל")}</p>}
  </div>}
  </>}
 </details>;
}
