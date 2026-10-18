"use client";
import{useEffect,useState}from"react";
import type{Locale}from"../../lib/locale.ts";
import{GroupApplicationForm}from"./application-form.tsx";
import{AcademySiteFrame}from"./academy-site-frame.tsx";
import{AcademyPricing}from"./academy-pricing.tsx";
import siteStyles from"./academy-site.module.css";
import{AcademyTravelFaq}from"./academy-travel-faq.tsx";
import styles from"./academy-intake.module.css";

export function AcademyIntakePage({locale:initialLocale}:{locale:Locale}){
 const[locale,setLocale]=useState(initialLocale),t=(en:string,he:string)=>locale==="he"?he:en,home=`/${locale}/florida`;
 useEffect(()=>{document.documentElement.lang=locale;document.documentElement.dir=locale==="he"?"rtl":"ltr";},[locale]);
 function language(next:Locale){if(next===locale)return;setLocale(next);window.history.replaceState(window.history.state,"",`/${next}/florida/apply`+window.location.hash);}
 return <AcademySiteFrame locale={locale} onLocaleChange={language} intake className={styles.shell??""}>
  <main id="main" className={styles.main}><div className={styles.intro}><p className={styles.eyebrow}>{t("Torah • Fishing • Self-governance","תורה • דיג • הנהגה עצמית")}</p><h1>{t("Apply to the Fishing Academy","פנייה לאקדמיה לדיג")}</h1><p>{t("A part-time enrichment program for boys from third grade upward. Tell us about your family, schedule and travel preferences so we can discuss suitable groups.","תוכנית העשרה חלקית לבנים מכיתה ג׳ ומעלה. ספרו על המשפחה ועל העדפות הזמנים והנסיעה כדי שנוכל לדון בקבוצות מתאימות.")}</p><p>{t("Each regular stage has twelve sessions, ordinarily one three-hour meeting per week. Actual group schedules, locations and availability are confirmed separately.","בכל שלב רגיל שנים־עשר מפגשים, בדרך כלל מפגש שבועי אחד בן שלוש שעות. הזמנים, המיקומים והזמינות בפועל מאושרים בנפרד לכל קבוצה.")}</p><a href={home+"#pricing"}>{t("Review per-child stage prices","לעיון במחירי שלב לכל ילד")}</a></div>
   <details className={siteStyles.intakePrices}><summary>{t("Review tuition for one 12-session stage","לעיון במחירי שלב אחד בן 12 מפגשים")}</summary><AcademyPricing locale={locale} applicationHref="#apply"/></details>
   <div id="apply"><section id="academy-form" className={styles.formSection} aria-label={t("Complete Academy inquiry","פנייה מלאה לאקדמיה")}><GroupApplicationForm locale={locale} programId="sunday_fishing_academy" fullIntake/></section></div>
   <section className={styles.faqSection} aria-label={t("Locations, travel and make-ups","מיקומים, נסיעות והשלמות")}><h2>{t("Locations, travel and make-ups","מיקומים, נסיעות והשלמות")}</h2><AcademyTravelFaq locale={locale} returnToForm/><details><summary>{t("What happens after this form?","מה קורה לאחר הטופס?")}</summary><p>{t("Your completed preferences are saved privately as an inquiry. Choose a callback or continuing toward enrollment. A suitable actual group, schedule, locations, capacity, terms and authorized payment offer must be confirmed before payment. Only verified qualifying payment reserves a founding-family place; submitting this form or waiting for follow-up does not reserve one.","ההעדפות המלאות נשמרות באופן פרטי כפנייה. בחרו שיחה חוזרת או המשך לקראת הרשמה. לפני תשלום יש לאשר קבוצה מתאימה בפועל, זמנים, מיקומים, מקום פנוי, תנאים והצעת תשלום מורשית. רק תשלום מתאים שאומת שומר מקום למשפחה מייסדת; שליחת הטופס או המתנה להמשך אינן שומרות מקום.")}</p></details><details><summary>{t("Who handles drop-off and pickup?","מי אחראי להבאה ולאיסוף?")}</summary><p>{t("Parents arrange transport to the confirmed times and locations and make the agreed guardian handoff. The Academy retains supervision and care during accepted custody. Optional Keys transport and offshore outings require separate arrangements.","ההורים מסדירים הגעה ואיסוף במועדים ובמיקומים שאושרו ומבצעים העברה מסודרת בין האחראים. האקדמיה ממשיכה בהשגחה ובאחריות לטיפול בזמן שבו הילד נמצא באחריותה. הסעה אופציונלית לקיז ויציאות לים הפתוח דורשות סידורים נפרדים.")}</p></details></section>
  </main>
 </AcademySiteFrame>;
}
