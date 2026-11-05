/* eslint-disable @next/next/no-img-element -- consume protected original asset bytes */
'use client';
import React, {useEffect, useRef, useState} from 'react';
import {trip390CitySuggestions, trip390CommandSchema, TRIP390_INTEREST_VERSION, TRIP390_NOTICE_VERSION, TRIP390_DRIVING_VERSION, TRIP390_OFFER, type Trip390Command} from './academy-trip390-contract.ts';
import site from './academy-site.module.css';
import styles from './academy-trip390.module.css';
import heroAssets from './academy-hero-assets.json';
import {academyR2Copy as trip390Copy} from './academy-r2-copy.ts';
import {AcademyValueIcon} from './academy-r2-value-icon.tsx';
import {trip390ReservationNotice} from './academy-trip390-reservation-notice.ts';
import {trip390StudentConduct} from './academy-trip390-student-conduct.ts';
import {trip390LearningAssets} from './academy-trip390-learning-assets.ts';
import {ACADEMY_CONTACT} from './academy-contact.ts';

export type Trip390SaveResult =
 | {state:'saved'; operationId:string; reference:string; email:'pending'|'not_queued'|'queued'|'sent'|'unknown'|'canceled'}
 | {state:'unknown'} | {state:'conflict'}
 /** Only an authoritative rejection may unlock editing. Transport errors are UNKNOWN. */
 | {state:'rejected'; reason:'invalid'|'unavailable'};

type ChildDraft = {id:string; name:string; age:string; experience:string};
type ContactObstacle = Pick<DOMRect,'left'|'right'|'top'|'bottom'> & {gap:number; kind:'control'|'photo'|'text'};
const navigation = ['learn', 'values', 'about', 'faq'] as const;

// Render registered original geometry with the HTML, so the first desktop
// frame and its hydrated counterpart use the same protected photo bands.
const desktopMaster = heroAssets.textFree.desktop;
const desktopRegion = heroAssets.current.en.desktop;
const [, protectedTop, , protectedBottom] = desktopRegion.protectedRect;
const desktopGeometry = desktopRegion.sourceSha256 === desktopMaster.sha256
 && protectedTop !== undefined && protectedBottom !== undefined ? {
 'data-master-height': desktopMaster.height / desktopMaster.width,
 'data-master-top': protectedTop / desktopMaster.width,
 'data-master-bottom': protectedBottom / desktopMaster.width,
} : {};

function registeredHero(image:HTMLImageElement) {
 if(!image.naturalWidth||!image.currentSrc)return null;
 const path=new URL(image.currentSrc,window.location.href).pathname;
 const role=path===heroAssets.textFree.mobile.publicPath?'mobile':path===heroAssets.textFree.desktop.publicPath?'desktop':null;
 if(!role)return null;
 const original=heroAssets.textFree[role],region=heroAssets.current.en[role];
 if(region.sourceSha256!==original.sha256||image.naturalWidth!==original.width||image.naturalHeight!==original.height)return null;
 return {role,original,region};
}


// A discretionary word break preserves the catalog text and normal whole-word
// layout, while avoiding a stranded final letter when enlarged beyond its box.
function introHeading(text:string) {
 return text.split(/(\bExperience\b)/u).map((part,index)=>index%2===1
  ? <span className={styles.headingWord} key={index}>{part.slice(0,6)}<wbr/>{part.slice(6)}</span>
  : part);
}


/** Candidate frontend. The existing integrator owns route mounting and the
 * admitted transport. Never map this payload into fabricated legacy fields. */
export function AcademyTrip390Page({initialLocale='en', initialOpen=false, reservationCollectionEnabled=false, submitInterest}: {
 initialLocale?:'en'|'he'; initialOpen?:boolean; reservationCollectionEnabled?:boolean; submitInterest?:(command:Trip390Command)=>Promise<Trip390SaveResult>;
}) {
 const [locale, setLocale] = useState(initialLocale);
 const [children, setChildren] = useState<ChildDraft[]>([{id:'first', name:'', age:'', experience:'new'}]);
 const [city, setCity] = useState('');
 const [menuOpen, setMenuOpen] = useState(false);
 const [activeSection, setActiveSection] = useState('');
 const [result, setResult] = useState<Trip390SaveResult|null>(null);
 const [operationLocale,setOperationLocale]=useState<'en'|'he'|null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [errorTarget, setErrorTarget] = useState('');
 const [whatsapp, setWhatsapp] = useState(false);
 const [conductExplained, setConductExplained] = useState(false);
 const [reservationAccepted,setReservationAccepted]=useState(false);
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
 const privacyDisclosure = useRef<HTMLDetailsElement>(null);
 const privacyRequested = useRef(false);
 const contact = useRef<HTMLAnchorElement>(null);
 const dialogReturn = useRef<{element:HTMLElement|null; x:number; y:number; url:string; pushed:boolean}|null>(null);
 const copy = trip390Copy[locale];
 // Financial cancellation prose stays in the exact R2 catalog for counsel review.
 // Current owning-source publication hold excludes it from public rendering.
 const publicFaqs=copy.faqs.filter(item=>item.id!=='cancellation'&&item.id!=='conduct');
 const t = (en:string, he:string) => locale==='he' ? he : en;
 const unresolved = result?.state==='unknown';
 const saved = result?.state==='saved';
 const locked = busy || unresolved || result?.state==='conflict';
 const documentLocale=operationLocale??locale;
 const conduct=trip390StudentConduct(documentLocale),reservationNotice=trip390ReservationNotice(documentLocale);
 const consentCopy=trip390Copy[documentLocale].form;
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
 function openPrivacy(event:React.MouseEvent<HTMLElement>) {
  privacyRequested.current=true;openInterest(event);
 }
 function oneInformationPanel(event:React.SyntheticEvent<HTMLDetailsElement>) {
  if(event.currentTarget.open)dialog.current?.querySelectorAll<HTMLDetailsElement>('details[name="trip390-notice"]').forEach(node=>{if(node!==event.currentTarget)node.open=false;});
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
   const addContentRect=(rect:DOMRect)=>{
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
     Array.from(range.getClientRects()).forEach(addContentRect);
    }
   });
   page.current?.querySelectorAll<SVGSVGElement>('[data-jlfa-values] article svg').forEach(icon=>{
    addContentRect(icon.getBoundingClientRect());
   });
   const image=hero.current?.querySelector('img');
   const asset=image&&registeredHero(image);
   if(image&&asset){
    // The source rectangle is defined in original pixels.
    const {original,region}=asset;
    const rect=image.getBoundingClientRect(),fit=getComputedStyle(image).objectFit;
    const scale=fit==='contain'?Math.min(rect.width/original.width,rect.height/original.height):Math.max(rect.width/original.width,rect.height/original.height);
    const x=rect.left+(rect.width-original.width*scale)/2,y=rect.top+(rect.height-original.height*scale)/2;
    const [left,top,right,bottom]=region.protectedRect;
    if(left!==undefined&&top!==undefined&&right!==undefined&&bottom!==undefined){
     const visible={left:Math.max(0,rect.left,x+left*scale),top:Math.max(0,rect.top,y+top*scale),right:Math.min(window.innerWidth,rect.right,x+right*scale),bottom:Math.min(window.innerHeight,rect.bottom,y+bottom*scale)};
     if(visible.right>visible.left&&visible.bottom>visible.top&&visible.left<box.right+gap&&visible.right>box.left-gap)obstacles.push({...visible,gap,kind:'photo'});
    }
   }
   const headerFloor=(header.current?.getBoundingClientRect().bottom??0)+gap;
   let top=baseTop,floor=Math.max(headerFloor,baseTop-168),metText=false;
   for(let index=0;index<=obstacles.length;index++){
    const overlap=obstacles.filter(rect=>rect.top<top+box.height+rect.gap&&rect.bottom>top-rect.gap);
    if(!overlap.length)break;
    metText ||= overlap.some(rect=>rect.kind==='text');
    if(overlap.some(rect=>rect.kind==='photo'||rect.kind==='text'))floor=Math.min(floor,Math.max(headerFloor,baseTop-224));
    top=Math.min(...overlap.map(rect=>rect.top-box.height-rect.gap));
    if(top>=floor)continue;
    // Exhaust the lower band first. Above it, use the closest clear body slot
    // only after the hero has scrolled behind the header and the menu is closed.
    if(top<headerFloor||!metText||menuOpen||!hero.current||hero.current.getBoundingClientRect().bottom>headerFloor-gap)break;
    floor=headerFloor;
    // A higher dock must also leave supporting photos and their captions clear.
    page.current?.querySelectorAll('main img,main figcaption').forEach(node=>{
     const rect=node.getBoundingClientRect();
     if(rect.width>0&&rect.height>0&&rect.bottom>headerFloor&&rect.top<window.innerHeight&&rect.left<box.right+gap&&rect.right>box.left-gap)
      obstacles.push({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,gap,kind:'photo'});
    });
   }
   const blocked=top<floor;
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
  if(privacyRequested.current&&privacyDisclosure.current){
   privacyRequested.current=false;privacyDisclosure.current.open=true;
   privacyDisclosure.current.querySelector('summary')?.focus();
  } else dialogTitle.current?.focus({preventScroll:true});
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
   // A portrait viewport receiving the landscape original uses the existing
   // natural flow: no photo enlargement/crop or tall empty continuation band.
   const portraitLandscape=window.matchMedia('(orientation: portrait)').matches&&image.naturalWidth>image.naturalHeight;
   const desktop=window.matchMedia('(min-width:768px) and (orientation:landscape)').matches;
   const asset=registeredHero(image);
   const eyebrow=heading.firstElementChild,title=heading.lastElementChild;
   const pillars=action.firstElementChild,button=action.lastElementChild;
   if(desktop&&asset?.role==='desktop'&&eyebrow&&title&&pillars&&button){
    const scale=node.getBoundingClientRect().width/asset.original.width;
    const photoHeight=scale*asset.original.height;
    // Compute the prospective overlay independently of the current flow state.
    // Width-fit aligns the full original at the top; cover centers its tall axis.
    const imageOffset=Math.min(0,(height-photoHeight)/2);
    const [,top,,bottom]=asset.region.protectedRect;
    if(top!==undefined&&bottom!==undefined){
     const upperBand=imageOffset+top*scale,lowerBand=height-(imageOffset+bottom*scale);
     const clearance=4;
     const titleLines=eyebrow.getBoundingClientRect().height+title.getBoundingClientRect().height;
     const actionHeight=button.getBoundingClientRect().bottom-pillars.getBoundingClientRect().top;
     const titleGap=parseFloat(getComputedStyle(eyebrow).marginBlockEnd);
     const titleInset=Math.min(12,upperBand-titleLines-titleGap-clearance);
     const actionInset=Math.min(height*.08,lowerBand-actionHeight-clearance);
     // CSS chooses the initial composition. Measurement can protect a larger
     // foreground by falling back to flow, but never promotes an initial flow.
     const initialOverlay=getComputedStyle(node).getPropertyValue('--initial-desktop-overlay').trim()==='1';
     const overlay=initialOverlay&&titleInset>=clearance&&actionInset>=clearance;
     node.dataset.desktopBands=overlay?'overlay':'flow';
     setHeroReflow(!overlay);
     return;
    }
   }
   delete node.dataset.desktopBands;
   setHeroReflow(desktop||portraitLandscape||heading.getBoundingClientRect().height>height*.25||action.getBoundingClientRect().height>height*.18);
  };
  const observer=typeof ResizeObserver==='undefined' ? null : new ResizeObserver(measure);
  [image,heading,action].forEach(element=>observer?.observe(element));
  image.addEventListener('load',measure); window.addEventListener('resize',measure); measure();
  return ()=>{observer?.disconnect();image.removeEventListener('load',measure);window.removeEventListener('resize',measure);};
 }, [locale]);

 function resetAcknowledgments(){setConductExplained(false);setReservationAccepted(false);}
 function changeChild(id:string, field:keyof Omit<ChildDraft,'id'>, value:string) {
  if(field==='name')resetAcknowledgments();
  setChildren(items=>items.map(item=>item.id===id ? {...item,[field]:value} : item));
 }
 function changeLocale(value:'en'|'he') {
  if(value!==locale&&!operation.current)resetAcknowledgments();
  setLocale(value); setMenuOpen(false); setError(''); setErrorTarget('');
 }
 function reportError(message:string, target='') {setErrorTarget(target); setError(message);}

 async function save(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!submitInterest || !reservationCollectionEnabled || inFlight.current || result?.state==='conflict') return;
  setError(''); setErrorTarget('');
  if (!operation.current) {
   const values = new FormData(event.currentTarget);
   const phoneE164 = String(values.get('phoneE164')??'').trim();
   const firstInvalid=event.currentTarget.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input:invalid,select:invalid,textarea:invalid');
   if(firstInvalid){
    reportError(firstInvalid.validity.valueMissing?copy.form.required_field:copy.form.invalid_field,firstInvalid.id);
    return;
   }
   const command = trip390CommandSchema.safeParse({operationId:crypto.randomUUID(), fields:{
    version:TRIP390_INTEREST_VERSION, offerVersion:TRIP390_OFFER.version,
    guardianName:values.get('guardianName'), email:values.get('email'), phone:phoneE164,
    city, postalCode:values.get('postalCode'), messageLanguage:values.get('messageLanguage'),
    instructionLanguage:values.get('instructionLanguage'),
    lessonDayDriving:{version:TRIP390_DRIVING_VERSION,limit:values.get('lessonDayDriving')},
    children:children.map(child=>({id:child.id==='first' ? crypto.randomUUID() : child.id,
     name:child.name, ageYears:child.age.trim() ? Number(child.age) : NaN, experience:child.experience})),
    acknowledgment:{version:TRIP390_NOTICE_VERSION, language:locale,
     conductExplained:values.get('conduct')==='on', interestPrivacySafety:values.get('interest')==='on',
     whatsapp:values.get('whatsapp')==='on',
     reservationNotice:{version:reservationNotice.version,language:documentLocale,text:reservationNotice.text,textDigest:reservationNotice.textDigest},
     studentConduct:{version:conduct.version,language:documentLocale,text:conduct.text,textDigest:conduct.textDigest}},
   }});
   if (!command.success) {
    const path=command.error.issues[0]?.path;
    const target=path?.[1]==='children' ? `trip390-child-${children[Number(path[2])]?.id}-${String(path[3])}`
     :path?.[1]==='acknowledgment'?(path.includes('interestPrivacySafety')||path.includes('reservationNotice'))?'trip390-interest':'trip390-conduct'
     :path?.[1]==='phone'?'trip390-phoneE164':`trip390-${String(path?.[1]??'')}`;
    reportError(copy.form.invalid_field, target);
    return;
   }
   operation.current=command.data;
   setOperationLocale(command.data.fields.acknowledgment.language);
  }
  inFlight.current=true; setBusy(true);
  try {
   const next=await submitInterest(operation.current);
   // Malformed/unbound success must never produce a permanent success screen.
   if (next?.state==='saved' && (next.operationId!==operation.current.operationId || typeof next.reference!=='string' || !next.reference.trim() || !['pending','not_queued','queued','sent','unknown','canceled'].includes(next.email))) {
    setResult({state:'unknown'});
   } else if (next?.state==='saved' || next?.state==='unknown' || next?.state==='conflict') {
    setResult(next);
    if (next.state==='conflict') reportError(copy.exact.form.conflict);
   } else if (next?.state==='rejected' && ['invalid','unavailable'].includes(next.reason)) {
    if(operation.current.fields.acknowledgment.language!==locale)resetAcknowledgments();
    setResult(next); operation.current=null;setOperationLocale(null);
    reportError(next.reason==='unavailable'
     ? copy.exact.form.unavailable
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
 const privacyPanel=<details name="trip390-notice" ref={privacyDisclosure} onToggle={oneInformationPanel}><summary>{reservationNotice.title}<span aria-hidden="true">+</span></summary><div className={styles.agreementPanel} tabIndex={0} role="region" aria-label={reservationNotice.title} data-reservation-notice-version={reservationNotice.version} data-reservation-notice-digest={reservationNotice.textDigest} lang={documentLocale}>{reservationNotice.paragraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div></details>;

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
   <section className={styles.hero} ref={hero} {...desktopGeometry} data-reflow={heroReflow?'true':undefined} aria-labelledby="trip390-title">
    <picture><source media="(max-width:767px), (max-width:999px) and (orientation:portrait)" srcSet="/groups/academy/hero-mobile-20261018.png" width="1143" height="2048"/><img src="/groups/academy/hero-desktop-20261018.png" width="2048" height="1143" alt={copy.exact.hero.alt} fetchPriority="high"/></picture>
    <div className={styles.heroText} data-hero-heading><p className={styles.heroEyebrow}><span aria-hidden="true"/>{copy.hero.eyebrow}<span aria-hidden="true"/></p><h1 id="trip390-title" lang="en" dir="ltr"><span>Jewish Leadership</span><span>Fishing Academy</span></h1></div>
    <div className={styles.heroAction} data-hero-action data-jlfa-hero-action><p className={styles.heroPillars} data-jlfa-pillars>{copy.hero.pillars}</p><a data-jlfa-reserve className={styles.action} href="#interest" onClick={openInterest}>{interestLabel}</a></div>
   </section>
   <section data-jlfa-intro className={`${styles.section} ${styles.introduction}`} aria-labelledby="trip390-intro-title">
    <div className={styles.sectionHeading}><h2 id="trip390-intro-title">{introHeading(copy.intro.title)}</h2></div>
    <p className={styles.lead}>{copy.intro.body}</p><p data-jlfa-audience className={styles.audienceLine}>{copy.intro.audience}</p><div className={styles.introInclusions}>{copy.intro.inclusions.map(item=><div key={item.id}><h3>{item.title}</h3><p>{item.body}</p></div>)}</div>
   </section>
   <section id="learn" className={`${styles.section} ${styles.skillsSection}`} aria-labelledby="trip390-learn-title">
    <div className={styles.sectionHeading}><h2 id="trip390-learn-title">{copy.learning.title}</h2><p>{copy.learning.subtitle}</p></div>
    <div className={styles.skills} data-jlfa-learning>{copy.skills.map((skill,index)=>{const asset=trip390LearningAssets[index];return <article key={skill.title} data-trip390-skill={index+1}>
     {asset?.src?<img className={styles.skillImage} data-academy-scene={asset.assetId} src={asset.src} width="1400" height="788" loading="lazy" alt={skill.alt}/>:<div className={styles.skillImageUnavailable} data-trip390-image-unavailable={index+1} aria-hidden="true"/>}
     <div className={styles.skillCopy}><h3>{skill.title}</h3><p>{skill.body}</p></div></article>;})}</div>
   </section>
   <section id="values" className={styles.valuesSection} data-jlfa-values><div className={styles.section}>
    <div className={styles.sectionHeading}><h2>{copy.exact.values.title}</h2><p>{copy.exact.values.body}</p></div>
    <div className={styles.valuesGrid}>{copy.exact.values.items.map((item,index)=><article key={item.id}><AcademyValueIcon name={(['clipboard-check','messages-square','route','rotate-cw'] as const)[index]!}/><div><h3>{item.title}</h3><p>{item.body}</p></div></article>)}</div>
    <div className={styles.valuesAction}><a className={styles.action} href="#interest" onClick={openInterest}>{interestLabel}</a></div>
   </div></section>
   <section id="about" className={`${styles.section} ${styles.founder}`} aria-labelledby="trip390-founder-title"><img src="/groups/people/founder-head.jpg" width="180" height="180" loading="eager" decoding="async" alt={copy.founder.title}/><div><h2 id="trip390-founder-title">{copy.founder.title}</h2><p>{copy.founder.body}</p></div></section>
   <section id="faq" className={styles.section} aria-labelledby="trip390-faq-title"><div className={styles.sectionHeading}><h2 id="trip390-faq-title">{copy.exact.faq.title}</h2></div><div className={styles.faqLayout}>{[publicFaqs.slice(0,Math.ceil(publicFaqs.length/2)),publicFaqs.slice(Math.ceil(publicFaqs.length/2))].map((items,index)=><div key={index} className={styles.faqs}>{items.map(item=><details key={item.id} id={item.id} data-trip390-faq data-jlfa-faq={item.id} name="trip390-faq" onToggle={event=>{if(event.currentTarget.open)page.current?.querySelectorAll<HTMLDetailsElement>('[data-trip390-faq]').forEach(node=>{if(node!==event.currentTarget)node.open=false;});}}><summary><span className={styles.faqQuestion}>{item.q}</span><span data-faq-glyph aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div>)}</div></section>
   <section id="interest" className={styles.finalInterest}><div className={styles.section}><h2>{copy.closing.title}</h2><p>{copy.closing.body}</p><a className={styles.action} href="#interest" onClick={openInterest}>{interestLabel}</a></div></section>
   <dialog className={styles.dialog} ref={dialog} aria-labelledby="trip390-interest-title" onKeyDown={containDialogTab} onCancel={event=>{event.preventDefault();closeInterest();}} onClose={()=>{if(!dialog.current?.open)setDialogOpen(false);}}>
    <div className={styles.dialogHeader}><h2 id="trip390-interest-title" ref={dialogTitle} tabIndex={-1}>{copy.form.title}</h2><button className={styles.closeDialog} type="button" onClick={closeInterest} aria-label={copy.exact.form.close}>×</button><div className={styles.languages} aria-label={t('Form language','שפת הטופס')}>{(['en','he'] as const).map(value=><button key={value} type="button" lang={value} aria-pressed={value===locale} onClick={()=>changeLocale(value)}>{value==='en'?'English':'עברית'}</button>)}</div></div>
    <div className={styles.dialogBody}><div className={styles.formIntro}><p>{copy.form.intro}</p>{(!submitInterest||!reservationCollectionEnabled)&&<p className={styles.unavailableNote}>{t('New registration is currently unavailable.','הרישום החדש אינו זמין כרגע.')}</p>}</div>
    {saved?<><div className={styles.saved} role="status" ref={savedSummary} tabIndex={-1}><span className={styles.savedMark} aria-hidden="true">✓</span><h3>{copy.form.saved}</h3><p>{copy.form.saved_body}</p><p>{({pending:copy.form.email_pending,queued:copy.exact.form.ackQueued,sent:copy.exact.form.ackSent,unknown:copy.exact.form.ackUnknown,canceled:t('No confirmation email will be sent.','לא תישלח הודעת אישור.'),not_queued:copy.form.email_not_queued})[result.email]}</p><p>{copy.form.saved_reference}: <bdi>{result.reference}</bdi></p></div><div className={styles.permissions}>{privacyPanel}</div></>
    :<form className={styles.form} ref={form} onSubmit={save} noValidate aria-busy={busy}>
     {error&&<p className={styles.error} role="alert" id="trip390-error" ref={errorSummary} tabIndex={-1}>{errorTarget?copy.form.validation_summary:error}{errorTarget&&<a href={'#'+errorTarget} onClick={event=>{event.preventDefault();document.getElementById(errorTarget)?.focus();}}>{t('Go to field','מעבר לשדה')}</a>}</p>}
     {unresolved&&<p className={styles.error} role="alert">{copy.form.save_unknown}</p>}
     <fieldset disabled={locked}><legend>{t('Parent & location','הורה ומיקום')}</legend><div className={styles.columns}>
      <label htmlFor="trip390-guardianName">{copy.form.guardian_name}<input id="trip390-guardianName" name="guardianName" required maxLength={100} autoComplete="name" {...invalid('trip390-guardianName')}/>{fieldError('trip390-guardianName')}</label>
      <label htmlFor="trip390-email">{copy.form.email}<input id="trip390-email" name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" {...invalid('trip390-email')}/>{fieldError('trip390-email')}</label>
      <label className={styles.fullWidth} htmlFor="trip390-phoneE164">{copy.form.phone}<input id="trip390-phoneE164" name="phoneE164" type="tel" autoComplete="tel" placeholder="+12025550101" pattern="\+[1-9][0-9]{7,14}" maxLength={16} dir="ltr" required aria-describedby="trip390-phone-hint" {...invalid('trip390-phoneE164')}/>{fieldError('trip390-phoneE164')}<small id="trip390-phone-hint">{copy.form.phone_hint}</small></label>
      <label htmlFor="trip390-city">{copy.form.city}<input id="trip390-city" name="city" required minLength={2} maxLength={120} value={city} onChange={event=>setCity(event.target.value)} list="trip390-cities" aria-describedby="trip390-city-hint" autoComplete="address-level2" {...invalid('trip390-city')}/><datalist id="trip390-cities">{trip390CitySuggestions(city).map(value=><option key={value} value={value}/>)}</datalist>{fieldError('trip390-city')}<small id="trip390-city-hint">{copy.form.city_hint}</small></label>
      <label htmlFor="trip390-postalCode">{copy.form.zip}<input id="trip390-postalCode" name="postalCode" required inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" dir="ltr" aria-describedby="trip390-zip-hint" {...invalid('trip390-postalCode')}/>{fieldError('trip390-postalCode')}<small id="trip390-zip-hint">{copy.form.zip_hint}</small></label>
     </div></fieldset>
     <fieldset disabled={locked}><legend>{t('The boys','הילדים')}</legend>
      {children.map((child,index)=><fieldset className={styles.child} key={child.id}><legend>{copy.form.child_heading.replace('{number}',String(index+1))}</legend><div className={styles.columns}>
       <label htmlFor={`trip390-child-${child.id}-name`}>{copy.form.child_name}<input id={`trip390-child-${child.id}-name`} required name={`child-${child.id}-name`} value={child.name} maxLength={100} onChange={event=>changeChild(child.id,'name',event.target.value)} {...invalid(`trip390-child-${child.id}-name`)}/>{fieldError(`trip390-child-${child.id}-name`)}</label>
       <label htmlFor={`trip390-child-${child.id}-ageYears`}>{copy.form.child_age}<input id={`trip390-child-${child.id}-ageYears`} required name={`child-${child.id}-age`} type="number" min={9} max={15} step={1} inputMode="numeric" value={child.age} onChange={event=>changeChild(child.id,'age',event.target.value)} {...invalid(`trip390-child-${child.id}-ageYears`)}/>{fieldError(`trip390-child-${child.id}-ageYears`)}</label>
       <label className={styles.fullWidth} htmlFor={`trip390-child-${child.id}-experience`}>{copy.form.experience}<select id={`trip390-child-${child.id}-experience`} value={child.experience} onChange={event=>changeChild(child.id,'experience',event.target.value)}>{['new','some','experienced','not_sure'].map((value,i)=><option key={value} value={value}>{copy.form.experience_choices[i]}</option>)}</select></label>
      </div>{children.length>1&&<button className={styles.removeChild} type="button" onClick={()=>{resetAcknowledgments();setChildren(items=>items.filter(item=>item.id!==child.id));}}>{copy.form.remove_child} {index+1}</button>}</fieldset>)}
      <button className={styles.addChild} type="button" disabled={children.length>=10} onClick={()=>{resetAcknowledgments();setChildren(items=>[...items,{id:crypto.randomUUID(),name:'',age:'',experience:'new'}]);}}><span aria-hidden="true">+</span> {copy.form.add_child}</button>
     </fieldset>
     <fieldset disabled={locked}><legend>{t('Preferences & questions','העדפות ושאלות')}</legend><div className={styles.columns}>
      <label className={styles.fullWidth} htmlFor="trip390-lessonDayDriving">{copy.form.driving_label}<select id="trip390-lessonDayDriving" name="lessonDayDriving" required defaultValue="" aria-describedby="trip390-driving-hint" {...invalid('trip390-lessonDayDriving')}><option value="" disabled>{t('Choose your driving-time preference','בחרו את העדפת זמן הנסיעה')}</option>{(['up_to_30','up_to_60','up_to_90','up_to_120','flexible'] as const).map((value,index)=><option key={value} value={value}>{copy.form.driving_choices[index]}</option>)}</select>{fieldError('trip390-lessonDayDriving')}<small id="trip390-driving-hint">{copy.form.driving_hint}</small></label>
      <label htmlFor="trip390-messageLanguage">{copy.form.message_language}<select id="trip390-messageLanguage" name="messageLanguage" defaultValue={initialLocale}><option value="en">English</option><option value="he">עברית</option></select></label>
      <label htmlFor="trip390-instructionLanguage">{copy.form.group_language}<select id="trip390-instructionLanguage" name="instructionLanguage" defaultValue="either"><option value="either">{t('Either','כל שפה')}</option><option value="en">English</option><option value="he">עברית</option></select></label>
     </div></fieldset>
     <fieldset disabled={locked||!reservationCollectionEnabled} className={styles.permissions}><legend>{t('Information & permissions','מידע ואישורים')}</legend>
      {privacyPanel}
      <label className={styles.check}><input id="trip390-interest" type="checkbox" name="interest" required checked={reservationAccepted} onChange={event=>setReservationAccepted(event.target.checked)} {...invalid('trip390-interest')}/><span lang={documentLocale}>{reservationNotice.acknowledgment}{fieldError('trip390-interest')}</span></label>
      <details name="trip390-notice" onToggle={oneInformationPanel}><summary>{conduct.title}<span aria-hidden="true">+</span></summary><div className={styles.agreementPanel} tabIndex={0} role="region" aria-label={conduct.title} data-student-conduct-version={conduct.version} data-student-conduct-digest={conduct.textDigest} lang={documentLocale}><p>{conduct.intro}</p>{conduct.sections.map(section=><section key={section.title}><h3>{section.title}</h3><p>{section.body}</p></section>)}</div></details>
      <label className={styles.check}><input id="trip390-conduct" type="checkbox" name="conduct" required checked={conductExplained} onChange={event=>setConductExplained(event.target.checked)} {...invalid('trip390-conduct')}/><span lang={documentLocale}>{conduct.acknowledgment}{fieldError('trip390-conduct')}</span></label>
      <label className={styles.check}><input type="checkbox" name="whatsapp" checked={whatsapp} onChange={event=>setWhatsapp(event.target.checked)}/><span lang={documentLocale}>{consentCopy.whatsapp}</span></label>
     </fieldset>
     <div className={styles.submitArea}><p className={styles.finePrint}>{copy.form.place_not_confirmed}</p>{(!submitInterest||!reservationCollectionEnabled)&&<p role="status">{t('New registration is currently unavailable.','הרישום החדש אינו זמין כרגע.')}</p>}<button className={styles.action} type="submit" disabled={!submitInterest||!reservationCollectionEnabled||busy||result?.state==='conflict'}>{busy?copy.form.sending:unresolved?t('Check same submission','בדיקת אותה פנייה'):copy.form.submit}</button></div>
    </form>}
   </div></dialog>
  </main>
  <footer className={styles.footer}><a href="#main" className={styles.footerBrand}><img src="/groups/brand/jlfa-logo-locked-v1.png" width="64" height="64" alt=""/><span>{copy.brand}</span></a><p className={styles.affiliation}>{copy.footer.affiliation}</p><nav className={styles.footerLinks} aria-label={t('Contact and privacy','יצירת קשר ופרטיות')}><a href={ACADEMY_CONTACT.telephone}>{copy.footer.contact}</a><a href={'https://wa.me/13054916674?text='+encodeURIComponent(copy.whatsapp_inquiry)} rel="noopener noreferrer" referrerPolicy="no-referrer">{copy.footer.whatsapp}</a><a href="#interest" onClick={openPrivacy}>{copy.footer.privacy}</a></nav></footer>
  <a className={styles.whatsapp} ref={contact} hidden={dialogOpen} tabIndex={dialogOpen?-1:0} aria-hidden={dialogOpen||undefined} href={'https://wa.me/13054916674?text='+encodeURIComponent(copy.whatsapp_inquiry)} aria-label={t('Contact us on WhatsApp','דברו איתנו בוואטסאפ')} rel="noopener noreferrer" referrerPolicy="no-referrer"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M26 15a11 11 0 0 1-16.5 9.5L4 26l1.6-5.3A11 11 0 1 1 26 15Z"/><path d="m10.4 9.4 2.1-.2 1.5 3-1.4 1.5c1 2 2.5 3.4 4.6 4.3l1.5-1.4 3 1.5-.3 2c-.2 1.4-2.3 1.6-3.5 1.1-4.9-1.8-8.4-5.4-9-9.1-.2-1.3.2-2.4 1.5-2.7Z"/></svg></a>
 </div>;
}
