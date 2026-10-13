"use client";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {floridaGroupApplicationFieldsSchema,floridaGroupApplicationNotice,floridaSchoolInquiryNotice,type FloridaGroupApplicationCommand,type FloridaProgramId} from "./contract.ts";
import {schoolAgeLabels,schoolWeekdayLabels,schoolTransportLabels} from "./school-inquiry-details.tsx";
import {journeyProgramName} from "./journey-preview-model.ts";
import styles from "./application-form.module.css";

type Challenge={challenge:string};
const optional=(value:FormDataEntryValue|null)=>typeof value==="string"&&value.trim()!==""?value:undefined;
const subscribeHydration=()=>()=>{};
const clientReady=()=>true,serverReady=()=>false;
export function classifyPublicApplicationFailure(requestStarted:boolean,status?:number,previouslyUncertain=false){
 if(!requestStarted||status===404)return "unavailable" as const;
 if(status!==undefined&&status>=400&&status<500)return "correctable" as const;
 if(previouslyUncertain)return "unconfirmed" as const;
 return "unconfirmed" as const;
}

export function GroupApplicationForm({locale,programId,onSaved,mode="native",onPreviewed,inquiryKind="parent"}:{locale:Locale;programId:FloridaProgramId;onSaved?:(reference:string)=>void;mode?:"native"|"sample";onPreviewed?:()=>void;inquiryKind?:"parent"|"institution"}){
 const school=inquiryKind==="institution",notice=school?floridaSchoolInquiryNotice:floridaGroupApplicationNotice;
 if(school&&programId!=="sunday_fishing_academy")throw new Error("SCHOOL_INQUIRY_ACADEMY_ONLY");
 const t=(en:string,he:string)=>locale==="he"?he:en,form=useRef<HTMLFormElement>(null),pending=useRef<{command:FloridaGroupApplicationCommand;website:""}|null>(null),errorRef=useRef<HTMLDivElement>(null),permissionRef=useRef<HTMLInputElement>(null);
 const [challenge,setChallenge]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[uncertainReference,setUncertainReference]=useState(""),[error,setError]=useState(""),[saved,setSaved]=useState(false),[savedReference,setSavedReference]=useState("");
 const [previewed,setPreviewed]=useState(false);
 const sampleReady=useSyncExternalStore(subscribeHydration,clientReady,serverReady);
 const endpoint=`/api/public/group-applications?program=${encodeURIComponent(programId)}`;
 useEffect(()=>{if(mode==="sample")return;let active=true,timer:ReturnType<typeof setTimeout>|undefined;fetch(endpoint,{cache:"no-store",credentials:"same-origin"}).then(async response=>{const body=await response.json();if(!response.ok||body?.ok!==true||typeof body.data?.challenge!=="string")throw new Error();return body.data as Challenge;}).then(data=>{if(active)timer=setTimeout(()=>{if(active)setChallenge(data.challenge);},1600);}).catch(()=>{if(active)setError(locale==="he"?"שליחת פניות מקוונות עדיין אינה זמינה. לא נשלחו פרטים.":"Online inquiries are not available yet. No details have been sent.");});return()=>{active=false;if(timer)clearTimeout(timer);};},[endpoint,locale,mode]);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 useEffect(()=>{if(!pending.current&&permissionRef.current)permissionRef.current.checked=false;},[locale]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||(mode==="native"&&!challenge))return;setSaved(false);setSavedReference("");setError("");const previouslyUncertain=uncertain;
  if(!pending.current){
   const values=new FormData(event.currentTarget),schedulePreference=values.getAll("schedulePreference").filter((value):value is string=>typeof value==="string");
   const permission={confirmed:values.get("permission")==="on",version:notice.version,language:locale};
   const fields=floridaGroupApplicationFieldsSchema.safeParse(school?{inquiryKind:"institution",programId,language:locale,schoolName:values.get("schoolName"),contactName:values.get("contactName"),staffRole:values.get("staffRole"),cityArea:values.get("cityArea"),contact:values.get("contact"),ageBand:values.get("ageBand"),groupSize:Number(values.get("groupSize")),preferredWeekday:values.get("preferredWeekday"),schoolTransport:values.get("schoolTransport"),permission}:{parentName:values.get("parentName"),contact:values.get("contact"),language:locale,childAge:optional(values.get("childAge")),cityArea:values.get("cityArea"),neighborhood:optional(values.get("neighborhood")),programId,schedulePreference,...(programId==="sunday_fishing_academy"?{scheduleContext:"program_format_interest"}:{}),scheduleNotes:optional(values.get("scheduleNotes")),permission});
   if(!fields.success){setError(school?t("Please complete the school, staff contact, city, country-coded business contact, age band, estimated size, weekday, transport answer and contact permission.","יש למלא שם מוסד, איש קשר ותפקיד, עיר, פרטי קשר מקצועיים עם קידומת מדינה, טווח גיל, מספר משוער, יום מועדף, תשובת הסעה והסכמה ליצירת קשר."):t("Please complete the required contact, location, program, schedule and permission fields.","יש למלא את פרטי הקשר, המיקום, המסלול והעדפות הזמנים הנדרשים ולאשר את ההסכמה."));return;}
   if(values.get("website")!==""){setError(t("Your inquiry could not be verified. Reload the page and try again.","לא ניתן לאמת את הפנייה. רעננו את הדף ונסו שוב."));return;}
   if(mode==="sample"){setPreviewed(true);onPreviewed?.();return;}
   pending.current={command:{operationId:crypto.randomUUID(),fields:fields.data},website:""};setUncertainReference(pending.current.command.operationId);
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
    pending.current=null;setUncertain(false);setUncertainReference("");setError(response.status===429?t("Too many attempts were received. Please wait and try again later.","התקבלו ניסיונות רבים מדי. המתינו ונסו שוב מאוחר יותר."):response.status===403?t("This form expired or could not be verified. Reload the page and try again.","לא ניתן לאמת את הטופס או שפג תוקפו. רעננו את הדף ונסו שוב."):t("Your inquiry was not saved. Review the fields and try again.","הפנייה לא נשמרה. בדקו את השדות ונסו שוב."));return;
   }
   const body=await response.json();if(!response.ok||body?.ok!==true||body.data?.saved!==true||typeof body.data?.item?.id!=="string")throw new Error();
   pending.current=null;setUncertain(false);setUncertainReference("");form.current?.reset();setSavedReference(body.data.item.id);setSaved(true);onSaved?.(body.data.item.id);
  }catch{
   const kind=classifyPublicApplicationFailure(requestStarted,undefined,previouslyUncertain);
   if(kind==="unavailable"){pending.current=null;setUncertain(false);setUncertainReference("");setError(t("Online inquiries are unavailable. No information was saved.","לא ניתן לשלוח פניות כעת. לא נשמר מידע."));}
   else{setUncertain(true);setError(t("We could not confirm whether your inquiry was saved. Keep this page open and check the same save before sending another copy.","לא הצלחנו לאשר אם הפנייה נשמרה. השאירו את הדף פתוח ובדקו את אותה שמירה לפני שליחת עותק נוסף."));}
  }finally{setBusy(false);}
 }

 const programName=journeyProgramName(programId,locale);
 return <form ref={form} data-inquiry-kind={inquiryKind} className={styles.form} onSubmit={submit} noValidate>
  <div className={styles.heading}><p className={styles.kicker}>{t("Private inquiry","פנייה פרטית")}</p><h3>{school?t("Ask about a school fishing activity","בירור על פעילות דיג לבית ספר"):t("Ask about a program","מתעניינים בתוכנית?")}</h3><p>{school?t("Tell us about the activity your school or institution would like to discuss. This is a request for a conversation, not an accepted quotation, enrollment or booking.","ספרו על הפעילות שבית הספר או המוסד שלכם מעוניין לברר. זו בקשה לשיחה, לא אישור להצעת מחיר, הרשמה או הזמנה."):t("Tell us which program interests you and when you can speak. We will contact you about the next step. Sending this form does not reserve a place or require payment.","בחרו את התוכנית שמעניינת אתכם וציינו מתי נוח לדבר. ניצור קשר לגבי השלב הבא. שליחת הטופס אינה שומרת מקום ואינה מחייבת בתשלום.")}</p></div>
  {error&&<div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}><strong>{t("Please check this inquiry","בדקו את הפנייה")}</strong><p>{error}</p></div>}
  {saved&&<div role="status" className={styles.success}><strong>{school?t("School inquiry received","פניית בית הספר התקבלה"):t("Inquiry received","הפנייה התקבלה")}</strong><p>{school?t("The next step is a separate discussion with the school's decisionmaker about the activity and a possible quotation. No activity is booked.","השלב הבא הוא שיחה נפרדת עם הגורם המחליט בבית הספר על הפעילות ועל הצעת מחיר אפשרית. לא הוזמנה פעילות."):t("Your place is not booked. We will contact you about a fit conversation and actual availability.","המקום עדיין אינו מוזמן. ניצור קשר לשיחת התאמה ולבירור האפשרויות בפועל.")} <strong>{t("Reference","מספר הפנייה")}:</strong> <bdi dir="ltr">{savedReference}</bdi></p></div>}
  {mode==="sample"&&<p className={styles.boundary}>{t("SYNTHETIC SAMPLE — enter invented details only. Nothing is sent or saved.","דוגמה סינתטית — הזינו פרטים מומצאים בלבד. דבר אינו נשלח או נשמר.")}</p>}
  {previewed&&<p role="status">{t("Sample fields checked locally. No inquiry or saved reference was created.","שדות הדוגמה נבדקו מקומית. לא נוצרו פנייה או מספר שמירה.")}</p>}
  <fieldset className={styles.fieldset} disabled={busy||uncertain}>
   <legend className={styles.srOnly}>{t("Group inquiry details","פרטי הפנייה לקבוצה")}</legend>
   {school?<div className={styles.fields}>
    <label>{t("School or institution name","שם בית הספר או המוסד")}<input name="schoolName" required maxLength={120} autoComplete="organization"/></label>
    <label>{t("Contact person's name","שם איש/אשת הקשר")}<input name="contactName" required maxLength={100} autoComplete="name"/></label>
    <label>{t("Staff role","תפקיד במוסד")}<input name="staffRole" required maxLength={80} autoComplete="organization-title"/></label>
    <label>{t("School/institution city","עיר בית הספר/המוסד")}<input name="cityArea" required maxLength={100} autoComplete="address-level2"/></label>
    <label>{t("Business email or telephone with country code","דוא״ל מקצועי או טלפון עם קידומת מדינה")}<input name="contact" required maxLength={254} dir="ltr"/></label>
    <label>{t("Approximate student age band","טווח גילי התלמידים המשוער")}<select name="ageBand" required defaultValue=""><option value="">{t("Choose an age band","בחרו טווח גיל")} </option>{Object.entries(schoolAgeLabels).map(([value,label])=><option key={value} value={value}>{label[locale==="he"?1:0]}</option>)}</select></label>
    <label>{t("Approximate group size — estimate, not offered capacity","מספר משתתפים משוער — הערכה, לא קיבולת מוצעת")}<input name="groupSize" required type="number" min={1} max={1000} step={1}/></label>
    <label>{t("Preferred weekday — not confirmed availability","יום מועדף — לא זמינות מאושרת")}<select name="preferredWeekday" required defaultValue=""><option value="">{t("Choose a preference","בחרו העדפה")}</option>{Object.entries(schoolWeekdayLabels).map(([value,label])=><option key={value} value={value}>{label[locale==="he"?1:0]}</option>)}</select></label>
    <label>{t("Would the school arrange transport?","האם בית הספר יסדיר הסעה?")}<select name="schoolTransport" required defaultValue=""><option value="">{t("Choose an answer","בחרו תשובה")}</option>{Object.entries(schoolTransportLabels).map(([value,label])=><option key={value} value={value}>{label[locale==="he"?1:0]}</option>)}</select><span>{t("This answer does not confirm provider transport.","התשובה אינה מאשרת הסעה מטעם המפעיל.")}</span></label>
   </div>:<><div className={styles.fields}>
    <label>{t("Parent or guardian name","שם ההורה או האפוטרופוס")}<input name="parentName" required maxLength={100} autoComplete="name"/></label>
    <label>{t("Email address or telephone number","כתובת דוא״ל או מספר טלפון")}<input name="contact" required maxLength={254} dir="ltr" inputMode="text" aria-describedby="contact-hint"/><span id="contact-hint" className={styles.fieldNote}>{t("Provide one contact. Include the country code for a telephone or WhatsApp number; no country code is assumed.","ציינו אמצעי קשר אחד. במספר טלפון או WhatsApp יש לכלול קידומת מדינה; לא נניח קידומת.")}</span></label>
    <label>{t("Boy’s age (optional)","גיל הבן (לא חובה)")}<input name="childAge" maxLength={20} inputMode="text"/></label>
    <label>{t("City or area in Florida","עיר או אזור בפלורידה")}<input name="cityArea" required maxLength={100} autoComplete="address-level2"/></label>
    <label>{t("Neighborhood (optional)","שכונה (לא חובה)")}<input name="neighborhood" maxLength={100} autoComplete="address-level3"/></label>
    <div className={styles.emptyGroup}><strong>{t("Program","מסלול")}</strong><p>{programName}</p></div>
   </div>
    <fieldset className={styles.schedule}><legend>{programId==="sunday_fishing_academy"?t("Preferred academy format — interest only","מתכונת אקדמיה מועדפת — הבעת עניין בלבד"):t("When could a fit call work?","מתי יכולה להתאים שיחת התאמה?")}</legend><p className={styles.fieldNote}>{programId==="sunday_fishing_academy"?t("These are format preferences for the same academy, not confirmed teaching times, enrollment or a booking. Put fit-call availability and time zone in the note below. Schools need a separate institutional inquiry; this guardian form is not that path.","אלה העדפות מתכונת לאותה אקדמיה, ולא מועדי הוראה מאושרים, הרשמה או הזמנה. ציינו זמינות לשיחת התאמה ואזור זמן בהערה למטה. בתי ספר דורשים פנייה מוסדית נפרדת; טופס הורה זה אינו המסלול לכך."):t("Choose at least one time when we may contact you for a fit conversation. These are not lesson or meeting times, and they do not create a seat or booking.","בחרו לפחות זמן אחד שבו נוכל ליצור קשר לשיחת התאמה. אלה אינם מועדי שיעורים או מפגשים, והם אינם יוצרים מקום או הזמנה.")}</p><div className={styles.checkGrid}>
     <label><input name="schedulePreference" type="checkbox" value="weekday_after_school"/><span>{programId==="sunday_fishing_academy"?t("Weekday after-school interest","עניין בימי חול אחרי הלימודים"):t("Weekday after school fit call","שיחת התאמה ביום חול אחרי הלימודים")}</span></label>
     <label><input name="schedulePreference" type="checkbox" value="sunday"/><span>{programId==="sunday_fishing_academy"?t("Sunday interest","עניין ביום ראשון"):t("Sunday fit call","שיחת התאמה ביום ראשון")}</span></label>
     {programId==="sunday_fishing_academy"&&<label><input name="schedulePreference" type="checkbox" value="weekday_morning_homeschool"/><span>{t("Weekday homeschool morning interest","עניין בבוקר לימוד ביתי בימי חול")}</span></label>}
     <label><input name="schedulePreference" type="checkbox" value="flexible"/><span>{programId==="sunday_fishing_academy"?t("Flexible format","מתכונת גמישה"):t("Flexible fit-call time","זמן גמיש לשיחת התאמה")}</span></label>
     <label><input name="schedulePreference" type="checkbox" value="other"/><span>{programId==="sunday_fishing_academy"?t("Another format preference","העדפת מתכונת אחרת"):t("Another fit-call time","זמן אחר לשיחת התאמה")}</span></label>
   </div></fieldset>
    <label className={styles.full}>{t("Other fit-call times, time zone or a brief scheduling note (optional)","זמנים אחרים לשיחת התאמה, אזור זמן או הערת תיאום קצרה (לא חובה)")}<textarea name="scheduleNotes" maxLength={300} rows={3}/></label>
   <div className={styles.emptyGroup}><strong>{t("Published group preference","קבוצה מועדפת מתוך הקבוצות שפורסמו")}</strong><p>{t("No confirmed group times or meeting points are currently listed.","כרגע אין ברשימה מועדי קבוצות או נקודות מפגש מאושרים.")}</p></div></>}
    <label className={styles.permission}><input ref={permissionRef} name="permission" type="checkbox" required/><span>{notice[locale]}</span></label>
   {school&&<p>{t("Do not submit child names, rosters, diagnoses, clinical or family histories, emergency/medical details, photographs, recordings or media permissions.","אין למסור שמות ילדים, רשימות תלמידים, אבחנות, היסטוריה קלינית או משפחתית, פרטי חירום/רפואה, תמונות, הקלטות או רשות לפרסום.")}</p>}
   <p className={styles.privacy}>{t("Do not include medical histories, diagnoses, reports, payment details or child photographs.","אין לצרף היסטוריה רפואית, אבחנות, דוחות, פרטי תשלום או תמונות ילדים.")}</p>
   <label className={styles.honeypot} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
  </fieldset>
  {uncertain&&<p className={styles.locked}>{t("We have not confirmed receipt of this inquiry. Keep this page open and use the same reference when checking it; do not pay based on this screen.","עדיין לא אושרה קבלת הפנייה. השאירו את הדף פתוח והשתמשו באותו מספר פנייה בעת הבדיקה; אין לשלם על סמך מסך זה.")} <strong>{t("Reference","מספר הפנייה")}:</strong> <bdi dir="ltr">{uncertainReference}</bdi></p>}
  <button type="submit" disabled={busy||(mode==="sample"?!sampleReady:!challenge)}>{mode==="sample"?t("Preview inquiry — not sent","בדיקת פנייה לדוגמה — ללא שליחה"):busy?t("Saving your inquiry…","שומרים את הפנייה…"):uncertain?t("Check save status","בדיקת מצב השמירה"):school?t("Send school inquiry","שליחת פנייה מטעם בית ספר"):t("Send my inquiry","שליחת הפנייה")}</button>
  <p className={styles.boundary}>{school?t("Business inquiry only — no guardian assertion, child account, case, rank credit, enrollment, booking or payment request.","פנייה מקצועית בלבד — ללא הצהרת הורה, חשבון ילד, תיק, יחידה מדרגה, הרשמה, הזמנה או בקשת תשלום."):t("This inquiry is only a request to talk. It does not enroll your child, reserve a place or require payment.","זו בקשה לשיחה בלבד. היא אינה רושמת את ילדכם, שומרת מקום או מחייבת בתשלום.")}</p>
 </form>;
}

export function SchoolInquirySection({locale,mode="native"}:{locale:Locale;mode?:"native"|"sample"}){
 return <details><summary>{locale==="he"?"פניית בית ספר או מוסד — מסלול נפרד":"School or institution inquiry — separate path"}</summary><GroupApplicationForm locale={locale} programId="sunday_fishing_academy" inquiryKind="institution" mode={mode}/></details>;
}
