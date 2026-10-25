"use client";
import {useAcademyHref} from "./academy-route-context.tsx";
import type {Locale} from "../../lib/locale.ts";
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {AcademyFounderCounter} from './academy-founder-counter.tsx';
import {founderPrice} from './academy-founder-contract.ts';
import styles from "./academy-pricing.module.css";
const money=(value:number)=><bdi dir="ltr">${value.toLocaleString('en-US')}</bdi>;
/** Presentation of the existing commercial master; no allocation or offer is created. */
export function AcademyRegistrationOffer({locale,childrenCount=1}:{locale:Locale;childrenCount?:number}){
 const pre=useAcademyCampaign()?.phase==='PRE_REGISTRATION',t=(en:string,he:string)=>locale==='he'?he:en;
 const primary=founderPrice('prepay',pre,false),sibling=founderPrice('prepay',pre,true),count=Math.max(1,childrenCount);
 return <aside className={styles.formOffer} data-registration-price>
  <p><strong>{t('First-stage prepayment','תשלום מראש לשלב הראשון')}: {money(primary)}</strong>{pre&&<> · {t('Save','חיסכון של')} {money(founderPrice('monthly_block',false,false)*3-primary)} {t('vs. three separately purchased blocks','לעומת שלושה מקבצים הנרכשים בנפרד')}</>}</p>
  {count>1&&<p data-registration-family-price>{t('Each eligible additional sibling','כל אח נוסף זכאי')}: {money(sibling)} · {t('Family prepayment total','סך התשלום מראש למשפחה')}: {money(primary+(count-1)*sibling)}</p>}
  <p>{pre?t('First-stage prepay · First 30 qualifying families · No payment today.','תשלום מראש לשלב הראשון · 30 המשפחות הזכאיות הראשונות · ללא תשלום היום.'):t('No payment today. Group, start date and any payment offer are arranged separately.','ללא תשלום היום. הקבוצה, מועד הפתיחה והצעת התשלום יתואמו בנפרד.')}</p>
  {pre&&<small>{t('Founder eligibility is checked when your registration is saved.','הזכאות לתעריף מייסדים נבדקת בעת שמירת ההרשמה.')}</small>}
 </aside>;
}
export function AcademyPricing({locale,applicationHref}:{locale:Locale;applicationHref?:string}){
 if(locale!=="en"&&locale!=="he")throw new Error("ACADEMY_PRICING_UNAVAILABLE");
 const formHref="/"+locale+"/florida/apply";
 if(applicationHref!==undefined&&applicationHref!==formHref&&applicationHref!=="#apply")throw new Error("ACADEMY_PRICING_UNAVAILABLE");
 const academyHref=useAcademyHref(),pre=useAcademyCampaign()?.phase==='PRE_REGISTRATION',t=(en:string,he:string)=>locale==='he'?he:en;
 const blocks=founderPrice('monthly_block',false,false)*3;
 return <section id="pricing" data-academy-pricing="" className={styles.pricing} lang={locale} dir={locale==='he'?'rtl':'ltr'} aria-labelledby="academy-pricing-title"><div className={styles.inner}>
  <header className={styles.header}><h2 id="academy-pricing-title">{pre?t('Pre-register free. Save $300.','הירשמו בחינם. חסכו 300 דולר.'):t('Registration','הרשמה')}</h2><p>{t('One 12-session stage, per child, in US dollars.','שלב אחד בן 12 מפגשים, לכל ילד, בדולר ארה״ב.')}</p></header>
  {pre&&<ul className={styles.qualifiers}><li>{t('First 30 qualifying families','30 המשפחות הזכאיות הראשונות')}</li><li>{t('First-stage prepayment','תשלום מראש לשלב הראשון')}</li><li>{t('No payment today','ללא תשלום היום')}</li></ul>}
  <AcademyFounderCounter locale={locale}/>
  <div className={styles.comparisonPanel} data-price-group="comparison">
   <table><caption>{t('Stage price comparison','השוואת מחירים לשלב')}</caption><thead><tr><th scope="col">{t('Child','ילד')}</th><th scope="col">{t('Ordinary prepay','תשלום רגיל מראש')}</th>{pre&&<th scope="col">{t('Founder prepay','תשלום מייסדים מראש')}</th>}</tr></thead><tbody>{[false,true].map(additional=><tr key={String(additional)}><th scope="row">{additional?t('Eligible additional sibling','אח נוסף זכאי'):t('Primary child','הילד הראשון')}</th><td data-price-kind={additional?'ordinary-sibling':'regular-prepay'}>{money(founderPrice('prepay',false,additional))}</td>{pre&&<td data-price-kind={additional?'founding-sibling':'founding-primary'}><strong>{money(founderPrice('prepay',true,additional))}</strong></td>}</tr>)}</tbody></table>
   <p className={styles.comparison}>{t('Three separately purchased four-lesson blocks','שלושה מקבצים נפרדים של ארבעה שיעורים')}: {money(blocks)} {t('per child','לכל ילד')}.</p>
   {pre&&<p className={styles.saving}>{t('Founder savings vs. three blocks:','חיסכון למייסדים לעומת שלושה מקבצים:')} {money(blocks-founderPrice('prepay',true,false))} {t('primary child;','לילד הראשון;')} {money(blocks-founderPrice('prepay',true,true))} {t('eligible sibling. Each founder rate is $100 below ordinary prepayment.','לאח זכאי. כל תעריף מייסדים נמוך ב־100 דולר מהתשלום הרגיל מראש.')}</p>}
   <p data-price-kind="monthly-block">{t('Monthly option:','אפשרות חודשית:')} {money(founderPrice('monthly_block',false,false))} {t('for 4 lessons.','ל־4 שיעורים.')} {t('Each block is purchased separately. No automatic renewal.','כל מקבץ נרכש בנפרד. ללא חידוש אוטומטי.')}</p>
  </div>
  <details className={styles.details}><summary>{t('How it works','איך זה עובד')}</summary><p>{t('Free registration reserves promotional eligibility, not a class seat or start date. Confirm your interest by email. A separate seven-calendar-day payment window begins only after an approved dated offer is successfully sent for a suitable group.','הרשמה חינמית שומרת זכאות להטבה, לא מקום בכיתה או מועד פתיחה. אשרו את ההתעניינות בדוא״ל. חלון תשלום נפרד בן שבעה ימים קלנדריים מתחיל רק לאחר שליחה מוצלחת של הצעה מאושרת ומתוארכת לקבוצה מתאימה.')}</p>{pre&&<p>{t('Founder rates apply to first-stage prepayment only, not four-lesson blocks. Two eligible children:','תעריפי מייסדים חלים על תשלום מראש לשלב הראשון בלבד, ולא על מקבצים של ארבעה שיעורים. שני ילדים זכאים:')} {money(founderPrice('prepay',true,false)+founderPrice('prepay',true,true))} {t('founder prepay;','בתעריף מייסדים;')} {money(founderPrice('prepay',false,false)+founderPrice('prepay',false,true))} {t('ordinary prepay;','בתעריף רגיל;')} {money(blocks*2)} {t('in separately purchased blocks. Discounts do not stack.','במקבצים הנרכשים בנפרד. אין כפל הנחות.')}</p>}</details>
  <nav className={styles.actions} aria-label={t('Pricing next steps','הצעדים הבאים לאחר בחירת המחיר')}><a className={styles.primary} href={applicationHref??academyHref(locale,'/apply')}>{pre?t('Pre-register for free','הרשמה מוקדמת בחינם'):t('Register','הרשמה')}</a></nav>
 </div></section>;
}
