"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import type {BnaPreferenceStore} from "./preferences-store.ts";
import {bnaOwnerPreferenceCommand,type BnaOwnerPreferenceCommand} from "./preferences-contract.ts";
type Readback=Awaited<ReturnType<BnaPreferenceStore["readOwner"]>>;
const actions=[
 ["pause_relationship","Pause this program","השהיית תוכנית זו"],["resume_relationship","Resume this program","חידוש תוכנית זו"],
 ["pause_all","Pause all BNA optional email","השהיית כל העדכונים של בני נביאים"],["resume_all","Resume all BNA optional email","חידוש כל העדכונים של בני נביאים"],
 ["withdraw_relationship","Record unsubscribe from this program","תיעוד הסרה מתוכנית זו"],["withdraw_all","Record unsubscribe from all BNA updates","תיעוד הסרה מכל העדכונים"],
 ["record_reply","Record a reply awaiting triage","תיעוד תשובה הממתינה לטיפול"],["triage_reply","Mark the reply reviewed","סימון התשובה כטופלה"],
 ["record_invalid","Record an invalid email address","תיעוד כתובת דוא״ל לא תקינה"],["resolve_invalid","Record verified address recovery","תיעוד אימות מחודש של הכתובת"],
 ["record_complaint","Record a complaint","תיעוד תלונה"],["resolve_complaint","Record complaint resolution","תיעוד טיפול בתלונה"],
] as const;
class PreferenceError extends Error{constructor(readonly status:number){super("BNA_PREFERENCE_REQUEST_FAILED");}}
export function BnaPreferencesOwnerPanel({id,locale,disabled=false,onOperationPending}:{id:string;locale:Locale;disabled?:boolean;onOperationPending?:(pending:boolean)=>void}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [data,setData]=useState<Readback|null>(null),[pending,setPending]=useState<BnaOwnerPreferenceCommand|null>(null),[busy,setBusy]=useState(false);
 const [action,setAction]=useState<BnaOwnerPreferenceCommand["action"]>("pause_relationship"),[note,setNote]=useState("");
 const [error,setError]=useState<number|null>(null),[message,setMessage]=useState(""),[link,setLink]=useState<string|null>(null);
 const active=useRef(true),locked=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;onOperationPending?.(false);};},[onOperationPending]);
 useEffect(()=>{onOperationPending?.(pending!==null);},[pending,onOperationPending]);
 async function read(){
  const response=await fetch("/api/private/bna-preferences?"+new URLSearchParams({id}),{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(30000)});
  const body=await response.json().catch(()=>null);if(!response.ok)throw new PreferenceError(response.status);if(!body?.ok||!body.data?.preferences||!Array.isArray(body.data.history))throw Error();
  if(active.current)setData(body.data as Readback);
 }
 async function load(){if(locked.current||disabled||pending)return;locked.current=true;setBusy(true);setError(null);setMessage("");
  try{await read();}catch(cause){if(active.current){const code=cause instanceof PreferenceError?cause.status:503;setError(code);if([401,403,404].includes(code)){setData(null);setLink(null);}}}
  finally{locked.current=false;if(active.current)setBusy(false);}
 }
 async function change(command:BnaOwnerPreferenceCommand){if(locked.current||disabled)return;
  const previouslyUnknown=pending!==null;locked.current=true;setBusy(true);setPending(command);setError(null);setMessage("");
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new PreferenceError(403);
   const response=await fetch("/api/private/bna-preferences",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(30000),
    headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(command)});
   const body=await response.json().catch(()=>null);if(!response.ok)throw new PreferenceError(response.status);if(!body?.ok||!body.data?.preferences)throw Error();
   if(active.current){setPending(null);setData(current=>current?{...current,preferences:body.data.preferences}:null);setNote("");setMessage(t("Preference change saved.","שינוי ההעדפה נשמר."));}
   await read();
  }catch(cause){if(active.current){const code=cause instanceof PreferenceError?cause.status:503;setError(code);
   if(!previouslyUnknown&&[400,401,403,404,409].includes(code))setPending(null);
   if([401,403,404].includes(code)){setData(null);setLink(null);}
  }}finally{locked.current=false;if(active.current)setBusy(false);}
 }
 async function issueLink(){if(locked.current||disabled||pending)return;locked.current=true;setBusy(true);setError(null);setLink(null);
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new PreferenceError(403);
   const response=await fetch("/api/private/bna-preferences",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(30000),
    headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify({action:"issue_link",inquiryId:id})});
   const body=await response.json().catch(()=>null);if(!response.ok)throw new PreferenceError(response.status);if(!body?.ok||typeof body.data?.token!=="string")throw Error();
   if(active.current)setLink("https://bneineviimacademy.org/email-preferences#token="+encodeURIComponent(body.data.token));
  }catch(cause){if(active.current)setError(cause instanceof PreferenceError?cause.status:503);}finally{locked.current=false;if(active.current)setBusy(false);}
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!data||pending||disabled||busy)return;
  const parsed=bnaOwnerPreferenceCommand.safeParse({inquiryId:id,operationId:crypto.randomUUID(),expectedVersion:data.preferences.version,action,note});
  if(!parsed.success){setError(400);return;}void change(parsed.data);
 }
 const p=data?.preferences;
 return <details className="lsw-details"><summary>{t("Optional email preferences and reply holds","העדפות עדכונים בדוא״ל והמתנה לטיפול בתשובות")}</summary>
  <p>{t("These controls apply to BNA educational/project email. Service acknowledgments and Fishing WhatsApp choices stay separate. Recording a reply pauses this program until you review it.","הבקרות חלות על עדכונים חינוכיים ועדכוני פרויקט של בני נביאים בדוא״ל. אישורי פנייה והעדפות WhatsApp של תוכנית הדיג נפרדים. תיעוד תשובה משהה תוכנית זו עד לטיפול בה.")}</p>
  <button type="button" disabled={busy||disabled||!!pending} onClick={()=>void load()}>{t("Load email preferences","טעינת העדפות דוא״ל")}</button>
  {error!==null&&<p role="alert">{pending?t("The result is unconfirmed. Retry the same change before another action.","התוצאה לא אושרה. יש לנסות שוב את אותו שינוי לפני פעולה אחרת."):error===404?t("Email preferences are unavailable for this inquiry.","העדפות דוא״ל אינן זמינות לפנייה זו."):error===409?t("Preferences changed. Reload them before saving.","ההעדפות השתנו. יש לטעון אותן מחדש לפני שמירה."):error===400?t("Select an action and record its factual basis.","יש לבחור פעולה ולתעד את הבסיס העובדתי שלה."):t("Preferences could not be read. Check access and try again.","לא ניתן לקרוא את ההעדפות. יש לבדוק גישה ולנסות שוב.")}</p>}
  {pending&&<button type="button" disabled={busy||disabled} onClick={()=>void change(pending)}>{t("Retry the same preference change","ניסיון חוזר של אותו שינוי העדפה")}</button>}
  {message&&<p role="status">{message}</p>}
  {p&&<div className="lsw-stack">
   <p>{t("Permission basis","בסיס ההרשאה")}: {p.permissionGrantedAt?new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(p.permissionGrantedAt))+" (Asia/Jerusalem)":t("No email-updates permission recorded on this inquiry","לא נרשמה בפנייה זו הרשאה לעדכוני דוא״ל")}</p>
   <ul>{p.withdrawn&&<li>{t("Unsubscribed","ההרשמה לעדכונים בוטלה")}</li>}{p.paused&&<li>{t("Paused by owner","הושהה בידי האחראי")}</li>}{p.replyPending&&<li>{t("Reply awaiting owner triage","תשובה ממתינה לטיפול האחראי")}</li>}{p.invalidRecipient&&<li>{t("Invalid email address","כתובת דוא״ל לא תקינה")}</li>}{p.complaint&&<li>{t("Complaint hold","השהיה בעקבות תלונה")}</li>}</ul>
   <p>{t("Saved permission does not itself activate an email sequence. An owner action here cannot subscribe someone.","הרשאה שמורה אינה מפעילה כשלעצמה סדרת דוא״ל. פעולה של האחראי כאן אינה יכולה לרשום אדם לעדכונים.")}</p>
   <form className="lsw-stack" onSubmit={submit}><label>{t("Action","פעולה")} <select disabled={busy||disabled||!!pending} value={action} onChange={event=>setAction(event.target.value as typeof action)}>{actions.map(([value,en,he])=><option key={value} value={value}>{t(en,he)}</option>)}</select></label>
    <label>{t("What did you observe or receive? Keep child details out of this note.","מה נצפה או התקבל? אין לכלול בהערה פרטים על ילדים.")} <textarea required minLength={3} maxLength={1000} disabled={busy||disabled||!!pending} value={note} onChange={event=>setNote(event.target.value)}/></label>
    <button type="submit" disabled={busy||disabled||!!pending}>{t("Save email preference action","שמירת פעולת העדפת דוא״ל")}</button></form>
   <button type="button" disabled={busy||disabled||!!pending} onClick={()=>void issueLink()}>{t("Prepare recipient preference link","הכנת קישור העדפות לנמען")}</button>
   {link&&<p><a href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("Open recipient preferences","פתיחת העדפות הנמען")}</a> · {t("Share only with this inquiry's adult email recipient in a requested reply. Preparing the link sends nothing.","יש לשתף רק עם הנמען הבוגר של הפנייה, במסגרת תשובה שביקש. הכנת הקישור אינה שולחת דבר.")}</p>}
   <h4>{t("Saved preference history","היסטוריית העדפות שמורה")}</h4><ol>{data.history.map(event=><li key={event.operationId}><time dateTime={event.recordedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(event.recordedAt))}</time> · {event.scope} · {event.action}{event.note&&<> · {event.note}</>}</li>)}</ol>
   {data.hasMoreHistory&&<p>{t("Showing the latest 100 preference events. Earlier events are retained.","מוצגים 100 אירועי ההעדפות האחרונים. אירועים קודמים נשמרים.")}</p>}
  </div>}
 </details>;
}
