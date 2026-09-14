'use client';
import { useEffect,useState,type MouseEventHandler,type ReactNode } from 'react';
import { direction } from '../../lib/locale.ts';
import type { Locale,WorkspaceRole,Destinations } from './model.ts';
import { localHref } from './model.ts';
import { uiCopy } from './i18n.ts';
type NavLeaf={key:string;label:string;href:string|undefined};
type NavSection={key:string;label:string;children:readonly NavLeaf[]};

function NavItem({label,href,current,onClick}: {label:string;href:string|undefined;current:boolean;onClick?:MouseEventHandler<HTMLAnchorElement>}) {return href?<a href={localHref(href)} aria-current={current?'page':undefined} onClick={onClick}>{label}</a>:<span aria-disabled="true">{label}</span>;}

function sections(locale:Locale,role:WorkspaceRole,destinations:Destinations):NavSection[] {
 const t=uiCopy(locale);
 if(role==='parent')return [
  {key:'home',label:t.home,children:[{key:'overview',label:t.overview,href:destinations.home}]},
  {key:'practice',label:t.practice,children:[{key:'practice',label:t.currentPractice,href:destinations.practice},{key:'coordination',label:t.practiceHistory,href:'#coordination'},{key:'controls',label:t.resources,href:'#controls'}]},
  {key:'feedback',label:t.feedback,children:[{key:'feedback',label:t.parentReports,href:destinations.feedback},{key:'summary',label:t.practitionerReplies,href:'#summary'}]},
  {key:'schedule',label:t.schedule,children:[{key:'schedule',label:t.appointments,href:destinations.schedule},{key:'schedule-action',label:t.rescheduleAppointment,href:destinations.schedule}]},
 ];
 return [
  {key:'calendar',label:t.calendar,children:[{key:'calendar',label:t.today,href:destinations.calendar}]},
  {key:'practice-management',label:t.practiceManagement,children:[{key:'table',label:t.clients,href:destinations.clients},{key:'feedback',label:t.parentFeedback,href:destinations.feedback},{key:'practice',label:t.homePractice,href:destinations.practice},{key:'controls',label:t.forms,href:destinations.forms}]},
  {key:'payments',label:t.payments,children:[{key:'credit',label:t.payments,href:destinations.payments}]},
 ];
}

function sectionIsActive(section:NavSection,active:string) {return section.children.some(child=>child.key===active);}

function NavSectionView({section,active,onNavigate}: {section:NavSection;active:string;onNavigate?:MouseEventHandler<HTMLAnchorElement>}) {
 const selected=sectionIsActive(section,active);
 return <details className="lsw-nav-section" open={selected}><summary><span>{section.label}</span><span aria-hidden="true">⌄</span></summary><div>{section.children.map(child=><NavItem key={child.key} label={child.label} href={child.href} current={child.key===active} onClick={onNavigate}/>)}</div></details>;
}

function activeHash(current:string) {return typeof window==='undefined'?current:window.location.hash.slice(1)||current;}

function Navigation({locale,role,destinations,current,mobile=false}: {locale:Locale;role:WorkspaceRole;destinations:Destinations;current:string;mobile?:boolean}) {
 const t=uiCopy(locale),[active,setActive]=useState(current),items=sections(locale,role,destinations);
 useEffect(()=>{const sync=()=>setActive(activeHash(current));sync();window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync);};},[current]);
 const closeMobileDrawer:MouseEventHandler<HTMLAnchorElement>|undefined=mobile?event=>{const drawer=event.currentTarget.closest('details.lsw-mobile-drawer');if(drawer instanceof HTMLDetailsElement)drawer.open=false;}:undefined;
 const content=<nav className="lsw-nav-sections" aria-label={t.navigation}>{items.map(section=><NavSectionView key={section.key} section={section} active={active} onNavigate={closeMobileDrawer}/>)}</nav>;
 if(mobile)return <details className="lsw-mobile-drawer"><summary aria-label={t.menu}><span aria-hidden="true">☰</span><span>{t.menu}</span></summary><div className="lsw-mobile-drawer__panel">{content}</div></details>;
 return <aside className="lsw-sidebar"><p className="lsw-eyebrow">{role==='parent'?t.parentSpace:t.practitionerSpace}</p>{content}</aside>;
}

function AccountMenu({locale,account}: {locale:Locale;account?:ReactNode}) {
 const t=uiCopy(locale);return <details className="lsw-account-menu"><summary aria-label={t.accountMenu}><span aria-hidden="true" className="lsw-avatar">A</span><span className="lsw-visually-hidden">{t.account}</span></summary><div className="lsw-account-menu__panel"><p>{t.account}</p>{account}<a href="#preferences">{t.notificationPreferences}</a></div></details>;
}

function ChildContext({locale,context}: {locale:Locale;context?:ReactNode}) {
 const t=uiCopy(locale),[selected,setSelected]=useState('synthetic-child-a');
 useEffect(()=>{const sync=()=>{const value=new URLSearchParams(window.location.search).get('child');setSelected(value==='synthetic-child-b'?'synthetic-child-b':'synthetic-child-a');};sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
 const update=(value:string)=>{const url=new URL(window.location.href);url.searchParams.set('child',value);window.history.pushState({},'',url);setSelected(value);};
 return <div className="lsw-context"><label className="lsw-context-selector" htmlFor="lsw-child-context"><span>{t.childContext}</span><select id="lsw-child-context" value={selected} onChange={event=>update(event.target.value)}><option value="synthetic-child-a">{t.childA}</option><option value="synthetic-child-b">{t.childB}</option></select></label>{context&&<span className="lsw-context-note">{context}</span>}</div>;
}

function LanguageLink({locale,href}: {locale:Locale;href:string}) {
 const t=uiCopy(locale);return <a lang={locale==='he'?'en':'he'} hrefLang={locale==='he'?'en':'he'} href={localHref(href)} onClick={event=>{const child=new URLSearchParams(window.location.search).get('child');if(!child)return;event.preventDefault();const target=new URL(href,window.location.origin);target.searchParams.set('child',child);target.hash=window.location.hash;window.location.assign(target);}}>{t.language}</a>;
}

export function AppShell({locale,role,current,destinations,children,account,languageHref,context,attention}: {locale:Locale;role:WorkspaceRole;current:string;destinations:Destinations;children:ReactNode;account?:ReactNode;languageHref?:string;context?:ReactNode;attention?:ReactNode}) {
 const t=uiCopy(locale);return <div className={`lsw lsw-shell lsw-shell--${role}`} lang={locale} dir={direction(locale)}><a className="lsw-skip" href="#lsw-main">{t.skip}</a><header className="lsw-topbar"><div className="lsw-brand"><span aria-hidden="true" className="lsw-brand-mark">L</span><div><b translate="no" dir="ltr">{t.brand}</b><span>{role==='parent'?t.parentSpace:t.practitionerSpace}</span></div></div><div className="lsw-header-actions">{languageHref&&<LanguageLink locale={locale} href={languageHref}/>}<AccountMenu locale={locale} account={account}/><Navigation locale={locale} role={role} current={current} destinations={destinations} mobile/></div></header><Navigation locale={locale} role={role} current={current} destinations={destinations}/><div className={`lsw-workarea ${attention?'lsw-workarea--with-rail':''}`}><main id="lsw-main" tabIndex={-1} className="lsw-main">{role==='parent'?<ChildContext locale={locale} context={context}/>:context&&<div className="lsw-context">{context}</div>}{children}</main>{attention&&<aside className="lsw-rail">{attention}</aside>}</div></div>;
}