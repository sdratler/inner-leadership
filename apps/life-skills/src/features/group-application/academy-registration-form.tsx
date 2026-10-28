"use client";
import {useEffect,useRef,useState,type FormEvent,type InputHTMLAttributes} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {floridaAcademyRegistrationFieldsSchema,type FloridaGroupApplicationCommand} from './contract.ts';
import {ACADEMY_REGISTRATION_VERSION,registrationConsent} from './academy-registration.ts';
import {registrationAcknowledgments} from './academy-registration-acknowledgments.ts';
import {communicationPreferenceSelection} from './academy-communication-preferences.ts';
import {academyRegistrationNotice} from './academy-registration-notice.ts';
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {captureCampaignAttribution,type CampaignAttribution} from './academy-campaign-contract.ts';
import type {FounderPublicResult} from './academy-founder-contract.ts';
import {AcademyRegistrationOffer} from './academy-pricing.tsx';
import {AcademyProgramTerms} from './academy-program-terms.tsx';
import {academyExactCopy,academyExactStates} from './academy-exact-copy.ts';
import {useAcademyHref} from './academy-route-context.tsx';
import styles from './academy-registration.module.css';

function ChoiceDropdown({name,label,options,value,onChange,empty,error}:{name:string;label:string;options:readonly {value:string;label:string;disabled?:boolean}[];value:string[];onChange:(v:string[])=>void;empty:string;error?:string|undefined}){
 function toggle(item:string){onChange(item==='flexible'?(value.includes(item)?[]:['flexible']):value.includes(item)?value.filter(v=>v!==item):[...value.filter(v=>v!=='flexible'),item]);}
 return <details className={styles.dropdown}><summary id={'registration-'+name} aria-invalid={!!error} aria-describedby={error?'registration-error-'+name:undefined}><strong>{label}</strong><span>{value.length?options.filter(o=>value.includes(o.value)).map(o=>o.label).join(', '):empty}</span></summary><div role="group" aria-label={label}>{options.map(o=><label key={o.value}><input type="checkbox" name={name} value={o.value} checked={value.includes(o.value)} disabled={o.disabled} onChange={()=>toggle(o.value)}/>{o.label}</label>)}</div>{error&&<small id={'registration-error-'+name} className={styles.errorText}>{error}</small>}</details>;
}
function SingleChoiceDropdown({name,label,options,value,onChange,empty,error}:{name:string;label:string;options:readonly {value:string;label:string}[];value:string;onChange:(v:string)=>void;empty:string;error?:string|undefined}){
 const disclosure=useRef<HTMLDetailsElement>(null),selected=options.find(option=>option.value===value)?.label;
 function choose(next:string){onChange(next);if(disclosure.current)disclosure.current.open=false;}
 return <details ref={disclosure} className={styles.dropdown}><summary id={'registration-'+name} aria-required="true" aria-invalid={!!error} aria-describedby={error?'registration-error-'+name:undefined}><strong>{label}</strong><span>{selected??empty}</span></summary><div role="radiogroup" aria-label={label}>{options.map(option=><label key={option.value}><input type="radio" name={name} value={option.value} checked={value===option.value} required onChange={()=>choose(option.value)}/>{option.label}</label>)}</div>{error&&<small id={'registration-error-'+name} className={styles.errorText}>{error}</small>}</details>;
}
function Field({name,label,error,...props}:{name:string;label:string;error?:string|undefined}&InputHTMLAttributes<HTMLInputElement>){
 const id='registration-'+name.replace(/[^a-zA-Z0-9-]/g,'-');return <div className={styles.field}><label htmlFor={id}>{label}</label><input {...props} id={id} name={name} aria-invalid={!!error} aria-describedby={error?id+'-error':undefined}/>{error&&<small id={id+'-error'} className={styles.errorText}>{error}</small>}</div>;
}
type Child={key:number;id:string;name:string};
export function registrationErrorTarget(name:string,children:readonly {id:string}[],locale:Locale):{id:string;label:string}|null{
 const t=(en:string,he:string)=>locale==='he'?he:en,c=academyExactCopy[locale].form;
 const labels:Record<string,string>={parentName:c.labels.parentName,contact:c.labels.phone,cityArea:c.labels.cityArea,postalCode:c.labels.postalCode,receiptEmail:c.labels.email,preferredDays:c.labels.days,preferredTimes:c.labels.times,driveMinutes:c.labels.driveMinutes,schoolHoursAvailability:c.labels.schoolHours,preferredGroupLanguage:c.labels.groupLanguage,optionalNotes:c.labels.notes,conductExplained:c.conductCheckbox,permission:c.requiredCheckbox};
 const key=name.startsWith('permission.')||name.startsWith('acknowledgments.programInformation')?'permission':name==='acknowledgments'||name.startsWith('acknowledgments.conduct')?'conductExplained':name;
 if(labels[key])return {id:'registration-'+key,label:labels[key]};
 for(const [index,child] of children.entries()){
  const prefix='child-'+child.id+'-';if(!child.id||!name.startsWith(prefix))continue;
  const label=({name:c.labels.childName,age:c.labels.age,grade:c.labels.grade,schooling:c.labels.schooling,experience:c.labels.experience} as Record<string,string>)[name.slice(prefix.length)];
  if(label)return {id:'registration-'+name,label:t('Child','ילד')+' '+(index+1)+' — '+label};
 }
 return null;
}
/** Saved copy uses only the server readback, never the currently editable form. */
export function AcademyRegistrationResult({locale,reference,founder}:{locale:Locale;reference:string;founder:FounderPublicResult|null}){
 const copy=academyExactStates[locale],saved=copy.save;
 const sent=founder?.email==='sent'&&!!founder.receiptEmail;
 const email=sent?saved.emailSent.replace('{email}',founder!.receiptEmail!):founder?.email==='queued'?saved.emailQueued:founder?.email==='delivery_problem'?saved.emailFailure:saved.emailUnknown;
 const status=founder?.status==='reserved'?saved.founderReserved:founder?.status==='pending_verification'||!founder?saved.pendingAllocation:founder.status==='regular_registration'||founder.status==='interest_list'?saved.ordinary:null;
 return <><strong>{saved.savedHeading}</strong>{status&&<p>{status}</p>}{founder?.status==='confirmed'&&<p>{copy.confirmation.alreadyConfirmed}</p>}{founder?.status==='confirmed'&&founder.founderRateReserved===true&&<p>{copy.confirmation.founderSentence}</p>}<p>{saved.reference.split('{reference}')[0]}<bdi dir="ltr">{founder?.reference??reference}</bdi>{saved.reference.split('{reference}')[1]}</p><p>{email}</p></>;
}
export function AcademyRegistrationForm({locale,onSaved,mode='native',onPreviewed}:{locale:Locale;onSaved?:(id:string)=>void;mode?:'native'|'sample';onPreviewed?:()=>void}){
 const copy=academyExactCopy[locale],c=copy.form,stateCopy=academyExactStates[locale],href=useAcademyHref(),t=(en:string,he:string)=>locale==='he'?he:en,form=useRef<HTMLFormElement>(null),errorRef=useRef<HTMLDivElement>(null),resultRef=useRef<HTMLDivElement>(null),sequence=useRef(1);
 const [children,setChildren]=useState<Child[]>([{key:1,id:'',name:''}]),[days,setDays]=useState<string[]>([]),[times,setTimes]=useState<string[]>([]),[schoolHours,setSchoolHours]=useState(''),[groupLanguage,setGroupLanguage]=useState('either'),[consent,setConsent]=useState(false);
 const [parentLanguage,setParentLanguage]=useState<Locale>(locale),[languageChosen,setLanguageChosen]=useState(false),[conductExplained,setConductExplained]=useState(false),[privateWapi,setPrivateWapi]=useState(false);
 useEffect(()=>{if(!languageChosen)setParentLanguage(locale);},[locale,languageChosen]);
 const [previewed,setPreviewed]=useState(false),[founder,setFounder]=useState<FounderPublicResult|null>(null);
 const campaign=useAcademyCampaign(),pre=campaign?.phase==='PRE_REGISTRATION',attribution=useRef<CampaignAttribution|null>(null);
 useEffect(()=>{try{attribution.current=captureCampaignAttribution(new URL(location.href),sessionStorage);}catch{}},[]);
 const [challenge,setChallenge]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState<'validation'|'unavailable'|'uncertain'|'rejected'|''>(''),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({}),[reference,setReference]=useState('');
 const pending=useRef<{command:FloridaGroupApplicationCommand;website:'';attribution:CampaignAttribution|null}|null>(null),sending=useRef(false),mounted=useRef(true);
 const endpoint='/api/public/group-applications?program=sunday_fishing_academy';
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setChildren(items=>items.map(child=>child.id?child:{...child,id:crypto.randomUUID()}));},[]);
 useEffect(()=>{setConsent(false);setConductExplained(false);setFieldErrors({});},[locale]);
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
   if(!conductExplained||!consent){setFieldErrors({...(!conductExplained?{conductExplained:c.conductCheckbox}:{}),...(!consent?{permission:c.requiredCheckbox}:{})});setError('validation');return;}
   const values=new FormData(event.currentTarget),registration={version:ACADEMY_REGISTRATION_VERSION,learners:children.map(child=>({id:child.id,fullName:values.get('child-'+child.id+'-name'),ageYears:values.get('child-'+child.id+'-age')===''?NaN:Number(values.get('child-'+child.id+'-age')),grade:values.get('child-'+child.id+'-grade'),schooling:values.get('child-'+child.id+'-schooling'),experience:values.get('child-'+child.id+'-experience')})),postalCode:values.get('postalCode'),preferredDays:days,preferredTimes:times,driveMinutes:Number(values.get('driveMinutes')),schoolHoursAvailability:values.get('schoolHoursAvailability'),preferredGroupLanguage:groupLanguage,stageInterest:'foundation',optionalNotes:optional(values.get('optionalNotes')),receiptEmail:optional(values.get('receiptEmail')),intent:'information',communicationPreferences:communicationPreferenceSelection(parentLanguage,privateWapi,locale),consent:registrationConsent(locale),acknowledgments:registrationAcknowledgments(locale,children.map(child=>child.id))};
   const fields=floridaAcademyRegistrationFieldsSchema.safeParse({parentName:values.get('parentName'),contact:optional(values.get('contact'))??values.get('receiptEmail'),cityArea:values.get('cityArea'),language:locale,programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:registration,permission:{confirmed:consent,version:academyRegistrationNotice.version,language:locale}});
   if(!fields.success||values.get('website')!==''){
    const errors:Record<string,string>={};for(const issue of fields.success?[]:fields.error.issues){let path=issue.path.join('.');if(path.startsWith('academyRegistration.learners.')){const i=Number(issue.path[2]),property={fullName:'name',ageYears:'age',grade:'grade',schooling:'schooling',experience:'experience'}[String(issue.path[3])];if(children[i]&&property)path='child-'+children[i].id+'-'+property;}else path=path.replace(/^academyRegistration\./,'');const field=path.startsWith('child-')?path.slice(path.lastIndexOf('-')+1):path;const messages:Record<string,string>={parentName:stateCopy.errors.parentName,receiptEmail:stateCopy.errors.email,cityArea:stateCopy.errors.cityArea,postalCode:stateCopy.errors.postalCode,name:stateCopy.errors.childName,age:stateCopy.errors.age,grade:stateCopy.errors.grade,preferredDays:stateCopy.errors.days,preferredTimes:stateCopy.errors.times,driveMinutes:stateCopy.errors.driveMinutes,permission:stateCopy.errors.permission};errors[path]=messages[field]??(path.startsWith('permission')?stateCopy.errors.permission:stateCopy.errors.option);}
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
 const choices=(values:Record<string,string>)=>Object.entries(values).map(([value,label])=>({value,label}));
 const select=(name:string,label:string,options:readonly {value:string;label:string}[],placeholder=t('Choose one','בחרו אפשרות'))=>{const id='registration-'+name;return <div className={styles.field}><label htmlFor={id}>{label}</label><select id={id} name={name} required defaultValue="" aria-invalid={!!fieldErrors[name]} aria-describedby={fieldErrors[name]?id+'-error':undefined}><option value="">{placeholder}</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>{fieldErrors[name]&&<small id={id+'-error'} className={styles.errorText}>{fieldErrors[name]}</small>}</div>;};
 const errorTargets=Object.keys(fieldErrors).map(name=>registrationErrorTarget(name,children,locale)).filter((target):target is {id:string;label:string}=>target!==null).filter((target,index,items)=>items.findIndex(item=>item.id===target.id)===index);
 function focusError(id:string){const target=document.getElementById(id);if(target&&form.current?.contains(target)){const dropdown=target.closest('details');if(dropdown)dropdown.open=true;target.focus();}}
 const errorText=error==='validation'?t('Please complete the highlighted fields and consent. Availability preferences must exclude Shabbos.','יש להשלים את השדות המסומנים ואת ההסכמה. העדפות הזמנים אינן יכולות לכלול שבת.'):error==='unavailable'?t('Online registration is temporarily unavailable. No details have been sent.','ההרשמה המקוונת אינה זמינה כרגע. לא נשלחו פרטים.'):error==='uncertain'?stateCopy.save.uncertainText:stateCopy.save.saveFailure;
 return <form ref={form} className={styles.form} data-academy-registration data-inquiry-kind="parent" onSubmit={submit} onChange={event=>{if((event.target as HTMLInputElement).name!=='permission')setConsent(false);}} noValidate>
  {mode==='sample'&&<p>{t('Sample only. No information is sent or saved.','דוגמה בלבד. לא נשלחים או נשמרים פרטים.')}</p>}{previewed&&<p role="status">{t('Sample checked. No information was submitted.','הדוגמה נבדקה. לא נשלחו פרטים.')}</p>}
  {error&&<div role="alert" ref={errorRef} tabIndex={-1} className={styles.alert}><strong>{uncertain?stateCopy.save.uncertainHeading:t('Please check your registration','יש לבדוק את פרטי ההרשמה')}</strong><p>{errorText}</p>{error==='validation'&&errorTargets.length>0&&<ul className={styles.errorLinks}>{errorTargets.map(target=><li key={target.id}><a href={'#'+target.id} onClick={event=>{event.preventDefault();focusError(target.id);}}>{target.label}</a></li>)}</ul>}{uncertain&&pending.current&&<p>{t('Operation reference','מספר הפעולה')}: <bdi dir="ltr">{pending.current.command.operationId}</bdi></p>}</div>}
  {reference&&<div role="status" ref={resultRef} tabIndex={-1} className={styles.success} data-academy-saved={reference}><AcademyRegistrationResult locale={locale} reference={reference} founder={founder}/></div>}
  {reference&&<AcademyProgramTerms locale={locale}/>}
  {!reference&&<><AcademyRegistrationOffer locale={locale} childrenCount={children.length}/>
  <fieldset className={styles.body} disabled={busy||uncertain}>
   <legend className={styles.srOnly}>{pre?c.titleA:c.titleB}</legend>
   <section aria-labelledby="registration-parent"><h2 id="registration-parent">{c.sections.parent}</h2><div className={styles.grid}>
    <Field name="parentName" label={c.labels.parentName} required maxLength={100} autoComplete="name" error={fieldErrors.parentName}/>
    <Field name="receiptEmail" label={c.labels.email} required type="email" maxLength={254} autoComplete="email" dir="ltr" error={fieldErrors.receiptEmail}/>
    <Field name="contact" label={c.labels.phone+t(' (optional)',' (לבחירה)')} maxLength={254} type="tel" autoComplete="tel" dir="ltr" error={fieldErrors.contact}/>
    <Field name="cityArea" label={c.labels.cityArea} required maxLength={100} autoComplete="address-level2" error={fieldErrors.cityArea}/>
    <Field name="postalCode" label={c.labels.postalCode} required inputMode="numeric" type="text" pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" dir="ltr" error={fieldErrors.postalCode}/>
   </div></section>
   <section aria-labelledby="registration-children"><h2 id="registration-children">{c.sections.child}</h2>{children.map((child,index)=><div className={styles.child} key={child.key} data-registration-child={child.id}><h3>{c.childTemplate.replace('{number}',String(index+1))}</h3><input type="hidden" name="learnerId" value={child.id}/><div className={styles.grid}>
    <Field name={'child-'+child.id+'-name'} label={c.labels.childName} required maxLength={120} autoComplete="off" onChange={()=>setConductExplained(false)} error={fieldErrors['child-'+child.id+'-name']}/>
    <Field name={'child-'+child.id+'-age'} label={c.labels.age} type="number" min={0} max={17} step={1} required inputMode="numeric" error={fieldErrors['child-'+child.id+'-age']}/>
    {select('child-'+child.id+'-grade',c.labels.grade,choices(c.options.grades),c.gradePlaceholder)}
    {select('child-'+child.id+'-schooling',c.labels.schooling,choices(c.options.schooling))}
    {select('child-'+child.id+'-experience',c.labels.experience,choices(c.options.experience))}
   </div>{children.length>1&&<button type="button" className={styles.textButton} onClick={()=>{setChildren(items=>items.filter(c=>c.key!==child.key));setConsent(false);setConductExplained(false);}}>{c.removeChild}</button>}</div>)}{children.length<10&&<button type="button" className={styles.secondary} onClick={()=>{setChildren(items=>[...items,{key:++sequence.current,id:crypto.randomUUID(),name:''}]);setConsent(false);setConductExplained(false);}}>{c.addChild}</button>}</section>
   <section aria-labelledby="registration-travel"><h2 id="registration-travel">{c.sections.availability}</h2><div className={styles.grid}>
    <ChoiceDropdown name="preferredDays" label={c.labels.days} options={choices(c.options.days).map(o=>({...o,disabled:o.value==='friday'&&times.includes('evening')}))} error={fieldErrors.preferredDays} value={days} onChange={setDays} empty={c.daysPrompt}/>
    <ChoiceDropdown name="preferredTimes" label={c.labels.times} options={choices(c.options.times).map(o=>({...o,disabled:o.value==='evening'&&days.includes('friday')}))} error={fieldErrors.preferredTimes} value={times} onChange={setTimes} empty={c.timesPrompt}/>
    <div><Field name="driveMinutes" label={c.labels.driveMinutes} type="number" min={5} max={120} step={1} required inputMode="numeric" error={fieldErrors.driveMinutes}/><p className={styles.help}>{c.driveHelp} <a href={href(locale)+'#academy-travel-faq'} target="_blank" rel="noopener noreferrer">{c.travelLink}</a></p></div>
    <SingleChoiceDropdown name="schoolHoursAvailability" label={c.labels.schoolHours} options={choices(c.options.schoolHours)} value={schoolHours} onChange={setSchoolHours} empty={t('Choose one','בחרו אפשרות')} error={fieldErrors.schoolHoursAvailability}/>
    <div><p id="registration-group-language-label">{c.labels.groupLanguage}</p><div id="registration-preferredGroupLanguage" tabIndex={-1} role="radiogroup" aria-labelledby="registration-group-language-label" className={styles.segments}>{Object.entries(c.options.groupLanguage).map(([value,label])=><label key={value}><input type="radio" name="preferredGroupLanguage" value={value} checked={groupLanguage===value} onChange={()=>setGroupLanguage(value)}/>{label}</label>)}</div></div>
    <div className={styles.field}><label htmlFor="registration-parentLanguage">{c.labels.parentLanguage}</label><select id="registration-parentLanguage" name="parentLanguage" value={parentLanguage} onChange={event=>{setParentLanguage(event.target.value==='he'?'he':'en');setLanguageChosen(true);}}>{Object.entries(c.options.parentLanguage).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   </div></section>
   <section aria-labelledby="registration-notes"><h2 id="registration-notes">{c.sections.notes}</h2><label htmlFor="registration-optionalNotes">{c.labels.notes}</label><textarea id="registration-optionalNotes" name="optionalNotes" maxLength={600} placeholder={c.notesPlaceholder}/><p className={styles.help}>{c.equipmentLine}</p></section>
   <section aria-label={c.sections.terms}><AcademyProgramTerms locale={locale}/>
    <label className={styles.consent}><input id="registration-conductExplained" type="checkbox" name="conductExplained" checked={conductExplained} onChange={event=>setConductExplained(event.target.checked)} required aria-invalid={!!fieldErrors.conductExplained} aria-describedby={fieldErrors.conductExplained?'registration-conduct-error':undefined}/><span>{c.conductCheckbox}</span></label>{fieldErrors.conductExplained&&<small id="registration-conduct-error" className={styles.errorText}>{c.conductCheckbox}</small>}
    <label className={styles.consent}><input id="registration-permission" type="checkbox" name="permission" checked={consent} onChange={event=>setConsent(event.target.checked)} required aria-invalid={Object.keys(fieldErrors).some(k=>k.startsWith('permission'))} aria-describedby={Object.keys(fieldErrors).some(k=>k.startsWith('permission'))?'registration-consent-error':undefined}/><span>{c.requiredCheckbox}</span></label>{Object.keys(fieldErrors).some(k=>k.startsWith('permission'))&&<small id="registration-consent-error" className={styles.errorText}>{stateCopy.errors.permission}</small>}
    <label className={styles.consent}><input type="checkbox" name="privateWapi" checked={privateWapi} onChange={event=>setPrivateWapi(event.target.checked)}/><span>{t('Optional: ','לבחירה: ')}{c.whatsappUpdates}</span></label>
   </section>
   <div className={styles.honeypot} aria-hidden="true"><label>{t('Website','אתר')}<input name="website" autoComplete="off" tabIndex={-1}/></label></div>
  </fieldset>
  <div className={styles.actions} data-registration-actions><div><button type="submit" className={styles.primary} disabled={busy||(mode==='native'&&!challenge&&!pending.current)||!!reference}>{uncertain&&!challenge?t('Refresh connection','רענון החיבור'):uncertain?stateCopy.save.checkStatus:pre?copy.nav.preRegister:copy.nav.register}</button>{uncertain&&!challenge&&<p>{t('Your original submission is kept unchanged. Refresh the connection, then explicitly check the original submission. Nothing is resubmitted automatically.','השליחה המקורית נשמרת ללא שינוי. רעננו את החיבור ואז בדקו במפורש את השליחה המקורית. דבר אינו נשלח שוב באופן אוטומטי.')}</p>}<p>{c.submitBelow}</p></div></div>
  {busy&&<p role="status">{c.submitBusy}</p>}</>}
 </form>;
}
