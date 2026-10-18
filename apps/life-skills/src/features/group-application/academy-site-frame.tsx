"use client";
import type {ReactNode} from "react";
import type {Locale} from "../../lib/locale.ts";
import {JlfaLogo,JLFA_TAGLINE} from "./jlfa-brand.tsx";
import brand from "./jlfa-brand.module.css";
import styles from "./academy-site.module.css";

export const ACADEMY_WHATSAPP="https://wa.me/972534932631?text=Hi%2C%20I%20came%20from%20your%20website.%20I%27d%20like%20to%20know%20more.";
export function AcademySiteFrame({locale,children,onLocaleChange,path="",intake=false,className=""}:{locale:Locale;children:ReactNode;onLocaleChange?:(locale:Locale)=>void;path?:string;intake?:boolean;className?:string}){
 const t=(en:string,he:string)=>locale==="he"?he:en,home=`/${locale}/florida`;
 return <div className={`${brand.scope} ${styles.site} ${className}`} lang={locale} dir={locale==="he"?"rtl":"ltr"} data-academy-site data-academy-full-inquiry={intake?"":undefined}>
  <a className={styles.skip} href={intake?"#academy-form":"#main"}>{t("Skip to content","דלגו לתוכן")}</a>
  <header className={styles.header} data-academy-header><div className={styles.headerInner}>
   <JlfaLogo locale={locale} homeHref={home}/>
   <nav className={styles.navigation} aria-label={t("Academy navigation","ניווט באקדמיה")}>
    <a href={home}>{t("Home","דף הבית")}</a><a href={home+"#stages"}>{t("The program","התוכנית")}</a><a href={home+"#pricing"}>{t("Prices","מחירים")}</a>
    <a href={intake?"#questions":home+"#questions"}>{t("FAQ","שאלות נפוצות")}</a>
   </nav>
   <a className={styles.headerAction} href={intake?"#academy-form":`/${locale}/florida/apply`}>{t("Register","להרשמה")} <span aria-hidden="true">↗</span></a>
   <div className={styles.languages} aria-label={t("Language","שפה")}>{(["en","he"] as const).map(language=>onLocaleChange?
    <button key={language} type="button" lang={language} aria-pressed={locale===language} onClick={()=>onLocaleChange(language)}>{language==="en"?"EN":"עברית"}</button>:
    <a key={language} href={`/${language}/florida${path}`} lang={language} aria-current={locale===language?"page":undefined}>{language==="en"?"EN":"עברית"}</a>)}</div>
  </div></header>
  {children}
  <footer className={styles.footer} data-academy-footer><div className={styles.footerInner}>
   <JlfaLogo locale={locale} footer homeHref={home}/><div><p className={styles.footerName}>South Florida Jewish Leadership Fishing Academy</p><p className={styles.footerPillars}>{JLFA_TAGLINE}</p><p className={styles.nonprofit}>{t("A program of Bnei Neviim Academy, a New Jersey nonprofit.","תוכנית של אקדמיית בני נביאים, ארגון ללא כוונת רווח בניו ג׳רזי.")} <a href="https://bneineviimacademy.org/" target="_blank" rel="noopener noreferrer">Bnei Neviim Academy ↗</a></p>
    <nav aria-label={t("Footer navigation","ניווט בתחתית הדף")}><a href={home}>{t("Home","דף הבית")}</a><a href={home+"#stages"}>{t("Explore the program","הכירו את התוכנית")}</a><a href={`/${locale}/florida/apply`}>{t("Begin an inquiry","לשליחת פנייה")}</a><a className={styles.whatsappLink} href={ACADEMY_WHATSAPP} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp ↗</a></nav>
   </div>
  </div></footer>
  <nav className={styles.bottomBar} aria-label={t("Quick Academy actions","פעולות מהירות באקדמיה")} data-academy-bottom-bar>
   <a href={intake?"#questions":home+"#questions"}>{t("FAQ","שאלות")}</a>
   <a className={styles.whatsappLink} href={ACADEMY_WHATSAPP} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp ↗</a>
   <a className={styles.button} href={intake?"#academy-form":`/${locale}/florida/apply`}>{intake?t("Complete form","למילוי הטופס"):t("Start registration","להרשמה")} <span aria-hidden="true">↗</span></a>
  </nav>
 </div>;
}
