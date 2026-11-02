/* eslint-disable @next/next/no-img-element -- preserve approved photography bytes */
'use client';
import React,{useRef,useState} from 'react';
import {trip390Copy,trip390CitySuggestions,trip390CommandSchema,TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_OFFER,type Trip390Command} from './academy-trip390-contract.ts';
import site from './academy-site.module.css';
import styles from './academy-trip390.module.css';

export type Trip390SaveResult={state:'saved';reference:string;email:'pending'|'not_queued'}|{state:'unknown'}|{state:'conflict'};
/** The integrator supplies the admitted existing HTTP transport. Without it the
 * component cannot submit. A promise resolving alone never implies delivery. */
export function AcademyTrip390Page({initialLocale='en',submitInterest}:{initialLocale?:'en'|'he';submitInterest?:(command:Trip390Command)=>Promise<Trip390SaveResult>}){
 const [locale,setLocale]=useState(initialLocale),[children,setChildren]=useState([{id:'',name:'',age:'',experience:'new'}]),[city,setCity]=useState(''),[result,setResult]=useState<Trip390SaveResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const operation=useRef<Trip390Command|null>(null),form=useRef<HTMLFormElement>(null),copy=trip390Copy[locale],t=(en:string,he:string)=>locale==='he'?he:en;
 const unresolved=result?.state==='unknown';
 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(!submitInterest||busy)return;setError('');
  if(!operation.current){
   const values=new FormData(event.currentTarget),phone=String(values.get('phone')??'').trim(),notes=String(values.get('notes')??'').trim();
   const command=trip390CommandSchema.safeParse({operationId:crypto.randomUUID(),fields:{version:TRIP390_INTEREST_VERSION,offerVersion:TRIP390_OFFER.version,guardianName:values.get('guardianName'),email:values.get('email'),...(phone?{phone}:{}),city,postalCode:values.get('postalCode'),messageLanguage:values.get('messageLanguage'),instructionLanguage:values.get('instructionLanguage'),...(notes?{notes}:{}),children:children.map(child=>({id:child.id||crypto.randomUUID(),name:child.name,ageYears:child.age.trim()?Number(child.age):NaN,experience:child.experience})),acknowledgment:{version:TRIP390_NOTICE_VERSION,language:locale,conductExplained:values.get('conduct')==='on',interestPrivacySafety:values.get('interest')==='on',whatsapp:values.get('whatsapp')==='on'}}});
   if(!command.success){setError(t('Check the form fields, both required acknowledgments, and an international phone number if WhatsApp is selected.','בדקו את פרטי הטופס, שני האישורים הנדרשים ומספר טלפון בינלאומי אם בחרתם בוואטסאפ.'));return;}
   operation.current=command.data;
  }
  setBusy(true);try{const next=await submitInterest(operation.current);setResult(next);if(next.state==='conflict')setError(t('This submission needs private owner review. Do not create a duplicate.','הפנייה דורשת בדיקה פרטית של הבעלים. אין ליצור פנייה כפולה.'));}catch{setResult({state:'unknown'});}finally{setBusy(false);}
 }
 const saved=result?.state==='saved';
 return <div className={`${site.site} ${styles.page}`} lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <a className={site.skip} href="#main">{t('Skip to content','דלגו לתוכן')}</a>
  <header className={styles.header}><a href="#main" aria-label={copy.brand}><img src="/groups/brand/jlfa-logo-locked-v1.png" width="72" height="72" alt={copy.brand}/></a><nav aria-label={t('Academy navigation','ניווט באקדמיה')}>{(['how','learn','included','dates','faq'] as const).map(key=><a key={key} href={'#'+key}>{copy.nav[key]}</a>)}</nav><div>{(['en','he'] as const).map(value=><button key={value} type="button" lang={value} aria-pressed={value===locale} onClick={()=>setLocale(value)}>{value==='en'?'English':'עברית'}</button>)}</div></header>
  <main id="main">
   <section className={styles.hero}><picture><source media="(max-width:600px)" srcSet="/groups/academy/hero-mobile-20261018.png"/><img src="/groups/academy/hero-desktop-20261018.png" width="2048" height="1143" alt={t('Fishing Academy preparation and fishing','הכנה ודיג באקדמיה לדיג')} fetchPriority="high"/></picture><div className={styles.heroText}><p>{copy.hero.eyebrow}</p><h1 lang="en" dir="ltr">{copy.hero.title}</h1><p>{copy.hero.pillars}</p></div></section>
   <section className={styles.offer}><h2>{copy.hero.description}</h2><p className={styles.amount}><bdi>{copy.hero.offer}</bdi> <small>USD</small></p><p>{copy.hero.includes}</p><p>{copy.hero.included_trip}</p><p>{copy.hero.equipment_note}</p><a className={styles.action} href="#interest">{copy.hero.interest_cta}</a><p>{copy.hero.interest_note}</p></section>
   <section id="how" className={styles.section}><h2>{copy.intro.title}</h2><p>{copy.intro.body}</p><p>{copy.intro.values}</p><div className={styles.grid}>{copy.steps.map(step=><article key={step.title}><h3>{step.title}</h3><p>{step.body}</p></article>)}</div></section>
   <section id="learn" className={styles.section}><h2>{copy.nav.learn}</h2><div className={styles.grid}>{copy.skills.map((skill,index)=><article key={skill.title}><img src={'/groups/academy/scenes/'+['foundation','foundation','independent','independent','advanced','leadership'][index]+'.webp'} width="640" height="400" loading="lazy" alt=""/><h3>{skill.title}</h3><p>{skill.body}</p></article>)}</div></section>
   <section id="included" className={styles.section}><h2>{copy.price.title}</h2><p><bdi>{copy.price.amount}</bdi> USD</p><p>{copy.price.unit}</p><div className={styles.columns}><div><h3>{copy.nav.included}</h3><ul>{copy.price.included.map(item=><li key={item}>{item}</li>)}</ul></div><div><h3>{t('Separate','בנפרד')}</h3><ul>{copy.price.separate.map(item=><li key={item}>{item}</li>)}</ul></div></div><p>{copy.price.renewal}</p><h3>{copy.returning.title}</h3><p>{copy.returning.body}</p></section>
   <section id="dates" className={styles.section}><h2>{copy.dates.title}</h2><p>{copy.dates.empty}</p><h3>{copy.location.title}</h3><p>{copy.location.body}</p></section>
   <section className={styles.section}><h2>{copy.torah.title}</h2><p>{copy.torah.body}</p><h3>{copy.founder.title}</h3><p>{copy.founder.body}</p></section>
   <section id="faq" className={styles.section}><h2>{copy.nav.faq}</h2>{copy.faqs.map(item=><details key={item.id} name="trip390-faq"><summary>{item.q}</summary><p>{item.a}</p></details>)}</section>
   <section id="interest" className={styles.section}><h2>{copy.form.title}</h2><p>{copy.form.intro}</p>
    {saved?<div role="status"><p>{copy.form.saved}</p><p>{copy.form.email_pending}</p><p>{copy.form.saved_reference}: <bdi>{result.reference}</bdi></p></div>:<form ref={form} onSubmit={save}>
     {error&&<p role="alert">{error}</p>}{unresolved&&<p role="alert">{copy.form.save_unknown}</p>}
     <fieldset disabled={busy||unresolved||result?.state==='conflict'}><legend>{t('Family interest','פרטי ההתעניינות')}</legend><div className={styles.columns}>
      <label>{copy.form.guardian_name}<input name="guardianName" required maxLength={100} autoComplete="name"/></label><label>{copy.form.email}<input name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr"/></label>
      <label>{copy.form.phone}<input name="phone" type="tel" autoComplete="tel" placeholder="+1…" dir="ltr"/></label>
      <label>{copy.form.city}<input name="city" required minLength={2} maxLength={120} value={city} onChange={event=>setCity(event.target.value)} list="trip390-cities" aria-describedby="trip390-city-hint" autoComplete="address-level2"/><datalist id="trip390-cities">{trip390CitySuggestions(city).map(value=><option key={value} value={value}/>)}</datalist><small id="trip390-city-hint">{copy.form.city_hint}</small></label>
      <label>{copy.form.zip}<input name="postalCode" required pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" dir="ltr"/><small>{copy.form.zip_hint}</small></label>
     </div>
     {children.map((child,index)=><fieldset key={index}><legend>{copy.form.child_name} {index+1}</legend><div className={styles.columns}>
      <label>{copy.form.child_name}<input required value={child.name} maxLength={100} onChange={event=>setChildren(items=>items.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></label>
      <label>{copy.form.child_age}<input required type="number" min={0} max={120} value={child.age} onChange={event=>setChildren(items=>items.map((item,i)=>i===index?{...item,age:event.target.value}:item))}/></label>
      <label>{copy.form.experience}<select value={child.experience} onChange={event=>setChildren(items=>items.map((item,i)=>i===index?{...item,experience:event.target.value}:item))}>{['new','some','experienced','not_sure'].map((value,i)=><option key={value} value={value}>{copy.form.experience_choices[i]}</option>)}</select></label></div>
      {children.length>1&&<button type="button" onClick={()=>setChildren(items=>items.filter((_,i)=>i!==index))}>{copy.form.remove_child}</button>}</fieldset>)}
     <button type="button" disabled={children.length>=10} onClick={()=>setChildren(items=>[...items,{id:crypto.randomUUID(),name:'',age:'',experience:'new'}])}>{copy.form.add_child}</button>
     <div className={styles.columns}><label>{copy.form.message_language}<select name="messageLanguage" defaultValue="en"><option value="en">English</option><option value="he">עברית</option></select></label><label>{copy.form.group_language}<select name="instructionLanguage" defaultValue="either"><option value="either">{t('Either','כל שפה')}</option><option value="en">English</option><option value="he">עברית</option></select></label></div>
     <label>{copy.form.notes}<textarea name="notes" maxLength={600}/><small>{copy.form.notes_hint}</small></label>
     <details name="trip390-notice"><summary>{copy.conduct.title}</summary><p>{copy.conduct.body}</p></details><details name="trip390-notice"><summary>{t('Interest, safety and privacy','התעניינות, בטיחות ופרטיות')}</summary><p>{copy.form.privacy_short}</p><p>{copy.form.interest_ack}</p><p>{copy.hero.interest_note}</p></details>
     <label className={styles.check}><input type="checkbox" name="conduct" required/>{copy.form.conduct}</label><label className={styles.check}><input type="checkbox" name="interest" required/>{copy.form.interest_ack}</label><label className={styles.check}><input type="checkbox" name="whatsapp"/>{copy.form.whatsapp}</label></fieldset>
     {!submitInterest&&<p role="status">{t('Local candidate: saving is awaiting the existing intake integration.','גרסה מקומית: השמירה ממתינה לחיבור למערכת הפניות הקיימת.')}</p>}
     <button className={styles.action} type="submit" disabled={!submitInterest||busy||result?.state==='conflict'}>{busy?copy.form.sending:unresolved?t('Check same submission','בדיקת אותה פנייה'):copy.form.submit}</button>
    </form>}
   </section>
  </main><footer className={styles.section}><p>{copy.brand}</p><a href={'https://wa.me/13054916674?text='+encodeURIComponent(copy.whatsapp_inquiry)} rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp · <bdi>+1 305-491-6674</bdi></a></footer>
 </div>;
}
