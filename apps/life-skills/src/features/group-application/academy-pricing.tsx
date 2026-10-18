import type {Locale} from "../../lib/locale.ts";
import styles from "./academy-pricing.module.css";

const whatsappHref="https://wa.me/972534932631?text=Hi%2C%20I%20came%20from%20your%20website.%20I%27d%20like%20to%20know%20more.";

/** Static Source03 offer presentation only; no remaining count or payment state.
 * The Hebrew copy is a translation candidate, not owner-approved translation.
 * Root owns form/offer/capacity/payment integration and later mounting.
 */
export function AcademyPricing({locale,applicationHref}:{locale:Locale;applicationHref?:string}){
 if(locale!=="en"&&locale!=="he")throw new Error("ACADEMY_PRICING_UNAVAILABLE");
 const formHref=`/${locale}/florida/apply`;
 if(applicationHref!==undefined&&applicationHref!==formHref&&applicationHref!=="#apply")throw new Error("ACADEMY_PRICING_UNAVAILABLE");
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const cards=[
  {kind:"regular-prepay",title:t("Regular stage prepay","תשלום מלא מראש לשלב"),amount:"$1,750",saving:t("Save $200 vs. $1,950","חיסכון של $200 לעומת $1,950"),note:t("Full prepayment for one 12-session stage, per child.","תשלום מלא מראש עבור שלב אחד בן 12 מפגשים, לכל ילד.")},
  {kind:"founding-sibling",title:t("Eligible founding sibling","אח נוסף במשפחה מייסדת זכאית"),amount:"$1,550",saving:t("Save $400 vs. $1,950","חיסכון של $400 לעומת $1,950"),note:t("Additional eligible sibling, first-stage prepay only.","לאח נוסף זכאי, בתשלום מראש עבור השלב הראשון בלבד.")},
  {kind:"ordinary-sibling",title:t("Eligible additional sibling","אח נוסף זכאי"),amount:"$1,650",saving:t("Save $300 vs. $1,950","חיסכון של $300 לעומת $1,950"),note:t("Ordinary eligible additional sibling, full stage prepay.","לאח נוסף זכאי במסלול הרגיל, בתשלום מלא מראש לשלב.")},
  {kind:"installments",title:t("Three installments","שלושה תשלומים"),amount:"$1,950",saving:"3 × $650 = $1,950",note:t("Primary learners and siblings pay the same installment total. No sibling installment discount.","הסכום הכולל בתשלומים זהה לילד הראשון ולאחים. אין הנחת אחים במסלול התשלומים.")},
 ];
 return <section id="pricing" data-academy-pricing="" className={styles.pricing} lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-labelledby="academy-pricing-title">
  <div className={styles.inner}>
   <header className={styles.header}>
    <p className={styles.eyebrow}>{t("12-session stage · per child","שלב בן 12 מפגשים · לכל ילד")}</p>
    <h2 id="academy-pricing-title">{t("Founding 20 Families","20 המשפחות המייסדות")}</h2>
    <p>{t("One 12-session stage, per child, in US dollars.","שלב אחד בן 12 מפגשים, לכל ילד, בדולר ארה״ב.")}</p>
   </header>
   <article className={styles.featured} data-price-kind="founding-primary">
    <div>
     <h3>{t("Founding primary learner","הילד הראשון במשפחה מייסדת")}</h3>
     <p>{t("First-20 qualifying families · first-stage prepay only","20 המשפחות הזכאיות הראשונות · תשלום מראש לשלב הראשון בלבד")}</p>
    </div>
    <div className={styles.priceGroup}>
     <p className={styles.comparison}>{t("Standard stage price","מחיר רגיל לשלב")} <del><bdi dir="ltr">$1,950</bdi></del></p>
     <p className={styles.amount}><bdi dir="ltr">$1,650</bdi></p>
     <p className={styles.saving}>{t("Save $300 vs. $1,950","חיסכון של $300 לעומת $1,950")}</p>
    </div>
   </article>
   <div className={styles.cards}>{cards.map(card=><article className={styles.card} data-price-kind={card.kind} key={card.kind}>
    <h3>{card.title}</h3><p className={styles.amount}><bdi dir="ltr">{card.amount}</bdi></p>
    <p className={styles.saving} dir={card.kind==="installments"?"ltr":undefined}>{card.saving}</p><p>{card.note}</p>
   </article>)}</div>
   <p className={styles.stageTerms}>{t("Founding prepay applies to the first stage only. Discounts do not stack. No full-year prepay or automatic next-stage charge. Installments cover the full 12-session stage.","מחירי התשלום מראש למשפחות מייסדות חלים על השלב הראשון בלבד. אין כפל הנחות, תשלום מראש לשנה שלמה או חיוב אוטומטי לשלב הבא. שלושת התשלומים מכסים את השלב המלא בן 12 המפגשים.")}</p>
   <div className={styles.disclosure}>
    <p>{t("Only verified qualifying payment confirms a founding-family reservation. An inquiry or callback request does not reserve a place.","רק תשלום מזכה שאומת מאשר מקום במסגרת ההטבה למשפחה מייסדת. פנייה או בקשה לשיחת חזרה אינן שומרות מקום.")}</p>
    <p>{t("We confirm the eligible group, schedule, locations, capacity and accepted terms before issuing an authorized payment offer. Pending, failed or unknown payment remains unreserved.","לפני הצעת תשלום מורשית מאשרים קבוצה מתאימה, לוח זמנים, מיקומים, מקום פנוי ותנאים שהתקבלו. תשלום ממתין, שנכשל או שמצבו אינו ידוע אינו שומר מקום.")}</p>
   </div>
   <nav className={styles.actions} aria-label={t("Pricing next steps","הצעדים הבאים לאחר בחירת המחיר")}>
    <a className={styles.primary} href={applicationHref??formHref}>{t("Apply / Continue to Enrollment","הגשת בקשה / המשך להרשמה")}</a>
    <a className={styles.secondary} href={whatsappHref} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("Questions? Message on WhatsApp","יש שאלות? כתבו לנו בוואטסאפ")}</a>
   </nav>
  </div>
 </section>;
}
