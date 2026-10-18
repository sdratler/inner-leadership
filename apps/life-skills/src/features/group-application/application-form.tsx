"use client";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {floridaGroupApplicationFieldsSchema,floridaGroupApplicationNotice,floridaSchoolInquiryNotice,type FloridaGroupApplicationCommand,type FloridaProgramId} from "./contract.ts";
import {schoolAgeLabels,schoolWeekdayLabels,schoolTransportLabels} from "./school-inquiry-details.tsx";
import {journeyProgramName} from "./journey-preview-model.ts";
import {AcademyFitFields,academyFitFromForm} from "./fit-fields.tsx";
import {academyIntakeFromForm,academyDriveMinutes,type AcademyIntake} from "./academy-intake.ts";
import {AcademyIntakeFields,AcademyIntakeLearnerFields} from "./academy-intake-fields.tsx";
import styles from "./application-form.module.css";
import copy from "./presentation-copy.json";

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

export function GroupApplicationForm({locale,programId,onSaved,mode="native",onPreviewed,inquiryKind="parent",fullIntake=false}:{locale:Locale;programId:FloridaProgramId;onSaved?:(reference:string)=>void;mode?:"native"|"sample";onPreviewed?:()=>void;inquiryKind?:"parent"|"institution";fullIntake?:boolean}){
 const school=inquiryKind==="institution",notice=school?floridaSchoolInquiryNotice:floridaGroupApplicationNotice;
 const viewCopy=programId==="sunday_fishing_academy"&&!school?{...copy,inquiry:{...copy.inquiry,...copy.realMensch.inquiry}}:copy;
 const [learnerCount,setLearnerCount]=useState(1);
 if(school&&programId!=="sunday_fishing_academy")throw new Error("SCHOOL_INQUIRY_ACADEMY_ONLY");
 if(fullIntake&&(school||programId!=="sunday_fishing_academy"))throw new Error("ACADEMY_FULL_INTAKE_ONLY");
 const t=(en:string,he:string)=>locale==="he"?he:en,form=useRef<HTMLFormElement>(null),pending=useRef<{command:FloridaGroupApplicationCommand;website:""}|null>(null),errorRef=useRef<HTMLDivElement>(null),successRef=useRef<HTMLDivElement>(null),permissionRef=useRef<HTMLInputElement>(null);
 const [challenge,setChallenge]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[uncertainReference,setUncertainReference]=useState(""),[error,setError]=useState(""),[saved,setSaved]=useState(false),[savedReference,setSavedReference]=useState("");
 const [previewed,setPreviewed]=useState(false);
 const [savedStep,setSavedStep]=useState<AcademyIntake["nextStep"]|null>(null),[savedAcknowledgment,setSavedAcknowledgment]=useState<"queued"|"not_requested"|null>(null);
 const sampleReady=useSyncExternalStore(subscribeHydration,clientReady,serverReady);
 const endpoint=`/api/public/group-applications?program=${encodeURIComponent(programId)}`;
 useEffect(()=>{if(mode==="sample")return;let active=true,timer:ReturnType<typeof setTimeout>|undefined;fetch(endpoint,{cache:"no-store",credentials:"same-origin"}).then(async response=>{const body=await response.json();if(!response.ok||body?.ok!==true||typeof body.data?.challenge!=="string")throw new Error();return body.data as Challenge;}).then(data=>{if(active)timer=setTimeout(()=>{if(active)setChallenge(data.challenge);},1600);}).catch(()=>{if(active)setError(locale==="he"?"שליחת פניות מקוונות עדיין אינה זמינה. לא נשלחו פרטים.":"Online inquiries are not available yet. No details have been sent.");});return()=>{active=false;if(timer)clearTimeout(timer);};},[endpoint,locale,mode]);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 useEffect(()=>{if(saved)successRef.current?.focus();},[saved]);
 useEffect(()=>{if(!pending.current&&permissionRef.current)permissionRef.current.checked=false;},[locale]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||(mode==="native"&&!challenge))return;setSaved(false);setSavedReference("");setError("");const previouslyUncertain=uncertain;
  if(!pending.current){
   const values=new FormData(event.currentTarget),schedulePreference=values.getAll("schedulePreference").filter((value):value is string=>typeof value==="string");
   const permission={confirmed:values.get("permission")==="on",version:notice.version,language:locale};
   const intake=fullIntake?academyIntakeFromForm(values):undefined,rawFit=programId==="sunday_fishing_academy"?academyFitFromForm(values):undefined;
   const fit=fullIntake&&intake&&rawFit?{...rawFit,maximumDriveMinutes:academyDriveMinutes(intake.driveLimit)}:rawFit;
   const fields=floridaGroupApplicationFieldsSchema.safeParse(school?{inquiryKind:"institution",programId,language:locale,schoolName:values.get("schoolName"),contactName:values.get("contactName"),staffRole:values.get("staffRole"),cityArea:values.get("cityArea"),contact:values.get("contact"),ageBand:values.get("ageBand"),groupSize:Number(values.get("groupSize")),preferredWeekday:values.get("preferredWeekday"),schoolTransport:values.get("schoolTransport"),permission}:{parentName:values.get("parentName"),contact:values.get("contact"),language:locale,childAge:optional(values.get("childAge")),cityArea:values.get("cityArea"),neighborhood:optional(values.get("neighborhood")),programId,schedulePreference,...(programId==="sunday_fishing_academy"?{scheduleContext:"program_format_interest",academyFit:fit}:{}),...(fullIntake?{academyIntake:intake}:{}),scheduleNotes:optional(values.get("scheduleNotes")),permission});
   if(!fields.success){setError(school?t("Please complete the school, staff contact, city, country-coded business contact, age band, estimated size, weekday, transport answer and contact permission.","יש למלא שם מוסד, איש קשר ותפקיד, עיר, פרטי קשר מקצועיים עם קידומת מדינה, טווח גיל, מספר משוער, יום מועדף, תשובת הסעה והסכמה ליצירת קשר."):fullIntake?t("Please complete contact, area/ZIP, every learner's details, schedule, driving limit, group/transport preferences, next-step choice and permission. An optional confirmation email must be valid.","יש למלא פרטי קשר, אזור ומיקוד, פרטים לכל לומד, העדפות זמנים, מגבלת נסיעה, העדפות קבוצה והסעות, בחירת המשך והסכמה. דוא״ל לאישור הפנייה, אם נמסר, חייב להיות תקין."):t("Please complete the required contact, location, program, schedule and permission fields.","יש למלא את פרטי הקשר, המיקום, המסלול והעדפות הזמנים הנדרשים ולאשר את ההסכמה."));return;}
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
   if(fullIntake){const recorded=floridaGroupApplicationFieldsSchema.safeParse(body.data.item.fields);if(!recorded.success||!("academyIntake"in recorded.data)||!recorded.data.academyIntake||JSON.stringify(recorded.data)!==JSON.stringify(pending.current.command.fields))throw new Error();setSavedStep(recorded.data.academyIntake.nextStep);setSavedAcknowledgment(body.data.acknowledgment==="queued"?"queued":body.data.acknowledgment==="not_requested"?"not_requested":null);}
   pending.current=null;setUncertain(false);setUncertainReference("");if(!fullIntake){form.current?.reset();setLearnerCount(1);}setSavedReference(body.data.item.id);setSaved(true);onSaved?.(body.data.item.id);
  }catch{
   const kind=classifyPublicApplicationFailure(requestStarted,undefined,previouslyUncertain);
   if(kind==="unavailable"){pending.current=null;setUncertain(false);setUncertainReference("");setError(t("Online inquiries are unavailable. No information was saved.","לא ניתן לשלוח פניות כעת. לא נשמר מידע."));}
   else{setUncertain(true);setError(t("We could not confirm whether your inquiry was saved. Keep this page open and check the same save before sending another copy.","לא הצלחנו לאשר אם הפנייה נשמרה. השאירו את הדף פתוח ובדקו את אותה שמירה לפני שליחת עותק נוסף."));}
  }finally{setBusy(false);}
 }

 const programName=journeyProgramName(programId,locale),p=(value:{en:string;he:string})=>value[locale];
 return <form ref={form} data-inquiry-kind={inquiryKind} className={styles.form} onSubmit={submit} noValidate>
  <div className={styles.heading}><p className={styles.kicker}>{t("Private inquiry","פנייה פרטית")}</p><h3>{fullIntake?t("Academy application and group preferences","פנייה לאקדמיה והעדפות קבוצה"):school?t("Ask about a school fishing activity","בירור על פעילות דיג לבית ספר"):programId==="sunday_fishing_academy"?p(viewCopy.inquiry.titleAcademy):programId==="private_fishing_life_skills"?p(viewCopy.inquiry.titleVip):t("Ask about Torah mornings","לפרטים על לימוד תורה בבוקר")}</h3><p>{fullIntake?t("Complete these preferences before an enrollment or callback request. No child names, health details or payment information are needed. This form does not reserve a place.","השלימו את ההעדפות לפני בקשת המשך לקראת הרשמה או שיחה חוזרת. אין צורך בשמות ילדים, בפרטים רפואיים או במידע לתשלום. הטופס אינו שומר מקום."):school?t("Tell us about the activity your school or institution would like to discuss. This is a request for a conversation, not an accepted quotation, enrollment or booking.","ספרו על הפעילות שבית הספר או המוסד שלכם מעוניין לברר. זו בקשה לשיחה, לא אישור להצעת מחיר, הרשמה או הזמנה."):p(viewCopy.inquiry.intro)}</p></div>
  {error&&<div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}><strong>{t("Please check this inquiry","בדקו את הפנייה")}</strong><p>{error}</p></div>}
  {saved&&<div ref={successRef} tabIndex={-1} role="status" className={styles.success} data-academy-saved={fullIntake?savedReference:undefined}><strong>{fullIntake?t("Inquiry saved","הפנייה נשמרה"):school?t("School inquiry received","פניית בית הספר התקבלה"):p(viewCopy.inquiry.savedTitle)}</strong><p>{fullIntake?(savedStep==="callback"?t("Your callback request is recorded. No payment, booking or founding-family reservation was made.","הבקשה לשיחה חוזרת נרשמה. לא בוצעו תשלום, הזמנה או שמירת מקום למשפחה מייסדת."):t("Your request to continue toward enrollment is recorded. We will confirm an eligible group, schedule, locations, capacity, terms and payment offer before a payment step. No place is reserved.","הבקשה להמשיך לקראת הרשמה נרשמה. לפני שלב תשלום יאושרו קבוצה מתאימה, זמנים, מיקומים, מקום פנוי, תנאים והצעת תשלום. לא נשמר מקום.")):school?t("The next step is a separate discussion with the school's decisionmaker about the activity and a possible quotation. No activity is booked.","השלב הבא הוא שיחה נפרדת עם הגורם המחליט בבית הספר על הפעילות ועל הצעת מחיר אפשרית. לא הוזמנה פעילות."):p(viewCopy.inquiry.savedBody)} <strong>{t("Reference","מספר הפנייה")}:</strong> <bdi dir="ltr">{savedReference}</bdi></p>{fullIntake&&<p>{savedAcknowledgment==="queued"?t("An inquiry acknowledgment is queued. Sending and delivery are not confirmed.","הודעת אישור הפנייה נרשמה בתור. השליחה והמסירה לא אושרו."):savedAcknowledgment==="not_requested"?t("No email acknowledgment was requested. Your phone inquiry is valid.","לא התבקשה הודעת אישור בדוא״ל. הפנייה הטלפונית תקפה."):t("Your inquiry is saved. Email delivery is not confirmed here.","הפנייה נשמרה. מסירת דוא״ל אינה מאושרת במסך זה.")}</p>}</div>}
  {mode==="sample"&&<p className={styles.boundary}>{p(viewCopy.inquiry.sampleBanner)}</p>}
  {previewed&&<p role="status">{p(viewCopy.inquiry.sampleResult)}</p>}
  <fieldset className={styles.fieldset} disabled={busy||uncertain||(fullIntake&&saved)}>
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
    <label>{p(viewCopy.inquiry.parentName)}<input name="parentName" required maxLength={100} autoComplete="name"/></label>
    <label>{p(viewCopy.inquiry.contact)}<input name="contact" required maxLength={254} dir="ltr" inputMode="text" aria-describedby="contact-hint"/><span id="contact-hint" className={styles.fieldNote}>{p(viewCopy.inquiry.contactHint)}</span></label>
    {programId!=="sunday_fishing_academy"&&<label>{p(viewCopy.inquiry.childAge)}<input name="childAge" maxLength={20} inputMode="text"/></label>}
    <label>{p(viewCopy.inquiry.cityArea)}<input name="cityArea" required maxLength={100} autoComplete="address-level2"/></label>
    <label>{p(viewCopy.inquiry.neighborhood)}<input name="neighborhood" maxLength={100} autoComplete="address-level3"/></label>
    <div className={styles.emptyGroup}><strong>{t("Program","מסלול")}</strong><p>{programName}</p></div>
   </div>
    {programId==="sunday_fishing_academy"&&<AcademyFitFields locale={locale} count={learnerCount} onCount={setLearnerCount} hideLegacyDrive={fullIntake} learnerDetails={fullIntake?Array.from({length:learnerCount},(_,index)=><AcademyIntakeLearnerFields locale={locale} index={index} key={index}/>):undefined}/>}
    <fieldset className={styles.schedule}><legend>{programId==="sunday_fishing_academy"?p(viewCopy.inquiry.formatLegend):p(viewCopy.inquiry.vipCallLegend)}</legend><p className={styles.fieldNote}>{programId==="sunday_fishing_academy"?p(viewCopy.inquiry.formatHint):p(viewCopy.inquiry.vipCallHint)}</p><div className={styles.checkGrid}>
     <label><input name="schedulePreference" type="checkbox" value="weekday_after_school"/><span>{programId==="sunday_fishing_academy"?p(viewCopy.inquiry.formatOptions.weekday_after_school):t("Weekday after school fit call","שיחת התאמה ביום חול אחרי הלימודים")}</span></label>
     {programId==="sunday_fishing_academy"&&<label><input name="schedulePreference" type="checkbox" value="weekday_before_school"/><span>{t("Weekday before school","ביום חול לפני הלימודים")}</span></label>}
     <label><input name="schedulePreference" type="checkbox" value="sunday"/><span>{programId==="sunday_fishing_academy"?p(viewCopy.inquiry.formatOptions.sunday):t("Sunday fit call","שיחת התאמה ביום ראשון")}</span></label>
     {programId==="sunday_fishing_academy"&&<label><input name="schedulePreference" type="checkbox" value="weekday_morning_homeschool"/><span>{p(viewCopy.inquiry.formatOptions.weekday_morning_homeschool)}</span></label>}
     <label><input name="schedulePreference" type="checkbox" value="flexible"/><span>{programId==="sunday_fishing_academy"?p(viewCopy.inquiry.formatOptions.flexible):t("Flexible fit-call time","זמן גמיש לשיחת התאמה")}</span></label>
     <label><input name="schedulePreference" type="checkbox" value="other"/><span>{programId==="sunday_fishing_academy"?p(viewCopy.inquiry.formatOptions.other):t("Another fit-call time","זמן אחר לשיחת התאמה")}</span></label>
   </div></fieldset>
    <label className={styles.full}>{p(viewCopy.inquiry.scheduleNotes)}<textarea name="scheduleNotes" maxLength={300} rows={3}/></label>
    {fullIntake&&<AcademyIntakeFields locale={locale}/>}
</>}
    <label className={styles.permission}><input ref={permissionRef} name="permission" type="checkbox" required/><span>{notice[locale]}</span></label>
   {school&&<p>{t("Do not submit child names, rosters, diagnoses, clinical or family histories, emergency/medical details, photographs, recordings or media permissions.","אין למסור שמות ילדים, רשימות תלמידים, אבחנות, היסטוריה קלינית או משפחתית, פרטי חירום/רפואה, תמונות, הקלטות או רשות לפרסום.")}</p>}
   {!school&&<p className={styles.privacy}>{p(viewCopy.inquiry.privacyHint)}</p>}
   <label className={styles.honeypot} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
  </fieldset>
  {uncertain&&<p className={styles.locked}>{t("We have not confirmed receipt of this inquiry. Keep this page open and use the same reference when checking it; do not pay based on this screen.","עדיין לא אושרה קבלת הפנייה. השאירו את הדף פתוח והשתמשו באותו מספר פנייה בעת הבדיקה; אין לשלם על סמך מסך זה.")} <strong>{t("Reference","מספר הפנייה")}:</strong> <bdi dir="ltr">{uncertainReference}</bdi></p>}
  <button type="submit" disabled={busy||(fullIntake&&saved)||(mode==="sample"?!sampleReady:!challenge)}>{mode==="sample"?p(viewCopy.inquiry.sampleSubmit):busy?p(viewCopy.inquiry.saving):uncertain?p(viewCopy.inquiry.retrySameSave):fullIntake?(saved?t("Inquiry saved","הפנייה נשמרה"):t("Save my completed inquiry","שמירת הפנייה המלאה שלי")):school?t("Send school inquiry","שליחת פנייה מטעם בית ספר"):p(viewCopy.inquiry.submit)}</button>
  <p className={styles.boundary}>{school?t("Business inquiry only — no guardian assertion, child account, case, rank credit, enrollment, booking or payment request.","פנייה מקצועית בלבד — ללא הצהרת הורה, חשבון ילד, תיק, יחידה מדרגה, הרשמה, הזמנה או בקשת תשלום."):p(viewCopy.inquiry.boundary)}</p>
 </form>;
}

export function SchoolInquirySection({locale,mode="native"}:{locale:Locale;mode?:"native"|"sample"}){
 return <details className={styles.schoolSection}><summary>{locale==="he"?"פניית בית ספר או מוסד — מסלול נפרד":"School or institution inquiry — separate path"}</summary><GroupApplicationForm locale={locale} programId="sunday_fishing_academy" inquiryKind="institution" mode={mode}/></details>;
}
