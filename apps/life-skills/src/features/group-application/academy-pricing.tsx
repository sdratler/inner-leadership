"use client";
import {useAcademyHref} from "./academy-route-context.tsx";
import type {Locale} from "../../lib/locale.ts";
import {AcademyBidi} from "./academy-bidi.tsx";
import styles from "./academy-pricing.module.css";
const whatsappHref="https://wa.me/972534932631?text=Hi%2C%20I%20came%20from%20your%20website.%20I%27d%20like%20to%20know%20more.";
export function AcademyPricing({locale,applicationHref}:{locale:Locale;applicationHref?:string}){
 if(locale!=="en"&&locale!=="he")throw new Error("ACADEMY_PRICING_UNAVAILABLE");
 const formHref="/"+locale+"/florida/apply";
 if(applicationHref!==undefined&&applicationHref!==formHref&&applicationHref!=="#apply")throw new Error("ACADEMY_PRICING_UNAVAILABLE");
 const academyHref=useAcademyHref();
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const groups=[
  {id:"founding",title:t("Founding Families","משפחות מייסדות"),intro:t("For the first 20 qualifying families. First-stage prepay only.","לעשרים המשפחות הזכאיות הראשונות. תשלום מראש לשלב הראשון בלבד."),cards:[
   {kind:"founding-primary",title:t("Primary child","הילד הראשון"),amount:"$1,650",saving:t("Save $300 vs. $1,950","חיסכון של $300 לעומת $1,950"),note:t("Primary learner, first-stage prepay only.","תשלום מראש לשלב הראשון בלבד, לילד הראשון.")},
   {kind:"founding-sibling",title:t("Eligible founding sibling","אח נוסף במשפחה מייסדת זכאית"),amount:"$1,550",saving:t("Save $400 vs. $1,950","חיסכון של $400 לעומת $1,950"),note:t("Additional eligible sibling, first-stage prepay only.","לאח נוסף זכאי, בתשלום מראש עבור השלב הראשון בלבד.")}
  ]},
  {id:"regular",title:t("Regular Pricing","מחירים רגילים"),intro:t("Choose full stage prepayment or three installments.","בחרו תשלום מלא מראש לשלב או שלושה תשלומים."),cards:[
   {kind:"regular-prepay",title:t("Full stage prepayment","תשלום מלא מראש לשלב"),amount:"$1,750",saving:t("Save $200 vs. $1,950","חיסכון של $200 לעומת $1,950"),note:t("Full prepayment for one 12-session stage, per child.","תשלום מלא מראש עבור שלב אחד בן 12 מפגשים, לכל ילד.")},
   {kind:"ordinary-sibling",title:t("Eligible sibling prepayment","תשלום מראש לאח נוסף זכאי"),amount:"$1,650",saving:t("Save $300 vs. $1,950","חיסכון של $300 לעומת $1,950"),note:t("Ordinary eligible additional sibling, full stage prepay.","לאח נוסף זכאי במסלול הרגיל, בתשלום מלא מראש לשלב.")},
   {kind:"installments",title:t("Three installments","שלושה תשלומים"),amount:"$1,950",saving:"3 × $650 = $1,950",note:t("Primary learners and siblings pay the same installment total. No sibling installment discount.","הסכום הכולל בתשלומים זהה לילד הראשון ולאחים. אין הנחת אחים במסלול התשלומים.")}
  ]}
 ];
 return <section id="pricing" data-academy-pricing="" className={styles.pricing} lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-labelledby="academy-pricing-title"><div className={styles.inner}>
  <header className={styles.header}><p className={styles.eyebrow}>{t("A stage of learning. Skills for life.","שלב של למידה. מיומנויות לחיים.")}</p><h2 id="academy-pricing-title">{t("How much it costs","כמה זה עולה")}</h2><p>{t("One 12-session stage, per child, in US dollars.","שלב אחד בן 12 מפגשים, לכל ילד, בדולר ארה״ב.")}</p></header>
  <div className={styles.priceGroups}>{groups.map(group=><section className={styles.priceGroupPanel} key={group.id} data-price-group={group.id}><header><p className={styles.groupTag}>{group.id==="founding"?t("First 20 qualifying families","20 המשפחות הזכאיות הראשונות"):t("One stage at a time","שלב אחד בכל פעם")}</p><h3>{group.title}</h3><p>{group.intro}</p></header><div className={styles.groupCards}>{group.cards.map(card=><article className={styles.card} data-price-kind={card.kind} key={card.kind}><h4>{card.title}</h4>{card.kind==="founding-primary"&&<p className={styles.comparison}>{t("Standard stage price","מחיר רגיל לשלב")} <del><bdi dir="ltr">$1,950</bdi></del></p>}<p className={styles.amount}><bdi dir="ltr">{card.amount}</bdi></p><p className={styles.saving} dir={card.kind==="installments"?"ltr":undefined}><AcademyBidi>{card.saving}</AcademyBidi></p><p>{card.note}</p></article>)}</div></section>)}</div>
  <nav className={styles.actions} aria-label={t("Pricing next steps","הצעדים הבאים לאחר בחירת המחיר")}><a className={styles.primary} href={applicationHref??academyHref(locale,"/apply")}>{t("Register","להרשמה")}</a><a className={styles.secondary} href={whatsappHref} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={t("Questions? Message on WhatsApp","יש שאלות? כתבו לנו בוואטסאפ")} title={t("Questions? Message on WhatsApp","יש שאלות? כתבו לנו בוואטסאפ")}><svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M26 15.5a10 10 0 0 1-14.6 8.9L6 26l1.6-5.2A10 10 0 1 1 26 15.5Z"/><path d="M12 10c-3 2 4 10 7 9l2-2-3-2-1 1c-2-1-3-2-4-4l1-1-2-3Z"/></svg></a></nav>
 </div></section>;
}
