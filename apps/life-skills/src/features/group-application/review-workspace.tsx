"use client";
import {useCallback,useEffect,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {isFloridaGroupApplication,type GroupApplicationRecord} from "./contract.ts";
import {LegacyGroupApplicationDetails} from "./legacy-record-details.tsx";
import {FitCallDraft} from "./fit-call-draft.tsx";
import styles from "../group-interest/workspace.module.css";

type ReviewResponse={ok:true;data:{items:GroupApplicationRecord[]}};
async function requestGroupApplications(){const response=await fetch("/api/private/group-applications",{cache:"no-store"}),body=await response.json() as ReviewResponse;if(!response.ok||body.ok!==true)throw new Error();return body.data.items;}

export function GroupApplicationReviewWorkspace({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [items,setItems]=useState<GroupApplicationRecord[]|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{setBusy(true);try{setItems(await requestGroupApplications());setError(false);}catch{setItems(null);setError(true);}finally{setBusy(false);}},[]);
 useEffect(()=>{let active=true;requestGroupApplications().then(result=>{if(active){setItems(result);setError(false);}}).catch(()=>{if(active){setItems(null);setError(true);}});return()=>{active=false;};},[]);
 const offer=(value:string)=>value==="sunday_fishing_academy"?t("Florida Fishing & Keys Course","מסלול הדיג והקיז בפלורידה"):value==="morning_torah_learning"?t("Morning Torah Learning","לימוד תורה בבוקר"):t("Private Fishing & Life Skills","דיג וכישורי חיים באופן פרטי");
 const schedule=(value:string)=>value==="weekday_after_school"?t("Weekday after school","בימי חול אחרי הלימודים"):value==="sunday"?t("Sunday","יום ראשון"):value==="other"?t("Another time","זמן אחר"):t("Flexible","גמישים");
 return <main className={`lsw-main ${styles.workspace}`} lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className={styles.recentHeader}><div><h1>{t("Group inquiries","פניות לגבי קבוצות")}</h1><p className={styles.intro}>{t("Private owner review only. Inquiries remain separate from People, clinical records, enrollment, bookings and payments until you take a separate explicit action.","לבדיקה פרטית של הבעלים בלבד. הפניות נשארות נפרדות מאנשים, מרשומות טיפוליות, מהרשמה, מהזמנות ומתשלומים עד לפעולה מפורשת ונפרדת.")}</p></div><button type="button" className={`lsw-button lsw-button--secondary ${styles.refresh}`} disabled={busy} onClick={()=>void load()}>{busy?t("Refreshing…","מרענן…"):t("Refresh","רענון")}</button></header>
  {error&&<section className="lsw-card" role="alert"><h2>{t("Inquiries could not be loaded","לא ניתן לטעון את הפניות")}</h2><p>{t("This is not an empty list. Check the connection and try again.","זו אינה רשימה ריקה. בדקו את החיבור ונסו שוב.")}</p><button type="button" className="lsw-button lsw-button--secondary" onClick={()=>void load()}>{t("Try again","ניסיון נוסף")}</button></section>}
  {!error&&items===null&&<p role="status">{t("Loading inquiries…","טוען פניות…")}</p>}
  {items?.length===0&&<section className="lsw-card"><h2>{t("No inquiries yet","אין עדיין פניות")}</h2><p>{t("New confirmed public group inquiries will appear here.","פניות ציבוריות מאומתות חדשות לקבוצה יופיעו כאן.")}</p></section>}
  {items?.map(item=>{const fields=item.fields;if(isFloridaGroupApplication(fields))return <article className={`lsw-card ${styles.record}`} key={item.id}><h2>{fields.parentName}{fields.childAge?` · ${t("Age","גיל")} ${fields.childAge}`:""}</h2><p><bdi dir="ltr" className={styles.phone}>{fields.contact}</bdi> · {fields.cityArea}{fields.neighborhood?` · ${fields.neighborhood}`:""}</p><p><strong>{t("Program","מסלול")}:</strong> {offer(fields.programId)} · <strong>{t("Possible times","זמנים אפשריים")}:</strong> {fields.schedulePreference.map(schedule).join(", ")}</p><p>{t("Owner review pending — no Person, case, enrollment, booking, charge or message was created","ממתינה לבדיקת הבעלים — לא נוצרו אדם, תיק, הרשמה, הזמנה, חיוב או הודעה")} · <time dateTime={item.receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"short",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(item.receivedAt))}</time></p>{fields.scheduleNotes&&<details className={styles.applicationDetails}><summary>{t("Scheduling note","הערה על זמנים")}</summary><p>{fields.scheduleNotes}</p></details>}<FitCallDraft item={{...item,fields}} locale={locale}/></article>;
   return <article className={`lsw-card ${styles.record}`} key={item.id}><h2>{fields.parentName} · {t("Israel group application","בקשה לקבוצה בישראל")}</h2><p><bdi dir="ltr" className={styles.phone}>{fields.parentPhone}</bdi> · {fields.town}</p><LegacyGroupApplicationDetails fields={fields} locale={locale} className={styles.applicationDetails}/><p>{t("Reviewed under the existing Israel application terms; not converted into a Florida inquiry.","נבדקת לפי תנאי הבקשה הקיימים בישראל; אינה מומרת לפנייה בפלורידה.")} · <time dateTime={item.receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.receivedAt))}</time></p></article>;})}
 </main>;
}
