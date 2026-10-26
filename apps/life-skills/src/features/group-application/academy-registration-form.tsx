"use client";
import {useEffect,useRef,useState,type FormEvent,type InputHTMLAttributes} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {floridaAcademyRegistrationFieldsSchema,type FloridaGroupApplicationCommand} from './contract.ts';
import {ACADEMY_REGISTRATION_VERSION,academyGradeLabels,registrationConsent} from './academy-registration.ts';
import {academyCommunicationNotice,academyCommunicationNoticeHashes,communicationPreferenceSelection} from './academy-communication-preferences.ts';
import {academyRegistrationNotice} from './academy-registration-notice.ts';
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {captureCampaignAttribution,type CampaignAttribution} from './academy-campaign-contract.ts';
import type {FounderPublicResult} from './academy-founder-contract.ts';
import {AcademyRegistrationOffer} from './academy-pricing.tsx';
import {AcademyProgramTerms} from './academy-program-terms.tsx';
import {academyTripCopy} from './academy-trip-copy.ts';
import {useAcademyHref} from './academy-route-context.tsx';
import styles from './academy-registration.module.css';

function ChoiceDropdown({name,label,options,value,onChange,empty,error}:{name:string;label:string;options:readonly {value:string;label:string;disabled?:boolean}[];value:string[];onChange:(v:string[])=>void;empty:string;error?:string|undefined}){
 function toggle(item:string){onChange(item==='flexible'?(value.includes(item)?[]:['flexible']):value.includes(item)?value.filter(v=>v!==item):[...value.filter(v=>v!=='flexible'),item]);}
 return <details className={styles.dropdown}><summary id={'registration-'+name} aria-invalid={!!error} aria-describedby={error?'registration-error-'+name:undefined}><strong>{label}</strong><span>{value.length?options.filter(o=>value.includes(o.value)).map(o=>o.label).join(', '):empty}</span></summary><div role="group" aria-label={label}>{options.map(o=><label key={o.value}><input type="checkbox" name={name} value={o.value} checked={value.includes(o.value)} disabled={o.disabled} onChange={()=>toggle(o.value)}/>{o.label}</label>)}</div>{error&&<small id={'registration-error-'+name} className={styles.errorText}>{error}</small>}</details>;
}
function Field({name,label,error,...props}:{name:string;label:string;error?:string|undefined}&InputHTMLAttributes<HTMLInputElement>){
 const id='registration-'+name.replace(/[^a-zA-Z0-9-]/g,'-');return <div className={styles.field}><label htmlFor={id}>{label}</label><input {...props} id={id} name={name} aria-invalid={!!error} aria-describedby={error?id+'-error':undefined}/>{error&&<small id={id+'-error'} className={styles.errorText}>{error}</small>}</div>;
}
type Child={key:number;id:string;name:string};
export function registrationErrorTarget(name:string,children:readonly {id:string}[],locale:Locale):{id:string;label:string}|null{
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const labels:Record<string,string>={parentName:t('Parent or guardian full name','שם מלא של הורה או אפוטרופוס'),contact:t('Phone or email','טלפון או דוא״ל'),cityArea:t('City / area','עיר / אזור'),postalCode:t('ZIP code','מיקוד'),receiptEmail:t('Email','דוא״ל'),preferredDays:t('Preferred days','ימים מועדפים'),preferredTimes:t('Preferred times','שעות מועדפות'),driveMinutes:t('Driving minutes','דקות נסיעה'),schoolHoursAvailability:t('Availability during school hours','זמינות בשעות בית הספר'),preferredGroupLanguage:t('Preferred group language','שפה מועדפת בקבוצה'),optionalNotes:t('Optional notes','הערות'),permission:t('Registration privacy and contact consent','הסכמה לפרטיות ויצירת קשר בהרשמה')};
 const key=name.startsWith('permission.')?'permission':name;
 if(labels[key])return {id:'registration-'+key,label:labels[key]};
 for(const [index,child] of children.entries()){
  const prefix='child-'+child.id+'-';if(!child.id||!name.startsWith(prefix))continue;
  const label=({name:t('Full name','שם מלא'),age:t('Age','גיל'),grade:t('Grade','כיתה'),schooling:t('School or homeschool','בית ספר או חינוך ביתי'),experience:t('Fishing experience','ניסיון בדיג')} as Record<string,string>)[name.slice(prefix.length)];
  if(label)return {id:'registration-'+name,label:t('Child','ילד')+' '+(index+1)+' — '+label};
 }
 return null;
}
export function AcademyRegistrationForm({locale,onSaved,mode='native',onPreviewed}:{locale:Locale;onSaved?:(id:string)=>void;mode?:'native'|'sample';onPreviewed?:()=>void}){
 const href=useAcademyHref(),t=(en:string,he:string)=>locale==='he'?he:en,form=useRef<HTMLFormElement>(null),errorRef=useRef<HTMLDivElement>(null),resultRef=useRef<HTMLDivElement>(null),sequence=useRef(1);
 const [children,setChildren]=useState<Child[]>([{key:1,id:'',name:''}]),[days,setDays]=useState<string[]>([]),[times,setTimes]=useState<string[]>([]),[groupLanguage,setGroupLanguage]=useState('either'),[consent,setConsent]=useState(false);
 const [parentLanguage,setParentLanguage]=useState<Locale>(locale),[languageChosen,setLanguageChosen]=useState(false),[nurtureEmail,setNurtureEmail]=useState(false),[privateWapi,setPrivateWapi]=useState(false);
 useEffect(()=>{if(!languageChosen)setParentLanguage(locale);},[locale,languageChosen]);
 const [previewed,setPreviewed]=useState(false),[founder,setFounder]=useState<FounderPublicResult|null>(null);
 const campaign=useAcademyCampaign(),pre=campaign?.phase==='PRE_REGISTRATION',attribution=useRef<CampaignAttribution|null>(null);
 useEffect(()=>{try{attribution.current=captureCampaignAttribution(new URL(location.href),sessionStorage);}catch{}},[]);
 const [challenge,setChallenge]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState<'validation'|'unavailable'|'uncertain'|'rejected'|''>(''),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({}),[reference,setReference]=useState('');
 const pending=useRef<{command:FloridaGroupApplicationCommand;website:'';attribution:CampaignAttribution|null}|null>(null),sending=useRef(false),mounted=useRef(true);
 const endpoint='/api/public/group-applications?program=sunday_fishing_academy';
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setChildren(items=>items.map(child=>child.id?child:{...child,id:crypto.randomUUID()}));},[]);
 useEffect(()=>{setConsent(false);setFieldErrors({});},[locale]);
 useEffect(()=>{if(error){for(const element of form.current?.querySelectorAll('summary[aria-invalid=true]')??[]){const dropdown=element.closest('details');if(dropdown)dropdown.open=true;}errorRef.current?.focus();}},[error,uncertain,fieldErrors]);
 useEffect(()=>{if(reference)resultRef.current?.focus();},[reference]);
 useEffect(()=>{if(mode==='sample')return;let active=true,timer:ReturnType<typeof setTimeout>|undefined;fetch(endpoint,{cache:'no-store',credentials:'same-origin'}).then(async response=>{const b=await response.json();if(!response.ok||b?.ok!==true||(typeof b.data?.challenge!=='string'||b.data.registrationNotice?.version!==academyRegistrationNotice.version))throw Error();return b.data.challenge as string;}).then(token=>{if(active)timer=setTimeout(()=>{if(active)setChallenge(token);},1600);}).catch(()=>{if(active)setError('unavailable');});return()=>{active=false;if(timer)clearTimeout(timer);};},[mode]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue='';}};addEventListener('beforeunload',guard);return()=>removeEventListener('beforeunload',guard);},[]);
 const optional=(v:FormDataEntryValue|null)=>typeof v==='string'&&v.trim()?v:undefined;
 async function renewChallenge(){
  const response=await fetch(endpoint,{cache:'no-store',credentials:'same-origin'}),body=await response.json();
  if(!response.ok||body?.ok!==true||typeof body.data?.challenge!=='string'||!body.data.challenge||body.data.registrationNotice?.version!==academyRegistrationNotice.version)throw Error();
  if(!mounted.current)return;
  await new Promise(resolve=>setTimeout(resolve,1600));
  if(mounted.current)setChallenge(body.data.challenge);
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(sending.current||(mode==='native'&&!challenge&&!pending.current)||reference)return;
  setError('');setFieldErrors({});
  if(!pending.current){
   const values=new FormData(event.currentTarget),registration={version:ACADEMY_REGISTRATION_VERSION,learners:children.map(child=>({id:child.id,fullName:values.get('child-'+child.id+'-name'),ageYears:values.get('child-'+child.id+'-age')===''?NaN:Number(values.get('child-'+child.id+'-age')),grade:values.get('child-'+child.id+'-grade'),schooling:values.get('child-'+child.id+'-schooling'),experience:values.get('child-'+child.id+'-experience')})),postalCode:values.get('postalCode'),preferredDays:days,preferredTimes:times,driveMinutes:Number(values.get('driveMinutes')),schoolHoursAvailability:values.get('schoolHoursAvailability'),preferredGroupLanguage:groupLanguage,stageInterest:'foundation',optionalNotes:optional(values.get('optionalNotes')),receiptEmail:optional(values.get('receiptEmail')),intent:'information',communicationPreferences:communicationPreferenceSelection(parentLanguage,nurtureEmail,privateWapi,locale),consent:registrationConsent(locale)};
   const fields=floridaAcademyRegistrationFieldsSchema.safeParse({parentName:values.get('parentName'),contact:values.get('contact'),cityArea:values.get('cityArea'),language:locale,programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:registration,permission:{confirmed:consent,version:academyRegistrationNotice.version,language:locale}});
   if(!fields.success||values.get('website')!==''){
    const errors:Record<string,string>={};for(const issue of fields.success?[]:fields.error.issues){let path=issue.path.join('.');if(path.startsWith('academyRegistration.learners.')){const i=Number(issue.path[2]),property={fullName:'name',ageYears:'age',grade:'grade',schooling:'schooling',experience:'experience'}[String(issue.path[3])];if(children[i]&&property)path='child-'+children[i].id+'-'+property;}else path=path.replace(/^academyRegistration\./,'');errors[path]=t('Please check this field.','יש לבדוק שדה זה.');}
    setFieldErrors(errors);setError('validation');return;
   }
   if(mode==='sample'){setPreviewed(true);onPreviewed?.();return;}
   pending.current={command:{operationId:crypto.randomUUID(),fields:fields.data},website:'',attribution:attribution.current};
  }
  sending.current=true;setBusy(true);
  try{
   // An explicit click after a failed renewal only refreshes the challenge.
   // The retained operation requires another explicit click to retry its POST.
   if(!challenge){await renewChallenge();if(mounted.current){setUncertain(true);setError('uncertain');}return;}
   const op=pending.current,wasUncertain=uncertain,response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({challenge,website:'',operationId:op.command.operationId,fields:op.command.fields,...(op.attribution?{attribution:op.attribution}:{})})});
   if(!mounted.current)return;
   if(response.status===403){
    setChallenge('');setUncertain(true);setError('uncertain');await renewChallenge();return;
   }
   if(wasUncertain&&response.status===429){
    setUncertain(true);setError('uncertain');return;
   }
   if(!response.ok&&response.status>=400&&response.status<500&&!wasUncertain){pending.current=null;setUncertain(false);setError('rejected');return;}
   const body=await response.json(),read=floridaAcademyRegistrationFieldsSchema.safeParse(body?.data?.item?.fields);
   if(!mounted.current)return;
   if(!response.ok||body?.ok!==true||body?.data?.saved!==true||typeof body.data.item.id!=='string'||!read.success||JSON.stringify(read.data)!==JSON.stringify(op.command.fields))throw Error();
   pending.current=null;setUncertain(false);setFounder(body.data.founder??null);setReference(body.data.item.id);onSaved?.(body.data.item.id);
  }catch{if(mounted.current){setUncertain(true);setError('uncertain');}}finally{sending.current=false;if(mounted.current)setBusy(false);}
 }
 const select=(name:string,label:string,options:readonly {value:string;label:string}[])=>{const id='registration-'+name;return <div className={styles.field}><label htmlFor={id}>{label}</label><select id={id} name={name} required defaultValue="" aria-invalid={!!fieldErrors[name]} aria-describedby={fieldErrors[name]?id+'-error':undefined}><option value="">{t('Choose an answer','בחרו תשובה')}</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>{fieldErrors[name]&&<small id={id+'-error'} className={styles.errorText}>{fieldErrors[name]}</small>}</div>;};
 const dayLabels=[['sunday','Sunday','יום ראשון'],['monday','Monday','יום שני'],['tuesday','Tuesday','יום שלישי'],['wednesday','Wednesday','יום רביעי'],['thursday','Thursday','יום חמישי'],['friday','Friday','יום שישי'],['flexible','Flexible','גמיש']];
 const timeLabels=[['morning','Morning','בוקר'],['afternoon','Afternoon','אחר הצהריים'],['evening','Evening','ערב'],['flexible','Flexible','גמיש']];
 const errorTargets=Object.keys(fieldErrors).map(name=>registrationErrorTarget(name,children,locale)).filter((target):target is {id:string;label:string}=>target!==null).filter((target,index,items)=>items.findIndex(item=>item.id===target.id)===index);
 function focusError(id:string){const target=document.getElementById(id);if(target&&form.current?.contains(target)){const dropdown=target.closest('details');if(dropdown)dropdown.open=true;target.focus();}}
 const errorText=error==='validation'?t('Please complete the highlighted fields and consent. Availability preferences must exclude Shabbos.','יש להשלים את השדות המסומנים ואת ההסכמה. העדפות הזמנים אינן יכולות לכלול שבת.'):error==='unavailable'?t('Online registration is temporarily unavailable. No details have been sent.','ההרשמה המקוונת אינה זמינה כרגע. לא נשלחו פרטים.'):error==='uncertain'?t('The save result is not confirmed. Keep this page open and submit the same information again to check the original operation; this will not create a duplicate.','תוצאת השמירה עדיין לא אומתה. השאירו את העמוד פתוח ושלחו שוב את אותם הפרטים לבדיקת הפעולה המקורית; לא ייווצר עותק נוסף.'):t('Your information was not saved. Please review the fields and try again.','הפרטים לא נשמרו. בדקו את השדות ונסו שוב.');
 return <form ref={form} className={styles.form} data-academy-registration data-inquiry-kind="parent" onSubmit={submit} onChange={event=>{if((event.target as HTMLInputElement).name!=='permission')setConsent(false);}} noValidate>
  {mode==='sample'&&<p>{t('Sample only. No information is sent or saved.','דוגמה בלבד. לא נשלחים או נשמרים פרטים.')}</p>}{previewed&&<p role="status">{t('Sample checked. No information was submitted.','הדוגמה נבדקה. לא נשלחו פרטים.')}</p>}
  {error&&<div role="alert" ref={errorRef} tabIndex={-1} className={styles.alert}><strong>{t('Please check your registration','יש לבדוק את פרטי ההרשמה')}</strong><p>{errorText}</p>{error==='validation'&&errorTargets.length>0&&<ul className={styles.errorLinks}>{errorTargets.map(target=><li key={target.id}><a href={'#'+target.id} onClick={event=>{event.preventDefault();focusError(target.id);}}>{target.label}</a></li>)}</ul>}{uncertain&&pending.current&&<p>{t('Operation reference','מספר הפעולה')}: <bdi dir="ltr">{pending.current.command.operationId}</bdi></p>}</div>}
  {reference&&<div role="status" ref={resultRef} tabIndex={-1} className={styles.success} data-academy-saved={reference}><strong>{founder?.status==='confirmed'?t('Your registration is saved and your interest is confirmed. No payment or class enrollment was created.','ההרשמה נשמרה וההתעניינות אושרה. לא נוצרו תשלום או הרשמה לכיתה.'):founder?.status==='closed'?t('Your original registration is saved. This rate reservation is now closed; contact us about current options.','ההרשמה המקורית נשמרה. שמירת התעריף סגורה כעת; צרו קשר לגבי האפשרויות העדכניות.'):founder?.status==='reserved'?t('Your free registration is saved, and your founding-family rate is reserved pending email confirmation. Confirm your interest using the email we send you. No payment is due now.','ההרשמה החינמית שלכם נשמרה, ותעריף המשפחה המייסדת שמור בכפוף לאישור בדוא״ל. אשרו את התעניינותכם באמצעות ההודעה שנשלח. אין תשלום כעת.'):founder?.status==='regular_registration'||founder?.status==='interest_list'?t('Your registration is saved. A founding-family rate has not been reserved. We will contact you about suitable ordinary registration options. No payment is due now.','ההרשמה שלכם נשמרה. לא נשמר תעריף משפחה מייסדת. ניצור קשר לגבי אפשרויות מתאימות להרשמה רגילה. אין תשלום כעת.'):t('Registration saved; founder-rate reservation pending verification.','ההרשמה נשמרה; שמירת תעריף המשפחה המייסדת ממתינה לאימות.')}</strong><p>{t('Reference','מספר הפנייה')}: <bdi dir="ltr">{founder?.reference??reference}</bdi></p><p>{founder?.email==='sent'?t('Confirmation email sent. Provider acceptance does not prove it was read.','הודעת האישור נשלחה. אישור הספק אינו מעיד שההודעה נקראה.'):founder?.email==='queued'?t('Confirmation email queued; not yet sent. No deadline has started.','הודעת האישור ממתינה לשליחה; טרם נשלחה. ספירת הימים טרם החלה.'):t('Email delivery needs review. We have not verified a successful send.','נדרשת בדיקת משלוח הדוא״ל. שליחה מוצלחת לא אומתה.')}</p></div>}
  <AcademyRegistrationOffer locale={locale} childrenCount={children.length}/>
  <fieldset className={styles.body} disabled={busy||uncertain||!!reference}>
   <legend className={styles.srOnly}>{t('Registration details','פרטי ההרשמה')}</legend>
   <section aria-labelledby="registration-parent"><h2 id="registration-parent">{t('Parent or Guardian Details','פרטי הורה או אפוטרופוס')}</h2><div className={styles.grid}>
    <Field name="parentName" label={t('Full name','שם מלא')} required maxLength={100} autoComplete="name" error={fieldErrors.parentName}/>
    <Field name="contact" label={t('Phone with country code','טלפון עם קידומת מדינה')} required maxLength={254} type="tel" autoComplete="tel" dir="ltr" error={fieldErrors.contact}/>
    <Field name="cityArea" label={t('City / area','עיר / אזור')} required maxLength={100} autoComplete="address-level2" error={fieldErrors.cityArea}/>
    <Field name="postalCode" label={t('ZIP code','מיקוד')} required inputMode="numeric" type="text" pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" dir="ltr" error={fieldErrors.postalCode}/>
    <Field name="receiptEmail" label={t('Email','דוא״ל')} required type="email" maxLength={254} autoComplete="email" dir="ltr" error={fieldErrors.receiptEmail}/>
   </div></section>
   <section aria-labelledby="registration-children"><h2 id="registration-children">{t('Child Details','פרטי הילדים')}</h2>{children.map((child,index)=><div className={styles.child} key={child.key} data-registration-child={child.id}><h3>{t('Child','ילד')} {index+1}</h3><input type="hidden" name="learnerId" value={child.id}/><div className={styles.grid}>
    <Field name={'child-'+child.id+'-name'} label={t('Child’s full name','שם הילד המלא')} required maxLength={120} autoComplete="off" error={fieldErrors['child-'+child.id+'-name']} onChange={event=>setChildren(items=>items.map(c=>c.key===child.key?{...c,name:event.target.value}:c))}/>
    <Field name={'child-'+child.id+'-age'} label={t('Age (whole years)','גיל (בשנים מלאות)')} type="number" min={0} max={17} step={1} required inputMode="numeric" error={fieldErrors['child-'+child.id+'-age']}/>
    {select('child-'+child.id+'-grade',t('Grade / equivalent homeschool grade','כיתה / כיתה מקבילה בחינוך ביתי'),Object.entries(academyGradeLabels[locale]).map(([value,label])=>({value,label})))}
    {select('child-'+child.id+'-schooling',t('School or homeschool','בית ספר או חינוך ביתי'),[{value:'school',label:t('Attends school','לומד בבית ספר')},{value:'homeschool',label:t('Homeschool','חינוך ביתי')},{value:'discuss',label:t('Discuss with me','לתיאום איתי')}])}
    {select('child-'+child.id+'-experience',t('Fishing experience','ניסיון בדיג'),[{value:'new',label:t('New to fishing','חדש בדיג')},{value:'some',label:t('Some experience','ניסיון מסוים')},{value:'experienced',label:t('Experienced','מנוסה')},{value:'not_sure',label:t('Not sure','לא בטוח/ה')}])}
   </div>{children.length>1&&<button type="button" className={styles.textButton} onClick={()=>{setChildren(items=>items.filter(c=>c.key!==child.key));setConsent(false);}}>{t('Remove this child','הסרת ילד זה')}</button>}</div>)}{children.length<10&&<button type="button" className={styles.secondary} onClick={()=>{setChildren(items=>[...items,{key:++sequence.current,id:crypto.randomUUID(),name:''}]);setConsent(false);}}>{t('Add another child','הוספת ילד נוסף')}</button>}</section>
   <section aria-labelledby="registration-travel"><h2 id="registration-travel">{t('Preferred Days and Times / Travel','ימים ושעות מועדפים / נסיעות')}</h2><div className={styles.grid}>
    <ChoiceDropdown name="preferredDays" label={t('Preferred days','ימים מועדפים')} options={dayLabels.map(([value,en,he])=>({value:value!,label:t(en!,he!),disabled:value==='friday'&&times.includes('evening')}))} error={fieldErrors.preferredDays} value={days} onChange={setDays} empty={t('Choose all suitable days','בחרו את כל הימים המתאימים')}/>
    <ChoiceDropdown name="preferredTimes" label={t('Preferred times','שעות מועדפות')} options={timeLabels.map(([value,en,he])=>({value:value!,label:t(en!,he!),disabled:value==='evening'&&days.includes('friday')}))} error={fieldErrors.preferredTimes} value={times} onChange={setTimes} empty={t('Choose all suitable times','בחרו את כל הזמנים המתאימים')}/>
    <div><Field name="driveMinutes" label={t('How many minutes are you willing to drive?','כמה דקות אתם מוכנים לנסוע?')} type="number" min={5} max={120} step={1} required inputMode="numeric" error={fieldErrors.driveMinutes}/><p className={styles.help}>{t('One way, in minutes. A longer drive may provide more fishing location options.','לכיוון אחד, בדקות. נסיעה ארוכה יותר עשויה לאפשר מקומות דיג נוספים.')} <a href={href(locale)+'#academy-travel-faq'} target="_blank" rel="noopener noreferrer">{t('Location / Travel FAQ','שאלות נפוצות על מיקומים ונסיעות')}</a></p></div>
    {select('schoolHoursAvailability',t('Availability during school hours','זמינות בשעות בית הספר'),[{value:'flexible',label:t('Homeschool / flexible schedule allows it','חינוך ביתי / מערכת גמישה מאפשרים זאת')},{value:'permission_needed',label:t('Possibly — I will arrange required school permission','ייתכן — אסדיר אישור נדרש מבית הספר')},{value:'outside_school_only',label:t('Only outside school hours','רק מחוץ לשעות בית הספר')},{value:'discuss',label:t('Please contact me to discuss','אנא צרו איתי קשר לתיאום')}])}
   </div><p className={styles.help}>{t('Preferences do not book a session. There are no Shabbos sessions.','ההעדפות אינן הזמנה למפגש. אין מפגשים בשבת.')}</p>
    <div id="registration-preferredGroupLanguage" tabIndex={-1} role="radiogroup" aria-label={t('Preferred group language','שפה מועדפת בקבוצה')} className={styles.segments}>{[['en',t('English','אנגלית')],['he',t('Hebrew','עברית')],['either',t('Either','שתי השפות')]].map(([value,label])=><label key={value}><input type="radio" name="preferredGroupLanguage" value={value} checked={groupLanguage===value} onChange={()=>setGroupLanguage(value!)}/>{label}</label>)}</div>
   </section>
   <section aria-labelledby="registration-notes"><h2 id="registration-notes">{t('Optional Notes','הערות (לא חובה)')}</h2><label className={styles.srOnly} htmlFor="registration-optionalNotes">{t('Optional notes','הערות לא חובה')}</label><textarea id="registration-optionalNotes" name="optionalNotes" maxLength={600}/><details className={styles.preparation}><summary>{t('First meeting preparation','הכנה למפגש הראשון')}</summary><p>{academyTripCopy.firstMeeting[locale]}</p></details></section>
   <section aria-labelledby="registration-communications"><h2 id="registration-communications">{t('Parent communication choices','בחירות תקשורת להורה')}</h2>
    <label htmlFor="registration-parentLanguage">{t('Preferred language for parent messages','שפה מועדפת להודעות להורה')}</label><select id="registration-parentLanguage" name="parentLanguage" value={parentLanguage} onChange={event=>{setParentLanguage(event.target.value==='he'?'he':'en');setLanguageChosen(true);}}><option value="en">English</option><option value="he">עברית</option></select>
    <p className={styles.help}>{t('Separate from the fishing group language.','נפרד משפת קבוצת הדיג.')}</p>
    <details className={styles.preparation}><summary>{t('Updates (optional)','עדכונים (לא חובה)')}</summary>
    <div data-communication-notice data-document-id={academyCommunicationNotice.id} data-document-version={academyCommunicationNotice.version} data-document-language={locale} data-document-sha256={academyCommunicationNoticeHashes[locale]}><p>{academyCommunicationNotice[locale]}</p><p className={styles.help}>{t('Version','גרסה')}: <bdi dir="ltr">{academyCommunicationNotice.version}</bdi></p></div>
    <label className={styles.consent}><input type="checkbox" name="nurtureEmail" checked={nurtureEmail} onChange={event=>setNurtureEmail(event.target.checked)}/>{t('Email updates','עדכונים בדוא״ל')}</label>
    <label className={styles.consent}><input type="checkbox" name="privateWapi" checked={privateWapi} onChange={event=>setPrivateWapi(event.target.checked)}/>{t('WhatsApp updates','עדכונים בוואטסאפ')}</label>
    </details>
   </section>
   <section aria-label={t('Registration terms','תנאי הרשמה')}><AcademyProgramTerms locale={locale}/>
    <label className={styles.consent}><input id="registration-permission" type="checkbox" name="permission" checked={consent} onChange={event=>setConsent(event.target.checked)} required aria-invalid={Object.keys(fieldErrors).some(k=>k.startsWith('permission'))} aria-describedby={Object.keys(fieldErrors).some(k=>k.startsWith('permission'))?'registration-consent-error':undefined}/><span>{t('I agree to the registration terms and privacy notice.','אני מסכים/ה לתנאי ההרשמה ולהודעת הפרטיות.')}</span></label>{Object.keys(fieldErrors).some(k=>k.startsWith('permission'))&&<small id="registration-consent-error" className={styles.errorText}>{t('Please review and accept the registration contact notice.','יש לעיין בהודעת ההרשמה ויצירת הקשר ולאשר אותה.')}</small>}
   </section>
   <div className={styles.honeypot} aria-hidden="true"><label>{t('Website','אתר')}<input name="website" autoComplete="off" tabIndex={-1}/></label></div>
  </fieldset>
  <div className={styles.actions} data-registration-actions><div><button type="submit" className={styles.primary} disabled={busy||(mode==='native'&&!challenge&&!pending.current)||!!reference}>{uncertain&&!challenge?t('Refresh connection','רענון החיבור'):uncertain?t('Check the original submission','בדיקת השליחה המקורית'):pre?t('Pre-register for free','הרשמה מוקדמת בחינם'):t('Register','הרשמה')}</button>{uncertain&&!challenge&&<p>{t('Your original submission is kept unchanged. Refresh the connection, then explicitly check the original submission. Nothing is resubmitted automatically.','השליחה המקורית נשמרת ללא שינוי. רעננו את החיבור ואז בדקו במפורש את השליחה המקורית. דבר אינו נשלח שוב באופן אוטומטי.')}</p>}<p>{t('We’ll email you to confirm your interest. Your group, start date and payment will be arranged later.','נשלח לכם דוא״ל לאישור ההתעניינות. הקבוצה, מועד הפתיחה והתשלום יתואמו בהמשך.')}</p></div></div>
  {busy&&<p role="status">{t('Checking your submission…','בודקים את שליחת הפרטים…')}</p>}
  <p className={styles.closing}>{t('Your information is kept privately for registration review. We will contact you about suitable next steps.','הפרטים נשמרים באופן פרטי לבדיקת ההרשמה. ניצור איתכם קשר לגבי המשך מתאים.')}</p>
 </form>;
}
