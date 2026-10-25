"use client";
import {useEffect,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {useAcademyHref} from './academy-route-context.tsx';
import {GroupApplicationForm} from './application-form.tsx';
import {AcademySiteFrame} from './academy-site-frame.tsx';
import styles from './academy-intake.module.css';
export function AcademyIntakePage({locale:initialLocale}:{locale:Locale}){
 const campaign=useAcademyCampaign(),pre=campaign?.phase==='PRE_REGISTRATION',academyHref=useAcademyHref(),[locale,setLocale]=useState(initialLocale),t=(en:string,he:string)=>locale==='he'?he:en;
 useEffect(()=>{document.documentElement.lang=locale;document.documentElement.dir=locale==='he'?'rtl':'ltr';},[locale]);
 function language(next:Locale){if(next===locale)return;setLocale(next);window.history.replaceState(window.history.state,'',academyHref(next,'/apply')+window.location.search+window.location.hash);}
 return <AcademySiteFrame locale={locale} onLocaleChange={language} intake className={styles.shell??''}>
  <main id="main" className={styles.main}><div className={styles.registrationHeading}><div className={styles.registrationLanguages} role="group" aria-label={t('Interface language','שפת הממשק')}><button type="button" lang="en" aria-pressed={locale==='en'} onClick={()=>language('en')}>English</button><span aria-hidden="true">|</span><button type="button" lang="he" aria-pressed={locale==='he'} onClick={()=>language('he')}>עברית</button></div><h1>{pre?t('Pre-register for free','הרשמה מוקדמת בחינם'):t('Registration','הרשמה')}</h1></div>
   <div id="apply"><section id="academy-form" className={styles.formSection} aria-label={t('Registration form','טופס הרשמה')}><GroupApplicationForm locale={locale} programId="sunday_fishing_academy" fullIntake/></section></div>
  </main>
 </AcademySiteFrame>;
}
