/* eslint-disable @next/next/no-img-element -- exact owner-approved PNG; only the explicitly approved header CSS window differs */
import type {Locale} from "../../lib/locale.ts";
import styles from "./jlfa-brand.module.css";

// Code-consumed projection of JLFA-BRAND-LOCK-20261016-01 and its current
// JLFA-WEB-SIMPLE-20261016-02 header exception, not a new asset master.
export const JLFA_NAME="South Florida Jewish Leadership Fishing Academy";
export const JLFA_TAGLINE="TORAH • FISHING • SELF-GOVERNANCE";
export const JLFA_LOGO_SRC="/groups/brand/jlfa-logo-locked-v1.png";
export const JLFA_LOGO_SHA256="e78ff6d3ef16c37613725507ce14da05883734a77f48b78ab9d6df3f92480356";
type Pair={en:string;he:string};
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
export function JlfaFaq({locale,faqs}:{locale:Locale;faqs:readonly(readonly[Pair,Pair])[]}){
 const groups=[{en:"Getting started",he:"מתחילים",indexes:[0,1,2]},
  {en:"Equipment, locations & outings",he:"ציוד, מקומות ויציאות",indexes:[3,4,5]},
  {en:"Practical arrangements",he:"פרטים מעשיים",indexes:faqs.map((_,i)=>i).filter(i=>i>=6)}];
 return <>{groups.map(group=><details key={group.en} className={styles.faqGroup} data-jlfa-faq-group>
  <summary>{group[locale]}</summary><div>{group.indexes.filter(i=>faqs[i]).map(i=>{const[question,answer]=faqs[i]!;return <details key={question.en} className={styles.faqQuestion} data-jlfa-faq-question>
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
