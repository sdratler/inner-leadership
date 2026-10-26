"use client";
import {useLayoutEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {useAcademyHref} from "./academy-route-context.tsx";
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
import styles from './academy-site.module.css';
/** Packet05 supersedes baked typography. Approved photo bytes stay unchanged. */
export function AcademyHero({locale}:{locale:Locale}){
 const copy=academyExactCopy[locale],href=useAcademyHref(),campaign=useAcademyCampaign(),pre=campaign?.phase==='PRE_REGISTRATION',t=(en:string,he:string)=>locale==='he'?he:en;
 const art=useRef<HTMLDivElement>(null),[enlarged,setEnlarged]=useState(false);
 useLayoutEffect(()=>{const node=art.current,image=node?.querySelector('img'),heading=node?.querySelector<HTMLElement>('[data-hero-heading]'),actions=node?.querySelector<HTMLElement>('[data-hero-actions]');if(!node||!image||!heading||!actions)return;
  const measure=()=>{if(!image.naturalWidth)return;const photoHeight=node.clientWidth*image.naturalHeight/image.naturalWidth;setEnlarged(heading.getBoundingClientRect().height>photoHeight*.3||actions.getBoundingClientRect().height>photoHeight*.34);};
  const observer=new ResizeObserver(measure);observer.observe(heading);observer.observe(actions);observer.observe(image);image.addEventListener('load',measure);measure();return()=>{observer.disconnect();image.removeEventListener('load',measure);};
 },[]);

 return <section className={styles.hero} aria-labelledby="academy-title" data-academy-hero data-campaign-phase={campaign?.phase??'UNAVAILABLE'}><div ref={art} className={styles.heroArt} data-enlarged={enlarged?'true':'false'}>
  <picture><source media="(min-width:768px)" srcSet="/groups/academy/hero-desktop-20261018.png" width={2048} height={1143}/><img src="/groups/academy/hero-mobile-20261018.png" width={1143} height={2048} alt={t('An adult and a boy talking at a fishing bridge, with the deck and railing visible','מבוגר וילד משוחחים על גשר דיג, לצד משטח ההליכה והמעקה')} fetchPriority="high" decoding="async" data-academy-hero-image/></picture>
  <div className={styles.heroHeading} data-hero-heading lang="en" dir="ltr"><p className={styles.heroLocation}>South Florida</p><h1 id="academy-title" lang="en" dir="ltr" aria-label={copy.hero.accessibleName}><span>Jewish Leadership</span><span>Fishing Academy</span></h1></div>
  <div className={styles.heroSelectedAction} data-hero-actions><p className={styles.heroProgram}>{copy.hero.pillars}</p><a className={styles.heroCta} href={href(locale,"/apply")} data-jlfa-primary="true">{pre?copy.nav.preRegister:copy.nav.register}</a>{pre&&<p className={styles.heroOffer}>{copy.hero.offer}</p>}</div>
 </div></section>;
}
