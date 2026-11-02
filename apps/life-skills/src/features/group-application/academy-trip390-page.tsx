/* eslint-disable @next/next/no-img-element -- consume protected original asset bytes */
'use client';
import React, {useEffect, useRef, useState} from 'react';
import {trip390Copy, trip390CitySuggestions, trip390CommandSchema, TRIP390_INTEREST_VERSION, TRIP390_NOTICE_VERSION, TRIP390_OFFER, type Trip390Command} from './academy-trip390-contract.ts';
import site from './academy-site.module.css';
import styles from './academy-trip390.module.css';

export type Trip390SaveResult =
 | {state:'saved'; operationId:string; reference:string; email:'pending'|'not_queued'}
 | {state:'unknown'} | {state:'conflict'}
 /** Only an authoritative rejection may unlock editing. Transport errors are UNKNOWN. */
 | {state:'rejected'; reason:'invalid'|'unavailable'};

type ChildDraft = {id:string; name:string; age:string; experience:string};
const navigation = ['how', 'learn', 'included', 'dates', 'faq'] as const;

/** Candidate frontend. The existing integrator owns route mounting and the
 * admitted transport. Never map this payload into fabricated legacy fields. */
export function AcademyTrip390Page({initialLocale='en', submitInterest}: {
 initialLocale?:'en'|'he'; submitInterest?:(command:Trip390Command)=>Promise<Trip390SaveResult>;
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
 const operation = useRef<Trip390Command|null>(null);
 const inFlight = useRef(false);
 const form = useRef<HTMLFormElement>(null);
 const menuButton = useRef<HTMLButtonElement>(null);
 const errorSummary = useRef<HTMLParagraphElement>(null);
 const savedSummary = useRef<HTMLDivElement>(null);
 const hero = useRef<HTMLElement>(null);
 const copy = trip390Copy[locale];
 const t = (en:string, he:string) => locale==='he' ? he : en;
 const unresolved = result?.state==='unknown';
 const saved = result?.state==='saved';
 const locked = busy || unresolved || result?.state==='conflict';

 useEffect(() => {
  if (!menuOpen) return;
  const escape = (event:KeyboardEvent) => {
   if (event.key==='Escape') {setMenuOpen(false); menuButton.current?.focus();}
  };
  document.addEventListener('keydown', escape);
  return () => document.removeEventListener('keydown', escape);
 }, [menuOpen]);
 useEffect(() => {
  if (error) errorSummary.current?.focus();
 }, [error]);
 useEffect(() => {
  if (saved) savedSummary.current?.focus();
 }, [saved]);
 useEffect(() => {
  if (typeof IntersectionObserver==='undefined') return;
  const observer = new IntersectionObserver(entries => {
   const visible = entries.filter(entry=>entry.isIntersecting);
   if (visible[0]) setActiveSection(visible[0].target.id);
  }, {rootMargin:'-10% 0px -65% 0px'});
  navigation.forEach(id => {const node=document.getElementById(id); if(node) observer.observe(node);});
  return () => observer.disconnect();
 }, []);
 useEffect(() => {
  const node=hero.current;
  const image=node?.querySelector('img');
  const heading=node?.querySelector<HTMLElement>('[data-hero-heading]');
  const action=node?.querySelector<HTMLElement>('[data-hero-action]');
  if (!image || !heading || !action) return;
  const measure=()=>{
   if (!image.naturalWidth) return;
   setHeroReflow(heading.getBoundingClientRect().height+action.getBoundingClientRect().height>image.getBoundingClientRect().height*.48);
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
   if (!event.currentTarget.reportValidity()) return;
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

 const navLinks = navigation.map(key=><a key={key} href={'#'+key} aria-current={activeSection===key ? 'location' : undefined} onClick={()=>{setMenuOpen(false);setActiveSection(key);}}>{copy.nav[key]}</a>);
 const invalid = (id:string) => errorTarget===id ? {'aria-invalid':true as const,'aria-describedby':'trip390-error'} : {};

 return <div className={`${site.site} ${styles.page}`} lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <a className={site.skip} href="#main">{t('Skip to content','דלגו לתוכן')}</a>
  <aside className={styles.reviewNote}>{t('Review candidate · English and Hebrew wording awaits approval.','גרסה לבדיקה · הנוסח באנגלית ובעברית ממתין לאישור.')}</aside>
  <header className={styles.header}>
   <a className={styles.logo} href="#main" aria-label={copy.brand}><img src="/groups/brand/jlfa-logo-locked-v1.png" width="72" height="72" alt={copy.brand}/></a>
   <nav className={styles.desktopNav} aria-label={t('Academy navigation','ניווט באקדמיה')}>{navLinks}</nav>
   <div className={styles.languages} aria-label={t('Website language','שפת האתר')}>{(['en','he'] as const).map(value=><button key={value} type="button" lang={value} aria-pressed={value===locale} onClick={()=>changeLocale(value)}>{value==='en'?'English':'עברית'}</button>)}</div>
   <a className={`${styles.action} ${styles.headerAction}`} href="#interest">{copy.hero.interest_cta}</a>
   <button className={styles.menuButton} ref={menuButton} type="button" aria-label={menuOpen?t('Close menu','סגירת התפריט'):t('Open menu','פתיחת התפריט')} aria-expanded={menuOpen} aria-controls="trip390-menu" onClick={()=>setMenuOpen(value=>!value)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{menuOpen?<path d="m6 6 12 12M6 18 18 6"/>:<path d="M4 6h16M4 12h16M4 18h16"/>}</svg>
   </button>
   <nav id="trip390-menu" className={styles.mobileNav} hidden={!menuOpen} aria-label={t('Mobile Academy navigation','ניווט נייד באקדמיה')}>{navLinks}<a href="#interest" onClick={()=>setMenuOpen(false)}>{copy.hero.interest_cta}</a></nav>
  </header>
  <main id="main" tabIndex={-1}>
   <section className={styles.hero} ref={hero} data-reflow={heroReflow?'true':undefined} aria-labelledby="trip390-title">
    <picture><source media="(max-width:767px)" srcSet="/groups/academy/hero-mobile-20261018.png" width="1143" height="2048"/><img src="/groups/academy/hero-desktop-20261018.png" width="2048" height="1143" alt={t('An adult and a boy preparing fishing equipment by the water','מבוגר וילד מכינים ציוד דיג ליד המים')} fetchPriority="high"/></picture>
    <div className={styles.heroText} data-hero-heading><p className={styles.eyebrow}>{copy.hero.eyebrow}</p><h1 id="trip390-title" lang="en" dir="ltr"><span>Jewish Leadership</span><span>Fishing Academy</span></h1></div>
    <div className={styles.heroAction} data-hero-action><p className={styles.pillars}>{copy.hero.pillars}</p><div className={styles.heroActionRow}><p className={styles.heroPrice}><bdi>{copy.hero.offer}</bdi><small> USD</small></p><a className={styles.action} href="#interest">{copy.hero.interest_cta}<span aria-hidden="true">↗</span></a></div><p className={styles.heroIncludes}>{copy.hero.includes}</p></div>
   </section>
   <section className={styles.offer} aria-label={t('The Fishing Academy package','חבילת האקדמיה לדיג')}><div><h2>{copy.hero.description}</h2><p>{copy.hero.included_trip}</p><p>{copy.hero.equipment_note}</p></div><p className={styles.offerNote}>{copy.hero.interest_note}</p></section>
   <section id="how" className={styles.section} aria-labelledby="trip390-how-title">
    <div className={styles.sectionHeading}><span className={styles.sectionNumber} aria-hidden="true">01 /</span><h2 id="trip390-how-title">{copy.intro.title}</h2></div>
    <div className={styles.intro}><p className={styles.lead}>{copy.intro.body}</p><p>{copy.intro.values}</p></div>
    <ol className={styles.steps}>{copy.steps.map((step,index)=><li key={step.title}><span className={styles.stepNumber} aria-hidden="true">0{index+1}</span><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
   </section>
   <section id="learn" className={`${styles.section} ${styles.skillsSection}`} aria-labelledby="trip390-learn-title">
    <div className={styles.sectionHeading}><span className={styles.sectionNumber} aria-hidden="true">02 /</span><h2 id="trip390-learn-title">{copy.nav.learn}</h2></div>
    <div className={styles.skills}>{copy.skills.map((skill,index)=><article key={skill.title}><span aria-hidden="true">{String(index+1).padStart(2,'0')}</span><div><h3>{skill.title}</h3><p>{skill.body}</p></div></article>)}</div>
   </section>
   <section id="included" className={styles.packageSection} aria-labelledby="trip390-package-title"><div className={styles.packageInner}>
    <div className={styles.packageIntro}><span className={styles.sectionNumber} aria-hidden="true">03 /</span><h2 id="trip390-package-title">{copy.price.title}</h2><p className={styles.packagePrice}><bdi>{copy.price.amount}</bdi><small> USD</small></p><p>{copy.price.unit}</p><p className={styles.finePrint}>{copy.price.renewal}</p><a className={styles.action} href="#interest">{copy.hero.interest_cta}<span aria-hidden="true">↗</span></a></div>
    <div className={styles.packageDetails}><div className={styles.inclusionColumns}><div><h3>{copy.nav.included}</h3><ul className={styles.included}>{copy.price.included.map(item=><li key={item}>{item}</li>)}</ul></div><div><h3>{t('Separate','בנפרד')}</h3><ul className={styles.separate}>{copy.price.separate.map(item=><li key={item}>{item}</li>)}</ul></div></div><div className={styles.returning}><h3>{copy.returning.title}</h3><p>{copy.returning.body}</p></div></div>
   </div></section>
   <section id="dates" className={styles.section} aria-labelledby="trip390-dates-title"><div className={styles.dates}>
    <div><span className={styles.sectionNumber} aria-hidden="true">04 /</span><h2 id="trip390-dates-title">{copy.dates.title}</h2><p>{copy.dates.empty}</p><a className={styles.action} href="#interest">{copy.hero.interest_cta}<span aria-hidden="true">↗</span></a></div><div className={styles.location}><h3>{copy.location.title}</h3><p>{copy.location.body}</p></div>
   </div></section>
   <section className={`${styles.section} ${styles.valuesSection}`}><div><h2>{copy.torah.title}</h2><p>{copy.torah.body}</p></div><div><h2>{copy.founder.title}</h2><p>{copy.founder.body}</p></div></section>
   <section id="faq" className={styles.section} aria-labelledby="trip390-faq-title"><div className={styles.faqLayout}><div className={styles.sectionHeading}><span className={styles.sectionNumber} aria-hidden="true">05 /</span><h2 id="trip390-faq-title">{copy.nav.faq}</h2></div><div className={styles.faqs}>{copy.faqs.map(item=><details key={item.id} name="trip390-faq"><summary>{item.q}<span aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div></div></section>
   <section id="interest" className={styles.formSection} aria-labelledby="trip390-interest-title"><div className={styles.formLayout}>
    <div className={styles.formIntro}><span className={styles.sectionNumber} aria-hidden="true">06 /</span><h2 id="trip390-interest-title">{copy.form.title}</h2><p>{copy.form.intro}</p><p className={styles.privateNote}>{copy.form.privacy_short}</p>{!submitInterest&&<p className={styles.unavailableNote}>{t('Preview only. Saving is unavailable until the existing inquiry integration is admitted.','תצוגה מקדימה בלבד. השמירה אינה זמינה עד לחיבור למערכת הפניות הקיימת.')}</p>}</div>
    {saved?<div className={styles.saved} role="status" ref={savedSummary} tabIndex={-1}><span className={styles.savedMark} aria-hidden="true">✓</span><h3>{copy.form.saved}</h3><p>{result.email==='pending'?copy.form.email_pending:t('No confirmation email has been queued.','לא הוכנסה הודעת אישור לתור השליחה.')}</p><p>{copy.form.saved_reference}: <bdi>{result.reference}</bdi></p></div>
    :<form className={styles.form} ref={form} onSubmit={save} noValidate aria-busy={busy}>
     {error&&<p className={styles.error} role="alert" id="trip390-error" ref={errorSummary} tabIndex={-1}>{error}{errorTarget&&<a href={'#'+errorTarget} onClick={()=>document.getElementById(errorTarget)?.focus()}>{t('Go to field','מעבר לשדה')}</a>}</p>}
     {unresolved&&<p className={styles.error} role="alert">{copy.form.save_unknown}</p>}
     <fieldset disabled={locked}><legend>{t('Parent & location','הורה ומיקום')}</legend><div className={styles.columns}>
      <label htmlFor="trip390-guardianName">{copy.form.guardian_name}<input id="trip390-guardianName" name="guardianName" required maxLength={100} autoComplete="name" {...invalid('trip390-guardianName')}/></label>
      <label htmlFor="trip390-email">{copy.form.email}<input id="trip390-email" name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" {...invalid('trip390-email')}/></label>
      <label htmlFor="trip390-phone">{copy.form.phone}<input id="trip390-phone" name="phone" type="tel" autoComplete="tel" placeholder="+1…" dir="ltr" required={whatsapp} {...invalid('trip390-phone')}/>{whatsapp&&<small>{t('Required for WhatsApp updates. Use an international number, for example +12025550101.','נדרש לעדכוני וואטסאפ. השתמשו במספר בינלאומי, לדוגמה +12025550101.')}</small>}</label>
      <label htmlFor="trip390-city">{copy.form.city}<input id="trip390-city" name="city" required minLength={2} maxLength={120} value={city} onChange={event=>setCity(event.target.value)} list="trip390-cities" aria-describedby="trip390-city-hint" autoComplete="address-level2" {...invalid('trip390-city')}/><datalist id="trip390-cities">{trip390CitySuggestions(city).map(value=><option key={value} value={value}/>)}</datalist><small id="trip390-city-hint">{copy.form.city_hint}</small></label>
      <label htmlFor="trip390-postalCode">{copy.form.zip}<input id="trip390-postalCode" name="postalCode" required inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" dir="ltr" aria-describedby="trip390-zip-hint" {...invalid('trip390-postalCode')}/><small id="trip390-zip-hint">{copy.form.zip_hint}</small></label>
     </div></fieldset>
     <fieldset disabled={locked}><legend>{t('The boys','הילדים')}</legend>
      {children.map((child,index)=><fieldset className={styles.child} key={child.id}><legend>{copy.form.child_name} {index+1}</legend><div className={styles.columns}>
       <label htmlFor={`trip390-child-${child.id}-name`}>{copy.form.child_name}<input id={`trip390-child-${child.id}-name`} required name={`child-${child.id}-name`} value={child.name} maxLength={100} onChange={event=>changeChild(child.id,'name',event.target.value)}/></label>
       <label htmlFor={`trip390-child-${child.id}-ageYears`}>{copy.form.child_age}<input id={`trip390-child-${child.id}-ageYears`} required name={`child-${child.id}-age`} type="number" min={0} max={120} step={1} inputMode="numeric" value={child.age} onChange={event=>changeChild(child.id,'age',event.target.value)}/></label>
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
      <label className={styles.check}><input type="checkbox" name="conduct" required/>{copy.form.conduct}</label>
      <label className={styles.check}><input type="checkbox" name="interest" required/>{copy.form.interest_ack}</label>
      <label className={styles.check}><input type="checkbox" name="whatsapp" checked={whatsapp} onChange={event=>setWhatsapp(event.target.checked)}/>{copy.form.whatsapp}</label>
     </fieldset>
     <div className={styles.submitArea}>{!submitInterest&&<p role="status">{t('Saving is unavailable in this review preview.','השמירה אינה זמינה בתצוגת הבדיקה הזאת.')}</p>}<button className={styles.action} type="submit" disabled={!submitInterest||busy||result?.state==='conflict'}>{busy?copy.form.sending:unresolved?t('Check same submission','בדיקת אותה פנייה'):copy.form.submit}<span aria-hidden="true">↗</span></button><p className={styles.finePrint}>{copy.hero.interest_note}</p></div>
    </form>}
   </div></section>
  </main>
  <footer className={styles.footer}><a href="#main" className={styles.footerBrand}><img src="/groups/brand/jlfa-logo-locked-v1.png" width="64" height="64" alt=""/><span>{copy.brand}</span></a><a href={'https://wa.me/13054916674?text='+encodeURIComponent(copy.whatsapp_inquiry)} rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp · <bdi>+1 305-491-6674</bdi></a></footer>
 </div>;
}
