"use client";
import {useEffect,useRef,useState} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {floridaGroupApplicationFieldsSchema,floridaGroupApplicationNotice,type FloridaGroupApplicationCommand,type FloridaProgramId} from "./contract.ts";
import styles from "./application-form.module.css";

type Challenge={challenge:string};
const optional=(value:FormDataEntryValue|null)=>typeof value==="string"&&value.trim()!==""?value:undefined;
export function classifyPublicApplicationFailure(requestStarted:boolean,status?:number,previouslyUncertain=false){
 if(!requestStarted||status===404)return "unavailable" as const;
 if(status!==undefined&&status>=400&&status<500)return "correctable" as const;
 if(previouslyUncertain)return "unconfirmed" as const;
 return "unconfirmed" as const;
}

export function GroupApplicationForm({locale,programId}:{locale:Locale;programId:FloridaProgramId}){
 const t=(en:string,he:string)=>locale==="he"?he:en,form=useRef<HTMLFormElement>(null),pending=useRef<{command:FloridaGroupApplicationCommand;website:""}|null>(null),errorRef=useRef<HTMLDivElement>(null),permissionRef=useRef<HTMLInputElement>(null);
 const [challenge,setChallenge]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
 const endpoint=`/api/public/group-applications?program=${encodeURIComponent(programId)}`;
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>|undefined;fetch(endpoint,{cache:"no-store",credentials:"same-origin"}).then(async response=>{const body=await response.json();if(!response.ok||body?.ok!==true||typeof body.data?.challenge!=="string")throw new Error();return body.data as Challenge;}).then(data=>{if(active)timer=setTimeout(()=>{if(active)setChallenge(data.challenge);},1600);}).catch(()=>{if(active)setError(locale==="he"?"שליחת פניות מקוונות עדיין אינה זמינה. לא נשלחו פרטים.":"Online inquiries are not available yet. No details have been sent.");});return()=>{active=false;if(timer)clearTimeout(timer);};},[endpoint,locale]);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 useEffect(()=>{if(!pending.current&&permissionRef.current)permissionRef.current.checked=false;},[locale]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||!challenge)return;setSaved(false);setError("");const previouslyUncertain=uncertain;
  if(!pending.current){
   const values=new FormData(event.currentTarget),schedulePreference=values.getAll("schedulePreference").filter((value):value is string=>typeof value==="string");
   const fields=floridaGroupApplicationFieldsSchema.safeParse({parentName:values.get("parentName"),contact:values.get("contact"),language:locale,childAge:optional(values.get("childAge")),cityArea:values.get("cityArea"),neighborhood:optional(values.get("neighborhood")),programId,schedulePreference,scheduleNotes:optional(values.get("scheduleNotes")),permission:{confirmed:values.get("permission")==="on",version:floridaGroupApplicationNotice.version,language:locale}});
   if(!fields.success){setError(t("Please complete the required contact, location, program, schedule and permission fields.","יש למלא את פרטי הקשר, המיקום, המסלול והעדפות הזמנים הנדרשים ולאשר את ההסכמה."));return;}
   if(values.get("website")!==""){setError(t("Your inquiry could not be verified. Reload the page and try again.","לא ניתן לאמת את הפנייה. רעננו את הדף ונסו שוב."));return;}
   pending.current={command:{operationId:crypto.randomUUID(),fields:fields.data},website:""};
  }
  setBusy(true);let requestStarted=false;
  try{
   requestStarted=true;const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({challenge,website:pending.current.website,operationId:pending.current.command.operationId,fields:pending.current.command.fields})});
   if(!response.ok&&previouslyUncertain&&response.status===403){
    setChallenge("");
    try{const renewed=await fetch(endpoint,{cache:"no-store",credentials:"same-origin"}),body=await renewed.json();if(!renewed.ok||body?.ok!==true||typeof body.data?.challenge!=="string")throw new Error();await new Promise(resolve=>setTimeout(resolve,1600));setChallenge(body.data.challenge);setUncertain(true);setError(t("Form verification was renewed. Check the same save again; it will not create a duplicate.","אימות הטופס חודש. בדקו שוב את אותה שמירה; לא ייווצר עותק נוסף."));}
    catch{setUncertain(true);setError(t("The earlier result is still unconfirmed and form verification could not be renewed. Keep this page open and try again later.","התוצאה הקודמת עדיין לא אומתה ולא ניתן היה לחדש את אימות הטופס. השאירו את הדף פתוח ונסו שוב מאוחר יותר."));}
    return;
   }
   if(!response.ok&&previouslyUncertain&&response.status===429){setUncertain(true);setError(t("The earlier result is still unconfirmed. Wait before checking the same save again.","התוצאה הקודמת עדיין לא אומתה. המתינו לפני בדיקה נוספת של אותה שמירה."));return;}
   if(!response.ok&&previouslyUncertain){setUncertain(true);setError(t("The earlier result is still unconfirmed because this check was rejected. Keep this page open and try the same check again later.","התוצאה הקודמת עדיין לא אומתה מפני שבדיקת השמירה נדחתה. השאירו את הדף פתוח ונסו את אותה בדיקה שוב מאוחר יותר."));return;}
   const kind=classifyPublicApplicationFailure(true,response.status,previouslyUncertain);
   if(!response.ok&&kind!=="unconfirmed"){
    pending.current=null;setUncertain(false);setError(response.status===429?t("Too many attempts were received. Please wait and try again later.","התקבלו ניסיונות רבים מדי. המתינו ונסו שוב מאוחר יותר."):response.status===403?t("This form expired or could not be verified. Reload the page and try again.","לא ניתן לאמת את הטופס או שפג תוקפו. רעננו את הדף ונסו שוב."):t("Your inquiry was not saved. Review the fields and try again.","הפנייה לא נשמרה. בדקו את השדות ונסו שוב."));return;
   }
   const body=await response.json();if(!response.ok||body?.ok!==true||body.data?.saved!==true)throw new Error();
   pending.current=null;setUncertain(false);form.current?.reset();setSaved(true);
  }catch{
   const kind=classifyPublicApplicationFailure(requestStarted,undefined,previouslyUncertain);
   if(kind==="unavailable"){pending.current=null;setUncertain(false);setError(t("Online inquiries are unavailable. No information was saved.","לא ניתן לשלוח פניות כעת. לא נשמר מידע."));}
   else{setUncertain(true);setError(t("We could not confirm whether your inquiry was saved. Keep this page open and check the same save before sending another copy.","לא הצלחנו לאשר אם הפנייה נשמרה. השאירו את הדף פתוח ובדקו את אותה שמירה לפני שליחת עותק נוסף."));}
  }finally{setBusy(false);}
 }

 const programName=programId==="sunday_fishing_academy"?t("Florida Fishing & Keys Course","מסלול הדיג והקיז בפלורידה"):programId==="morning_torah_learning"?t("Morning Torah Learning","לימוד תורה בבוקר"):t("Private Fishing & Life Skills","דיג וכישורי חיים באופן פרטי");
 return <form ref={form} className={styles.form} onSubmit={submit} noValidate>
  <div className={styles.heading}><p className={styles.kicker}>{t("Private inquiry","פנייה פרטית")}</p><h3>{t("Ask about a Florida group","בירור על קבוצה בפלורידה")}</h3><p>{t("An inquiry is not a booking. Please send only basic contact and scheduling details.","הפנייה אינה הזמנה. יש לשלוח רק פרטי קשר בסיסיים והעדפות זמנים.")}</p></div>
  {error&&<div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}><strong>{t("Please check this inquiry","בדקו את הפנייה")}</strong><p>{error}</p></div>}
  {saved&&<div role="status" className={styles.success}><strong>{t("Inquiry saved","הפנייה נשמרה")}</strong><p>{t("Your inquiry was saved for private owner review. Group details and next steps will be discussed before anything is booked.","הפנייה נשמרה לבדיקה פרטית של הבעלים. פרטי הקבוצה והצעדים הבאים יידונו לפני אישור הזמנה.")}</p></div>}
  <fieldset className={styles.fieldset} disabled={busy||uncertain}>
   <legend className={styles.srOnly}>{t("Group inquiry details","פרטי הפנייה לקבוצה")}</legend>
   <div className={styles.fields}>
    <label>{t("Parent or guardian name","שם ההורה או האפוטרופוס")}<input name="parentName" required maxLength={100} autoComplete="name"/></label>
    <label>{t("Phone or email","טלפון או דוא״ל")}<input name="contact" required maxLength={254} dir="ltr" inputMode="text" aria-describedby="contact-hint"/><span id="contact-hint" className={styles.fieldNote}>{t("Provide one way to contact you about this inquiry. No country code is assumed.","ציינו דרך אחת ליצור איתכם קשר בנוגע לפנייה. לא נניח קידומת מדינה.")}</span></label>
    <label>{t("Boy’s age (optional)","גיל הבן (לא חובה)")}<input name="childAge" maxLength={20} inputMode="text"/></label>
    <label>{t("City or area in Florida","עיר או אזור בפלורידה")}<input name="cityArea" required maxLength={100} autoComplete="address-level2"/></label>
    <label>{t("Neighborhood (optional)","שכונה (לא חובה)")}<input name="neighborhood" maxLength={100} autoComplete="address-level3"/></label>
    <div className={styles.emptyGroup}><strong>{t("Program","מסלול")}</strong><p>{programName}</p></div>
   </div>
    <fieldset className={styles.schedule}><legend>{t("When could a fit call work?","מתי יכולה להתאים שיחת התאמה?")}</legend><p className={styles.fieldNote}>{t("Choose at least one time when we may contact you for a fit conversation. These are not lesson or meeting times, and they do not create a seat or booking.","בחרו לפחות זמן אחד שבו נוכל ליצור קשר לשיחת התאמה. אלה אינם מועדי שיעורים או מפגשים, והם אינם יוצרים מקום או הזמנה.")}</p><div className={styles.checkGrid}>
     <label><input name="schedulePreference" type="checkbox" value="weekday_after_school"/><span>{t("Weekday after school fit call","שיחת התאמה ביום חול אחרי הלימודים")}</span></label>
     <label><input name="schedulePreference" type="checkbox" value="sunday"/><span>{t("Sunday fit call","שיחת התאמה ביום ראשון")}</span></label>
     <label><input name="schedulePreference" type="checkbox" value="flexible"/><span>{t("Flexible fit-call time","זמן גמיש לשיחת התאמה")}</span></label>
     <label><input name="schedulePreference" type="checkbox" value="other"/><span>{t("Another fit-call time","זמן אחר לשיחת התאמה")}</span></label>
   </div></fieldset>
    <label className={styles.full}>{t("Other fit-call times or a brief scheduling note (optional)","זמנים אחרים לשיחת התאמה או הערה קצרה (לא חובה)")}<textarea name="scheduleNotes" maxLength={300} rows={3}/></label>
   <div className={styles.emptyGroup}><strong>{t("Published group preference","קבוצה מועדפת מתוך הקבוצות שפורסמו")}</strong><p>{t("No confirmed group times or meeting points are currently listed.","כרגע אין ברשימה מועדי קבוצות או נקודות מפגש מאושרים.")}</p></div>
    <label className={styles.permission}><input ref={permissionRef} name="permission" type="checkbox" required/><span>{floridaGroupApplicationNotice[locale]}</span></label>
   <p className={styles.privacy}>{t("Do not include medical histories, diagnoses, reports, payment details or child photographs.","אין לצרף היסטוריה רפואית, אבחנות, דוחות, פרטי תשלום או תמונות ילדים.")}</p>
   <label className={styles.honeypot} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
  </fieldset>
  {uncertain&&<p className={styles.locked}>{t("The original details are temporarily locked while you check the same operation.","הפרטים המקוריים נעולים זמנית בזמן בדיקת אותה פעולה.")}</p>}
  <button type="submit" disabled={busy||!challenge}>{busy?t("Saving your inquiry…","שומרים את הפנייה…"):uncertain?t("Check save status","בדיקת מצב השמירה"):t("Send group inquiry","שליחת פנייה על קבוצה")}</button>
  <p className={styles.boundary}>{t("Saving creates one private administrative inquiry only. It does not create an account, clinical case, enrollment, trip clearance, booking, charge or provider message.","השמירה יוצרת פנייה מנהלית פרטית אחת בלבד. היא אינה יוצרת חשבון, תיק טיפולי, הרשמה, אישור לטיול, הזמנה, חיוב או הודעת ספק.")}</p>
 </form>;
}
