"use client";
import {useAcademyHref} from "./academy-route-context.tsx";
import type {Locale} from "../../lib/locale.ts";
import {AcademyBidi} from "./academy-bidi.tsx";
import styles from "./academy-pricing.module.css";
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
  {id:"regular",title:t("Regular Pricing","מחירים רגילים"),intro:t("Choose a prepaid 12-lesson stage or a separately purchased four-lesson monthly block.","בחרו שלב בן 12 שיעורים בתשלום מראש או מקבץ חודשי נפרד של ארבעה שיעורים."),cards:[
   {kind:"regular-prepay",title:t("Full stage prepayment","תשלום מלא מראש לשלב"),amount:"$1,750",saving:t("Save $200 vs. $1,950","חיסכון של $200 לעומת $1,950"),note:t("Full prepayment for one 12-session stage, per child.","תשלום מלא מראש עבור שלב אחד בן 12 מפגשים, לכל ילד.")},
   {kind:"ordinary-sibling",title:t("Eligible sibling prepayment","תשלום מראש לאח נוסף זכאי"),amount:"$1,650",saving:t("Save $300 vs. $1,950","חיסכון של $300 לעומת $1,950"),note:t("Ordinary eligible additional sibling, full stage prepay.","לאח נוסף זכאי במסלול הרגיל, בתשלום מלא מראש לשלב.")},
   {kind:"monthly-block",title:t("Four-lesson monthly block","מקבץ חודשי של ארבעה שיעורים"),amount:"$650",saving:t("Four lessons, per child","ארבעה שיעורים לכל ילד"),note:t("Primary learners and siblings pay the same block price. Each new block is purchased separately, with a renewed early refund window. No automatic future charge.","מחיר המקבץ זהה לילד הראשון ולאחים. כל מקבץ חדש נרכש בנפרד, עם חלון החזר מוקדם חדש. אין חיוב עתידי אוטומטי.")}
  ]}
 ];
 return <section id="pricing" data-academy-pricing="" className={styles.pricing} lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-labelledby="academy-pricing-title"><div className={styles.inner}>
  <header className={styles.header}><h2 id="academy-pricing-title">{t("How much it costs","כמה זה עולה")}</h2><p>{t("One 12-session stage, per child, in US dollars.","שלב אחד בן 12 מפגשים, לכל ילד, בדולר ארה״ב.")}</p></header>
  <div className={styles.priceGroups}>{groups.map(group=><section className={styles.priceGroupPanel} key={group.id} data-price-group={group.id}><header><p className={styles.groupTag}>{group.id==="founding"?t("First 20 qualifying families","20 המשפחות הזכאיות הראשונות"):t("One stage at a time","שלב אחד בכל פעם")}</p><h3>{group.title}</h3><p>{group.intro}</p></header><div className={styles.groupCards}>{group.cards.map(card=><article className={styles.card} data-price-kind={card.kind} key={card.kind}><h4>{card.title}</h4>{card.kind==="founding-primary"&&<p className={styles.comparison}>{t("Three separately purchased blocks","שלושה מקבצים הנרכשים בנפרד")} <del><bdi dir="ltr">$1,950</bdi></del></p>}<p className={styles.amount}><bdi dir="ltr">{card.amount}</bdi></p><p className={styles.saving} dir={card.kind==="installments"?"ltr":undefined}><AcademyBidi>{card.saving}</AcademyBidi></p><p>{card.note}</p></article>)}</div></section>)}</div>
  <nav className={styles.actions} aria-label={t("Pricing next steps","הצעדים הבאים לאחר בחירת המחיר")}><a className={styles.primary} href={applicationHref??academyHref(locale,"/apply")}>{t("Register","להרשמה")}</a></nav>
 </div></section>;
}
