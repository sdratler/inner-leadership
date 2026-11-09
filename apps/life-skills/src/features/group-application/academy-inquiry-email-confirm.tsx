'use client';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {AcademySiteFrame} from './academy-site-frame.tsx';
import styles from './academy-intake.module.css';
import siteStyles from './academy-site.module.css';
import emailStyles from './academy-inquiry-email-confirm.module.css';
import {inquiryEmailControlCopy,inquiryEmailControlToken,submitInquiryEmailControl,INQUIRY_EMAIL_CONTROL_PATH} from './academy-inquiry-email-control-copy.ts';

type State='initial'|'ready'|'missing'|'busy'|'uncertain'|'confirmed'|'already_used'|'not_available';
export function AcademyInquiryEmailConfirm({locale:initialLocale}:{locale:Locale}){
 const [locale,setLocale]=useState(initialLocale),[state,setState]=useState<State>('initial');
 const token=useRef<string|null>(null),captured=useRef(false),mounted=useRef(false),inFlight=useRef(false),request=useRef<AbortController|null>(null);
 useEffect(()=>{
  mounted.current=true;
  if(!captured.current){
   token.current=inquiryEmailControlToken(location.hash);
   // Strip even an invalid fragment. Preserve only the server's query mode;
   // no bearer is copied to storage, links, telemetry or a GET request.
   history.replaceState(history.state,'',location.pathname+location.search);captured.current=true;
   setState(token.current?'ready':'missing');
  }
  return()=>{mounted.current=false;request.current?.abort();inFlight.current=false;};
 },[]);
 async function confirm(){
  if((state!=='ready'&&state!=='uncertain')||!token.current||inFlight.current)return;
  inFlight.current=true;const controller=new AbortController();request.current=controller;setState('busy');
  try{
   const result=await submitInquiryEmailControl(token.current,controller.signal);
   if(mounted.current&&!controller.signal.aborted){token.current=null;setState(result);}
  }catch{if(mounted.current&&!controller.signal.aborted)setState('uncertain');}
  finally{if(mounted.current&&!controller.signal.aborted)inFlight.current=false;}
 }
 const copy=inquiryEmailControlCopy(locale),complete=state==='confirmed'||state==='already_used';
 return <AcademySiteFrame locale={locale} path={INQUIRY_EMAIL_CONTROL_PATH} onLocaleChange={setLocale}>
  <main id="main" lang={locale} dir={locale==='he'?'rtl':'ltr'} className={styles.main}>
   <section className={`${styles.registrationHeading} ${emailStyles.content}`} aria-labelledby="inquiry-email-heading" aria-busy={state==='busy'}>
    <h1 id="inquiry-email-heading">{state==='confirmed'?copy.confirmedHeading:state==='already_used'?copy.usedHeading:copy.heading}</h1>
    <p role={complete?'status':undefined}>{state==='confirmed'?copy.confirmedText:state==='already_used'?copy.usedText:copy.intro}</p>
    {!complete&&<p>{copy.small}</p>}
    {state==='missing'&&<p role="alert">{copy.missing}</p>}
    {state==='not_available'&&<p role="status">{copy.unavailable}</p>}
    {state==='uncertain'&&<p role="alert">{copy.uncertain}</p>}
    {(state==='ready'||state==='busy'||state==='uncertain')&&<button type="button" className={`${siteStyles.button} ${emailStyles.action}`} disabled={state==='busy'} onClick={()=>void confirm()}>{state==='busy'?copy.busy:state==='uncertain'?copy.retry:copy.action}</button>}
   </section>
  </main>
 </AcademySiteFrame>;
}
