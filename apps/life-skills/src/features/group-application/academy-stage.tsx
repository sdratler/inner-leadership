"use client";
import {Fragment,useId,useSyncExternalStore} from 'react';
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {useAcademyHref} from './academy-route-context.tsx';
import type {Locale} from '../../lib/locale.ts';
import {AcademySiteFrame} from './academy-site-frame.tsx';
import {AcademyScene,type AcademySceneSlot} from './academy-scenes.tsx';
import {academyExactCurriculum,academyExactCopy} from './academy-exact-copy.ts';
import styles from './academy-site.module.css';
import {AcademyBidi} from './academy-bidi.tsx';

const ageKeys=['8–10','11–13','14–17'] as const;
const ageQueries=['8-10','11-13','14-17'] as const;
const ageChangeEvent='academy-curriculum-age-change';
export function academyAgeIndex(search:string){
 const values=new URLSearchParams(search).getAll('age');
 return values.length===1?Math.max(0,ageQueries.findIndex(age=>age===values[0])):0;
}
export function academyAgeHref(href:string,index:number){
 const age=ageQueries[index];
 return age&&index!==0?`${href}?age=${age}`:href;
}
function subscribeAge(onChange:()=>void){
 window.addEventListener('popstate',onChange);window.addEventListener(ageChangeEvent,onChange);
 return()=>{window.removeEventListener('popstate',onChange);window.removeEventListener(ageChangeEvent,onChange);};
}
const ageSnapshot=()=>window.location.search;
const serverAgeSnapshot=()=>'';
const sceneSlots:Record<string,AcademySceneSlot>={foundation:'foundation',independent:'independent',advanced:'advanced',leadership:'leadership'};

/** Native radio controls progressively enhance the complete server-rendered text.
 * They do not select eligibility or change the historical lesson identities. */
export function AcademyStage({locale,slug}:{locale:Locale;slug:string}){
 const academyHref=useAcademyHref(),campaign=useAcademyCampaign(),ageGroup=useId();
 const search=useSyncExternalStore(subscribeAge,ageSnapshot,serverAgeSnapshot),ageIndex=academyAgeIndex(search);
 function chooseAge(index:number){
  const age=ageQueries[index];if(!age)return;
  const url=new URL(window.location.href);url.searchParams.set('age',age);
  if(url.href===window.location.href)return;
  window.history.pushState(window.history.state,'',url.pathname+url.search+url.hash);
  window.dispatchEvent(new Event(ageChangeEvent));
 }
 function changeLocale(language:Locale){
  window.location.assign(academyAgeHref(academyHref(language,`/stages/${slug}`),ageIndex));
 }
 const stage=academyExactCurriculum.stages.find(item=>item.slug===slug),scene=sceneSlots[slug];
 if(!stage||!scene)return null;
 const common=academyExactCurriculum.common[locale],nav=academyExactCopy[locale].nav;
 return <AcademySiteFrame locale={locale} path={`/stages/${stage.slug}`} {...(ageIndex>0?{onLocaleChange:changeLocale}:{})}><main id="main" data-academy-stage-view={stage.slug}>
  <nav className={`${styles.wrap} ${styles.stageNav}`} aria-label={nav.curriculum} data-academy-curriculum-navigation>
   {academyExactCurriculum.stages.map((item,index)=><a key={item.slug} href={academyAgeHref(academyHref(locale,`/stages/${item.slug}`),ageIndex)} aria-current={item.slug===slug?'page':undefined}>{common.navigation[index]}</a>)}
  </nav>
  <section className={styles.stageIntro}><div className={styles.wrap}>
   <div className={styles.curriculumHero}>
    <div><p className={styles.eyebrow}><bdi>{String(academyExactCurriculum.stages.indexOf(stage)+1).padStart(2,'0')} / 04</bdi></p><h1>{stage.title[locale]}</h1><p className={styles.lead}>{stage.introduction[locale]}</p></div>
    <AcademyScene slot={scene} locale={locale}/>
   </div>
   <fieldset className={styles.curriculumAges}>
    <legend>{common.ageLabel}</legend>
    {ageKeys.map((age,index)=><Fragment key={age}>
     <input className={styles.curriculumAgeChoice} type="radio" name={ageGroup} id={`${ageGroup}-${index}`} value={age} data-age-choice={index} checked={index===ageIndex} onChange={()=>chooseAge(index)}/>
     <label className={styles.curriculumAgeLabel} htmlFor={`${ageGroup}-${index}`}><AcademyBidi>{common.ageTabs[index]!}</AcademyBidi></label>
    </Fragment>)}
    <div className={styles.curriculumAgePanels}>
     {ageKeys.map((age,index)=><section className={styles.curriculumAgePanel} key={age} data-age-panel={index} aria-labelledby={`${ageGroup}-heading-${index}`}>
      <h3 id={`${ageGroup}-heading-${index}`}><AcademyBidi>{common.ageTabs[index]!}</AcademyBidi></h3>
      <ul>{stage.agePanels[age][locale].map(paragraph=><li key={paragraph}>{paragraph}</li>)}</ul>
     </section>)}
    </div>
   </fieldset>
   <p className={styles.ageTerms}>{common.readinessNote}</p>
  </div></section>
  <section className={`${styles.wrap} ${styles.section}`} aria-labelledby="academy-progression-heading">
   <h2 id="academy-progression-heading">{common.progressionHeading}</h2>
   <p>{common.logisticsNote}</p>
   <ol className={styles.weekList} data-academy-lesson-list>
    {stage.lessons.map(lesson=><li key={lesson.rmId} value={lesson.number}>
     <strong aria-hidden="true"><AcademyBidi>{String(lesson.number)}</AcademyBidi></strong>
     <div><h3>{lesson.title[locale]}</h3><p>{lesson.description[locale]}</p></div>
    </li>)}
   </ol>
  </section>
  <div className={`${styles.wrap} ${styles.stageActions}`}><a className={styles.button} href={academyHref(locale,'/apply')} data-academy-curriculum-register>{campaign?.phase==='PRE_REGISTRATION'?nav.preRegister:nav.register}</a></div>
 </main></AcademySiteFrame>;
}
