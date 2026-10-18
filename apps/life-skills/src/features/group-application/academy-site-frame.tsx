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
    <a href={home+"#stages"}>{t("The program","התוכנית")}</a><a href={home+"#pricing"}>{t("Prices","מחירים")}</a>
    {intake?<a href="#academy-travel-faq" onClick={()=>{const faq=document.getElementById("academy-travel-faq");if(faq instanceof HTMLDetailsElement)faq.open=true;}}>{t("Travel FAQ","שאלות על נסיעה")}</a>:<a href={home+"#questions"}>{t("Questions","שאלות")}</a>}
   </nav>
   <div className={styles.languages} aria-label={t("Language","שפה")}>{(["en","he"] as const).map(language=>onLocaleChange?
    <button key={language} type="button" lang={language} aria-pressed={locale===language} onClick={()=>onLocaleChange(language)}>{language==="en"?"EN":"עברית"}</button>:
    <a key={language} href={`/${language}/florida${path}`} lang={language} aria-current={locale===language?"page":undefined}>{language==="en"?"EN":"עברית"}</a>)}</div>
  </div></header>
  {children}
  <footer className={styles.footer} data-academy-footer><div className={styles.footerInner}>
   <JlfaLogo locale={locale} footer homeHref={home}/><div><p className={styles.footerName}>South Florida Jewish Leadership Fishing Academy</p><p className={styles.footerPillars}>{JLFA_TAGLINE}</p>
    <nav aria-label={t("Footer navigation","ניווט בתחתית הדף")}><a href={home}>{t("Home","דף הבית")}</a><a href={home+"#stages"}>{t("Explore the program","הכירו את התוכנית")}</a><a href={`/${locale}/florida/apply`}>{t("Begin an inquiry","לשליחת פנייה")}</a><a href={ACADEMY_WHATSAPP} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp ↗</a></nav>
   </div>
  </div></footer>
 </div>;
}
