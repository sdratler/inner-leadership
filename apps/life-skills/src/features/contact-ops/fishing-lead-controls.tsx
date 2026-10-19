"use client";
import {useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {loginHref} from "../identity/login-return.ts";
import {FISHING_ACADEMY_LEAD_LABEL,fishingLeadDisplayState,type FishingLeadRequest} from "./core/fishing-lead.ts";
import {readFishingLeadContext,previewFishingLead,confirmFishingLead,FishingLeadClientError,
 type FishingLeadContext,type FishingLeadPreview,type FishingLeadProgram,type FishingLeadSource} from "./core/fishing-lead-client.ts";

type ReadyPreview=Extract<FishingLeadPreview,{state:"ready"}>;
type Pending={request:Extract<FishingLeadRequest,{action:"confirm"}>;preview:ReadyPreview;epoch:number};
/** Compact, explicit native membership controls. No provider, task or message
 * action is triggered here; tokens stay only in this authorized component. */
export function FishingLeadControls({locale,source,program,denied}:{locale:Locale;source:FishingLeadSource;
 program:FishingLeadProgram;denied?:(status:number)=>void}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [open,setOpen]=useState(false),[context,setContext]=useState<FishingLeadContext|null>(null),
  [preview,setPreview]=useState<ReadyPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),
  [notice,setNotice]=useState(""),[unauthorized,setUnauthorized]=useState<number|null>(null),[uncertain,setUncertain]=useState(false),
  [relationship,setRelationship]=useState<"guardian"|"adult_partner">("guardian"),[newPersonConfirmed,setNewPersonConfirmed]=useState(false),
  [choices,setChoices]=useState<{personId:string;name:string}[]>([]),[selectedPerson,setSelectedPerson]=useState("");
 const pending=useRef<Pending|null>(null),guard=useRef(false),alive=useRef(true),confirmation=useRef<HTMLHeadingElement>(null),prepareButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{const protect=(e:BeforeUnloadEvent)=>{if(pending.current){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",protect);return()=>window.removeEventListener("beforeunload",protect);},[]);
 useEffect(()=>{if(preview)confirmation.current?.focus();},[preview]);
 function failure(e:unknown){
  const status=e instanceof FishingLeadClientError?e.status:503;
  if(status===401||status===403){pending.current=null;setUncertain(false);setPreview(null);setContext(null);setChoices([]);setSelectedPerson("");setNotice("");setUnauthorized(status);denied?.(status);return;}
  if(status===400||status===409){pending.current=null;setUncertain(false);setPreview(null);setError(status===409?
   t("The saved record or contact authority changed. Reload its current state before preparing a new action.","הרשומה השמורה או מקור אנשי הקשר השתנו. יש לטעון את המצב העדכני לפני הכנת פעולה חדשה."):
   t("This request was not accepted. Reload and check the selected person.","הבקשה לא התקבלה. יש לטעון מחדש ולבדוק את האדם שנבחר."));return;}
  setUncertain(!!pending.current);setError(pending.current?t("The outcome could not be confirmed. Retry the same operation; do not prepare another Add or Remove.","לא ניתן לאשר את התוצאה. יש לנסות שוב את אותה פעולה, ולא להכין הוספה או הסרה נוספת."):
   t("The current lead state could not be loaded. This is not an empty lead list. Try again.","לא ניתן לטעון את מצב המתעניין. זו אינה רשימה ריקה. יש לנסות שוב."));
 }
 async function reload(){if(guard.current||pending.current)return;guard.current=true;setBusy(true);setError("");
  try{const current=await readFishingLeadContext(program,source);if(!alive.current)return;setContext(current);setPreview(null);setNotice("");setSelectedPerson("");setChoices(current.state==="blocked"?current.choices:[]);}
  catch(e){if(alive.current){setContext(null);failure(e);}}finally{guard.current=false;if(alive.current)setBusy(false);}}
 async function choose(id:string){if(guard.current||pending.current)return;setSelectedPerson(id);if(!id){await reload();return;}guard.current=true;setBusy(true);setError("");
  try{const current=await readFishingLeadContext(program,{kind:"person",id});if(alive.current){setContext(current);setPreview(null);}}
  catch(e){if(alive.current){setContext(null);failure(e);}}finally{guard.current=false;if(alive.current)setBusy(false);}}
 async function prepare(){if(guard.current||pending.current||!context)return;guard.current=true;setBusy(true);setError("");setNotice("");
  try{
   const current=context.state==="blocked"&&context.reason==="identity"&&selectedPerson?
    await readFishingLeadContext(program,{kind:"person",id:selectedPerson}):context;
   if(current.state!=="ready")return;
   const m=current.membership,operationId=crypto.randomUUID();
   const input:Exclude<FishingLeadRequest,{action:"confirm"}>=m?.state==="active"?
    {action:"preview_remove",operationId,expectedEpoch:current.epoch,personId:m.personId,expectedAssociationVersion:m.version}:
    {action:"preview_add",operationId,expectedEpoch:current.epoch,source,...(selectedPerson?{selectedPersonId:selectedPerson}:{}),expectedAssociationVersion:m?.version??0,relationship};
   const result=await previewFishingLead(program,input);if(!alive.current)return;
   if(result.state==="clarify"){setPreview(null);setChoices(result.choices);setContext({state:"blocked",epoch:current.epoch,reason:result.reason,choices:result.choices});setSelectedPerson("");return;}
   setPreview(result);setNewPersonConfirmed(false);
  }catch(e){if(alive.current)failure(e);}finally{guard.current=false;if(alive.current)setBusy(false);}}
 async function confirm(){if(guard.current||!preview||!context||preview.newPerson&&!newPersonConfirmed&&!pending.current)return;
  guard.current=true;setBusy(true);setError("");
  const op=pending.current??{request:{action:"confirm" as const,token:preview.token,confirmNewPerson:preview.newPerson&&newPersonConfirmed},preview,epoch:context.epoch};
  pending.current=op;
  try{
   const receipt=await confirmFishingLead(program,op.request,op.preview,op.epoch);
   const current=await readFishingLeadContext(program,selectedPerson?{kind:"person",id:selectedPerson}:source);
   if(current.state!=="ready"||!current.membership||current.personId!==receipt.personId)throw new FishingLeadClientError(503);
   const state=fishingLeadDisplayState(receipt,current.membership);
   if(!alive.current)return;pending.current=null;setUncertain(false);setContext(current);setPreview(null);setNewPersonConfirmed(false);setChoices([]);setSelectedPerson("");
   setNotice(state==="active"?t("Added to Leads. No follow-up task was created.","נוסף לרשימת המתעניינים. לא נוצרה משימת המשך."):
    t("Removed from this fishing lead list. Contact and history retained.","הוסר מרשימת המתעניינים בדיג. פרטי הקשר וההיסטוריה נשמרו."));
  }catch(e){if(alive.current)failure(e);}finally{guard.current=false;if(alive.current)setBusy(false);}}
 const active=context?.state==="ready"&&context.membership?.state==="active";
 const blocked=context?.state==="blocked";
 const canPrepare=context?.state==="ready"||blocked&&context.reason==="identity"&&!!selectedPerson;
 const label=context?.state==="ready"?context.projection:null;
 return <details className="lsw-details" open={open} onToggle={e=>{const next=e.currentTarget.open;setOpen(next);if(next&&!context&&!busy&&!unauthorized)void reload();}}>
  <summary>{t("Fishing lead list","רשימת המתעניינים בדיג")} · {program==="sunday_fishing_academy"?t("Fishing Academy","אקדמיית דיג"):t("Private Fishing & Life Skills","דיג וכישורי חיים באופן פרטי")}</summary>
  <section className="lsw-stack" aria-busy={busy} aria-label={t("Fishing lead membership controls","בקרות שיוך לרשימת המתעניינים בדיג")}>
   {program==="sunday_fishing_academy"&&<p>{t("Academy label","תווית האקדמיה")}: <bdi dir="ltr">{FISHING_ACADEMY_LEAD_LABEL}</bdi></p>}
   {unauthorized!==null?<div role="alert"><p>{unauthorized===401?t("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):t("This account cannot manage fishing leads.","לחשבון הזה אין הרשאה לניהול מתעניינים בדיג.")}</p>
    {unauthorized===401&&<a className="lsw-button lsw-button--secondary" href={loginHref(locale,window.location.pathname+window.location.search)}>{t("Sign in","כניסה")}</a>}</div>:<>
    {busy&&<p role="status">{t("Checking…","בודק…")}</p>}
    {context?.state==="ready"&&<p><strong>{t("Native lead membership","שיוך לרשימת המתעניינים במערכת")}:</strong> {active?t("Added","נוסף"):context.membership?t("Removed","הוסר"):t("Not classified","טרם סווג")}</p>}
    {context?.state==="ready"&&<p><strong>{t("WhatsApp label sync","סנכרון תווית WhatsApp")}:</strong> {label?.unresolvedEffect?t("Outcome unknown — reconciliation needed","התוצאה אינה ידועה — נדרשת בדיקה חוזרת"):label?.status==="verified"?t("Verified by provider readback","אומת בקריאה חוזרת מהספק"):label?.status==="pending"?t("Pending","ממתין"):label?.status==="failed"?t("Failed","נכשל"):label?.status==="outcome_unknown"?t("Outcome unknown — reconciliation needed","התוצאה אינה ידועה — נדרשת בדיקה חוזרת"):label?.status==="unsupported"?t("Not supported by this connected account","אינו נתמך בחשבון המחובר"):t("Not configured — account, label and chat binding not verified","לא מוגדר — שיוך לחשבון, לתווית ולצ׳אט לא אומת")}{label?.verifiedAt&&<> · <time dateTime={label.verifiedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(label.verifiedAt))}</time></>}</p>}
    {blocked&&<p>{context.reason==="native_authority_required"?t("Native contact authority is not enabled. No fallback changes will be made.","מקור אנשי הקשר המקומי עדיין אינו פעיל. לא יבוצעו שינויים במקור חלופי."):context.reason==="email_only"?
     t("Saved as a native inquiry. WhatsApp label sync needs a verified phone or chat identity.","נשמר כפנייה במערכת. סנכרון תווית WhatsApp דורש זהות טלפון או צ׳אט מאומתת."):context.reason==="reserved"?t("This contact identity requires review before lead-list changes.","זהות הקשר הזו דורשת בדיקה לפני שינוי ברשימת המתעניינים."):t("More than one person matches this contact identity. Choose before continuing.","יותר מאדם אחד מתאים לזהות הקשר הזו. יש לבחור לפני המשך הפעולה.")}</p>}
    {choices.length>0&&!preview&&<label className="lsw-field">{t("Choose the matching person","בחירת האדם המתאים")}<select className="lsw-input" value={selectedPerson} disabled={busy} onChange={e=>void choose(e.target.value)}><option value="">{t("Choose…","בחירה…")}</option>{choices.map(c=><option key={c.personId} value={c.personId}>{c.name}</option>)}</select></label>}
    {!preview&&canPrepare&&!active&&<label className="lsw-field">{t("Contact role for this interest","תפקיד איש הקשר בהתעניינות הזו")}<select className="lsw-input" value={relationship} disabled={busy} onChange={e=>setRelationship(e.target.value as typeof relationship)}><option value="guardian">{t("Parent / guardian contact","איש קשר הורה / אפוטרופוס")}</option><option value="adult_partner">{t("Adult participant / partner","משתתף / שותף מבוגר")}</option></select></label>}
    {preview?<div className="lsw-card lsw-stack"><h3 ref={confirmation} tabIndex={-1}>{preview.action==="add"?t("Review lead-list addition","בדיקת הוספה לרשימת המתעניינים"):t("Review lead-list removal","בדיקת הסרה מרשימת המתעניינים")}</h3><p>{preview.name}{preview.phone&&<> · <bdi dir="ltr">{preview.phone}</bdi></>}</p>
     <p>{preview.newPerson?t("This will create one minimum adult contact and this fishing membership only.","פעולה זו תיצור איש קשר מבוגר בסיסי אחד ואת השיוך הזה לדיג בלבד."):t("This changes only this fishing membership. Contact details, notes, follow-ups and other memberships stay unchanged.","פעולה זו משנה רק את השיוך הזה לדיג. פרטי הקשר, ההערות, משימות ההמשך ושיוכים אחרים נשארים ללא שינוי.")}</p>
     <p>{t("No task, message, account, booking or payment will be created. This does not grant consent or family/case access.","לא ייווצרו משימה, הודעה, חשבון, הזמנה או תשלום. הפעולה אינה מעניקה הסכמה או גישה למשפחה או לתיק.")}</p>
     {preview.newPerson&&<label><input type="checkbox" checked={newPersonConfirmed} disabled={busy||uncertain} onChange={e=>setNewPersonConfirmed(e.target.checked)}/> {t("I confirm creation of this new adult contact.","אני מאשר/ת יצירת איש קשר מבוגר חדש זה.")}</label>}
     <div className="lsw-actions"><button type="button" className="lsw-button lsw-button--primary" disabled={busy||preview.newPerson&&!newPersonConfirmed&&!uncertain} onClick={()=>void confirm()}>{uncertain?t("Retry the same operation","ניסיון נוסף לאותה פעולה"):preview.action==="add"?t("Confirm Add","אישור הוספה"):t("Confirm Remove","אישור הסרה")}</button>
      <button type="button" className="lsw-button lsw-button--secondary" disabled={busy||uncertain} onClick={()=>{setPreview(null);setNewPersonConfirmed(false);setError("");queueMicrotask(()=>prepareButton.current?.focus());}}>{t("Cancel","ביטול")}</button></div>
    </div>:<div className="lsw-actions">{canPrepare&&<button type="button" ref={prepareButton} className="lsw-button lsw-button--primary" disabled={busy||!!error} onClick={()=>void prepare()}>{active?t("Remove from Lead List","הסרה מרשימת המתעניינים"):t("Add to Lead List","הוספה לרשימת המתעניינים")}</button>}
     <button type="button" className="lsw-button lsw-button--secondary" disabled={busy} onClick={()=>void reload()}>{t("Reload current state","טעינת המצב העדכני")}</button></div>}
    <p className="lsw-help">{t("Lead membership and WhatsApp label status are tracked separately.","השיוך לרשימת המתעניינים ומצב תווית WhatsApp מוצגים בנפרד.")}</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   </>}
  </section>
 </details>;
}
