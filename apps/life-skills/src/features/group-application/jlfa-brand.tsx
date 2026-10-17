/* eslint-disable @next/next/no-img-element -- exact owner-approved PNG; only the explicitly approved header CSS window differs */
import type {ReactNode} from "react";
import coreCopy from "./jlfa-core-copy.json";
import {JlfaCurriculum} from "./jlfa-curriculum.tsx";
import type {Locale} from "../../lib/locale.ts";
import styles from "./jlfa-brand.module.css";

// Code-consumed projection of JLFA-BRAND-LOCK-20261016-01 and its current
// JLFA-WEB-SIMPLE-20261016-02 header exception, not a new asset master.
export const JLFA_NAME="South Florida Jewish Leadership Fishing Academy";
export const JLFA_TAGLINE="TORAH • FISHING • SELF-GOVERNANCE";
export const JLFA_LOGO_SRC="/groups/brand/jlfa-logo-locked-v1.png";
export const JLFA_LOGO_SHA256="e78ff6d3ef16c37613725507ce14da05883734a77f48b78ab9d6df3f92480356";
type Pair={en:string;he:string};
// JLFA-SESSION-3H-20261018-01: the complete regular meeting block.
const sessionCadence:Pair={en:"One three-hour group session each week. Twelve sessions per stage.",he:"מפגש קבוצתי אחד של שלוש שעות בכל שבוע. שנים־עשר מפגשים בכל שלב."};
function JlfaSessionCadence({locale}:{locale:Locale}){return <p data-jlfa-session-cadence><strong>{sessionCadence[locale]}</strong></p>;}
export function JlfaLogo({locale,footer=false}:{locale:Locale;footer?:boolean}){
 const image=<img src={JLFA_LOGO_SRC} width={1254} height={1254} alt={footer?`${JLFA_NAME} — ${JLFA_TAGLINE}`:JLFA_NAME}/>;
 return <a href="#main" className={`${styles.logoLink} ${footer?styles.footerLogo:styles.headerLogo}`} aria-label={`${JLFA_NAME} — ${locale==="he"?"דף הבית":"home"}`}
  data-jlfa-header-logo={footer?undefined:"true"} data-jlfa-footer-logo={footer?"true":undefined}>
  {footer?image:<span className={styles.headerWindow} data-jlfa-logo-window="0,100,1254,1000">{image}</span>}
 </a>;
}
export function JlfaHeroPlaceholder({locale}:{locale:Locale}){
 return <div className={styles.heroPlaceholder} role="img" aria-label={locale==="he"?"מקום שמור לתמונת פתיחה שעדיין בעבודה":"Placeholder for unfinished hero artwork"}>
  <span>{locale==="he"?"תמונת הפתיחה עדיין בעבודה":"HERO ARTWORK IN PROGRESS"}</span><strong aria-hidden="true">＋</strong>
  <p>{locale==="he"?"התמונה הסופית תוצב כאן לאחר אישור.":"Final hero artwork will be placed here after approval."}</p>
 </div>;
}
type JlfaFaqGroup={en:string;he:string;indexes:readonly number[]};
export function JlfaFaq({locale,faqs,groups:suppliedGroups}:{locale:Locale;faqs:readonly(readonly[Pair,Pair])[];groups?:readonly JlfaFaqGroup[]}){
 const groups=suppliedGroups??[{en:"Getting started",he:"מתחילים",indexes:[0,1,2]},
  {en:"Equipment, locations & outings",he:"ציוד, מקומות ויציאות",indexes:[3,4,5]},
  {en:"Practical arrangements",he:"פרטים מעשיים",indexes:faqs.map((_,i)=>i).filter(i=>i>=6)}];
 return <>{groups.map(group=><details key={group.en} className={styles.faqGroup} data-jlfa-faq-group>
  <summary>{group[locale]}</summary><div>{group.indexes.filter(i=>faqs[i]).map(i=>{const[question,answer]=faqs[i]!;return <details key={question.en} className={styles.faqQuestion} data-jlfa-faq-question={i}>
   <summary>{question[locale]}</summary><p>{answer[locale]}</p></details>;})}</div>
 </details>)}</>;
}
export type JlfaCurriculumContentProps={title:string;intro:string;cards:readonly{title:string;body:string}[];skills:{title:string;body:string;items:readonly string[]}};
/** Only the existing public overview belongs here; never a teacher/family DTO. */
export function JlfaCurriculumContent({title,intro,cards,skills}:JlfaCurriculumContentProps){
 return <div className={styles.curriculumContent} data-jlfa-curriculum-content>
  <h3>{title}</h3><p>{intro}</p><div className={styles.curriculumCards}>{cards.map(card=><article key={card.title} data-jlfa-stage><h4>{card.title}</h4><p>{card.body}</p></article>)}</div>
  <section><h3>{skills.title}</h3><p>{skills.body}</p><ul>{skills.items.map(item=><li key={item}>{item}</li>)}</ul></section>
 </div>;
}

/** Public core-program copy only: accepted V4 English and reviewed translation.
 * Separate academic materials, instructor keys and family DTOs never enter here. */
const coreNode=(index:number)=>coreCopy.nodes[index]!;
const coreText=(index:number,locale:Locale)=>coreNode(index)[locale];
const coreStageIndexes=[[26,27,28,29,30],[31,32,33,34,35],[36,37,38,39,40],[41,42,43,44,45]] as const;
export const JLFA_CORE_FAQS=Array.from({length:11},(_,i)=>[coreNode(76+i*2),coreNode(77+i*2)] as const);
const coreFaqGroups=[{en:"Getting started",he:"מתחילים",indexes:[0,3,6,9,10]},
 {en:"Equipment, locations & outings",he:"ציוד, מקומות ויציאות",indexes:[1,2,4]},
 {en:"Practical arrangements",he:"פרטים מעשיים",indexes:[5,7,8]}];

export function JlfaCoreProgram({locale}:{locale:Locale}){
 const p=(index:number)=>coreText(index,locale);
 return <div className={`${styles.curriculumContent} ${styles.coreProgram}`} data-jlfa-curriculum-content>
  <h3>{p(24)}</h3><p>{p(25)}</p><JlfaSessionCadence locale={locale}/><div className={styles.curriculumCards}>{coreStageIndexes.map(indexes=><article key={indexes[0]} data-jlfa-stage>
   <h4>{p(indexes[0])}</h4>{indexes.slice(1).map(index=><p key={index} data-jlfa-copy-node={index}>{p(index)}</p>)}</article>)}</div>
  <section><h3>{p(46)}</h3>{[[47,48,49],[50,51],[52,53]].map(indexes=><div key={indexes[0]}><h4>{p(indexes[0]!)}</h4>{indexes.slice(1).map(index=><p key={index}>{p(index)}</p>)}</div>)}<p>{p(54)}</p></section>
  <section><h3>{p(55)}</h3><p>{p(56)}</p><p>{p(57)}</p></section>
  <section><h3>{p(58)}</h3><p>{p(59)}</p><ul>{[60,61,62,63,64,65].map(index=><li key={index} data-jlfa-skill>{p(index)}</li>)}</ul><p>{p(66)}</p></section>
  <section><h3>{p(67)}</h3>{[68,69,70].map(index=><p key={index}>{p(index)}</p>)}</section>
 </div>;
}

export function JlfaCoreMain({locale,form,school}:{locale:Locale;form:ReactNode;school:ReactNode}){
 const p=(index:number)=>coreText(index,locale),[name,place,tagline]=p(0).split("\n"),explore=p(3).split("  |  ")[1]!;
 return <>
  <section className={`${styles.hero} ${styles.coreHero}`}><div className={`${styles.coreWrap} ${styles.heroGrid}`}>
   <div><h1>{name}</h1><p className={styles.corePlace}>{place}</p><p className={styles.heroLead}>{tagline}</p><p className={styles.corePillars}>{JLFA_TAGLINE}</p><p>{p(1)}</p><JlfaSessionCadence locale={locale}/><p>{p(2)}</p>
    <div className={styles.coreActions}><a className={styles.corePrimary} data-jlfa-primary href="#apply">{p(103)}</a><JlfaCurriculum locale={locale} label={explore} title={locale==="he"?"סקירת התוכנית":"Program overview"}><JlfaCoreProgram locale={locale}/></JlfaCurriculum></div>
   </div>
  </div></section>
  <section id="about" className={`${styles.coreWrap} ${styles.coreSection}`}><h2>{p(4)}</h2><p>{p(5)}</p><p>{p(6)}</p>
   <details className={styles.coreDisclosure}><summary>{p(7)}</summary>{[8,9,10].map(index=><p key={index}>{p(index)}</p>)}</details>
   <details className={styles.coreDisclosure}><summary>{p(11)}</summary>{[12,14,16,18,20,22].map(index=><section key={index}><h3>{p(index)}</h3><p>{p(index+1)}</p></section>)}</details>
  </section>
  <section id="outings" className={styles.coreTint}><div className={`${styles.coreWrap} ${styles.coreSection}`}><h2>{p(71)}</h2>{[72,73,74].map(index=><p key={index}>{p(index)}</p>)}</div></section>
  <section id="questions" className={`${styles.faq} ${styles.coreFaq}`}><div className={`${styles.coreWrap} ${styles.coreSection}`}><h2>{p(75)}</h2><div className={styles.coreFaqList}><JlfaFaq locale={locale} faqs={JLFA_CORE_FAQS} groups={coreFaqGroups}/></div></div></section>
  <section className={`${styles.coreWrap} ${styles.coreSection}`}><h2>{p(98)}</h2><p>{p(99)}</p><p>{p(100)}</p></section>
  <section id="apply" className={styles.coreTint}><div className={`${styles.coreWrap} ${styles.coreSection} ${styles.coreApply}`}><div><h2>{p(101)}</h2><p>{p(102)}</p><p>{p(104)}</p></div>{form}</div></section>
  <section className={`${styles.coreWrap} ${styles.coreSection}`}>{school}</section>
 </>;
}
