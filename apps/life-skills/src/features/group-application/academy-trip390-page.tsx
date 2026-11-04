/* eslint-disable @next/next/no-img-element -- consume protected original asset bytes */
'use client';
import React, {useEffect, useRef, useState} from 'react';
import {trip390Copy, trip390CitySuggestions, trip390CommandSchema, TRIP390_INTEREST_VERSION, TRIP390_NOTICE_VERSION, TRIP390_OFFER, type Trip390Command} from './academy-trip390-contract.ts';
import site from './academy-site.module.css';
import styles from './academy-trip390.module.css';
import heroAssets from './academy-hero-assets.json';
import sceneAssets from './academy-scenes.json';

export type Trip390SaveResult =
 | {state:'saved'; operationId:string; reference:string; email:'pending'|'not_queued'}
 | {state:'unknown'} | {state:'conflict'}
 /** Only an authoritative rejection may unlock editing. Transport errors are UNKNOWN. */
 | {state:'rejected'; reason:'invalid'|'unavailable'};

type ChildDraft = {id:string; name:string; age:string; experience:string};
type ContactObstacle = Pick<DOMRect,'left'|'right'|'top'|'bottom'> & {gap:number; kind:'control'|'photo'|'text'};
const navigation = ['how', 'learn', 'included', 'dates', 'faq'] as const;
// F10 authorizes these existing illustrations for this offer's supporting
// sections. The catalog remains byte/dimension provenance, not new copy or
// historical-stage authority; no generated replacements or venue-photo claim.
function supportingScene(slot:'foundation'|'advanced'|'advanced-mobile'|'form') {
 const asset=sceneAssets.assets.find(item=>item.slot===slot);
 if(!asset)throw new Error('TRIP390_SUPPORTING_ASSET_REQUIRED');
 return asset;
}
const preparationScene=supportingScene('foundation');
const knowledgeScene=supportingScene('advanced');
const knowledgeMobileScene=supportingScene('advanced-mobile');
const outingScene=supportingScene('form');

/** Candidate frontend. The existing integrator owns route mounting and the
 * admitted transport. Never map this payload into fabricated legacy fields. */
export function AcademyTrip390Page({initialLocale='en', initialOpen=false, submitInterest}: {
 initialLocale?:'en'|'he'; initialOpen?:boolean; submitInterest?:(command:Trip390Command)=>Promise<Trip390SaveResult>;
}) {
 const [locale, setLocale] = useState(initialLocale);
 const [children, setChildren] = useState<ChildDraft[]>([{id:'first', name:'', age:'', experience:'new'}]);
 const [city, setCity] = useState('');
 const [menuOpen, setMenuOpen] = useState(false);
 const [activeSection, setActiveSection] = useState('');
 const [result, setResult] = useState<Trip390SaveResult|null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [errorTarget, setErrorTarget] = useState('');
 const [whatsapp, setWhatsapp] = useState(false);
 const [heroReflow, setHeroReflow] = useState(false);
 const [dialogOpen, setDialogOpen] = useState(false);
 const operation = useRef<Trip390Command|null>(null);
 const inFlight = useRef(false);
 const form = useRef<HTMLFormElement>(null);
 const menuButton = useRef<HTMLButtonElement>(null);
 const errorSummary = useRef<HTMLParagraphElement>(null);
 const savedSummary = useRef<HTMLDivElement>(null);
 const hero = useRef<HTMLElement>(null);
 const page = useRef<HTMLDivElement>(null);
 const header = useRef<HTMLElement>(null);
 const dialog = useRef<HTMLDialogElement>(null);
 const dialogTitle = useRef<HTMLHeadingElement>(null);
 const contact = useRef<HTMLAnchorElement>(null);
 const dialogReturn = useRef<{element:HTMLElement|null; x:number; y:number; url:string; pushed:boolean}|null>(null);
 const copy = trip390Copy[locale];
 const t = (en:string, he:string) => locale==='he' ? he : en;
 const unresolved = result?.state==='unknown';
 const saved = result?.state==='saved';
 const locked = busy || unresolved || result?.state==='conflict';
 const interestLabel=copy.hero.interest_cta;

 function openInterest(event?:React.MouseEvent<HTMLElement>) {
  event?.preventDefault();
  if (dialog.current?.open) return;
  const url=new URL(window.location.href);
  const pushed=url.hash!=='#interest'&&url.hash!=='#academy-form';
  dialogReturn.current={element:event?.currentTarget??(document.activeElement instanceof HTMLElement?document.activeElement:null),x:window.scrollX,y:window.scrollY,url:url.pathname+url.search+url.hash,pushed};
  if(pushed){url.hash='interest';window.history.pushState({...window.history.state,academyTrip390Dialog:true},'',url.pathname+url.search+url.hash);}
  setMenuOpen(false);setDialogOpen(true);
 }
 function closeInterest() {
  setDialogOpen(false);
  const previous=dialogReturn.current;
  if(previous?.pushed){previous.pushed=false;window.history.back();}
  else if(['#interest','#academy-form'].includes(window.location.hash)){
   const url=new URL(window.location.href);url.hash='';
   window.history.replaceState(window.history.state,'',url.pathname+url.search);
  }
 }
 function containDialogTab(event:React.KeyboardEvent<HTMLDialogElement>) {
  if(event.key!=='Tab')return;
  const tabbables=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex]'))
   .filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&!node.closest('[inert]')&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');
  const first=tabbables[0],last=tabbables[tabbables.length-1];
  if(!first||!last){event.preventDefault();dialogTitle.current?.focus();return;}
  const active=document.activeElement;
  if(event.shiftKey&&(active===first||!tabbables.includes(active as HTMLElement))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(active===last||!tabbables.includes(active as HTMLElement))){event.preventDefault();first.focus();}
 }

 useEffect(()=>{
  if(!initialOpen)return;
  // Apply the route hint after hydration/layout; it is not a controlled open
  // value, so closing an /apply dialog does not immediately reopen it.
  const frame=requestAnimationFrame(()=>setDialogOpen(true));
  return()=>cancelAnimationFrame(frame);
 },[initialOpen]);
 useEffect(()=>{
  const sync=()=>{
   const hash=window.location.hash;
   if(dialogReturn.current&&(hash==='#interest'||hash==='#academy-form'))dialogReturn.current.pushed=window.history.state?.academyTrip390Dialog===true;
   setDialogOpen(hash==='#interest'||hash==='#academy-form');
   const item=Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-trip390-faq]')).find(node=>'#'+node.id===hash);
   if(item)item.open=true;
  };
  if(window.location.hash)sync();
  window.addEventListener('popstate',sync);window.addEventListener('hashchange',sync);
  return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('hashchange',sync);};
 },[]);

 useEffect(()=>{
  const link=contact.current;
  if(!link)return;
  let frame=0,lift=0;
  const measure=()=>{
   frame=0;
   if(dialog.current?.open)return; // Native modal makes all background controls inert.
   const box=link.getBoundingClientRect(),baseTop=box.top+lift,gap=12;
   const obstacles:ContactObstacle[]=Array.from(page.current?.querySelectorAll<HTMLElement>('a,button,summary,input,select,textarea')??[])
    .filter(node=>node!==link&&!node.closest('dialog')&&!node.matches('[data-trip390-faq]>summary')&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden')
    .map(node=>node.getBoundingClientRect())
    .filter(rect=>rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<window.innerHeight&&rect.left<box.right+gap&&rect.right>box.left-gap)
    .map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,gap,kind:'control'}));
   // Protect painted text, including body copy, rather than reserving empty
   // full-width rows or a permanent rail beside the reading content.
   const addTextRect=(rect:DOMRect)=>{
    if(rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<window.innerHeight&&rect.left<box.right+4&&rect.right>box.left-4)
     obstacles.push({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,gap:4,kind:'text'});
   };
   page.current?.querySelectorAll<HTMLElement>('[data-trip390-faq]>summary,h2,h3,p,li').forEach(summary=>{
    if(summary.closest('dialog')||!summary.getClientRects().length||getComputedStyle(summary).visibility==='hidden')return;
    // Closed native details can retain descendant layout/Range rectangles.
    // Only their summary is painted; collapsed answers must not repel contact.
    const closedDetails=summary.closest<HTMLDetailsElement>('details:not([open])');
    if(closedDetails&&!closedDetails.querySelector(':scope > summary')?.contains(summary))return;
    const bounds=summary.getBoundingClientRect();
    if(bounds.bottom<=0||bounds.top>=window.innerHeight)return;
    const walker=document.createTreeWalker(summary,NodeFilter.SHOW_TEXT);
    for(let text=walker.nextNode();text;text=walker.nextNode()){
     if(!text.textContent?.trim())continue;
     const range=document.createRange();range.selectNodeContents(text);
     Array.from(range.getClientRects()).forEach(addTextRect);
    }
   });
   const image=hero.current?.querySelector('img');
   if(image?.naturalWidth&&image.currentSrc){
    const path=new URL(image.currentSrc,window.location.href).pathname;
    const role=path===heroAssets.textFree.mobile.publicPath?'mobile':path===heroAssets.textFree.desktop.publicPath?'desktop':null;
    if(role){
     const original=heroAssets.textFree[role],region=heroAssets.current.en[role];
     // Consume only the registered original-pixel overlay-clearance rectangle.
     // This does not revive owner03 derivative artwork, copy or approval scope.
     if(region.sourceSha256===original.sha256&&image.naturalWidth===original.width&&image.naturalHeight===original.height){
      const rect=image.getBoundingClientRect(),fit=getComputedStyle(image).objectFit;
      const scale=fit==='contain'?Math.min(rect.width/original.width,rect.height/original.height):Math.max(rect.width/original.width,rect.height/original.height);
      const x=rect.left+(rect.width-original.width*scale)/2,y=rect.top+(rect.height-original.height*scale)/2;
      const [left,top,right,bottom]=region.protectedRect;
      if(left!==undefined&&top!==undefined&&right!==undefined&&bottom!==undefined){
       const visible={left:Math.max(0,rect.left,x+left*scale),top:Math.max(0,rect.top,y+top*scale),right:Math.min(window.innerWidth,rect.right,x+right*scale),bottom:Math.min(window.innerHeight,rect.bottom,y+bottom*scale)};
       if(visible.right>visible.left&&visible.bottom>visible.top&&visible.left<box.right+gap&&visible.right>box.left-gap)obstacles.push({...visible,gap,kind:'photo'});
      }
     }
    }
   }
   const headerFloor=(header.current?.getBoundingClientRect().bottom??0)+gap;
   let top=baseTop,maxLift=168;
   // Three button heights for controls; up to four for a protected photo or
   // actual readable text. No clear bounded slot means temporarily hiding the
   // floating control; the footer contact remains available.
   for(let index=0;index<=obstacles.length;index++){
    const overlap=obstacles.filter(rect=>rect.top<top+box.height+rect.gap&&rect.bottom>top-rect.gap);
    if(!overlap.length)break;
    if(overlap.some(rect=>rect.kind==='photo'||rect.kind==='text'))maxLift=224;
    top=Math.min(...overlap.map(rect=>rect.top-box.height-rect.gap));
    if(top<Math.max(headerFloor,baseTop-maxLift))break;
   }
   const blocked=top<Math.max(headerFloor,baseTop-maxLift);
   lift=blocked?0:baseTop-top;
   link.style.setProperty('--contact-lift',`${lift}px`);
   link.style.visibility=blocked?'hidden':'';
   link.tabIndex=blocked?-1:0;
   if(blocked)link.setAttribute('aria-hidden','true');else link.removeAttribute('aria-hidden');
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
  if(page.current)observer?.observe(page.current);
  const image=hero.current?.querySelector('img');
  if(image){observer?.observe(image);image.addEventListener('load',schedule);}
  window.addEventListener('scroll',schedule,{passive:true,capture:true});
  window.addEventListener('resize',schedule);document.addEventListener('toggle',schedule,true);schedule();
  return()=>{observer?.disconnect();image?.removeEventListener('load',schedule);cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);document.removeEventListener('toggle',schedule,true);link.style.removeProperty('--contact-lift');link.style.visibility='';link.removeAttribute('aria-hidden');link.tabIndex=0;};
 },[locale,dialogOpen,menuOpen]);
 useEffect(()=>{
  const node=dialog.current;
  if(!node)return;
  if(!dialogOpen){if(node.open)node.close();return;}
  if(!dialogReturn.current)dialogReturn.current={element:null,x:window.scrollX,y:window.scrollY,url:window.location.pathname+window.location.search,pushed:false};
  const root=document.documentElement;
  const fallbackFocus=menuButton.current?.getClientRects().length?menuButton.current:header.current?.querySelector<HTMLElement>('a');
  const overflow=root.style.overflow;
  root.style.overflow='hidden';
  if(!node.open)node.showModal();
  dialogTitle.current?.focus({preventScroll:true});
  return()=>{
   if(node.open)node.close();root.style.overflow=overflow;
   const previous=dialogReturn.current;
   if(previous){window.scrollTo({left:previous.x,top:previous.y,behavior:'instant'});(previous.element?.isConnected&&previous.element.getClientRects().length?previous.element:fallbackFocus)?.focus({preventScroll:true});}
  };
 },[dialogOpen]);
 useEffect(()=>{
  const measure=()=>{
   page.current?.style.setProperty('--header-height',`${header.current?.getBoundingClientRect().height??80}px`);
   // Derive text reflow from font scale, never from the resulting card width.
   if(page.current)page.current.dataset.textReflow=String(parseFloat(getComputedStyle(page.current).fontSize)>=26);
  };
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
  if(header.current)observer?.observe(header.current);
  if(page.current)observer?.observe(page.current);
  window.addEventListener('resize',measure);measure();
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);

 useEffect(() => {
  if (!menuOpen) return;
  const escape = (event:KeyboardEvent) => {
   if (event.key==='Escape') {setMenuOpen(false); menuButton.current?.focus();}
  };
  document.addEventListener('keydown', escape);
  return () => document.removeEventListener('keydown', escape);
 }, [menuOpen]);
 useEffect(() => {
  if (error&&dialog.current?.open) errorSummary.current?.focus();
 }, [error]);
 useEffect(() => {
  if (saved&&dialog.current?.open) savedSummary.current?.focus();
 }, [saved]);
 useEffect(() => {
  let frame=0;
  const measure=()=>{
   frame=0;
   const line=(header.current?.getBoundingClientRect().bottom??0)+24;
   let current='';
   navigation.forEach(id=>{if((document.getElementById(id)?.getBoundingClientRect().top??Infinity)<=line)current=id;});
   setActiveSection(current);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
  if(page.current)observer?.observe(page.current);
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);measure();
  return()=>{cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
 }, []);
 useEffect(() => {
  const node=hero.current;
  const image=node?.querySelector('img');
  const heading=node?.querySelector<HTMLElement>('[data-hero-heading]');
  const action=node?.querySelector<HTMLElement>('[data-hero-action]');
  if (!node || !image || !heading || !action) return;
  const measure=()=>{
   if (!image.naturalWidth) return;
   // Use the intended first-screen height, not the reflowed image height: the
   // latter would make enlarged-text mode oscillate between two layouts.
   const height=Math.max(1,window.innerHeight-(header.current?.getBoundingClientRect().height??80));
   // A tall viewport must not enlarge the original beyond the full width:
   // retain its natural image height and continue the navy hero below it.
   node.dataset.photoFit=node.getBoundingClientRect().width*image.naturalHeight/image.naturalWidth<=height?'width':'cover';
   setHeroReflow(heading.getBoundingClientRect().height>height*.25||action.getBoundingClientRect().height>height*.18);
  };
  const observer=typeof ResizeObserver==='undefined' ? null : new ResizeObserver(measure);
  [image,heading,action].forEach(element=>observer?.observe(element));
  image.addEventListener('load',measure); window.addEventListener('resize',measure); measure();
  return ()=>{observer?.disconnect();image.removeEventListener('load',measure);window.removeEventListener('resize',measure);};
 }, [locale]);

 function changeChild(id:string, field:keyof Omit<ChildDraft,'id'>, value:string) {
  setChildren(items=>items.map(item=>item.id===id ? {...item,[field]:value} : item));
 }
 function changeLocale(value:'en'|'he') {
  setLocale(value); setMenuOpen(false); setError(''); setErrorTarget('');
 }
 function reportError(message:string, target='') {setErrorTarget(target); setError(message);}

 async function save(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!submitInterest || inFlight.current || result?.state==='conflict') return;
  setError(''); setErrorTarget('');
  if (!operation.current) {
   const values = new FormData(event.currentTarget);
   const phone = String(values.get('phone')??'').trim();
   const notes = String(values.get('notes')??'').trim();
   const firstInvalid=event.currentTarget.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input:invalid,select:invalid,textarea:invalid');
   if(firstInvalid){
    reportError(firstInvalid.validity.valueMissing?copy.form.required_field:copy.form.invalid_field,firstInvalid.id);
    return;
   }
   const command = trip390CommandSchema.safeParse({operationId:crypto.randomUUID(), fields:{
    version:TRIP390_INTEREST_VERSION, offerVersion:TRIP390_OFFER.version,
    guardianName:values.get('guardianName'), email:values.get('email'), ...(phone ? {phone} : {}),
    city, postalCode:values.get('postalCode'), messageLanguage:values.get('messageLanguage'),
    instructionLanguage:values.get('instructionLanguage'), ...(notes ? {notes} : {}),
    children:children.map(child=>({id:child.id==='first' ? crypto.randomUUID() : child.id,
     name:child.name, ageYears:child.age.trim() ? Number(child.age) : NaN, experience:child.experience})),
    acknowledgment:{version:TRIP390_NOTICE_VERSION, language:locale,
     conductExplained:values.get('conduct')==='on', interestPrivacySafety:values.get('interest')==='on',
     whatsapp:values.get('whatsapp')==='on'},
   }});
   if (!command.success) {
    const path=command.error.issues[0]?.path;
    const target=path?.[1]==='children' ? `trip390-child-${children[Number(path[2])]?.id}-${String(path[3])}` : `trip390-${String(path?.[1]??'')}`;
    reportError(path?.[1]==='phone'
     ? t('Enter an international phone number, for example +12025550101. WhatsApp updates require a phone number.','הזינו מספר טלפון בינלאומי, לדוגמה +12025550101. עדכוני וואטסאפ מחייבים מספר טלפון.')
     : t('Please check the highlighted field and the two required acknowledgments.','בדקו את השדה המסומן ואת שני האישורים הנדרשים.'), target);
    return;
   }
   operation.current=command.data;
  }
  inFlight.current=true; setBusy(true);
  try {
   const next=await submitInterest(operation.current);
   // Malformed/unbound success must never produce a permanent success screen.
   if (next?.state==='saved' && (next.operationId!==operation.current.operationId || typeof next.reference!=='string' || !next.reference.trim() || !['pending','not_queued'].includes(next.email))) {
    setResult({state:'unknown'});
   } else if (next?.state==='saved' || next?.state==='unknown' || next?.state==='conflict') {
    setResult(next);
    if (next.state==='conflict') reportError(t('This submission needs private owner review. Do not create a duplicate.','הפנייה דורשת בדיקה פרטית של הבעלים. אין ליצור פנייה כפולה.'));
   } else if (next?.state==='rejected' && ['invalid','unavailable'].includes(next.reason)) {
    setResult(next); operation.current=null;
    reportError(next.reason==='unavailable'
     ? t('Saving is currently unavailable. Your information is still here. Please try again later.','השמירה אינה זמינה כעת. הפרטים שהזנתם נשמרו בטופס. נסו שוב מאוחר יותר.')
     : t('The server did not accept this submission. Check your information and try again.','המערכת לא קיבלה את הפנייה. בדקו את הפרטים ונסו שוב.'));
   } else setResult({state:'unknown'});
  } catch {setResult({state:'unknown'});}
  finally {inFlight.current=false; setBusy(false);}
 }

 const navLinks = navigation.map(key=><a key={key} href={'#'+key} aria-current={activeSection===key ? 'location' : undefined} onClick={event=>{
  event.preventDefault();setMenuOpen(false);setActiveSection(key);
  const target=document.getElementById(key);
  if(!target)return;
  if(window.location.hash!=='#'+key)window.history.pushState(window.history.state,'','#'+key);
  window.scrollTo({top:window.scrollY+target.getBoundingClientRect().top-(header.current?.getBoundingClientRect().height??80)-20,behavior:'instant'});
 }}>{copy.nav[key]}</a>);
 const invalid = (id:string) => errorTarget===id ? {'aria-invalid':true as const,'aria-describedby':id+'-error'} : {};
 const fieldError = (id:string) => errorTarget===id?<small id={id+'-error'} className={styles.inlineError}>{error}</small>:null;

 return <div className={`${site.site} ${styles.page}`} ref={page} lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <a className={site.skip} href="#main">{t('Skip to content','דלגו לתוכן')}</a>
  <header className={styles.header} ref={header}><div className={styles.headerInner}>
   <a className={styles.logo} href="#main" aria-label={copy.brand}><img src="/groups/brand/jlfa-logo-locked-v1.png" width="72" height="72" alt={copy.brand}/></a>
   <nav className={styles.desktopNav} aria-label={t('Academy navigation','ניווט באקדמיה')}>{navLinks}</nav>
   <div className={styles.languages} aria-label={t('Website language','שפת האתר')}>{(['en','he'] as const).map(value=><button key={value} type="button" lang={value} aria-pressed={value===locale} onClick={()=>changeLocale(value)}>{value==='en'?'English':'עברית'}</button>)}</div>
   <a className={`${styles.action} ${styles.headerAction}`} href="#interest" onClick={openInterest}>{interestLabel}</a>
   <button className={styles.menuButton} ref={menuButton} type="button" aria-label={menuOpen?t('Close menu','סגירת התפריט'):t('Open menu','פתיחת התפריט')} aria-expanded={menuOpen} aria-controls="trip390-menu" onClick={()=>setMenuOpen(value=>!value)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{menuOpen?<path d="m6 6 12 12M6 18 18 6"/>:<path d="M4 6h16M4 12h16M4 18h16"/>}</svg>
   </button>
   <nav id="trip390-menu" className={styles.mobileNav} hidden={!menuOpen} aria-label={t('Mobile Academy navigation','ניווט נייד באקדמיה')}>{navLinks}<a className={styles.action} href="#interest" onClick={openInterest}>{interestLabel}</a></nav>
  </div></header>
  <main id="main" tabIndex={-1}>
   <section className={styles.hero} ref={hero} data-reflow={heroReflow?'true':undefined} aria-labelledby="trip390-title">
    <picture><source media="(max-width:767px), (max-width:999px) and (orientation:portrait)" srcSet="/groups/academy/hero-mobile-20261018.png" width="1143" height="2048"/><img src="/groups/academy/hero-desktop-20261018.png" width="2048" height="1143" alt={t('An adult and a boy preparing fishing equipment by the water','מבוגר וילד מכינים ציוד דיג ליד המים')} fetchPriority="high"/></picture>
    <div className={styles.heroText} data-hero-heading><h1 id="trip390-title" lang="en" dir="ltr"><span>Jewish Leadership</span><span>Fishing Academy</span></h1></div>
    <div className={styles.heroAction} data-hero-action><a className={styles.action} href="#interest" onClick={openInterest}>{interestLabel}</a></div>
   </section>
   <section className={`${styles.section} ${styles.introduction}`} aria-labelledby="trip390-intro-title">
    <div className={styles.sectionHeading}><h2 id="trip390-intro-title">{copy.intro.title}</h2></div>
    <p className={styles.lead}>{copy.hero.description}</p>
    <div className={styles.intro}><p className={styles.lead}>{copy.intro.body}</p><p>{copy.intro.values}</p></div>
   </section>
   <section className={styles.audience} aria-labelledby="trip390-audience-title"><div className={styles.section}>
    <h2 id="trip390-audience-title">{copy.hero.eyebrow}</h2><p>{copy.faqs.find(item=>item.id==='age')?.a}</p>
   </div></section>
   <section id="how" className={styles.section} aria-labelledby="trip390-how-title">
    <div className={styles.sectionHeading}><h2 id="trip390-how-title">{copy.nav.how}</h2></div>
    <p className={styles.lead}>{copy.hero.includes}</p>
    <div className={styles.preparationFeature}>
     <figure className={styles.sceneFigure} data-trip390-scene="foundation"><img className={styles.supportingScene} data-academy-scene="foundation" src={preparationScene.publicPath} width={preparationScene.width} height={preparationScene.height} loading="lazy" alt={t('Illustration of organized fishing equipment','איור של ציוד דיג מסודר')}/></figure>
     <ol className={styles.steps}>{copy.steps.slice(0,2).map(step=><li key={step.title}><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
    </div>
    <div className={styles.outingFeature}>
     <figure className={styles.sceneFigure} data-trip390-scene="form"><img className={styles.supportingScene} data-academy-scene="form" src={outingScene.publicPath} width={outingScene.width} height={outingScene.height} loading="lazy" alt={t('Illustration of a calm coastal scene','איור של חוף שקט')}/></figure>
     <div>{copy.steps.slice(2).map(step=><div key={step.title}><h3>{step.title}</h3><p>{step.body}</p></div>)}</div>
    </div>
   </section>
   <section id="learn" className={`${styles.section} ${styles.skillsSection}`} aria-labelledby="trip390-learn-title">
    <div className={styles.sectionHeading}><h2 id="trip390-learn-title">{copy.nav.learn}</h2></div>
    <p className={styles.pillars}>{copy.hero.pillars}</p>
    <div className={styles.knowledgeFeature}>
     <figure className={`${styles.sceneFigure} ${styles.knowledgePicture}`} data-trip390-scene="advanced"><picture><source media="(max-width:767px)" srcSet={knowledgeMobileScene.publicPath} width={knowledgeMobileScene.width} height={knowledgeMobileScene.height}/><img className={styles.supportingScene} data-academy-scene="advanced" src={knowledgeScene.publicPath} width={knowledgeScene.width} height={knowledgeScene.height} loading="lazy" alt={t('Illustration of a large fish beneath the surface','איור של דג גדול מתחת לפני המים')}/></picture></figure>
     <div className={styles.knowledgeText}>{copy.skills.slice(3,5).map(skill=><article key={skill.title}><h3>{skill.title}</h3><p>{skill.body}</p></article>)}</div>
    </div>
    <div className={styles.skills}>{copy.skills.filter((_,index)=>index<3||index>4).map(skill=><article key={skill.title}><h3>{skill.title}</h3><p>{skill.body}</p></article>)}</div>
    <div className={styles.torah}><h3>{copy.torah.title}</h3><p>{copy.torah.body}</p></div>
   </section>
   <section id="included" className={styles.packageSection} aria-labelledby="trip390-package-title"><div className={styles.packageInner}>
    <div className={styles.packageIntro}><h2 id="trip390-package-title">{copy.price.title}</h2><p className={styles.packagePrice}><span dir="ltr"><bdi>{copy.price.amount}</bdi><small>USD</small></span><span className={styles.priceUnit}>{copy.price.per_boy}</span></p><p>{copy.price.unit}</p><p className={styles.finePrint}>{copy.price.renewal}</p><a className={styles.action} href="#interest" onClick={openInterest}>{interestLabel}</a></div>
    <div className={styles.packageDetails}><div className={styles.inclusionColumns}><div><h3>{copy.nav.included}</h3><ul className={styles.included}>{copy.price.included.map(item=><li key={item}>{item}</li>)}</ul></div><div><h3>{t('Separate','בנפרד')}</h3><ul className={styles.separate}>{copy.price.separate.map(item=><li key={item}>{item}</li>)}</ul></div></div><div className={styles.returning}><h3>{copy.returning.title}</h3><p>{copy.returning.body}</p></div></div>
   </div></section>
   <section id="dates" className={styles.section} aria-labelledby="trip390-dates-title"><div className={styles.dates}>
    <div><h2 id="trip390-dates-title">{copy.dates.title}</h2><p>{copy.dates.empty}</p></div><div className={styles.location}><h3>{copy.location.title}</h3><p>{copy.location.body}</p></div>
   </div></section>
   <section className={`${styles.section} ${styles.founder}`} aria-labelledby="trip390-founder-title"><img src="/groups/people/founder-head.jpg" width="180" height="180" loading="eager" decoding="async" alt={copy.founder.title}/><div><h2 id="trip390-founder-title">{copy.founder.title}</h2><p>{copy.founder.body}</p></div></section>
   <section id="faq" className={styles.section} aria-labelledby="trip390-faq-title"><div className={styles.sectionHeading}><h2 id="trip390-faq-title">{copy.nav.faq}</h2></div><div className={styles.faqLayout}>{[copy.faqs.slice(0,9),copy.faqs.slice(9)].map((items,index)=><section key={index} className={styles.faqGroup} aria-labelledby={`trip390-faq-group-${index}`}><h3 id={`trip390-faq-group-${index}`}>{index===0?t('Participation, preparation & travel','השתתפות, הכנה ונסיעה'):t('The trip, safety & registration','הטיול, בטיחות והתעניינות')}</h3><div className={styles.faqs}>{items.map(item=><details key={item.id} id={item.id} data-trip390-faq name="trip390-faq" onToggle={event=>{if(event.currentTarget.open)page.current?.querySelectorAll<HTMLDetailsElement>('[data-trip390-faq]').forEach(node=>{if(node!==event.currentTarget)node.open=false;});}}><summary><span className={styles.faqQuestion}>{item.q}</span><span data-faq-glyph aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div></section>)}</div></section>
   <section id="interest" className={styles.finalInterest}><div className={styles.section}><h2>{copy.form.title}</h2><p>{copy.hero.interest_note}</p><a className={styles.action} href="#interest" onClick={openInterest}>{interestLabel}</a></div></section>
   <dialog className={styles.dialog} ref={dialog} aria-labelledby="trip390-interest-title" onKeyDown={containDialogTab} onCancel={event=>{event.preventDefault();closeInterest();}} onClose={()=>{if(!dialog.current?.open)setDialogOpen(false);}}>
    <div className={styles.dialogHeader}><h2 id="trip390-interest-title" ref={dialogTitle} tabIndex={-1}>{copy.form.title}</h2><button className={styles.closeDialog} type="button" onClick={closeInterest} aria-label={t('Close interest form','סגירת טופס ההתעניינות')}>×</button><div className={styles.languages} aria-label={t('Form language','שפת הטופס')}>{(['en','he'] as const).map(value=><button key={value} type="button" lang={value} aria-pressed={value===locale} onClick={()=>changeLocale(value)}>{value==='en'?'English':'עברית'}</button>)}</div></div>
    <div className={styles.dialogBody}><div className={styles.formIntro}><p>{copy.form.intro}</p><p className={styles.privateNote}>{copy.form.place_not_confirmed}</p>{!submitInterest&&<p className={styles.unavailableNote}>{t('Preview only. Saving is unavailable until the existing inquiry integration is admitted.','תצוגה מקדימה בלבד. השמירה אינה זמינה עד לחיבור למערכת הפניות הקיימת.')}</p>}</div>
    {saved?<div className={styles.saved} role="status" ref={savedSummary} tabIndex={-1}><span className={styles.savedMark} aria-hidden="true">✓</span><h3>{copy.form.saved}</h3><p>{result.email==='pending'?copy.form.email_pending:t('No confirmation email has been queued.','לא הוכנסה הודעת אישור לתור השליחה.')}</p><p>{copy.form.saved_reference}: <bdi>{result.reference}</bdi></p></div>
    :<form className={styles.form} ref={form} onSubmit={save} noValidate aria-busy={busy}>
     {error&&<p className={styles.error} role="alert" id="trip390-error" ref={errorSummary} tabIndex={-1}>{errorTarget?copy.form.validation_summary:error}{errorTarget&&<a href={'#'+errorTarget} onClick={event=>{event.preventDefault();document.getElementById(errorTarget)?.focus();}}>{t('Go to field','מעבר לשדה')}</a>}</p>}
     {unresolved&&<p className={styles.error} role="alert">{copy.form.save_unknown}</p>}
     <fieldset disabled={locked}><legend>{t('Parent & location','הורה ומיקום')}</legend><div className={styles.columns}>
      <label htmlFor="trip390-guardianName">{copy.form.guardian_name}<input id="trip390-guardianName" name="guardianName" required maxLength={100} autoComplete="name" {...invalid('trip390-guardianName')}/>{fieldError('trip390-guardianName')}</label>
      <label htmlFor="trip390-email">{copy.form.email}<input id="trip390-email" name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" {...invalid('trip390-email')}/>{fieldError('trip390-email')}</label>
      <label className={styles.fullWidth} htmlFor="trip390-phone">{copy.form.phone}<input id="trip390-phone" name="phone" type="tel" autoComplete="tel" placeholder="+1…" dir="ltr" required={whatsapp} {...invalid('trip390-phone')}/>{fieldError('trip390-phone')}{whatsapp&&<small>{t('Required for WhatsApp updates. Use an international number, for example +12025550101.','נדרש לעדכוני וואטסאפ. השתמשו במספר בינלאומי, לדוגמה +12025550101.')}</small>}</label>
      <label htmlFor="trip390-city">{copy.form.city}<input id="trip390-city" name="city" required minLength={2} maxLength={120} value={city} onChange={event=>setCity(event.target.value)} list="trip390-cities" aria-describedby="trip390-city-hint" autoComplete="address-level2" {...invalid('trip390-city')}/><datalist id="trip390-cities">{trip390CitySuggestions(city).map(value=><option key={value} value={value}/>)}</datalist>{fieldError('trip390-city')}<small id="trip390-city-hint">{copy.form.city_hint}</small></label>
      <label htmlFor="trip390-postalCode">{copy.form.zip}<input id="trip390-postalCode" name="postalCode" required inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" dir="ltr" aria-describedby="trip390-zip-hint" {...invalid('trip390-postalCode')}/>{fieldError('trip390-postalCode')}<small id="trip390-zip-hint">{copy.form.zip_hint}</small></label>
     </div></fieldset>
     <fieldset disabled={locked}><legend>{t('The boys','הילדים')}</legend>
      {children.map((child,index)=><fieldset className={styles.child} key={child.id}><legend>{copy.form.child_heading.replace('{number}',String(index+1))}</legend><div className={styles.columns}>
       <label htmlFor={`trip390-child-${child.id}-name`}>{copy.form.child_name}<input id={`trip390-child-${child.id}-name`} required name={`child-${child.id}-name`} value={child.name} maxLength={100} onChange={event=>changeChild(child.id,'name',event.target.value)} {...invalid(`trip390-child-${child.id}-name`)}/>{fieldError(`trip390-child-${child.id}-name`)}</label>
       <label htmlFor={`trip390-child-${child.id}-ageYears`}>{copy.form.child_age}<input id={`trip390-child-${child.id}-ageYears`} required name={`child-${child.id}-age`} type="number" min={0} max={120} step={1} inputMode="numeric" value={child.age} onChange={event=>changeChild(child.id,'age',event.target.value)} {...invalid(`trip390-child-${child.id}-ageYears`)}/>{fieldError(`trip390-child-${child.id}-ageYears`)}</label>
       <label className={styles.fullWidth} htmlFor={`trip390-child-${child.id}-experience`}>{copy.form.experience}<select id={`trip390-child-${child.id}-experience`} value={child.experience} onChange={event=>changeChild(child.id,'experience',event.target.value)}>{['new','some','experienced','not_sure'].map((value,i)=><option key={value} value={value}>{copy.form.experience_choices[i]}</option>)}</select></label>
      </div>{children.length>1&&<button className={styles.removeChild} type="button" onClick={()=>setChildren(items=>items.filter(item=>item.id!==child.id))}>{copy.form.remove_child} {index+1}</button>}</fieldset>)}
      <button className={styles.addChild} type="button" disabled={children.length>=10} onClick={()=>setChildren(items=>[...items,{id:crypto.randomUUID(),name:'',age:'',experience:'new'}])}><span aria-hidden="true">+</span> {copy.form.add_child}</button>
     </fieldset>
     <fieldset disabled={locked}><legend>{t('Preferences & questions','העדפות ושאלות')}</legend><div className={styles.columns}>
      <label htmlFor="trip390-messageLanguage">{copy.form.message_language}<select id="trip390-messageLanguage" name="messageLanguage" defaultValue={initialLocale}><option value="en">English</option><option value="he">עברית</option></select></label>
      <label htmlFor="trip390-instructionLanguage">{copy.form.group_language}<select id="trip390-instructionLanguage" name="instructionLanguage" defaultValue="either"><option value="either">{t('Either','כל שפה')}</option><option value="en">English</option><option value="he">עברית</option></select></label>
     </div><label htmlFor="trip390-notes">{copy.form.notes}<textarea id="trip390-notes" name="notes" maxLength={600} aria-describedby="trip390-notes-hint"/><small id="trip390-notes-hint">{copy.form.notes_hint}</small></label></fieldset>
     <fieldset disabled={locked} className={styles.permissions}><legend>{t('Information & permissions','מידע ואישורים')}</legend>
      <details name="trip390-notice"><summary>{copy.conduct.title}<span aria-hidden="true">+</span></summary><div tabIndex={0} role="region" aria-label={copy.conduct.title}>{copy.conduct.body}</div></details>
      <details name="trip390-notice"><summary>{t('Interest, safety and privacy','התעניינות, בטיחות ופרטיות')}<span aria-hidden="true">+</span></summary><div tabIndex={0} role="region" aria-label={t('Interest, safety and privacy','התעניינות, בטיחות ופרטיות')}><p>{copy.form.privacy_short}</p><p>{copy.form.interest_ack}</p><p>{copy.hero.interest_note}</p></div></details>
      <label className={styles.check}><input id="trip390-conduct" type="checkbox" name="conduct" required {...invalid('trip390-conduct')}/><span>{copy.form.conduct}{fieldError('trip390-conduct')}</span></label>
      <label className={styles.check}><input id="trip390-interest" type="checkbox" name="interest" required {...invalid('trip390-interest')}/><span>{copy.form.interest_ack}{fieldError('trip390-interest')}</span></label>
      <label className={styles.check}><input type="checkbox" name="whatsapp" checked={whatsapp} onChange={event=>setWhatsapp(event.target.checked)}/>{copy.form.whatsapp}</label>
     </fieldset>
     <div className={styles.submitArea}>{!submitInterest&&<p role="status">{t('Saving is unavailable in this review preview.','השמירה אינה זמינה בתצוגת הבדיקה הזאת.')}</p>}<button className={styles.action} type="submit" disabled={!submitInterest||busy||result?.state==='conflict'}>{busy?copy.form.sending:unresolved?t('Check same submission','בדיקת אותה פנייה'):copy.form.submit}</button><p className={styles.finePrint}>{copy.hero.interest_note}</p></div>
    </form>}
   </div></dialog>
  </main>
  <footer className={styles.footer}><a href="#main" className={styles.footerBrand}><img src="/groups/brand/jlfa-logo-locked-v1.png" width="64" height="64" alt=""/><span>{copy.brand}</span></a><a href={'https://wa.me/13054916674?text='+encodeURIComponent(copy.whatsapp_inquiry)} rel="noopener noreferrer" referrerPolicy="no-referrer">{t('Contact us on WhatsApp','דברו איתנו בוואטסאפ')}</a><p className={styles.affiliation}>{copy.footer.affiliation}</p></footer>
  <a className={styles.whatsapp} ref={contact} hidden={dialogOpen} tabIndex={dialogOpen?-1:0} aria-hidden={dialogOpen||undefined} href={'https://wa.me/13054916674?text='+encodeURIComponent(copy.whatsapp_inquiry)} aria-label={t('Contact us on WhatsApp','דברו איתנו בוואטסאפ')} rel="noopener noreferrer" referrerPolicy="no-referrer"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M26 15a11 11 0 0 1-16.5 9.5L4 26l1.6-5.3A11 11 0 1 1 26 15Z"/><path d="m10.4 9.4 2.1-.2 1.5 3-1.4 1.5c1 2 2.5 3.4 4.6 4.3l1.5-1.4 3 1.5-.3 2c-.2 1.4-2.3 1.6-3.5 1.1-4.9-1.8-8.4-5.4-9-9.1-.2-1.3.2-2.4 1.5-2.7Z"/></svg></a>
 </div>;
}
