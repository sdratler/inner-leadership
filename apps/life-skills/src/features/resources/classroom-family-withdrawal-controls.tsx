"use client";
import {useEffect,useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo,IdentityClientError} from "../identity/client.ts";
import {UnsavedChangesGuard} from "../../ui/workspace/draft-guard.tsx";
import {classroomWithdrawalVersion} from "./classroom-withdrawal-contract.ts";
import {classroomFamilyWithdrawalPath,classroomFamilyWithdrawalCommandSchema,type ClassroomFamilyWithdrawalCommand,type ClassroomFamilyWithdrawalReview,type ClassroomFamilyWithdrawalResult} from "./classroom-family-withdrawal-contract.ts";
class WithdrawalRequestError extends Error{constructor(readonly status:number){super("CLASSROOM_WITHDRAWAL_REQUEST_FAILED");}}
async function request<T>(url:string,init:RequestInit={}){
 const response=await fetch(url,{...init,credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"}),body=await response.json() as {ok:boolean;data:T};
 if(!response.ok||body.ok!==true)throw new WithdrawalRequestError(response.status);return body.data;
}
type Props={applicationId:string;stageId:string;locale:Locale;disabled?:boolean;onLockedChange?:(locked:boolean)=>void;denied?:(status:number)=>void};
/** Owner family-level action; it is not the selected child's cancellation,
 * payment/refund control, history deletion or Drive-provider verification. */
export function ClassroomFamilyWithdrawalControls({applicationId,stageId,locale,disabled=false,onLockedChange,denied}:Props){
 const t=(en:string,he:string)=>locale==="he"?he:en,[review,setReview]=useState<ClassroomFamilyWithdrawalReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<"unavailable"|"conflict"|null>(null),[pending,setPending]=useState<{command:ClassroomFamilyWithdrawalCommand;body:string}|null>(null),[saved,setSaved]=useState<ClassroomFamilyWithdrawalResult|null>(null),[confirmed,setConfirmed]=useState(false);
 const locked=busy||pending!==null||confirmed;
 useEffect(()=>{onLockedChange?.(locked);return()=>onLockedChange?.(false);},[locked,onLockedChange]);
 const failure=(e:unknown)=>{
  if(e instanceof IdentityClientError&&["UNAUTHENTICATED","FORBIDDEN"].includes(e.code)||e instanceof WithdrawalRequestError&&[401,403].includes(e.status)){
   setReview(null);setPending(null);setSaved(null);setConfirmed(false);denied?.(e instanceof WithdrawalRequestError?e.status:e instanceof IdentityClientError&&e.code==="UNAUTHENTICATED"?401:403);setError("unavailable");
  }else if(e instanceof WithdrawalRequestError&&[400,404,409].includes(e.status)){setReview(null);setPending(null);setConfirmed(false);setError("conflict");}
  else setError("unavailable");
 };
 const load=async()=>{
  if(busy||pending||confirmed||disabled)return;setBusy(true);setError(null);setSaved(null);
  try{const next=await request<ClassroomFamilyWithdrawalReview>(classroomFamilyWithdrawalPath+"?"+new URLSearchParams({applicationId,stageId}));
   if(next.binding.applicationId!==applicationId||next.stageId!==stageId||next.children.length===0||next.children.reduce((n,c)=>n+c.lessons.length,0)!==next.lessonCount)throw new WithdrawalRequestError(409);setReview(next);
  }catch(e){setReview(null);failure(e);}finally{setBusy(false);}
 };
 const send=async(value:NonNullable<typeof pending>)=>{
  if(busy||disabled)return;setBusy(true);setError(null);
  try{const session=await sessionInfo(),result=await request<ClassroomFamilyWithdrawalResult>(classroomFamilyWithdrawalPath,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken,"idempotency-key":value.command.operationId},body:value.body});
   if(result.operationId!==value.command.operationId||result.stageId!==stageId||result.state!=="withdrawn")throw new Error("UNCONFIRMED_WITHDRAWAL_RESULT");
   setPending(null);setSaved(result);setReview(null);setConfirmed(false);
  }catch(e){failure(e);}finally{setBusy(false);}
 };
 const submit=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!review||review.withdrawn||busy||pending||disabled||!confirmed||new FormData(event.currentTarget).get("confirmFamily")!=="yes")return;
  const command=classroomFamilyWithdrawalCommandSchema.parse({version:classroomWithdrawalVersion,operationId:crypto.randomUUID(),binding:review.binding,stageId,expectedScopeSha256:review.scopeSha256}),next={command,body:JSON.stringify(command)};setPending(next);setSaved(null);void send(next);
 };
 return <section className="lsw-card" data-classroom-family-withdrawal aria-label={t("Family classroom withdrawal","סיום גישת המשפחה לכיתה")}>
  <UnsavedChangesGuard dirty={locked} message={t("Leave this family classroom withdrawal? A submitted request may already be saved. Retry an unconfirmed request before changing its scope.","לצאת מסיום גישת המשפחה לכיתה? ייתכן שבקשה שנשלחה כבר נשמרה. נסו שוב בקשה שלא אושרה לפני שינוי ההיקף שלה.")}/>
  <h3>{t("End classroom access for this family and group","סיום הגישה לכיתה למשפחה זו ולקבוצה זו")}</h3>
  <p>{t("This applies to every affected child in this family for the selected group, including siblings. It ends classroom access and keeps the saved history. Payments, refunds and group enrollment are handled separately.","פעולה זו חלה על כל הילדים המושפעים במשפחה זו בקבוצה שנבחרה, כולל אחים. היא מסיימת את הגישה לכיתה ושומרת את ההיסטוריה. תשלומים, החזרים והרשמה לקבוצה מטופלים בנפרד.")}</p>
  {busy&&<p role="status">{t("Reading or saving family classroom access…","קורא או שומר את גישת המשפחה לכיתה…")}</p>}
  {error&&<p role="alert">{error==="conflict"?t("The family or classroom scope changed. Read the current affected list before continuing.","המשפחה או היקף הכיתה השתנו. קראו את הרשימה העדכנית לפני המשך."):pending?t("The result is unconfirmed. Retry this same request before changing the family or group.","התוצאה לא אושרה. נסו שוב את אותה בקשה לפני שינוי המשפחה או הקבוצה."):t("Classroom withdrawal is not ready. Verified family, source and purchase authority are required.","סיום הגישה לכיתה אינו מוכן. נדרשות סמכויות מאומתות למשפחה, למקור ולרכישה.")}</p>}
  {!pending&&<button type="button" className="lsw-button lsw-button--secondary" disabled={busy||disabled||confirmed} onClick={()=>void load()}>{t("Read all affected children and lessons","קריאת כל הילדים והשיעורים המושפעים")}</button>}
  {review&&<div><p>{t("Affected children","ילדים מושפעים")}: {review.children.length} · {t("Lesson references","הפניות לשיעורים")}: {review.lessonCount}</p>
   <ul>{review.children.map(child=><li key={child.learnerId}>{child.displayName}<ul>{child.lessons.map(lesson=><li key={lesson.moduleId+":"+lesson.version}><bdi>{lesson.moduleId} · {lesson.version}</bdi></li>)}</ul></li>)}</ul>
   {review.withdrawn?<p role="status">{t("Classroom access has ended. Saved history is retained.","הגישה לכיתה הסתיימה. ההיסטוריה השמורה נשמרת.")}</p>:<form onSubmit={submit}><fieldset className="lsw-fieldset" disabled={busy||pending!==null||disabled}><legend>{t("Confirm the whole family scope above","אישור כל היקף המשפחה המופיע לעיל")}</legend>
    <label className="lsw-field"><span><input type="checkbox" name="confirmFamily" value="yes" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> {t("End classroom access for every child and lesson listed above; keep the saved history.","לסיים את הגישה לכיתה לכל ילד ושיעור המופיעים לעיל; לשמור את ההיסטוריה.")}</span></label>
    <button type="submit" className="lsw-button">{t("End this family's classroom access","סיום גישת המשפחה לכיתה")}</button>
   </fieldset></form>}
  </div>}
  {confirmed&&!pending&&!busy&&<button type="button" className="lsw-button lsw-button--secondary" onClick={()=>{setConfirmed(false);setReview(null);setError(null);}}>{t("Cancel this confirmation","ביטול האישור הזה")}</button>}
  {pending&&!busy&&<button type="button" className="lsw-button" disabled={disabled} onClick={()=>void send(pending)}>{t("Retry the same classroom withdrawal","ניסיון חוזר לאותו סיום גישה לכיתה")}</button>}
  {saved&&<p role="status">{t("Family classroom access ended. Saved reference:","גישת המשפחה לכיתה הסתיימה. מזהה שמור:")} <bdi>{saved.operationId}</bdi></p>}
 </section>;
}
