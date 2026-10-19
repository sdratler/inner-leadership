import bilingual from "./academy-bilingual-copy.json";
import type {Locale} from "../../lib/locale.ts";
import styles from "./academy-site.module.css";
export function AcademyOutingPrices({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <section id="outings" className={`${styles.wrap} ${styles.section}`}><h2>{t("Keys trips & optional offshore fishing","יציאות לקיז ודיג אופציונלי בים הפתוח")}</h2><div className={styles.outingsGrid}>
  <article data-academy-outing="keys"><h3>{t("Florida Keys — included in the program","פלורידה קיז — כלול בתוכנית")}</h3><p>{bilingual.outings.keys[locale]}</p></article>
  <article data-academy-outing="offshore"><h3>{t("Offshore boat fishing — optional separate purchase","דיג מסירה בים הפתוח — רכישה נפרדת ואופציונלית")}</h3><p>{bilingual.outings.offshore[locale]}</p></article>
 </div></section>;
}
