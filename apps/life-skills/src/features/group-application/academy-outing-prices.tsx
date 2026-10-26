import {academyTripCopy} from "./academy-trip-copy.ts";
import type {Locale} from "../../lib/locale.ts";
import styles from "./academy-site.module.css";
export function AcademyOutingPrices({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <section id="outings" className={`${styles.wrap} ${styles.section}`}><h2>{t("Keys trips & optional offshore fishing","יציאות לקיז ודיג אופציונלי בים הפתוח")}</h2><div className={styles.outingsGrid}>
  <article data-academy-outing="keys"><h3>{t("Planned Florida Keys trips","יציאות מתוכננות לפלורידה קיז")}</h3><p>{academyTripCopy.keysSummary[locale]}</p><details><summary>{t("Trip arrangements","סידורי היציאה")}</summary><p>{academyTripCopy.keysDetails[locale]}</p></details></article>
  <article data-academy-outing="offshore"><h3>{t("Optional offshore fishing","דיג אופציונלי בים הפתוח")}</h3><p>{academyTripCopy.offshoreSummary[locale]}</p><details><summary>{t("Eligibility and arrangements","זכאות וסידורים")}</summary><p>{academyTripCopy.offshoreConditions[locale]}</p></details></article>
 </div></section>;
}
