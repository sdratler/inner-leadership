"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {interestCommandSchema,interestNotice,serviceInterestCommandSchema,type InterestCommand,type InterestList,
 type InterestRecord,type ServiceInterestCommand} from "./contract.ts";
import styles from "./workspace.module.css";
export function classifyGroupInterestSaveFailure(requestStarted:boolean,status?:number,previouslyUncertain=false){
 if(previouslyUncertain)return "unconfirmed" as const;
 if(!requestStarted||status===401)return "reauth" as const;
 if(status!==undefined&&status>=400&&status<500)return "correctable" as const;
 return "unconfirmed" as const;
}
export function permissionLanguageChanged(language:Locale|null){return {language,confirmed:false};}
export function serviceOptions(item:Pick<InterestRecord,"fields">){return item.fields.serviceType==="group_and_tutoring"?["group","tutoring"] as const:[item.fields.serviceType] as const;}
export function GroupInterestWorkspace({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const form=useRef<HTMLFormElement>(null),pending=useRef<InterestCommand|null>(null),servicePending=useRef<ServiceInterestCommand|null>(null);
 const [data,setData]=useState<InterestList|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),
  [error,setError]=useState(""),[saved,setSaved]=useState(false),[permission,setPermission]=useState(permissionLanguageChanged(null)),
  [serviceBusy,setServiceBusy]=useState(""),[serviceUncertain,setServiceUncertain]=useState(""),
  [serviceError,setServiceError]=useState<{inquiryId:string;message:string}|null>(null),[serviceSaved,setServiceSaved]=useState("");
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
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current||servicePending.current){event.preventDefault();event.returnValue="";}};
  window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);
 },[]);
 async function save(){
  if(busy)return;setSaved(false);setError("");
   const previouslyUncertain=uncertain;
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
    if(!response.ok&&classifyGroupInterestSaveFailure(true,response.status,previouslyUncertain)!=="unconfirmed"){
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
    if(classifyGroupInterestSaveFailure(requestStarted,undefined,previouslyUncertain)==="reauth"){pending.current=null;setUncertain(false);setError(t("Sign in again, then review and save this inquiry.","יש להתחבר מחדש, לבדוק ולשמור את הפנייה."));}
   else{setUncertain(true);setError(t("Save is unconfirmed. Keep this page open and retry the same inquiry; no message or payment is triggered.",
    "השמירה לא אומתה. השאירו את הדף פתוח ונסו שוב את אותה פנייה; לא נשלחת הודעה ולא מופעל תשלום."));}
  }
  finally{setBusy(false);}
 }
 async function saveServiceInterest(event:FormEvent<HTMLFormElement>,inquiry:InterestRecord){
  event.preventDefault();if(serviceBusy)return;const serviceForm=event.currentTarget;setServiceSaved("");setServiceError(null);
  const previouslyUncertain=serviceUncertain===inquiry.id;
  if(!servicePending.current){
   const values=new FormData(event.currentTarget),member=String(values.get("member")??"").split("|");
   const parsed=serviceInterestCommandSchema.safeParse({action:"record_service_interest",operationId:crypto.randomUUID(),
    inquiryId:inquiry.id,familyId:member[0],personId:member[1],serviceType:values.get("serviceType")});
   if(!parsed.success){setServiceError({inquiryId:inquiry.id,message:t("Select a verified family member and one service.","בחרו בן/בת משפחה מאומת/ת ושירות אחד.")});return;}
   servicePending.current=parsed.data;
  }else if(servicePending.current.inquiryId!==inquiry.id){return;}
  setServiceBusy(inquiry.id);let requestStarted=false;
  try{
   const session=await sessionInfo();if(session.role!=="practitioner")throw new Error();requestStarted=true;
   const response=await fetch("/api/private/group-interest",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(servicePending.current)});
   if(!response.ok&&classifyGroupInterestSaveFailure(true,response.status,previouslyUncertain)!=="unconfirmed"){
    servicePending.current=null;setServiceUncertain("");
    setServiceError({inquiryId:inquiry.id,message:response.status===401?t("Sign in again, then review and save this service interest.","יש להתחבר מחדש, לבדוק ולשמור את ההתעניינות בשירות."):
     response.status===403?t("Your current account cannot save this service interest.","החשבון הנוכחי אינו מורשה לשמור את ההתעניינות בשירות."):
     response.status===404?t("The selected inquiry or verified family member is no longer available. Refresh and choose again.","הפנייה או בן/בת המשפחה שנבחרו אינם זמינים עוד. רעננו ובחרו שוב."):
     response.status===409?t("This save conflicts with an earlier request. Refresh before trying again.","השמירה מתנגשת בבקשה קודמת. רעננו לפני ניסיון נוסף."):
     t("The service interest was not saved. Check the selection and try again.","ההתעניינות בשירות לא נשמרה. בדקו את הבחירה ונסו שוב.")});return;
   }
   const body=await response.json();if(!response.ok||!body.ok||body.data?.saved!==true)throw new Error();
   servicePending.current=null;setServiceUncertain("");setServiceSaved(inquiry.id);serviceForm.reset();await load();
  }catch{
   if(classifyGroupInterestSaveFailure(requestStarted,undefined,previouslyUncertain)==="reauth"){
    servicePending.current=null;setServiceUncertain("");setServiceError({inquiryId:inquiry.id,message:t("Sign in again, then review and save this service interest.","יש להתחבר מחדש, לבדוק ולשמור את ההתעניינות בשירות.")});
   }else{
    setServiceUncertain(inquiry.id);setServiceError({inquiryId:inquiry.id,message:t("Save is unconfirmed. Keep this page open and retry the same family member and service; no enrollment, message or payment is triggered.",
     "השמירה לא אומתה. השאירו את הדף פתוח ונסו שוב עם אותו בן/בת משפחה ואותו שירות; לא נוצרת הרשמה, לא נשלחת הודעה ולא מופעל תשלום.")});
   }
  }finally{setServiceBusy("");}
 }
 return <section className={`lsw-main ${styles.workspace}`}>
  <h1>{t("Group and tutoring interest","התעניינות בקבוצה ובתגבור")}</h1>
  <p className={styles.intro}>{t("Private owner entry for administrative interest and review only. Record practical information, not clinical history; this does not enroll, charge, invite, book or send a message.",
   "רישום פרטי של הבעלים להתעניינות מנהלית ולבדיקה בלבד. יש לתעד מידע מעשי ולא היסטוריה טיפולית; הפעולה אינה רושמת, מחייבת, מזמינה, קובעת פגישה או שולחת הודעה.")}</p>
  {error&&<p role="alert">{error}</p>}
  {saved&&<p role="status">{t("Inquiry saved and read back from the app database.","הפנייה נשמרה ונקראה בחזרה ממסד הנתונים של האפליקציה.")}</p>}
  <form ref={form} className={styles.form} onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset className={styles.fields} disabled={busy||uncertain}><legend>{t("Record an inquiry","רישום פנייה")}</legend>
    <label className={styles.field}>{t("Service","שירות")}<select name="serviceType" required><option value="group">{t("Group","קבוצה")}</option><option value="tutoring">{t("Tutoring","תגבור")}</option><option value="group_and_tutoring">{t("Both","שניהם")}</option></select></label>
    <label className={styles.field}>{t("Parent name","שם ההורה")}<input name="parentName" required maxLength={100}/></label>
    <label className={styles.field}>{t("Parent phone, including country code","טלפון ההורה כולל קידומת מדינה")}<input name="parentPhone" type="tel" required maxLength={16} placeholder="+972…" dir="ltr"/></label>
    <label className={styles.field}>{t("Contact language","שפת קשר")}<select name="language" defaultValue={locale}><option value="he">עברית</option><option value="en">English</option></select></label>
    <label className={styles.field}>{t("Child first name or short identifier","שם פרטי או מזהה קצר של הילד/ה")}<input name="childLabel" required maxLength={60}/></label>
    <label className={styles.field}>{t("Child age","גיל הילד/ה")}<input name="childAge" type="number" required min={0} max={17}/></label>
    <label className={styles.field}>{t("Area (optional)","אזור (לא חובה)")}<input name="area" maxLength={120}/></label>
    <label className={styles.field}>{t("Availability (optional)","זמינות (לא חובה)")}<input name="availability" maxLength={240}/></label>
    <label className={styles.field}>{t("Group preferences (optional)","העדפות לקבוצה (לא חובה)")}<input name="groupPreference" maxLength={240}/></label>
    <label className={styles.field}>{t("How parent permission was received","איך התקבלה הסכמת ההורה")}<select name="permissionSource" required defaultValue=""><option value="" disabled>{t("Select","בחירה")}</option><option value="spoken">{t("Spoken","בעל פה")}</option><option value="written">{t("Written","בכתב")}</option><option value="whatsapp">WhatsApp</option></select></label>
    <label className={styles.field}>{t("Language used for parent permission","שפת הסכמת ההורה")}<select name="permissionLanguage" required value={permission.language??""} onChange={event=>setPermission(permissionLanguageChanged(event.target.value==="he"?"he":event.target.value==="en"?"en":null))}><option value="" disabled>{t("Select","בחירה")}</option><option value="he">עברית</option><option value="en">English</option></select></label>
    <label className={styles.permission}><input name="permission" type="checkbox" required disabled={!permission.language} checked={permission.confirmed} onChange={event=>setPermission(current=>({...current,confirmed:event.target.checked}))}/><span>{permission.language?interestNotice[permission.language]:t("Select the permission language to review the exact notice.","בחרו את שפת ההסכמה כדי לקרוא את הנוסח המדויק.")}</span></label>
   </fieldset>
   <button type="submit" className={`lsw-button lsw-button--primary ${styles.save}`} disabled={busy}>{busy?t("Saving…","שומר…"):uncertain?t("Retry same inquiry","ניסיון חוזר לאותה פנייה"):t("Save interest","שמירת התעניינות")}</button>
  </form>
  <header className={styles.recentHeader}><h2>{t("Recent inquiries","פניות אחרונות")}</h2>
   <button type="button" className={`lsw-button lsw-button--secondary ${styles.refresh}`} disabled={busy} onClick={()=>void load()}>{t("Refresh","רענון")}</button></header>
  {!data&&!error&&<p role="status">{t("Loading inquiries and verified family members…","טוען פניות ובני משפחה מאומתים…")}</p>}
  {data&&data.items.length===0&&<p>{t("No inquiries recorded.","לא נרשמו פניות.")}</p>}
  {data?.items.map(item=>{const recorded=data.serviceInterests.filter(value=>value.sourceInquiryId===item.id);return <article className={styles.record} key={item.id}><h3>{item.fields.parentName} — {item.fields.childLabel}</h3>
   <p><bdi dir="ltr" className={styles.phone}>{item.fields.parentPhone}</bdi> · {item.fields.serviceType==="group"?t("Group","קבוצה"):item.fields.serviceType==="tutoring"?t("Tutoring","תגבור"):t("Both","שניהם")} · {t("Age","גיל")} {item.fields.childAge}</p>
   <p>{[item.fields.area,item.fields.availability,item.fields.groupPreference].filter(Boolean).join(" · ")}</p>
   <p>{t("Interest only — owner review pending","התעניינות בלבד — ממתין לבדיקת הבעלים")} · <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.createdAt))}</time></p>
   {recorded.length>0&&<div className={styles.savedInterests}><h4>{t("Recorded service interests","התעניינויות בשירות שנרשמו")}</h4><ul>{recorded.map(value=><li key={value.id}>{value.personLabel} — {value.familyLabel} · {value.serviceType==="group"?t("Group","קבוצה"):t("Tutoring","תגבור")}</li>)}</ul></div>}
   {serviceError?.inquiryId===item.id&&<p role="alert">{serviceError.message}</p>}
   {serviceSaved===item.id&&<p role="status">{t("Service interest saved and read back. No placement, enrollment, message or payment was created.","ההתעניינות בשירות נשמרה ונקראה בחזרה. לא נוצרו שיבוץ, הרשמה, הודעה או תשלום.")}</p>}
   {data.members.length===0?<p>{t("No verified child/family identity is available. Create or verify the family in People before recording a service interest.","אין זהות מאומתת של ילד/ה ומשפחה. יש ליצור או לאמת את המשפחה במסך אנשים לפני רישום התעניינות בשירות.")}</p>:
    <form className={styles.promotion} onSubmit={event=>void saveServiceInterest(event,item)}>
     <label className={styles.field}>{t("Verified family member","בן/בת משפחה מאומת/ת")}<select name="member" required disabled={serviceUncertain===item.id}><option value="">{t("Select one family member","בחרו בן/בת משפחה אחד/ת")}</option>{data.members.map(member=><option key={`${member.familyId}:${member.personId}`} value={`${member.familyId}|${member.personId}`}>{member.personLabel} — {member.familyLabel}</option>)}</select></label>
     <label className={styles.field}>{t("One service","שירות אחד")}<select name="serviceType" required disabled={serviceUncertain===item.id}>{serviceOptions(item).map(value=><option key={value} value={value}>{value==="group"?t("Group","קבוצה"):t("Tutoring","תגבור")}</option>)}</select></label>
     <button type="submit" className="lsw-button lsw-button--primary" disabled={Boolean(serviceBusy)||serviceUncertain!==""&&serviceUncertain!==item.id}>{serviceBusy===item.id?t("Saving…","שומר…"):serviceUncertain===item.id?t("Retry same service interest","ניסיון חוזר לאותה התעניינות"):t("Record service interest","רישום התעניינות בשירות")}</button>
    </form>}
  </article>})}
  {data?.hasMore&&<p>{t("Showing the latest 50; older inquiries remain saved.","מוצגות 50 הפניות האחרונות; פניות קודמות נשארות שמורות.")}</p>}
 </section>;
}
