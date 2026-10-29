"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {isFloridaGroupApplication,isSchoolInquiry,type GroupApplicationRecord} from "./contract.ts";
import {SchoolInquiryDetails} from "./school-inquiry-details.tsx";
import {FitCallDraft} from "./fit-call-draft.tsx";
import {AcademyFitReadback} from "./fit-fields.tsx";
import {AcademyIntakeReadback,academyDriveLabel} from "./academy-intake-readback.tsx";
import {AcademyRegistrationReadback} from './academy-registration-readback.tsx';
import {FishingLeadControls} from "../contact-ops/fishing-lead-controls.tsx";
import {FishingFollowupPanel} from "./fishing-followup-panel.tsx";
import {loginHref} from "../identity/login-return.ts";
import {InquiryEmailSetupSummary} from "./inquiry-email-setup-summary.tsx";
import type {InquiryEmailSetupReport} from "./inquiry-email-setup.ts";
import {AcademyInquiryFilters} from './academy-inquiry-filters.tsx';
import {emptyAcademyInquiryFilters,matchesAcademyInquiryFilters,type AcademyInquiryFiltersValue} from './academy-inquiry-filters.ts';
import {AcademyFounderControls} from './academy-founder-controls.tsx';
import styles from "../group-interest/workspace.module.css";

type ReviewData={items:GroupApplicationRecord[];nextCursor?:string|null;emailSetup?:InquiryEmailSetupReport|null};
type ReviewResponse={ok:true;data:ReviewData};
class ReviewReadError extends Error{constructor(readonly status:number){super("INQUIRY_REVIEW_FAILED");}}
async function requestGroupApplications(search:string,cursor:string|null){const query=new URLSearchParams();if(search)query.set("search",search);if(cursor)query.set("cursor",cursor);const response=await fetch("/api/private/group-applications"+(query.size?"?"+query.toString():""),{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});if(!response.ok)throw new ReviewReadError(response.status);const body=await response.json() as ReviewResponse;if(body.ok!==true)throw new ReviewReadError(503);return body.data;}

export function GroupApplicationReviewWorkspace({locale,initialSearch=""}:{locale:Locale;initialSearch?:string}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [data,setData]=useState<ReviewData|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[accessFailure,setAccessFailure]=useState<number|null>(null);
 const [academyFilters,setAcademyFilters]=useState<AcademyInquiryFiltersValue>(emptyAcademyInquiryFilters);
 const [search,setSearch]=useState(initialSearch),[appliedSearch,setAppliedSearch]=useState(initialSearch);
 const readVersion=useRef<symbol|null>(null),attemptedSearch=useRef("");
 const items=data?.items??null;
 const visibleAcademyCount=items?.filter(item=>matchesAcademyInquiryFilters(item,academyFilters)).length??0;
 const accessDenied=(status:number)=>{readVersion.current=null;attemptedSearch.current="";setSearch("");setAppliedSearch("");setData(null);setBusy(false);setError(false);setAccessFailure(status);};
 const load=useCallback(async(query="",cursor:string|null=null)=>{
  const version=Symbol();readVersion.current=version;attemptedSearch.current=query;setBusy(true);
  // Keep keyed inquiry drafts mounted during a read, but discard their setup
  // report immediately. A failed or obsolete read cannot restore that report.
  setData(current=>current?{...current,emailSetup:null}:null);
  try{const result=await requestGroupApplications(query,cursor);if(version!==readVersion.current)return;setData(current=>cursor&&current?{...result,items:[...new Map([...current.items,...result.items].map(item=>[item.id,item])).values()]}:result);setAppliedSearch(query);setError(false);setAccessFailure(null);}
  catch(e){if(version!==readVersion.current)return;setData(null);const denied=e instanceof ReviewReadError&&(e.status===401||e.status===403);if(denied){attemptedSearch.current="";setSearch("");setAppliedSearch("");}setError(!denied);setAccessFailure(denied?e.status:null);}
  finally{if(version===readVersion.current)setBusy(false);}
 },[]);
 useEffect(()=>{const timer=window.setTimeout(()=>{setSearch(initialSearch);void load(initialSearch);},0);return()=>{window.clearTimeout(timer);readVersion.current=null;};},[load,initialSearch]);
 const offer=(value:string)=>value==="sunday_fishing_academy"?t("Real Mensch · Jewish Leadership Fishing Academy","Real Mensch · האקדמיה היהודית לדיג ולמנהיגות"):value==="morning_torah_learning"?t("Morning Torah Learning","לימוד תורה בבוקר"):t("Private Fishing & Life Skills","דיג וכישורי חיים באופן פרטי");
 const schedule=(value:string)=>value==="weekday_before_school"?t("Weekday before school","בימי חול לפני הלימודים"):value==="weekday_morning_homeschool"?t("Weekday homeschool morning","בוקר לימוד ביתי בימי חול"):value==="weekday_after_school"?t("Weekday after school","בימי חול אחרי הלימודים"):value==="sunday"?t("Sunday","יום ראשון"):value==="other"?t("Another time","זמן אחר"):t("Flexible","גמישים");
 return <main className={`lsw-main ${styles.workspace}`} lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className={styles.recentHeader}><div><h1>{t("Fishing Academy inquiries","פניות לאקדמיה לדיג")}</h1><p className={styles.intro}>{t("Review Academy inquiries, registrations and follow-ups. Enrollment, bookings and payments remain separate.","סקירת פניות, בקשות הרשמה ומעקבים של האקדמיה. הצטרפות לתוכנית, הזמנות ותשלומים נשארים נפרדים.")}</p></div><button type="button" className={`lsw-button lsw-button--secondary ${styles.refresh}`} disabled={busy} onClick={()=>void load(appliedSearch)}>{busy?t("Refreshing…","מרענן…"):t("Refresh","רענון")}</button></header>
  <form className="lsw-actions" role="search" onSubmit={event=>{event.preventDefault();void load(search.trim());}}><label className="lsw-field">{t("Search saved inquiries","חיפוש בפניות שמורות")}<input className="lsw-input" type="search" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/></label><button className="lsw-button lsw-button--secondary" type="submit" disabled={busy}>{t("Search","חיפוש")}</button></form>
  {error&&<section className="lsw-card" role="alert"><h2>{t("Inquiries could not be loaded","לא ניתן לטעון את הפניות")}</h2><p>{t("This is not an empty list. Check the connection and try again.","זו אינה רשימה ריקה. בדקו את החיבור ונסו שוב.")}</p><button type="button" className="lsw-button lsw-button--secondary" onClick={()=>void load(attemptedSearch.current)}>{t("Try again","ניסיון נוסף")}</button></section>}
  {accessFailure!==null&&<section className="lsw-card" role="alert"><p>{accessFailure===401?t("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):t("This account cannot review private inquiries.","לחשבון הזה אין הרשאה לבדיקת פניות פרטיות.")}</p>{accessFailure===401&&<a className="lsw-button lsw-button--secondary" href={loginHref(locale,`/${locale}/app/group-applications`)}>{t("Sign in","כניסה")}</a>}</section>}
  {!error&&accessFailure===null&&items===null&&<p role="status">{t("Loading inquiries…","טוען פניות…")}</p>}
  {data!==null&&!busy&&!error&&accessFailure===null&&<details className="lsw-card" data-inquiry-email-setup><summary>{t("Inquiry confirmation email setup","הגדרת הודעת אישור הפנייה")}</summary><InquiryEmailSetupSummary report={data.emailSetup??null} locale={locale}/></details>}
  {<AcademyFounderControls key={accessFailure??'owner'} locale={locale} denied={accessFailure!==null}/>}
  {items!==null&&accessFailure===null&&<AcademyInquiryFilters locale={locale} value={academyFilters} onChange={setAcademyFilters} loadedCount={items.length} visibleCount={visibleAcademyCount}/>}
  {items?.length===0&&<section className="lsw-card"><h2>{appliedSearch?t("No matching Academy inquiries loaded","לא נטענו פניות תואמות לאקדמיה"):t("No Academy inquiries loaded on this page","לא נטענו פניות לאקדמיה בעמוד הזה")}</h2><p>{data?.nextCursor?t("Continue to older inquiries using the button below.","אפשר להמשיך לפניות ישנות יותר באמצעות הכפתור למטה."):t("New Academy inquiries and registrations will appear here.","פניות ובקשות הרשמה חדשות לאקדמיה יופיעו כאן.")}</p></section>}
  {items?.map(item=>{const fields=item.fields;if(isSchoolInquiry(fields))return <article className={`lsw-card ${styles.record}`} key={item.id}><h2>{fields.schoolName}</h2><SchoolInquiryDetails fields={fields} locale={locale}/><p><bdi dir="ltr">{item.id}</bdi> · <time dateTime={item.receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"short",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(item.receivedAt))}</time></p><FishingFollowupPanel locale={locale} applicationId={item.id}/><FishingLeadControls locale={locale} source={{kind:"inquiry",id:item.id}} program={fields.programId} denied={accessDenied}/></article>;if(isFloridaGroupApplication(fields))return <article hidden={!matchesAcademyInquiryFilters(item,academyFilters)} data-academy-intake-ref={fields.academyIntake||fields.academyRegistration?item.id:undefined} className={`lsw-card ${styles.record}`} key={item.id}><h2>{fields.parentName}{fields.childAge?` · ${t("Age","גיל")} ${fields.childAge}`:""}</h2><p><bdi dir="ltr" className={styles.phone}>{fields.contact}</bdi> · {fields.cityArea}{fields.neighborhood?` · ${fields.neighborhood}`:""}</p><p><strong>{t("Program","מסלול")}:</strong> {offer(fields.programId)} · <strong>{fields.academyRegistration?t("Availability recorded below","העדפות זמינות מפורטות בהמשך"):fields.scheduleContext==="program_format_interest"?t("Preferred academy format","מתכונת אקדמיה מועדפת"):t("Possible fit-call times","זמנים אפשריים לשיחת התאמה")}:</strong> {fields.schedulePreference.map(schedule).join(", ")}</p><p>{t("Submitting this inquiry created no Person, case, enrollment, booking or charge. An administrative email acknowledgment is tracked separately; a queue entry is not delivery.","שליחת הפנייה לא יצרה אדם, תיק, הרשמה, הזמנה או חיוב. הודעת אישור מנהלית בדוא״ל מתועדת בנפרד; רישום בתור אינו אישור מסירה.")} · <time dateTime={item.receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"short",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(item.receivedAt))}</time> · <bdi dir="ltr">{item.id}</bdi></p>{fields.scheduleNotes&&<details className={styles.applicationDetails}><summary>{t("Scheduling note","הערה על זמנים")}</summary><p>{fields.scheduleNotes}</p></details>}{fields.academyFit&&<AcademyFitReadback exactAges={fields.academyIntake?.learners.every(learner=>learner.ageYears!==undefined)??false} fit={fields.academyFit} locale={locale} driveLabel={fields.academyIntake?academyDriveLabel(fields.academyIntake.driveLimit,locale):undefined}/>} {fields.academyIntake&&<><p>{t("Reference","מספר הפנייה")}: <bdi dir="ltr">{item.id}</bdi></p><AcademyIntakeReadback intake={fields.academyIntake} locale={locale}/></>}{fields.academyRegistration&&<AcademyRegistrationReadback registration={fields.academyRegistration} locale={locale}/>}<FitCallDraft item={{...item,fields}} locale={locale}/><FishingFollowupPanel locale={locale} applicationId={item.id}/>{fields.programId==="sunday_fishing_academy"&&<p><a className="lsw-button lsw-button--secondary" href={`/${locale}/app/clients?inquiryId=${encodeURIComponent(item.id)}`}>{t("Academy CRM (after setup)","רשימת האקדמיה (לאחר ההגדרה)")}</a></p>}{fields.programId!=="morning_torah_learning"&&<FishingLeadControls locale={locale} source={{kind:"inquiry",id:item.id}} program={fields.programId} denied={accessDenied}/>}</article>;
   return null;})}
  {data?.nextCursor&&!error&&accessFailure===null&&<button type="button" className="lsw-button lsw-button--secondary" disabled={busy} onClick={()=>void load(appliedSearch,data.nextCursor!)}>{busy?t("Loading…","טוען…"):appliedSearch?t("Continue searching older inquiries","המשך חיפוש בפניות ישנות יותר"):t("Load older inquiries","טעינת פניות ישנות יותר")}</button>}
 </main>;
}
