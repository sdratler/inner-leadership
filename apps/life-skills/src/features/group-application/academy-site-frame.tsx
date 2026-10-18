"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import type {Locale} from "../../lib/locale.ts";
import {JlfaLogo,JLFA_TAGLINE} from "./jlfa-brand.tsx";
import {AcademyWhatsApp,ACADEMY_WHATSAPP} from "./academy-whatsapp.tsx";
import brand from "./jlfa-brand.module.css";
import styles from "./academy-site.module.css";
export {ACADEMY_WHATSAPP} from "./academy-whatsapp.tsx";
export function AcademySiteFrame({locale,children,hero,onLocaleChange,path="",intake=false,className=""}:{locale:Locale;children:ReactNode;hero?:ReactNode;onLocaleChange?:(locale:Locale)=>void;path?:string;intake?:boolean;className?:string}){
 const t=(en:string,he:string)=>locale==="he"?he:en,home=`/${locale}/florida`,[open,setOpen]=useState(false),menu=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null),site=useRef<HTMLDivElement>(null),header=useRef<HTMLElement>(null),[headerHidden,setHeaderHidden]=useState(false),[heroFailed,setHeroFailed]=useState(false);
 const links=[[home,t("Home","דף הבית")],[home+"#stages",t("Four stages","ארבעה שלבים")],[home+"#locations",t("Where we fish","איפה דגים")],[home+"/pricing",t("Pricing","מחירים")],[intake?"#questions":home+"#questions",t("FAQ","שאלות נפוצות")],[intake?"#academy-form":home+"/apply",t("Register","להרשמה")]];
 function close(restore=false){setOpen(false);if(restore)toggle.current?.focus();}
 useEffect(()=>{if(!open)return;menu.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  const pointer=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!toggle.current?.contains(event.target as Node)){setOpen(false);if(menu.current?.contains(document.activeElement)&&!(event.target as Element)?.closest?.("a,button,input,select,textarea,[tabindex]"))toggle.current?.focus({preventScroll:true});}};
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();setOpen(false);toggle.current?.focus();}};
  const resize=()=>{if(innerWidth>=900)setOpen(false);};document.addEventListener("pointerdown",pointer);document.addEventListener("keydown",escape);addEventListener("resize",resize);
  return()=>{document.removeEventListener("pointerdown",pointer);document.removeEventListener("keydown",escape);removeEventListener("resize",resize);};
 },[open]);
 useEffect(()=>{
  const node=header.current;if(!node)return;
  const measure=()=>site.current?.style.setProperty("--academy-header-height",`${node.getBoundingClientRect().height}px`);
  const observer=new ResizeObserver(measure);observer.observe(node);measure();
  let previous=scrollY,distance=0,frame=0;
  const update=()=>{frame=0;const current=Math.max(0,scrollY),delta=current-previous;previous=current;
   distance=delta*distance<0?delta:distance+delta;
   if(current<node.offsetHeight||open||node.contains(document.activeElement)){setHeaderHidden(false);distance=0;}
   else if(distance>12){setHeaderHidden(true);distance=0;}else if(distance< -8){setHeaderHidden(false);distance=0;}
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};addEventListener("scroll",schedule,{passive:true});
  return()=>{observer.disconnect();removeEventListener("scroll",schedule);if(frame)cancelAnimationFrame(frame);};
 },[open]);
 useEffect(()=>{const image=site.current?.querySelector<HTMLImageElement>("[data-academy-hero-image]");if(!image)return;const update=()=>setHeroFailed(image.complete&&image.naturalWidth===0);image.addEventListener("error",update);image.addEventListener("load",update);update();return()=>{image.removeEventListener("error",update);image.removeEventListener("load",update);};},[hero]);
 const languages=<div className={styles.languages} aria-label={t("Language","שפה")}>{(["en","he"] as const).map(language=>onLocaleChange?<button key={language} type="button" lang={language} aria-pressed={locale===language} onClick={()=>{onLocaleChange(language);if(open)close(true);else setOpen(false);}}>{language==="en"?"EN":"עברית"}</button>:<a key={language} href={`/${language}/florida${path}`} lang={language} aria-current={locale===language?"page":undefined}>{language==="en"?"EN":"עברית"}</a>)}</div>;
 return <div ref={site} className={`${brand.scope} ${styles.site} ${className}`} lang={locale} dir={locale==="he"?"rtl":"ltr"} data-academy-site data-hero-image-failed={heroFailed?"true":"false"} data-academy-full-inquiry={intake?"":undefined}>
  <a className={styles.skip} href={intake?"#academy-form":"#main"}>{t("Skip to content","דלגו לתוכן")}</a>
  <header ref={header} className={styles.header} data-academy-header data-hidden={headerHidden?"true":"false"} onFocusCapture={()=>setHeaderHidden(false)}><div className={styles.headerInner}><JlfaLogo locale={locale} homeHref={home} eager/>
   <nav className={styles.navigation} aria-label={t("Academy navigation","ניווט באקדמיה")}>{links.slice(0,5).map(([href,label])=><a key={href} href={href}>{label}</a>)}</nav>
   <div className={styles.desktopActions}>{languages}<a className={styles.headerAction} href={links[5]![0]}>{t("Register","להרשמה")}</a></div>
   <a className={styles.mobileRegister} href={links[5]![0]}>{t("Register","להרשמה")}</a><button ref={toggle} className={styles.menuToggle} type="button" aria-label={open?t("Close Academy menu","סגירת תפריט האקדמיה"):t("Open Academy menu","פתיחת תפריט האקדמיה")} aria-controls="academy-mobile-menu" aria-expanded={open} onClick={()=>{setHeaderHidden(false);setOpen(!open);}}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  </div><nav ref={menu} id="academy-mobile-menu" className={styles.mobileMenu} hidden={!open} aria-label={t("Mobile Academy navigation","ניווט באקדמיה לנייד")}>
   <button type="button" className={styles.menuClose} aria-label={t("Close menu","סגירת תפריט")} onClick={()=>close(true)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
   {links.map(([href,label])=><a key={href} href={href} onClick={()=>close()}>{label}</a>)}<a href={ACADEMY_WHATSAPP} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={()=>close()}>WhatsApp</a>{languages}
  </nav></header>{hero}{children}
  <footer className={styles.footer} data-academy-footer><div className={styles.footerInner}>
   <div className={styles.footerBrand}><JlfaLogo locale={locale} footer homeHref={home}/><p className={styles.footerName}>South Florida Jewish Leadership Fishing Academy</p><p className={styles.footerPillars}>{JLFA_TAGLINE}</p><p className={styles.nonprofit}>{t("A program of Bnei Neviim Academy, a New Jersey nonprofit.","תוכנית של אקדמיית בני נביאים, ארגון ללא כוונת רווח בניו ג׳רזי.")}</p></div>
   <nav className={styles.footerGroup} aria-label={t("Explore the Academy","להכיר את האקדמיה")}><h2>{t("Explore","להכיר")}</h2><a href={home}>{t("Home","דף הבית")}</a><a href={home+"#stages"}>{t("Four stages","ארבעה שלבים")}</a><a href={home+"#locations"}>{t("Where we fish","איפה דגים")}</a><a href={home+"/pricing"}>{t("Pricing & outings","מחירים ויציאות")}</a><a href={home+"#questions"}>{t("FAQ","שאלות נפוצות")}</a></nav>
   <nav className={styles.footerGroup} aria-label={t("Connect with the Academy","קשר עם האקדמיה")}><h2>{t("Let’s talk","בואו נדבר")}</h2><a className={styles.headerAction} href={home+"/apply"}>{t("Register / request a callback","הרשמה / בקשת שיחת חזרה")}</a><a className={styles.footerWhatsApp} href={ACADEMY_WHATSAPP} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("Message on WhatsApp","כתבו לנו בוואטסאפ")}</a><a href="https://bneineviimacademy.org/" target="_blank" rel="noopener noreferrer">Bnei Neviim Academy ↗</a></nav>
  </div></footer><AcademyWhatsApp locale={locale}/>
 </div>;
}
