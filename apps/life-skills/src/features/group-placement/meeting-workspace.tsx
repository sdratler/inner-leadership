"use client";
import {useEffect,useRef,useState} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {classifyGroupPlacementSaveFailure,proposedDraftMeetingCommandSchema,reviseDraftMeetingCommandSchema,type DraftGroupRecord,type DraftMeetingRevisionRecord,
 type ProposedDraftMeetingCommand,type ReviseDraftMeetingCommand} from "./contract.ts";
import styles from "./workspace.module.css";

type MeetingCommand=ProposedDraftMeetingCommand|ReviseDraftMeetingCommand;
function displayTime(value:string,locale:Locale){return new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{
 dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(value));}
function values(form:HTMLFormElement){const data=new FormData(form);return {timeZone:"Asia/Jerusalem" as const,localStart:data.get("localStart"),
 durationMinutes:Number(data.get("durationMinutes")),venue:data.get("venue")};}

export function DraftMeetingPlanner({locale,group,revisions,reload}:{locale:Locale;group:DraftGroupRecord;
 revisions:DraftMeetingRevisionRecord[];reload:()=>Promise<void>}){
 const t=(en:string,he:string)=>locale==="he"?he:en,pending=useRef<MeetingCommand|null>(null);
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(""),[error,setError]=useState(""),[saved,setSaved]=useState("");
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue="";}};
  window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);
 async function save(event:FormEvent<HTMLFormElement>,sourceRevisionId?:string){
  event.preventDefault();if(busy)return;const form=event.currentTarget,target=sourceRevisionId??"new",wasUncertain=uncertain===target;setError("");setSaved("");
  if(!pending.current){const base={operationId:crypto.randomUUID(),...values(form)},parsed=sourceRevisionId?
    reviseDraftMeetingCommandSchema.safeParse({action:"revise_draft_group_meeting",sourceRevisionId,...base}):
    proposedDraftMeetingCommandSchema.safeParse({action:"propose_draft_group_meeting",draftGroupId:group.id,...base});
   if(!parsed.success){setError(t("Enter an unambiguous Jerusalem date and time, a 15–480 minute duration, and a venue.",
    "יש להזין תאריך ושעה חד-משמעיים לפי ירושלים, משך של 15–480 דקות ומקום."));return;}pending.current=parsed.data;
  }else if(sourceRevisionId&&(pending.current.action!=="revise_draft_group_meeting"||pending.current.sourceRevisionId!==sourceRevisionId)||
   !sourceRevisionId&&pending.current.action!=="propose_draft_group_meeting")return;
  setBusy(true);let started=false;
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new Error();started=true;
   const response=await fetch("/api/private/group-placement",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(pending.current)});
   if(!response.ok&&classifyGroupPlacementSaveFailure(true,response.status,wasUncertain)!=="unconfirmed"){
    if(wasUncertain&&response.status===401){setError(t("Sign in in another tab, keep this form open, then retry the exact same proposal.",
     "יש להתחבר בכרטיסייה אחרת, להשאיר טופס זה פתוח ואז לנסות שוב את אותה הצעה בדיוק."));return;}
    pending.current=null;setUncertain("");setError(response.status===401?t("Sign in again, then review and save.","יש להתחבר מחדש, לבדוק ולשמור."):
     response.status===403?t("This account cannot plan draft meetings.","חשבון זה אינו מורשה לתכנן פגישות טיוטה."):
     response.status===404?t("The draft group or occurrence is no longer available. Refresh and review.","קבוצת הטיוטה או המועד אינם זמינים עוד. יש לרענן ולבדוק."):
     response.status===409?t("This occurrence changed. Refresh before making another correction.","המועד השתנה. יש לרענן לפני תיקון נוסף."):
     t("The proposal was not saved. Check every field and try again.","ההצעה לא נשמרה. יש לבדוק את כל השדות ולנסות שוב."));return;
   }
   const body=await response.json();if(!response.ok||!body.ok||body.data?.saved!==true)throw new Error();
   const conflicts=Number(body.data.item?.conflicts?.length??0);pending.current=null;setUncertain("");form.reset();
   setSaved(conflicts?t("Saved as a proposal with a visible scheduling conflict. Nothing was booked or sent.","נשמר כהצעה עם התנגשות גלויה. דבר לא הוזמן ולא נשלח."):
    sourceRevisionId?t("Correction saved and read back. The earlier proposal remains in history; nothing was booked or sent.","התיקון נשמר ונקרא בחזרה. ההצעה הקודמת נשארה בהיסטוריה; דבר לא הוזמן ולא נשלח."):
    t("Proposed occurrence saved and read back. Nothing was booked or sent.","המועד המוצע נשמר ונקרא בחזרה. דבר לא הוזמן ולא נשלח."));await reload();
  }catch{if(classifyGroupPlacementSaveFailure(started,undefined,wasUncertain)==="reauth"){
    pending.current=null;setUncertain("");setError(t("Sign in again, then review and save.","יש להתחבר מחדש, לבדוק ולשמור."));
   }else{setUncertain(target);setError(t("Save is unconfirmed. Keep this form open and retry the exact same proposal; no booking, invitation or notification was created.",
    "השמירה לא אומתה. יש להשאיר טופס זה פתוח ולנסות שוב את אותה הצעה בדיוק; לא נוצרו הזמנה, פגישה או התראה."));}}
  finally{setBusy(false);}
 }
 const current=revisions.filter(item=>item.revisionStatus==="current"),history=revisions.filter(item=>item.revisionStatus==="superseded");
 return <section className={styles.meetings} aria-labelledby={`meeting-heading-${group.id}`}>
  <h4 id={`meeting-heading-${group.id}`}>{t("Proposed meeting occurrences","מועדי פגישה מוצעים")}</h4>
  <p className={styles.boundary}>{t("Private planning only. Proposed times do not reserve the calendar and are not confirmed meetings.",
   "תכנון פרטי בלבד. מועדים מוצעים אינם שומרים זמן ביומן ואינם פגישות מאושרות.")}</p>
  {current.length===0?<p>{t("No proposed occurrence.","אין מועד מוצע.")}</p>:<ul className={styles.meetingList}>{current.map(item=><li key={item.id}>
   <strong>{displayTime(item.startsAt,locale)} · {item.durationMinutes} {t("minutes","דקות")}</strong><span>{item.venue}</span>
   {item.conflicts.length===0?<small className={styles.current}>{t("No conflict found at the last read. This is not a reservation.","לא נמצאה התנגשות בקריאה האחרונה. זו אינה שמירת זמן.")}</small>:
    <div className={styles.conflict} role="status"><b>{t("Scheduling conflict","התנגשות בלוח הזמנים")}</b><ul>{item.conflicts.map((conflict,index)=><li key={`${conflict.kind}-${conflict.reference}-${index}`}>
     {conflict.kind==="private_appointment"?t("Private appointment","פגישה פרטית"):t("Other draft occurrence","מועד טיוטה אחר")} · <bdi dir="ltr">{conflict.reference}</bdi> · {displayTime(conflict.startsAt,locale)}–{displayTime(conflict.endsAt,locale)}</li>)}</ul></div>}
   <details className={styles.moveAction}><summary>{t("Correct proposed occurrence","תיקון המועד המוצע")}</summary>
    <p>{t("The current proposal remains in history. This does not change any private appointment.","ההצעה הנוכחית נשמרת בהיסטוריה. פעולה זו אינה משנה פגישה פרטית כלשהי.")}</p>
    <MeetingForm locale={locale} item={item} busy={busy} disabled={uncertain!==""&&uncertain!==item.id} retry={uncertain===item.id} onSave={event=>void save(event,item.id)}/></details>
  </li>)}</ul>}
  {history.length>0&&<details className={styles.history}><summary>{t("Occurrence history","היסטוריית מועדים")}</summary><ol>{history.map(item=><li key={item.id}>
   {displayTime(item.startsAt,locale)} · {item.durationMinutes} {t("minutes","דקות")} · {item.venue} · <bdi dir="ltr">{item.id.slice(0,8)}</bdi></li>)}</ol></details>}
  {error&&<p role="alert">{error}</p>}{saved&&<p role="status">{saved}</p>}
  <details className={styles.action}><summary>{t("Add proposed occurrence","הוספת מועד מוצע")}</summary>
   <MeetingForm locale={locale} busy={busy} disabled={uncertain!==""&&uncertain!=="new"} retry={uncertain==="new"} onSave={event=>void save(event)}/></details>
 </section>;
}

function MeetingForm({locale,item,busy,disabled,retry,onSave}:{locale:Locale;item?:DraftMeetingRevisionRecord;busy:boolean;disabled:boolean;retry:boolean;
 onSave:(event:FormEvent<HTMLFormElement>)=>void}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <form className={styles.meetingForm} onSubmit={onSave}>
  <label>{t("Jerusalem date and time","תאריך ושעה לפי ירושלים")}<input type="datetime-local" name="localStart" required defaultValue={item?.localStart} disabled={disabled||retry}/></label>
  <label>{t("Duration (minutes)","משך (דקות)")}<input type="number" name="durationMinutes" min="15" max="480" step="1" required defaultValue={item?.durationMinutes} disabled={disabled||retry}/></label>
  <label>{t("Proposed venue","מקום מוצע")}<input name="venue" required maxLength={200} defaultValue={item?.venue} disabled={disabled||retry}/></label>
  <button type="submit" className="lsw-button lsw-button--primary" disabled={busy||disabled}>{busy?t("Saving…","שומר…"):retry?t("Retry exact same save","ניסיון חוזר לאותה שמירה בדיוק"):item?t("Save correction","שמירת תיקון"):t("Save proposed occurrence","שמירת מועד מוצע")}</button>
 </form>;
}
