"use client";
import {useAcademyHref} from "./academy-route-context.tsx";
/* eslint-disable @next/next/no-img-element -- exact existing founder photographs */
import type {Locale} from "../../lib/locale.ts";
import {AcademySiteFrame} from "./academy-site-frame.tsx";
import {AcademyHero} from "./academy-hero.tsx";
import {AcademyPricing} from "./academy-pricing.tsx";
import bilingual from "./academy-bilingual-copy.json";
import {AcademyScene,AcademyIcon,type AcademySceneSlot} from "./academy-scenes.tsx";
import {academyStages,academySelfGovernance,academyQuestions} from "./academy-public-program.ts";
import styles from "./academy-site.module.css";
const stageScenes:AcademySceneSlot[]=["foundation","independent","advanced","leadership"];
export function AcademyWebsite({locale,onLocaleChange}:{locale:Locale;onLocaleChange:(locale:Locale)=>void}){
 const academyHref=useAcademyHref();
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const faqGroups=[{title:t("Getting started","מתחילים"),indexes:[0,1,2,9]},{title:t("Locations, travel & outings","מיקומים, נסיעות ויציאות"),indexes:[3,4,5,6,7,8]},{title:t("Prices & registration","מחירים והרשמה"),indexes:[10,11]}];
 return <AcademySiteFrame locale={locale} onLocaleChange={onLocaleChange} hero={<AcademyHero locale={locale}/>}>
  <main id="main">
   <section id="about" className={`${styles.wrap} ${styles.section} ${styles.whatItIs}`}><h2>{t("What we do","מה אנחנו עושים?")}</h2><p className={styles.lead}>{bilingual.about[locale]}</p></section>
   <section id="who-its-for" className={`${styles.photoSection} ${styles.audience}`}><AcademyScene slot="locations" locale={locale} className={styles.sectionBackdrop!}/><div className={`${styles.wrap} ${styles.section}`}><div className={styles.audienceCopy}><h2>{t("Who it’s for","למי זה מתאים?")}</h2><p className={styles.lead}>{bilingual.audience[locale]}</p></div></div></section>
   <section id="stages" className={styles.tint}><div className={`${styles.wrap} ${styles.section}`}><span id="how-it-works" aria-hidden="true"/><h2>{t("Four stages of fishing & leadership","ארבעה שלבים בדיג ובמנהיגות")}</h2><p>{bilingual.stageIntro[locale]}</p><div className={styles.stageGrid}>{academyStages.map((stage,index)=><article className={styles.stageCard} key={stage.slug} data-academy-stage-card={stage.slug}><AcademyScene slot={stageScenes[index]!} locale={locale}/><div className={styles.stageCardContent}><span className={styles.stageBadge}>{t(`Stage ${stage.number} · 12 sessions`,`שלב ${stage.number} · 12 מפגשים`)}</span><h3>{stage.title[locale]}</h3><p><strong>{stage.theme[locale]}</strong></p><p>{stage.summary[locale]}</p><a className={styles.button} href={academyHref(locale,`/stages/${stage.slug}`)}>{t("Explore this stage","להיכרות עם השלב")}</a></div></article>)}</div></div></section>


   <section id="self-governance" className={`${styles.photoSection} ${styles.gains}`}><AcademyScene slot="habitat" locale={locale} className={styles.sectionBackdrop!}/><div className={`${styles.wrap} ${styles.section}`}><h2>{t("What boys gain","מה הבנים מפתחים?")}</h2><p className={styles.lead}>{bilingual.gainIntro[locale]}</p><div className={styles.skillsGrid}>{academySelfGovernance.map((skill,index)=><article key={skill.title.en}><AcademyIcon name={(["plan","pause","reflect","conversation","values","leadership"] as const)[index]!}/><h3>{skill.title[locale]}</h3><p>{skill.body[locale]}</p></article>)}</div></div></section>
   <AcademyPricing locale={locale}/>
   <section id="questions" className={`${styles.wrap} ${styles.section}`}><h2>{t("Frequently asked questions","שאלות נפוצות")}</h2><div className={styles.faqList}>{faqGroups.map(group=><div className={styles.faqGroup} key={group.title}><h3>{group.title}</h3>{group.indexes.map(index=>{const item=academyQuestions[index]!;return <details id={index===4?"academy-travel-faq":index===3?"locations":undefined} className={styles.faq} key={item.question.en}><summary>{item.question[locale]}</summary><p>{item.answer[locale]}</p></details>;})}</div>)}</div></section>
   <section id="parent-reflections" className={styles.testimonial} aria-label={t("A parent’s testimonial","דברי הורה")} data-academy-testimonial-state="historical-reflection">
    <figure><img className={styles.testimonialPortrait} src="/groups/testimonials/l-bars-2024.png" width={2000} height={2000} loading="lazy" alt="L. Bars"/><div><blockquote lang="en" dir="ltr"><p>“Medication is no longer relevant.”</p></blockquote><figcaption><strong>L. Bars</strong><span>{t("Mother of a student · 2024 · Beit Shemesh","אמו של תלמיד · 2024 · בית שמש")}</span></figcaption></div></figure>
   </section>
   <section id="founder" className={styles.founderSection}><img className={styles.founderImage} src="/groups/people/founder-grass-group.webp" width={1600} height={1068} loading="lazy" alt={t("An outdoor discussion with a small group","שיחה בחוץ עם קבוצה קטנה")}/><div className={`${styles.wrap} ${styles.section} ${styles.founderGrid}`}><div className={styles.founderPanel}><img className={styles.founderHead} src="/groups/people/founder-head.jpg" width={720} height={720} loading="lazy" alt={t("Rabbi Shlomo Dratler","הרב שלמה דרטלר")}/><h2>{t("Meet Rabbi Shlomo Dratler","הכירו את הרב שלמה דרטלר")}</h2><p>{bilingual.founder[locale]}</p></div></div></section>
  </main>
 </AcademySiteFrame>;
}
