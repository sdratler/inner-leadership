"use client";
import type {Locale} from "../../lib/locale.ts";
import styles from "./workspace.module.css";

export type FishingDraftContext={
 label:string;
 fields:readonly {key:"participants"|"fees"|"dates"|"cadence"|"staffing"|"venue"|"attendance";label:string;value:string}[];
};

export function fishingDraftContext(locale:Locale):FishingDraftContext{
 const he=locale==="he",unset=he?"לא הוגדר":"Unset";
 return {label:he?"תוכנית דיג — טיוטה":"Fishing program — draft",fields:[
  {key:"participants",label:he?"משתתפים":"Participants",value:he?"לא נוספו על ידי התבנית":"None added by this starter"},
  {key:"fees",label:he?"תשלום":"Fee",value:unset},
  {key:"dates",label:he?"תאריכים":"Dates",value:unset},
  {key:"cadence",label:he?"תדירות":"Cadence",value:unset},
  {key:"staffing",label:he?"צוות":"Staffing",value:unset},
  {key:"venue",label:he?"מקום":"Venue",value:unset},
  {key:"attendance",label:he?"נוכחות":"Attendance",value:he?"חסומה עד לאישור מועד ומשתתפים מורשים":"Blocked until an occurrence and authorized participants are confirmed"},
 ]};
}

export function FishingProgramStarter({locale,onPrepare,disabled,hasUnsavedLabel}:{locale:Locale;onPrepare:()=>void;disabled:boolean;hasUnsavedLabel:boolean}){
 const he=locale==="he",context=fishingDraftContext(locale),t=(en:string,hebrew:string)=>he?hebrew:en;
 return <section className={styles.programStarter} aria-labelledby="fishing-program-draft-heading">
  <div><p className={styles.eyebrow}>{t("Reusable program context","הקשר תוכנית לשימוש חוזר")}</p><h3 id="fishing-program-draft-heading">{t("Fishing program — planning draft","תוכנית דיג — טיוטת תכנון")}</h3></div>
  <p>{t("Start with the existing private group tools: a draft group, verified service interests, proposed placements and proposed occurrences. The starter fills only an administrative label.",
   "מתחילים בכלי הקבוצות הפרטיים הקיימים: קבוצת טיוטה, התעניינויות מאומתות בשירות, הצעות שיבוץ ומועדים מוצעים. התבנית ממלאת רק תווית מנהלית.")}</p>
  <dl>{context.fields.map(item=><div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
  <p className={styles.boundary}>{t("Planning only. Preparing this draft does not enroll, book, charge, message, confirm participation or record attendance.",
   "תכנון בלבד. הכנת הטיוטה אינה רושמת, קובעת, מחייבת, שולחת הודעה, מאשרת השתתפות או מתעדת נוכחות.")}</p>
  <div className={styles.starterActions}><button type="button" className="lsw-button lsw-button--secondary" aria-controls="draft-group-label" disabled={disabled||hasUnsavedLabel} onClick={onPrepare}>{t("Prepare fishing draft","הכנת טיוטת דיג")}</button>
   {hasUnsavedLabel&&<small>{t("The current unsaved label is preserved. Clear it before applying this starter.","התווית שלא נשמרה נשמרת. יש למחוק אותה לפני החלת התבנית.")}</small>}</div>
 </section>;
}
