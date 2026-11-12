'use client';
import type {ReactNode} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import type {Locale} from '../../lib/locale.ts';
import {FishingOwnerNavigation} from './fishing-owner-navigation.tsx';
import type {FishingOwnerAvailability,FishingOwnerDestination} from './fishing-owner-navigation-model.ts';
import styles from './fishing-owner-shell.module.css';
const current:Readonly<Record<string,FishingOwnerDestination>>={
 'group-applications':'inquiries',clients:'family_contacts','fishing-groups':'groups_calendar',marketing:'marketing',settings:'settings',
};
/** Scope/availability arrive from the guarded server. Pathname changes only
 * highlighting and a same-origin language link, never authorization. */
export function FishingOwnerShell({locale,availability,children}:{locale:Locale;availability:FishingOwnerAvailability;children:ReactNode}){
 const path=usePathname(),query=useSearchParams(),other=locale==='he'?'en':'he',key=current[path.split('/')[3]??''];
 const languageHref=path.replace(/^\/(en|he)(?=\/|$)/,`/${other}`)+(query.size?'?'+query.toString():'');
 return <div className={styles.root} lang={locale} dir={locale==='he'?'rtl':'ltr'} data-fishing-owner-shell="true">
  <header className={styles.header}><strong>{locale==='he'?'אקדמיית הדיג':'Fishing Academy'}</strong>
   <a href={languageHref} hrefLang={other} lang={other}>{other==='he'?'עברית':'English'}</a></header>
  <div className={styles.layout}><FishingOwnerNavigation mode="fishing_owner" locale={locale} availability={availability}
   {...(key?{currentDestination:key}:{})} unavailableAreas={{overview:{state:'unavailable',reason:'not_connected'},billing:{state:'unavailable',reason:'not_connected'},communications:{state:'unavailable',reason:'not_connected'}}}/>
   <div className={styles.content}>{children}</div></div>
 </div>;
}
