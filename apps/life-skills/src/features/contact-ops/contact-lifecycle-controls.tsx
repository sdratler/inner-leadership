"use client";
import {useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {IdentityClientError,sessionInfo} from "../identity/client.ts";
import type {ContactLifecycle} from "./core/contact-lifecycle.ts";

export function ContactLifecycleControls({locale,personId,version,epoch,archived,blocked,denied,lockEdits}:{locale:Locale;personId:string;version:number;epoch:number;archived:boolean;blocked:boolean;denied:(status:number)=>void;lockEdits:(locked:boolean)=>void}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [pending,setPending]=useState<ContactLifecycle|null>(null),guard=useRef(false);
 const action=archived?"restore":"archive";
 async function save(){
  if(guard.current||blocked)return;guard.current=true;setBusy(true);lockEdits(true);
  const command=pending??{action,personId,expectedEpoch:epoch,expectedVersion:version,operationId:crypto.randomUUID()};setPending(command);
  try{
   const session=await sessionInfo();
   const response=await fetch("/api/private/contact-profiles",{method:"POST",credentials:"same-origin",redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(command)});
   if(response.status===401||response.status===403){denied(response.status);return;}
   const body=await response.json();
   if(response.ok&&body?.ok&&body.data?.personId===personId&&body.data?.authorityEpoch===epoch){window.location.reload();return;}
   if(response.status===409){setPending(null);setConfirm(false);lockEdits(false);setMessage(t("The record changed. Reload and review its current state before trying again.","הרשומה השתנתה. יש לטעון מחדש ולבדוק את מצבה לפני ניסיון נוסף."));return;}
   throw Error("UNCONFIRMED");
  }catch(error){
   if(error instanceof IdentityClientError&&["UNAUTHENTICATED","FORBIDDEN"].includes(error.code)){denied(error.code==="UNAUTHENTICATED"?401:403);return;}
   setMessage(t("The result could not be confirmed. Retry this exact request or reload to check the saved state. No message was sent.","לא ניתן לאשר את התוצאה. אפשר לנסות שוב את אותה בקשה או לטעון מחדש לבדיקת המצב השמור. לא נשלחה הודעה."));
  }finally{guard.current=false;setBusy(false);}
 }
 return <section className="lsw-card" aria-label={t("Contact archive","ארכיון אנשי קשר")}>
  <p>{t("Archiving removes this contact from open administrative follow-ups. Notes, linked cases, payments and history remain. Restoring does not remove a contact opt-out or reopen a closed case.","העברה לארכיון מסירה את איש הקשר מהמשך טיפול מנהלי פתוח. הערות, תיקים מקושרים, תשלומים והיסטוריה נשמרים. שחזור אינו מבטל איסור יצירת קשר ואינו פותח תיק סגור.")}</p>
  {blocked&&<p>{t("Save or resolve your current edits before changing archive status.","יש לשמור או לפתור את העריכה הנוכחית לפני שינוי מצב הארכיון.")}</p>}
  {!confirm?<button type="button" className="lsw-button lsw-button--secondary" disabled={blocked||busy} onClick={()=>{setConfirm(true);setMessage("");}}>{archived?t("Restore contact","שחזור איש קשר"):t("Archive contact","העברה לארכיון")}</button>:
   <div className="lsw-stack"><p>{archived?t("Restore this contact to its previous administrative stage?","לשחזר את איש הקשר לשלב המנהלי הקודם?"):t("Archive this contact? Nothing will be permanently deleted.","להעביר את איש הקשר לארכיון? דבר לא יימחק לצמיתות.")}</p><div className="lsw-actions">
    <button type="button" className="lsw-button lsw-button--primary" disabled={blocked||busy} onClick={()=>void save()}>{pending?t("Retry this request","ניסיון חוזר של הבקשה"):t("Confirm","אישור")}</button>
    {!pending&&<button type="button" className="lsw-button lsw-button--quiet" disabled={busy} onClick={()=>setConfirm(false)}>{t("Cancel","ביטול")}</button>}
   </div></div>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
