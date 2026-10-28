"use client";
import {useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {fishingFollowupCommandSchema,type FishingFollowupCommand} from "./fishing-followup-contract.ts";
import type {FishingInquiryFollowupStore} from "./fishing-followup-store.ts";

type Detail=Awaited<ReturnType<FishingInquiryFollowupStore["read"]>>;
type Saved=Awaited<ReturnType<FishingInquiryFollowupStore["followup"]>>;
class RequestError extends Error{constructor(readonly status:number){super("FISHING_FOLLOWUP_FAILED");}}
const endpoint="/api/private/group-applications/followups";

/** Owner action remains attached to the saved inquiry, including email-only inquiries. */
export function FishingFollowupPanel({locale,applicationId}:{locale:Locale;applicationId:string}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState<number|null>(null);
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<FishingFollowupCommand|null>(null),[message,setMessage]=useState("");
 const [status,setStatus]=useState<"new"|"contacted"|"waiting"|"closed">("new"),
  [note,setNote]=useState(""),[nextAction,setNextAction]=useState("Review inquiry"),
  [dueDate,setDueDate]=useState(""),[waiting,setWaiting]=useState("");
 async function read(){
  setBusy(true);setError(null);
  try{const response=await fetch(endpoint+"?"+new URLSearchParams({id:applicationId}),
   {credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
   const body=await response.json().catch(()=>null);
   if(!response.ok||!body?.ok)throw new RequestError(response.status);
   const value=body.data as Detail;setDetail(value);setStatus(value.followup.status);
   setNextAction(value.followup.nextAction??"");setDueDate(value.followup.dueDate??"");
   setWaiting(value.followup.waitingCondition??"");setError(null);
  }catch(cause){const code=cause instanceof RequestError?cause.status:503;setError(code);
   if([401,403,404].includes(code)){setDetail(null);setPending(null);}}
  finally{setBusy(false);}
 }
 async function save(command:FishingFollowupCommand){
  setBusy(true);setError(null);setMessage("");setPending(command);
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new RequestError(403);
   const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",
    redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},
    body:JSON.stringify(command)});
   const body=await response.json().catch(()=>null);
   if(!response.ok||!body?.ok)throw new RequestError(response.status);
   const saved=body.data as Saved;if(saved.applicationId!==applicationId)throw new RequestError(503);
   setPending(null);setNote("");await read();setMessage(t("Follow-up saved.","המעקב נשמר."));
  }catch(cause){const code=cause instanceof RequestError?cause.status:503;setError(code);
   if([400,401,403,404,409].includes(code))setPending(null);
   if([401,403,404].includes(code))setDetail(null);
  }finally{setBusy(false);}
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!detail||pending)return;
  const parsed=fishingFollowupCommandSchema.safeParse({operationId:crypto.randomUUID(),applicationId,
   expectedVersion:detail.followup.version,status,note,nextAction:nextAction.trim()||null,
   dueDate:dueDate||null,waitingCondition:waiting.trim()||null});
  if(!parsed.success){setError(400);return;}void save(parsed.data);
 }
 return <details className="lsw-details" onToggle={event=>{if(event.currentTarget.open&&!detail&&!busy&&error!==404)void read();}}>
  <summary>{t("Owner follow-up","המשך טיפול של האחראי")}</summary>
  <section className="lsw-stack" aria-busy={busy}>
   {error!==null&&<div role="alert" className="lsw-alert"><p>{error===401?t("Sign in again.","יש להיכנס מחדש."):
    error===403||error===404?t("This account cannot open this Fishing inquiry.","לחשבון זה אין גישה לפניית הדיג."):
    error===409?t("This inquiry changed. Reload before saving.","הפנייה השתנתה. יש לרענן לפני השמירה."):
    error===400?t("Add a note and a next action or waiting condition.","יש להוסיף הערה ופעולה הבאה או תנאי המתנה."):
    t("Follow-up could not be read. Try again.","לא ניתן לקרוא את המעקב. אפשר לנסות שוב.")}</p>
    {![401,403,404].includes(error)&&<button type="button" onClick={()=>void read()}>{t("Reload","רענון")}</button>}</div>}
   {message&&<p role="status">{message}</p>}
   {pending&&!busy&&<div role="status" className="lsw-alert"><p>{t("Save outcome unknown. Retry the same operation.","תוצאת השמירה אינה ידועה. יש לנסות שוב את אותה פעולה.")}</p>
    <button type="button" onClick={()=>void save(pending)}>{t("Retry same save","ניסיון חוזר לאותה שמירה")}</button></div>}
   {busy&&!detail&&<p role="status">{t("Loading follow-up…","טוען מעקב…")}</p>}
   {detail&&<><p>{t("Current stage","שלב נוכחי")}: {detail.followup.status} · {t("Next action","פעולה הבאה")}: {detail.followup.nextAction??t("None","אין")}</p>
    <form onSubmit={submit} className="lsw-stack"><label>{t("Stage","שלב")}<select value={status} onChange={event=>setStatus(event.target.value as typeof status)}>
     <option value="new">{t("New","חדש")}</option><option value="contacted">{t("Contacted","נוצר קשר")}</option>
     <option value="waiting">{t("Waiting","ממתין")}</option><option value="closed">{t("Closed","סגור")}</option></select></label>
     <label>{t("Note","הערה")}<textarea required maxLength={5000} value={note} onChange={event=>setNote(event.target.value)}/></label>
     <label>{t("Next action","פעולה הבאה")}<input maxLength={500} value={nextAction} onChange={event=>setNextAction(event.target.value)}/></label>
     <label>{t("Due date","תאריך יעד")}<input type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label>
     <label>{t("Waiting condition","תנאי המתנה")}<input maxLength={500} value={waiting} onChange={event=>setWaiting(event.target.value)}/></label>
     <button type="submit" disabled={busy||!!pending}>{t("Save follow-up","שמירת המשך טיפול")}</button></form>
    {detail.history.length>0&&<><h4>{t("Saved history","היסטוריה שמורה")}</h4><ol>{detail.history.map(item=><li key={item.operationId}>
     <time dateTime={item.recordedAt}>{item.recordedAt}</time> · {item.status} · {item.note}
     {item.nextAction&&<> · {item.nextAction}</>}{item.waitingCondition&&<> · {item.waitingCondition}</>}</li>)}</ol></>}
   </>}
  </section>
 </details>;
}
