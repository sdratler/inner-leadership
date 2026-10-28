"use client";
import {useAcademyHref,useAcademyRouteMode} from "./academy-route-context.tsx";
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
import {academyMetadata} from "./academy-metadata.ts";
import {useEffect,useRef,useState,type ReactNode} from "react";
import type {Locale} from "../../lib/locale.ts";
import {JlfaLogo} from "./jlfa-brand.tsx";
import {AcademyWhatsApp,ACADEMY_WHATSAPP} from "./academy-whatsapp.tsx";
import styles from "./academy-site.module.css";
export {ACADEMY_WHATSAPP} from "./academy-whatsapp.tsx";
export function AcademySiteFrame({locale,children,hero,onLocaleChange,path="",intake=false,className=""}:{locale:Locale;children:ReactNode;hero?:ReactNode;onLocaleChange?:(locale:Locale)=>void;path?:string;intake?:boolean;className?:string}){
 const copy=academyExactCopy[locale],academyHref=useAcademyHref(),routeMode=useAcademyRouteMode(),campaign=useAcademyCampaign(),pre=campaign?.phase==='PRE_REGISTRATION';
 const t=(en:string,he:string)=>locale==="he"?he:en,home=academyHref(locale),[open,setOpen]=useState(false),menu=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null),site=useRef<HTMLDivElement>(null),header=useRef<HTMLElement>(null),headerHidden=false,[heroFailed,setHeroFailed]=useState(false);
 const links=[[home,copy.nav.home],[home+"#stages",copy.nav.curriculum],[home+"/pricing",copy.nav.pricing],[home+"#questions",copy.nav.faq],[intake?"#academy-form":home+"/apply",pre?copy.nav.preRegister:copy.nav.register]];
 function close(restore=false){setOpen(false);if(restore)toggle.current?.focus();}
 useEffect(()=>{

  const meta=academyMetadata(locale,intake?"/apply":path,undefined,routeMode,campaign);
  document.title=meta.title;
  for(const [selector,attribute,value] of [
   ['meta[property="og:image"]','content',meta.openGraph.images[0]!.url],
   ['meta[name="twitter:image"]','content',meta.twitter.images[0]!],
  ]){let node=document.querySelector<HTMLMetaElement>(selector!);if(!node){node=document.createElement('meta');node.setAttribute(selector!.includes('property=')?'property':'name',selector!.split('"')[1]!);document.head.appendChild(node);}node.setAttribute(attribute!,value!);}

  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href",meta.alternates.canonical);
  for(const language of ["en","he"] as const)document.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${language}"]`)?.setAttribute("href",meta.alternates.languages[language]);
  for(const [selector,value] of [['meta[name="description"]',meta.description],['meta[property="og:title"]',meta.openGraph.title],['meta[property="og:description"]',meta.openGraph.description],['meta[property="og:url"]',meta.openGraph.url],['meta[property="og:locale"]',meta.openGraph.locale],['meta[name="twitter:title"]',meta.twitter.title],['meta[name="twitter:description"]',meta.twitter.description]])document.querySelector<HTMLMetaElement>(selector!)?.setAttribute("content",value!);
 },[locale,intake,path,routeMode,onLocaleChange,campaign,pre]);
 useEffect(()=>{if(!open)return;menu.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  const pointer=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!toggle.current?.contains(event.target as Node)){setOpen(false);if(menu.current?.contains(document.activeElement)&&!(event.target as Element)?.closest?.("a,button,input,select,textarea,[tabindex]"))toggle.current?.focus({preventScroll:true});}};
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();setOpen(false);toggle.current?.focus();}};
  const resize=()=>{if(innerWidth>=1000)setOpen(false);};document.addEventListener("pointerdown",pointer);document.addEventListener("keydown",escape);addEventListener("resize",resize);
  return()=>{document.removeEventListener("pointerdown",pointer);document.removeEventListener("keydown",escape);removeEventListener("resize",resize);};
 },[open]);
 useEffect(()=>{
  const node=header.current;if(!node)return;
  const measure=()=>site.current?.style.setProperty("--academy-header-height",`${node.getBoundingClientRect().height}px`);
  const observer=new ResizeObserver(measure);observer.observe(node);measure();
  return()=>observer.disconnect();
 },[open]);
 useEffect(()=>{const image=site.current?.querySelector<HTMLImageElement>("[data-academy-hero-image]");if(!image)return;const update=()=>setHeroFailed(image.complete&&image.naturalWidth===0);image.addEventListener("error",update);image.addEventListener("load",update);update();return()=>{image.removeEventListener("error",update);image.removeEventListener("load",update);};},[hero]);
 const languages=<div className={styles.languages} aria-label={t("Language","שפה")}>{(["en","he"] as const).map(language=>onLocaleChange?<button key={language} type="button" lang={language} aria-pressed={locale===language} onClick={()=>{onLocaleChange(language);if(open)close(true);else setOpen(false);}}>{language==="en"?"English":"עברית"}</button>:<a key={language} href={academyHref(language,path)} lang={language} aria-current={locale===language?"page":undefined}>{language==="en"?"English":"עברית"}</a>)}</div>;
 return <div ref={site} className={`${styles.site} ${className}`} lang={locale} dir={locale==="he"?"rtl":"ltr"} data-academy-site data-hero-image-failed={heroFailed?"true":"false"} data-academy-full-inquiry={intake?"":undefined}>
  <a className={styles.skip} href={intake?"#academy-form":"#main"}>{t("Skip to content","דלגו לתוכן")}</a>
  <header ref={header} className={styles.header} data-academy-header data-hidden={headerHidden?"true":"false"} ><div className={styles.headerInner}><JlfaLogo locale={locale} homeHref={home} eager/>
   <nav className={styles.navigation} aria-label={t("Academy navigation","ניווט באקדמיה")}>{links.slice(0,4).map(([href,label])=><a key={href} href={href}>{label}</a>)}</nav>
   <div className={styles.desktopActions}>{!intake&&languages}<a className={styles.headerAction} href={links[4]![0]}>{pre?copy.nav.preRegister:copy.nav.register}</a></div>
   <a className={styles.mobileRegister} href={links[4]![0]}>{pre?copy.nav.preRegister:copy.nav.register}</a><button ref={toggle} className={styles.menuToggle} type="button" aria-label={open?t("Close Academy menu","סגירת תפריט האקדמיה"):t("Open Academy menu","פתיחת תפריט האקדמיה")} aria-controls="academy-mobile-menu" aria-expanded={open} onClick={()=>{setOpen(!open);}}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  </div><nav ref={menu} id="academy-mobile-menu" className={styles.mobileMenu} hidden={!open} aria-label={t("Mobile Academy navigation","ניווט באקדמיה לנייד")}>
   <button type="button" className={styles.menuClose} aria-label={t("Close menu","סגירת תפריט")} onClick={()=>close(true)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
   {links.map(([href,label])=><a key={href} href={href} data-academy-registration-link={href===links[4]![0]?true:undefined} onClick={()=>close()}>{label}</a>)}<a href={ACADEMY_WHATSAPP} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={()=>close()}>{t("WhatsApp","וואטסאפ")}</a>{languages}
  </nav></header>{hero}{children}
  <footer className={styles.footer} data-academy-footer><div className={styles.footerInner}>
   <JlfaLogo locale={locale} footer homeHref={home}/>
   <p className={styles.nonprofit}>{copy.home.footerAttribution}</p>
   <a className={styles.headerAction} href={intake?"#academy-form":home+"/apply"}>{pre?copy.nav.preRegister:copy.nav.register}</a>
   <div className={styles.footerLinks}>{languages}<a href={ACADEMY_WHATSAPP} target="_blank" rel="noopener noreferrer">{t('Contact via WhatsApp','יצירת קשר בוואטסאפ')}</a><a href={intake?'#academy-program-terms':home+'/apply#academy-program-terms'}>{copy.form.sections.terms}</a></div>
  </div></footer>{!intake&&<AcademyWhatsApp locale={locale}/>}
 </div>;
}
