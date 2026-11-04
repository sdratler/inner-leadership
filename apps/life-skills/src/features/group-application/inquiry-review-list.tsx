import type {Locale} from "../../lib/locale.ts";
import {isTrip390Interest,type GroupApplicationRecord} from "./contract.ts";
import styles from "./inquiry-review.module.css";

/** A view of already authorized, decoded records. Selecting never writes a follow-up. */
export function InquiryReviewList({items,locale,disabled,onSelect}:{items:readonly GroupApplicationRecord[];locale:Locale;disabled:boolean;onSelect:(reference:string)=>void}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <section aria-label={t("Saved trip inquiries","פניות שמורות לטיול")} className={styles.list} data-inquiry-list>
  <div className={styles.columns} aria-hidden="true"><span>{t("Parent / contact","הורה / פרטי קשר")}</span><span>{t("Boys / ages","ילדים / גילאים")}</span><span>{t("City / ZIP","עיר / מיקוד")}</span><span>{t("Received · Florida time","התקבלה · שעון פלורידה")}</span></div>
  <ul>{items.map(item=>{if(!isTrip390Interest(item.fields))return null;const f=item.fields;return <li key={item.id} className={styles.row} data-inquiry-row={item.id}>
   <div><button type="button" disabled={disabled} className={styles.open} onClick={()=>onSelect(item.id)} aria-label={t(`Open inquiry from ${f.guardianName}`,`פתיחת הפנייה של ${f.guardianName}`)}><bdi>{f.guardianName}</bdi></button><bdi dir="ltr" className={styles.contact}>{f.email}</bdi>{f.phone&&<bdi dir="ltr" className={styles.contact}>{f.phone}</bdi>}<span className={styles.muted}>{t("Messages: ","שפת הודעות: ")}{f.messageLanguage==="he"?t("Hebrew","עברית"):t("English","אנגלית")}</span></div>
   <div><span className={styles.mobileLabel}>{t("Boys / ages","ילדים / גילאים")}</span>{f.children.map(child=><span className={styles.child} key={child.id}><bdi>{child.name}</bdi> · {t("age","גיל")} {child.ageYears}</span>)}</div>
   <div><span className={styles.mobileLabel}>{t("City / ZIP","עיר / מיקוד")}</span><bdi>{f.city}</bdi><bdi dir="ltr" className={styles.contact}>{f.postalCode}</bdi></div>
   <div><span className={styles.mobileLabel}>{t("Received · Florida time","התקבלה · שעון פלורידה")}</span><time dateTime={item.receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(item.receivedAt))}</time><span className={styles.muted}>{t("Saved inquiry","פנייה שמורה")}</span></div>
  </li>;})}</ul>
 </section>;
}
