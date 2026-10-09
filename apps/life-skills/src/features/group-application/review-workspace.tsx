"use client";
import {useCallback,useEffect,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import type {GroupApplicationRecord} from "./contract.ts";
import styles from "../group-interest/workspace.module.css";

type ReviewResponse={ok:true;data:{items:GroupApplicationRecord[]}};
async function requestGroupApplications(){const response=await fetch("/api/private/group-applications",{cache:"no-store"}),body=await response.json() as ReviewResponse;if(!response.ok||body.ok!==true)throw new Error();return body.data.items;}

export function GroupApplicationReviewWorkspace({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [items,setItems]=useState<GroupApplicationRecord[]|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{setBusy(true);try{setItems(await requestGroupApplications());setError(false);}catch{setItems(null);setError(true);}finally{setBusy(false);}},[]);
 useEffect(()=>{let active=true;requestGroupApplications().then(result=>{if(active){setItems(result);setError(false);}}).catch(()=>{if(active){setItems(null);setError(true);}});return()=>{active=false;};},[]);
 const observationLabels={intrinsicMotivation:t("Intrinsic motivation","מוטיבציה פנימית"),expression:t("Expressing thoughts and needs","הבעת מחשבות וצרכים"),selfGovernance:t("Self-direction and decisions","הכוונה עצמית וקבלת החלטות"),valuesAndGoals:t("Values and goals","ערכים ומטרות"),cooperation:t("Cooperation","שיתוף פעולה"),socialConfidence:t("Appropriate disagreement and social confidence","חוסר הסכמה מתאים וביטחון חברתי"),stressfulSituations:t("Coping with stressful situations","התמודדות במצבים מלחיצים")};
 const observationValue=(value:string)=>value==="going_well"?t("Generally going well","בדרך כלל הולך טוב"):value==="sometimes_difficult"?t("Sometimes difficult","לפעמים קשה"):value==="would_like_support"?t("Would like support","נשמח לתמיכה"):t("Not shared","לא נמסר");
 const screenAccessValue=(value:string)=>value==="screens_at_home"?t("Yes","כן"):value==="no_screens_at_home"?t("No screens at home","אין מסכים בבית"):value==="no_regular_access"?t("No regular access","ללא גישה קבועה"):value==="shared_device"?t("Shared device","מכשיר משותף"):value==="own_device"?t("Own device","מכשיר אישי"):t("Not shared","לא נמסר");
 const screenTimeValue=(value:string)=>value==="none"?t("No screen time","ללא זמן מסך"):value==="under_2_hours_weekly"?t("Less than 2 hours a week","פחות משעתיים בשבוע"):value==="2_to_5_hours_weekly"?t("2–5 hours a week","2–5 שעות בשבוע"):value==="6_to_10_hours_weekly"?t("6–10 hours a week","6–10 שעות בשבוע"):value==="11_to_20_hours_weekly"?t("11–20 hours a week","11–20 שעות בשבוע"):value==="over_20_hours_weekly"?t("More than 20 hours a week","יותר מ־20 שעות בשבוע"):value==="no_fixed_limit"?t("No fixed limit","ללא מגבלה קבועה"):value==="not_sure"?t("Not sure","לא בטוחים"):value==="under_1_hour"?t("Under 1 hour daily (legacy)","פחות משעה ביום (ישן)"):value==="1_to_2_hours"?t("1–2 hours daily (legacy)","1–2 שעות ביום (ישן)"):value==="2_to_4_hours"?t("2–4 hours daily (legacy)","2–4 שעות ביום (ישן)"):value==="over_4_hours"?t("More than 4 hours daily (legacy)","יותר מ־4 שעות ביום (ישן)"):t("Not shared","לא נמסר");
 return <main className={`lsw-main ${styles.workspace}`} lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className={styles.recentHeader}><div><h1>{t("Group applications","בקשות הצטרפות לקבוצה")}</h1><p className={styles.intro}>{t("Private owner review only. Applications remain separate from People, clinical records and enrollment until you take a separate explicit action.","לבדיקה פרטית של הבעלים בלבד. הבקשות נשארות נפרדות מאנשים, מרשומות טיפוליות ומהרשמה עד לפעולה מפורשת ונפרדת.")}</p></div><button type="button" className={`lsw-button lsw-button--secondary ${styles.refresh}`} disabled={busy} onClick={()=>void load()}>{busy?t("Refreshing…","מרענן…"):t("Refresh","רענון")}</button></header>
  {error&&<section className="lsw-card" role="alert"><h2>{t("Applications could not be loaded","לא ניתן לטעון את הבקשות")}</h2><p>{t("This is not an empty list. Check the connection and try again.","זו אינה רשימה ריקה. בדקו את החיבור ונסו שוב.")}</p><button type="button" className="lsw-button lsw-button--secondary" onClick={()=>void load()}>{t("Try again","ניסיון נוסף")}</button></section>}
  {!error&&items===null&&<p role="status">{t("Loading applications…","טוען בקשות…")}</p>}
  {items?.length===0&&<section className="lsw-card"><h2>{t("No applications yet","אין עדיין בקשות")}</h2><p>{t("New confirmed public group applications will appear here.","בקשות ציבוריות מאומתות חדשות לקבוצה יופיעו כאן.")}</p></section>}
  {items?.map(item=>{const observations=Object.entries(item.fields.observations);const hasDetails=Boolean(item.fields.screenAccess||item.fields.screenTime||item.fields.parentPriorities||observations.length);return <article className={`lsw-card ${styles.record}`} key={item.id}>
   <h2>{item.fields.parentName} · {t("Age","גיל")} {item.fields.childAge}</h2>
   <p><bdi dir="ltr" className={styles.phone}>{item.fields.parentPhone}</bdi> · {item.fields.town}{item.fields.neighborhood?` · ${item.fields.neighborhood}`:""} · {item.fields.schedulePreference==="morning"?t("Morning","בוקר"):item.fields.schedulePreference==="evening"?t("Evening","ערב"):t("Flexible","גמיש")}</p>
   {item.fields.interestedInEveningGroup!==undefined&&<p>{item.fields.interestedInEveningGroup?t("Legacy application: interested in helping form an evening group","בקשה ישנה: מעוניינים לסייע בהקמת קבוצת ערב"):t("Legacy application: no evening-group preference recorded","בקשה ישנה: לא נרשמה העדפה לקבוצת ערב")}</p>}
   <p>{t("Owner review pending — no contact, Person, case or enrollment was created","ממתינה לבדיקת הבעלים — לא נוצרו קשר, אדם, תיק או הרשמה")} · <time dateTime={item.receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.receivedAt))}</time></p>
   {hasDetails&&<details className={styles.applicationDetails}><summary>{t("Optional parent details","פרטים אופציונליים מההורה")}</summary>
    {item.fields.screenAccess&&<p><strong>{t("Screen access","גישה למסך")}:</strong> {screenAccessValue(item.fields.screenAccess)}</p>}
    {item.fields.screenTime&&<p><strong>{t("Screen time","זמן מסך")}:</strong> {screenTimeValue(item.fields.screenTime)}</p>}
    {observations.length>0&&<dl>{observations.map(([key,value])=><div key={key}><dt>{observationLabels[key as keyof typeof observationLabels]}</dt><dd>{observationValue(value??"not_shared")}</dd></div>)}</dl>}
    {item.fields.parentPriorities&&<p><strong>{t("Parent priorities","עדיפויות ההורה")}:</strong> {item.fields.parentPriorities}</p>}
   </details>}
  </article>})}
 </main>;
}
