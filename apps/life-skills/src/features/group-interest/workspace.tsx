"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {interestCommandSchema,interestNotice,type InterestCommand,type InterestList} from "./contract.ts";
export function classifyGroupInterestSaveFailure(requestStarted:boolean,status?:number){
 if(!requestStarted||status===401)return "reauth" as const;
 if(status!==undefined&&status>=400&&status<500)return "correctable" as const;
 return "unconfirmed" as const;
}
export function permissionLanguageChanged(language:Locale|null){return {language,confirmed:false};}
export function GroupInterestWorkspace({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const form=useRef<HTMLFormElement>(null),pending=useRef<InterestCommand|null>(null);
 const [data,setData]=useState<InterestList|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),
  [error,setError]=useState(""),[saved,setSaved]=useState(false),[permission,setPermission]=useState(permissionLanguageChanged(null));
 const load=useCallback(async()=>{
  try{const response=await fetch("/api/private/group-interest",{cache:"no-store"}),body=await response.json();
   if(!response.ok||!body.ok)throw new Error();setData(body.data);setError("");
  }catch{setData(null);setError(locale==="he"?"לא ניתן לטעון פניות. זו אינה רשימה ריקה.":"Inquiries could not be loaded. This is not an empty list.");}
 },[locale]);
 useEffect(()=>{
  let active=true;
  fetch("/api/private/group-interest",{cache:"no-store"}).then(async response=>{
   const body=await response.json();if(!response.ok||!body.ok)throw new Error();return body.data as InterestList;
  }).then(result=>{if(active)setData(result);}).catch(()=>{if(active)setError(locale==="he"?"לא ניתן לטעון פניות. זו אינה רשימה ריקה.":"Inquiries could not be loaded. This is not an empty list.");});
  return()=>{active=false;};
 },[locale]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue="";}};
  window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);
 },[]);
 async function save(){
  if(busy)return;setSaved(false);setError("");
  if(!pending.current){
   const values=new FormData(form.current!);
   const age=values.get("childAge"),parsedAge=typeof age==="string"&&age.trim()!==""?Number(age):Number.NaN;
   const parsed=interestCommandSchema.safeParse({operationId:crypto.randomUUID(),fields:{
    serviceType:values.get("serviceType"),parentName:values.get("parentName"),parentPhone:values.get("parentPhone"),
    language:values.get("language"),childLabel:values.get("childLabel"),childAge:parsedAge,
    area:values.get("area"),availability:values.get("availability"),groupPreference:values.get("groupPreference"),
    permission:{confirmed:values.get("permission")==="on",version:interestNotice.version,language:values.get("permissionLanguage"),source:values.get("permissionSource")}
   }});
   if(!parsed.success){setError(t("Check required fields and the parent's permission.","בדקו את שדות החובה ואת הסכמת ההורה."));return;}
   pending.current=parsed.data;
  }
  setBusy(true);
  let requestStarted=false;
  try{
   const session=await sessionInfo();if(session.role!=="practitioner")throw new Error();
   requestStarted=true;
   const response=await fetch("/api/private/group-interest",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},
    body:JSON.stringify(pending.current)});
   if(!response.ok&&classifyGroupInterestSaveFailure(true,response.status)!=="unconfirmed"){
    pending.current=null;setUncertain(false);
    setError(response.status===401?t("Sign in again, then review and save this inquiry.","יש להתחבר מחדש, לבדוק ולשמור את הפנייה."):
     response.status===403?t("Your current account cannot save this inquiry.","החשבון הנוכחי אינו מורשה לשמור את הפנייה."):
     response.status===409?t("This save conflicts with an earlier request. Review the fields and save again.","השמירה מתנגשת בבקשה קודמת. בדקו את השדות ושמרו שוב."):
     t("The inquiry was not saved. Check the fields and permission, then try again.","הפנייה לא נשמרה. בדקו את השדות ואת ההסכמה ונסו שוב."));
    return;
   }
   const body=await response.json();if(!response.ok||!body.ok||body.data?.saved!==true)throw new Error();
   pending.current=null;setUncertain(false);form.current?.reset();setPermission(permissionLanguageChanged(null));setSaved(true);await load();
  }catch{
   if(classifyGroupInterestSaveFailure(requestStarted)==="reauth"){pending.current=null;setUncertain(false);setError(t("Sign in again, then review and save this inquiry.","יש להתחבר מחדש, לבדוק ולשמור את הפנייה."));}
   else{setUncertain(true);setError(t("Save is unconfirmed. Keep this page open and retry the same inquiry; no message or payment is triggered.",
    "השמירה לא אומתה. השאירו את הדף פתוח ונסו שוב את אותה פנייה; לא נשלחת הודעה ולא מופעל תשלום."));}
  }
  finally{setBusy(false);}
 }
 return <section className="lsw-main">
  <h1>{t("Group and tutoring interest","התעניינות בקבוצה ובתגבור")}</h1>
  <p>{t("Private owner entry — interest for review, without enrollment or payment. Record only practical information; no clinical history.",
   "רישום פרטי של הבעלים — פנייה לבדיקה, ללא הרשמה או תשלום. יש לתעד מידע מעשי בלבד, ללא היסטוריה טיפולית.")}</p>
  <p>{t("Private owner entry. This records administrative interest only and does not enroll, charge, invite, book or send a message.",
   "רישום פרטי של הבעלים. הפעולה מתעדת התעניינות מנהלית בלבד ואינה רושמת, מחייבת, מזמינה, קובעת פגישה או שולחת הודעה.")}</p>
  {error&&<p role="alert">{error}</p>}
  {saved&&<p role="status">{t("Inquiry saved and read back from the app database.","הפנייה נשמרה ונקראה בחזרה ממסד הנתונים של האפליקציה.")}</p>}
  <form ref={form} onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset disabled={busy||uncertain}><legend>{t("Record an inquiry","רישום פנייה")}</legend>
    <label>{t("Service","שירות")}<select name="serviceType" required><option value="group">{t("Group","קבוצה")}</option><option value="tutoring">{t("Tutoring","תגבור")}</option><option value="group_and_tutoring">{t("Both","שניהם")}</option></select></label>
    <label>{t("Parent name","שם ההורה")}<input name="parentName" required maxLength={100}/></label>
    <label>{t("Parent phone, including country code","טלפון ההורה כולל קידומת מדינה")}<input name="parentPhone" type="tel" required maxLength={16} placeholder="+972…" dir="ltr"/></label>
    <label>{t("Contact language","שפת קשר")}<select name="language" defaultValue={locale}><option value="he">עברית</option><option value="en">English</option></select></label>
    <label>{t("Child first name or short identifier","שם פרטי או מזהה קצר של הילד/ה")}<input name="childLabel" required maxLength={60}/></label>
    <label>{t("Child age","גיל הילד/ה")}<input name="childAge" type="number" required min={0} max={17}/></label>
    <label>{t("Area (optional)","אזור (לא חובה)")}<input name="area" maxLength={120}/></label>
    <label>{t("Availability (optional)","זמינות (לא חובה)")}<input name="availability" maxLength={240}/></label>
    <label>{t("Group preferences (optional)","העדפות לקבוצה (לא חובה)")}<input name="groupPreference" maxLength={240}/></label>
    <label>{t("How parent permission was received","איך התקבלה הסכמת ההורה")}<select name="permissionSource" required defaultValue=""><option value="" disabled>{t("Select","בחירה")}</option><option value="spoken">{t("Spoken","בעל פה")}</option><option value="written">{t("Written","בכתב")}</option><option value="whatsapp">WhatsApp</option></select></label>
    <label>{t("Language used for parent permission","שפת הסכמת ההורה")}<select name="permissionLanguage" required value={permission.language??""} onChange={event=>setPermission(permissionLanguageChanged(event.target.value==="he"?"he":event.target.value==="en"?"en":null))}><option value="" disabled>{t("Select","בחירה")}</option><option value="he">עברית</option><option value="en">English</option></select></label>
    <label><input name="permission" type="checkbox" required disabled={!permission.language} checked={permission.confirmed} onChange={event=>setPermission(current=>({...current,confirmed:event.target.checked}))}/>{permission.language?interestNotice[permission.language]:t("Select the permission language to review the exact notice.","בחרו את שפת ההסכמה כדי לקרוא את הנוסח המדויק.")}</label>
   </fieldset>
   <button type="submit" disabled={busy}>{busy?t("Saving…","שומר…"):uncertain?t("Retry same inquiry","ניסיון חוזר לאותה פנייה"):t("Save interest","שמירת התעניינות")}</button>
  </form>
  <h2>{t("Recent inquiries","פניות אחרונות")}</h2>
  <button type="button" disabled={busy} onClick={()=>void load()}>{t("Refresh","רענון")}</button>
  {data&&data.items.length===0&&<p>{t("No inquiries recorded.","לא נרשמו פניות.")}</p>}
  {data?.items.map(item=><article key={item.id}><h3>{item.fields.parentName} — {item.fields.childLabel}</h3>
   <p>{item.fields.parentPhone} · {item.fields.serviceType==="group"?t("Group","קבוצה"):item.fields.serviceType==="tutoring"?t("Tutoring","תגבור"):t("Both","שניהם")} · {t("Age","גיל")} {item.fields.childAge}</p>
   <p>{[item.fields.area,item.fields.availability,item.fields.groupPreference].filter(Boolean).join(" · ")}</p>
   <p>{t("Interest only — owner review pending","התעניינות בלבד — ממתין לבדיקת הבעלים")} · <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.createdAt))}</time></p>
  </article>)}
  {data?.hasMore&&<p>{t("Showing the latest 50; older inquiries remain saved.","מוצגות 50 הפניות האחרונות; פניות קודמות נשארות שמורות.")}</p>}
 </section>;
}
