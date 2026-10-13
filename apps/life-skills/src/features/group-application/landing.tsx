/* eslint-disable @next/next/no-img-element -- approved existing brand and private-program assets are reused byte-for-byte */
"use client";
import {useEffect,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import type {FloridaProgramId} from "./contract.ts";
import {academyLandingDraft,academyLandingForMode} from "./academy-draft.ts";
import copy from "./presentation-copy.json";
import {GroupApplicationForm,SchoolInquirySection} from "./application-form.tsx";
import baseStyles from "./landing.module.css";
import additions from "./landing-additions.module.css";

const styles={...baseStyles,...additions};

type Pair={en:string;he:string};
type Program={id:FloridaProgramId;slug:string;label:Pair;eyebrow:Pair;title:Pair;lead:Pair;body:Pair;price:Pair;facts:Pair[];sectionTitle:Pair;sectionBody:Pair;cards:{title:Pair;body:Pair}[];boundary:Pair;faqs:[Pair,Pair][]};
const pair=(en:string,he:string):Pair=>({en,he});
const programs:Record<FloridaProgramId,Program>={
 sunday_fishing_academy:academyLandingDraft,
 morning_torah_learning:{id:"morning_torah_learning",slug:"torah-mornings",label:pair("Morning Torah Learning","לימוד תורה בבוקר"),eyebrow:pair("HOMESCHOOL REBBE • FLORIDA","רב לבוקר של חינוך ביתי • פלורידה"),title:pair("A grounded Torah morning with room to grow.","בוקר תורה יציב שנותן מקום לצמוח."),lead:pair("A Monday–Friday morning rhythm of Torah, breakfast, guided conversation, outdoor movement and self-governance.","מסגרת בוקר בימים שני–שישי הכוללת תורה, ארוחת בוקר, שיחה מונחית, תנועה בחוץ והנהגה עצמית."),body:pair("The intended window is roughly 8:30 or 9:00 until 1:00. The exact shul, daily times, calendar, holidays and absence terms are not yet confirmed.","החלון המתוכנן הוא בערך מ־8:30 או 9:00 עד 13:00. בית הכנסת, השעות היומיות, לוח השנה, החגים ותנאי ההיעדרות טרם אושרו."),price:pair("$1,000 per student each month. Deposit, cancellation, calendar and absence terms remain to be confirmed before enrollment.","1,000 דולר לתלמיד בכל חודש. תנאי המקדמה, הביטול, לוח השנה וההיעדרות יאושרו לפני ההרשמה."),facts:[pair("Monday–Friday target rhythm","מסגרת מתוכננת לימים שני–שישי"),pair("Torah and practical self-governance","תורה והנהגה עצמית מעשית"),pair("Not a complete school program","לא תוכנית לימודים מלאה")],sectionTitle:pair("A morning rhythm, not a promise of a full school","מסגרת בוקר, לא הבטחה לבית ספר מלא"),sectionBody:pair("Each block has a clear purpose while leaving final timing to the confirmed host setting.","לכל חלק יש מטרה ברורה, והשעות המדויקות ייקבעו עם אישור המסגרת המארחת."),cards:[
  {title:pair("Arrive and settle","מגיעים ומתארגנים"),body:pair("Breakfast, individual prayer or joining an existing minyan as applicable. The boys do not constitute a minyan.","ארוחת בוקר, תפילה אישית או הצטרפות למניין קיים לפי העניין. הבנים אינם מהווים מניין.")},
  {title:pair("Learn Torah","לומדים תורה"),body:pair("Focused learning with explanation, questions and age-appropriate discussion.","למידה ממוקדת עם הסבר, שאלות ושיחה המתאימה לגיל.")},
  {title:pair("Move outdoors","יוצאים לתנועה בחוץ"),body:pair("A planned break for movement, attention and responsible participation.","הפסקה מתוכננת לתנועה, לקשב ולהשתתפות אחראית.")},
  {title:pair("Reflect and plan","מתבוננים ומתכננים"),body:pair("Connect learning to choices, responsibilities and the next practical step.","מחברים את הלמידה לבחירות, לאחריות ולצעד המעשי הבא.")},
 ],boundary:pair("This service does not include fishing, a secular curriculum, a complete homeschool program or Life Skills app access. Parents remain responsible for all other education and legal requirements.","השירות אינו כולל דיג, תוכנית לימודים כללית, תוכנית חינוך ביתי מלאה או גישה לאפליקציית כישורי חיים. ההורים אחראים לכל יתר החינוך והדרישות החוקיות."),faqs:[
  [pair("Is this a complete school or homeschool curriculum?","האם זו תוכנית בית ספר או חינוך ביתי מלאה?"),pair("No. It is a defined Torah-morning service. Parents remain responsible for all other education and requirements.","לא. זהו שירות מוגדר של לימוד תורה בבוקר. ההורים נשארים אחראים לכל יתר החינוך והדרישות.")],
  [pair("Where will it meet?","היכן יתקיימו המפגשים?"),pair("The exact shul and daily schedule are not confirmed. This private preview collects area and call availability without inventing a venue.","בית הכנסת ולוח הזמנים היומי טרם אושרו. התצוגה הפרטית אוספת אזור וזמינות לשיחה בלי להמציא מקום.")],
 ]},
 private_fishing_life_skills:{...copy.vip,id:"private_fishing_life_skills",slug:"private-fishing",faqs:copy.vip.faqs.map<[Pair,Pair]>(entry=>[entry[0]!,entry[1]!])},
};

const pathFor=(locale:Locale,program:Program,mode:"native"|"sample"="native")=>mode==="sample"?`/${locale}/sample?page=florida-landing&program=${program.id}`:`/${locale}/florida${program.slug?`/${program.slug}`:""}`;
export function GroupApplicationLanding({locale:initialLocale,programId="sunday_fishing_academy",mode="native"}:{locale:Locale;programId?:FloridaProgramId;mode?:"native"|"sample"}){
 const [locale,setLocale]=useState<Locale>(initialLocale),[menuOpen,setMenuOpen]=useState(false);
 const visiblePrograms={...programs,sunday_fishing_academy:academyLandingForMode(mode)},program=visiblePrograms[programId];
 const academy=programId==="sunday_fishing_academy",vip=programId==="private_fishing_life_skills";
 const t=(en:string,he:string)=>locale==="he"?he:en,p=(value:Pair)=>value[locale];
 const primary=p(academy?copy.shared.ctaAcademy:vip?copy.shared.ctaVip:pair("Ask about Torah mornings","לפרטים על לימוד תורה בבוקר"));
 useEffect(()=>{document.documentElement.lang=locale;document.documentElement.dir=locale==="he"?"rtl":"ltr";},[locale]);
 const switchLanguage=(next:Locale)=>{if(next===locale)return;setMenuOpen(false);setLocale(next);window.history.replaceState(window.history.state,"",pathFor(next,program,mode)+(mode==="sample"?"":window.location.search)+window.location.hash);};
 return <div className={styles.page} lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <a className={styles.skip} href="#main">{t("Skip to content","דלגו לתוכן")}</a>
  <header className={styles.header}><div className={styles.wrap}>
   <a className={styles.brand} href="#main" aria-label={t("Life Skills Florida home","דף הבית של כישורי חיים פלורידה")}><img src="/groups/brand/life-skills-logo.png" alt="כישורי חיים — לחיים שלמים"/><span>Life Skills<small>{t("FLORIDA","פלורידה")}</small></span></a>
   <button className={styles.menuToggle} type="button" aria-expanded={menuOpen} aria-controls="florida-page-nav" onClick={()=>setMenuOpen(open=>!open)}><span aria-hidden="true">{menuOpen?"×":"☰"}</span><span className={styles.srOnly}>{menuOpen?t("Close navigation","סגירת ניווט"):t("Open navigation","פתיחת ניווט")}</span></button>
   <nav id="florida-page-nav" className={`${styles.nav} ${menuOpen?styles.navOpen:""}`} aria-label={t("Page navigation","ניווט בדף")}>
    <details className={styles.programMenu}><summary>{p(copy.shared.otherProgramsLabel)}</summary><div>{Object.values(visiblePrograms).map(item=><a aria-current={item.id===programId?"page":undefined} href={pathFor(locale,item,mode)} key={item.id}>{p(item.label)}</a>)}</div></details>
    <a href="#about">{t("About","אודות")}</a><a href="#questions">{t("FAQ","שאלות")}</a><a className={styles.navCta} href="#apply">{primary}</a>
   </nav>
   <div className={styles.language} aria-label={t("Language","שפה")}><button type="button" lang="en" aria-pressed={locale==="en"} onClick={()=>switchLanguage("en")}>EN</button><button type="button" lang="he" aria-pressed={locale==="he"} onClick={()=>switchLanguage("he")}>עברית</button></div>
  </div></header>
  <main id="main">
   <p className={`${styles.wrap} ${styles.previewBanner}`}>{p(copy.shared.previewBanner)}</p>
   {mode==="sample"&&<p className={styles.wrap}>{p(copy.inquiry.sampleBanner)} <a href={`/${locale}/sample?page=florida-journeys&program=${programId}`}>{t("Open the complete journey","פתיחת המסלול המלא")}</a></p>}
   <section className={styles.hero}><div className={`${styles.wrap} ${styles.heroGrid}`}>
    <div className={styles.heroCopy}><p className={styles.eyebrow}>{p(program.eyebrow)}</p><h1>{p(program.title)}</h1><p className={styles.heroLead}>{p(program.lead)}</p><p>{p(program.body)}</p><p className={styles.price}>{p(program.price)}</p>
     <div className={styles.heroActions}><a className={styles.primaryButton} href="#apply">{primary}</a><a className={styles.textLink} href="#learning">{p(copy.shared.secondaryHeroLink)} <span aria-hidden="true">↓</span></a></div>
     <ul className={academy?styles.benefitRow:styles.heroFacts} aria-label={academy?t("Academy benefits","יתרונות האקדמיה"):undefined}>{program.facts.map((value,index)=><li key={value.en}>{academy&&<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={["M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16","M2 16c2-3 4 3 6 0s4 3 6 0 4 3 8 0 M12 2v8a3 3 0 0 0 6 0 M5 2h7","M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M9 9l6-3-3 9-6 3z"][index]}/></svg>}<span>{p(value)}</span></li>)}</ul>
    </div>
    <div className={styles.heroPlaceholder} role="img" aria-label={p(copy.shared.placeholderLabel)}><div className={styles.waterLines} aria-hidden="true"><i/><i/><i/></div><span>{p(copy.shared.placeholderLabel)}</span><strong>{p(program.label)}</strong><p>{p(copy.shared.placeholderBody)}</p></div>
   </div></section>
   <section className={styles.how} id="about">
    <div className={`${styles.wrap} ${styles.twoColumn}`}><div><p className={styles.eyebrow}>{p(copy.shared.teacherKicker)}</p><h2>{p(copy.shared.teacherTitle)}</h2></div><p className={styles.sectionLead}>{p(copy.shared.teacherBody)}</p></div>
    <div id="learning" className={`${styles.wrap} ${styles.twoColumn} ${styles.learningRow}`}><div><p className={styles.eyebrow}>{p(copy.shared.programSectionKicker)}</p><h2>{p(program.sectionTitle)}</h2></div><p className={styles.sectionLead}>{p(program.sectionBody)}</p></div>
    <div className={`${styles.wrap} ${styles.skillGrid} ${academy?styles.rankGrid:""}`}>{program.cards.map((card,index)=><article key={card.title.en}><span>{String(index+1).padStart(2,"0")}</span><h3>{p(card.title)}</h3><p>{p(card.body)}</p></article>)}</div>
   </section>
   <section className={styles.readiness}><div className={`${styles.wrap} ${styles.readinessGrid}`}><div><p className={styles.eyebrow}>{t("Your next step","הצעד הבא שלכם")}</p><h2>{p(copy.shared.nextStepTitle)}</h2><p>{p(program.boundary)}</p></div><aside><ol>{copy.shared.nextStepSteps.map(step=><li key={step.en}>{p(step)}</li>)}</ol></aside></div></section>
   {(academy||vip)&&<section className={styles.programs}><div className={`${styles.wrap} ${styles.teaser}`}><h2>{p(academy?copy.shared.vipTeaserTitle:copy.academy.label)}</h2>{academy&&<p>{p(copy.shared.vipTeaserBody)}</p>}<a className={styles.textLink} href={pathFor(locale,visiblePrograms[academy?"private_fishing_life_skills":"sunday_fishing_academy"],mode)}>{p(academy?copy.shared.vipTeaserLink:copy.shared.academyReturnLink)}</a></div></section>}
   <section className={styles.locations}><div className={`${styles.wrap} ${styles.locationCard}`}><div><p className={styles.eyebrow}>{t("Locations & schedules","מיקומים ומועדים")}</p><h2>{p(copy.shared.locationTitle)}</h2><p>{p(copy.shared.locationBody)}</p></div></div></section>
   <section className={styles.faq} id="questions"><div className={`${styles.wrap} ${styles.twoColumn}`}><div><p className={styles.eyebrow}>{t("Before you inquire","לפני שפונים")}</p><h2>{p(copy.shared.faqTitle)}</h2></div><div className={styles.faqList}>{program.faqs.map(([question,answer])=><details key={question.en}><summary>{p(question)}</summary><p>{p(answer)}</p></details>)}</div></div></section>
   <section className={styles.apply} id="apply"><div className={`${styles.wrap} ${styles.applyGrid}`}><div className={styles.applyCopy}><p className={styles.eyebrow}>{t("One clear next step","צעד הבא ברור אחד")}</p><h2>{p(copy.shared.applyTitle)}</h2><p>{p(copy.shared.applyBody)}</p></div><GroupApplicationForm locale={locale} programId={programId} mode={mode}/></div></section>
   {academy&&<section className={styles.wrap}><SchoolInquirySection locale={locale} mode={mode}/></section>}
  </main>
  <footer className={styles.footer}><div className={`${styles.wrap} ${styles.footerTop}`}><a className={styles.brand} href="#main"><img src="/groups/brand/life-skills-logo.png" alt="כישורי חיים — לחיים שלמים"/><span>Life Skills<small>{t("FLORIDA","פלורידה")}</small></span></a><p>{p(program.label)}</p><a className={styles.primaryButton} href="#apply">{primary}</a></div>
   <div className={`${styles.wrap} ${styles.footerBottom}`}><p>{p(copy.shared.footerAffiliation)} <a href="https://bneineviimacademy.org/" target="_blank" rel="noopener noreferrer">Bnei Neviim Academy ↗</a></p><p>{p(copy.shared.previewBanner)}</p><a href={pathFor(locale,visiblePrograms.morning_torah_learning,mode)}>{p(visiblePrograms.morning_torah_learning.label)}</a></div>
  </footer>
 </div>;
}
