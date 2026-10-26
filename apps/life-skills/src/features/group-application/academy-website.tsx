"use client";
/* eslint-disable @next/next/no-img-element -- exact existing founder photographs */
import {useEffect} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {useAcademyHref} from './academy-route-context.tsx';
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
import {AcademySiteFrame} from './academy-site-frame.tsx';
import {AcademyHero} from './academy-hero.tsx';
import {AcademyPricing} from './academy-pricing.tsx';
import {AcademyScene,AcademyIcon,type AcademySceneSlot} from './academy-scenes.tsx';
import styles from './academy-site.module.css';
const stageScenes:AcademySceneSlot[]=['foundation','independent','advanced','leadership'];
export function AcademyWebsite({locale,onLocaleChange}:{locale:Locale;onLocaleChange:(locale:Locale)=>void}){
 const href=useAcademyHref(),copy=academyExactCopy[locale].home,pre=useAcademyCampaign()?.phase==='PRE_REGISTRATION';
 const t=(en:string,he:string)=>locale==='he'?he:en;
 useEffect(()=>{const open=()=>{try{const id=decodeURIComponent(location.hash.slice(1)),node=document.getElementById(id);if(node instanceof HTMLDetailsElement){node.open=true;node.scrollIntoView({block:'start'});}}catch{}};open();addEventListener('hashchange',open);return()=>removeEventListener('hashchange',open);},[]);
 useEffect(()=>{if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);if(!matchMedia('(prefers-reduced-motion:reduce)').matches)entry.target.animate([{opacity:.85,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,easing:'ease-out'});}},{threshold:.08});document.querySelectorAll('[data-academy-site] main>section').forEach(node=>observer.observe(node));return()=>observer.disconnect();},[]);
 return <AcademySiteFrame locale={locale} onLocaleChange={onLocaleChange} hero={<AcademyHero locale={locale}/>}>
  <main id="main">
   <section id="about" className={`${styles.wrap} ${styles.section} ${styles.whatItIs}`}><h2>{copy.aboutHeading}</h2><p className={styles.lead}>{copy.aboutLead}</p><p>{copy.aboutSupporting}</p></section>
   <section id="who-its-for" className={styles.audience}><div className={`${styles.wrap} ${styles.section}`}><h2>{copy.audienceHeading}</h2><p>{copy.audience}</p></div></section>
   <section id="self-governance" className={styles.gains}><div className={`${styles.wrap} ${styles.section}`}><h2>{copy.gainsHeading}</h2><div className={styles.skillsGrid}>{copy.gains.map((skill,index)=><article key={skill.title}><AcademyIcon name={(['gear','reflect','pause','conversation','values','leadership'] as const)[index]!}/><h3>{skill.title}</h3><p>{skill.body}</p></article>)}</div></div></section>
   <section id="how-it-works" className={`${styles.wrap} ${styles.section}`}><h2>{copy.journeyHeading}</h2><ol className={styles.journey}>{copy.journey.map((step,index)=><li key={index}><span aria-hidden="true">{index+1}</span><h3>{index===0&&!pre?copy.journeyRegularFirstTitle:step.title}</h3><p>{step.body}</p></li>)}</ol></section>
   <section id="stages" className={`${styles.wrap} ${styles.section}`}><h2>{copy.stagesHeading}</h2><p>{copy.stagesIntro}</p><div className={styles.stageGrid}>{copy.stageCards.map((stage,index)=><article className={styles.stageCard} key={stage.slug} data-academy-stage-card={stage.slug}><AcademyScene slot={stageScenes[index]!} locale={locale}/><div className={styles.stageCardContent}><h3>{stage.title}</h3><p><strong>{stage.tagline}</strong></p><p>{stage.body}</p><a className={styles.button} href={href(locale,`/stages/${stage.slug}`)}>{stage.linkLabel}</a></div></article>)}</div></section>
   <AcademyPricing locale={locale}/>
   <section id="questions" className={`${styles.wrap} ${styles.section}`}><h2>{copy.faqHeading}</h2><div className={styles.faqList}>{copy.faq.map(item=>{const content=item.id==='after-registration'&&!pre?copy.regularFollowup:item;return <details id={item.id} className={styles.faq} key={item.id}><summary>{content.question}</summary><p>{content.answer}</p></details>;})}</div></section>
   <section id="parent-reflections" className={styles.testimonial} aria-label={t("A parent’s testimonial","דברי הורה")} data-academy-testimonial-state="historical-reflection">
    <figure><img className={styles.testimonialPortrait} src="/groups/testimonials/l-bars-2024.png" width={2000} height={2000} loading="lazy" alt="L. Bars"/><div><blockquote lang="en" dir="ltr"><p>“Medication is no longer relevant.”</p></blockquote><figcaption><strong>L. Bars</strong><span>{t("Mother of a student · 2024 · Beit Shemesh","אמו של תלמיד · 2024 · בית שמש")}</span></figcaption></div></figure>
   </section>
   <section id="founder" className={styles.founderSection}><img className={styles.founderImage} src="/groups/people/founder-grass-group.webp" width={1600} height={1068} loading="lazy" alt={t('An outdoor discussion with a small group','שיחה בחוץ עם קבוצה קטנה')}/><div className={`${styles.wrap} ${styles.section} ${styles.founderGrid}`}><div className={styles.founderPanel}><img className={styles.founderHead} src="/groups/people/founder-head.jpg" width={720} height={720} loading="lazy" alt={t('Rabbi Shlomo Dratler','הרב שלמה דרטלר')}/><h2>{copy.founderHeading}</h2><p>{copy.founderBody}</p></div></div></section>
  </main>
 </AcademySiteFrame>;
}
