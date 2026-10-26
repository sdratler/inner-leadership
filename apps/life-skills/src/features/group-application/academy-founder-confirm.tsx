"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {floridaDeadline} from './academy-founder-contract.ts';
import {academyExactStates} from './academy-exact-copy.ts';
import styles from './academy-intake.module.css';

type ConfirmationState='loading'|'missing'|'invalid'|'read_failed'|'unavailable'|'available'|'confirming'|'confirm_unknown'|'confirmed'|'already_confirmed';
type ConfirmationContext={available:boolean;confirmed:boolean;deadline:string|null;founderRateReserved:boolean};
const actionStyle={minHeight:44,padding:'0.5rem 1rem',font:'inherit',maxWidth:'100%'};

// A successful HTTP response alone is not confirmation or permission to confirm.
export function readConfirmationContext(value:unknown):ConfirmationContext|null{
 if(!value||typeof value!=='object')return null;
 const body=value as {ok?:unknown;data?:{available?:unknown;confirmed?:unknown;deadline?:unknown;founderRateReserved?:unknown}};
 if(body.ok!==true||!body.data||typeof body.data.available!=='boolean'||typeof body.data.confirmed!=='boolean')return null;
 const {available,confirmed,deadline}=body.data;
 if(deadline!==null&&(typeof deadline!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(deadline)||!Number.isFinite(Date.parse(deadline))))return null;
 if(body.data.founderRateReserved!==undefined&&typeof body.data.founderRateReserved!=='boolean')return null;
 return {available,confirmed,deadline,founderRateReserved:body.data.founderRateReserved===true};
}

export function readConfirmedResult(value:unknown):{founderRateReserved:boolean}|null{
 if(!value||typeof value!=='object')return null;
 const body=value as {ok?:unknown;data?:{confirmed?:unknown;founderRateReserved?:unknown}};
 if(body.ok!==true||body.data?.confirmed!==true||body.data.founderRateReserved!==undefined&&typeof body.data.founderRateReserved!=='boolean')return null;
 return {founderRateReserved:body.data.founderRateReserved===true};
}

export function AcademyConfirmationOutcome({locale,alreadyConfirmed,founderRateReserved}:{locale:Locale;alreadyConfirmed:boolean;founderRateReserved:boolean}){
 const copy=academyExactStates[locale].confirmation;
 return <section role="status">
  {alreadyConfirmed?<p>{copy.alreadyConfirmed}</p>:<><h2>{copy.confirmedHeading}</h2><p>{copy.confirmedText}</p></>}
  {founderRateReserved===true&&<p>{copy.founderSentence}</p>}
 </section>;
}

export function AcademyFounderConfirm({locale}:{locale:Locale}){
 const token=useRef(''),captured=useRef(false),mounted=useRef(false),request=useRef<AbortController|null>(null),generation=useRef(0),inFlight=useRef(false);
 const [state,setState]=useState<ConfirmationState>('loading'),[deadline,setDeadline]=useState<string|null>(null);
 const [founderRateReserved,setFounderRateReserved]=useState(false);
 const read=useCallback(async()=>{
  if(!token.current){setState('missing');return;}
  if(!/^[A-Za-z0-9_-]{43}$/.test(token.current)){setState('invalid');return;}
  request.current?.abort();const controller=new AbortController(),current=++generation.current;request.current=controller;inFlight.current=true;
  setState('loading');setDeadline(null);setFounderRateReserved(false);
  const isCurrent=()=>mounted.current&&!controller.signal.aborted&&generation.current===current;
  try{
   const response=await fetch('/api/public/academy-founder',{method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'read_confirmation',token:token.current})});
   const context=readConfirmationContext(await response.json());
   if(!response.ok||!context)throw Error();
   if(isCurrent()){setDeadline(context.deadline);setFounderRateReserved(context.founderRateReserved);setState(context.confirmed?'already_confirmed':context.available?'available':'unavailable');}
  }catch{if(isCurrent())setState('read_failed');}
  finally{if(isCurrent())inFlight.current=false;}
 },[]);
 useEffect(()=>{
  mounted.current=true;
  if(!captured.current){token.current=location.hash.slice(1);history.replaceState(null,'',location.pathname);captured.current=true;}
  void read();
  return()=>{mounted.current=false;request.current?.abort();inFlight.current=false;};
 },[read]);
 async function confirm(){
  if(state!=='available'||inFlight.current)return;
  request.current?.abort();const controller=new AbortController(),current=++generation.current;request.current=controller;inFlight.current=true;setState('confirming');setFounderRateReserved(false);
  const isCurrent=()=>mounted.current&&!controller.signal.aborted&&generation.current===current;
  try{
   const response=await fetch('/api/public/academy-founder',{method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'confirm_interest',token:token.current})}),body=await response.json();
   const result=readConfirmedResult(body);
   if(!response.ok||!result)throw Error();
   if(isCurrent()){setFounderRateReserved(result.founderRateReserved);setState('confirmed');}
  }catch{if(isCurrent()){setDeadline(null);setState('confirm_unknown');}}
  finally{if(isCurrent())inFlight.current=false;}
 }
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const copy=academyExactStates[locale].confirmation;
 const retry=state==='read_failed'||state==='confirm_unknown'||state==='unavailable';
 return <main lang={locale} dir={locale==='he'?'rtl':'ltr'} className={styles.main}>
  <h1>{copy.heading}</h1>
  <p>{copy.text}</p>
  <p>{copy.smallLine}</p>
  {deadline&&<p>{t('Confirmation deadline: ','המועד האחרון לאישור: ')}{floridaDeadline(deadline,locale)}</p>}
  {state==='loading'&&<p role="status">{t('Checking your confirmation link…','בודקים את קישור האישור…')}</p>}
  {state==='missing'&&<p role="alert">{t('This page has no confirmation link. Open the complete link from your registration email.','לעמוד זה חסר קישור האישור. פתחו את הקישור המלא מתוך הודעת ההרשמה שלכם.')}</p>}
  {state==='invalid'&&<p role="alert">{t('This confirmation link is incomplete or invalid. Open the complete link from your registration email.','קישור האישור אינו מלא או אינו תקין. פתחו את הקישור המלא מתוך הודעת ההרשמה שלכם.')}</p>}
  {state==='read_failed'&&<p role="alert">{t('We could not check this link. Keep this page open and retry below. Retrying only checks your status; it does not confirm interest.','לא הצלחנו לבדוק את הקישור. השאירו את העמוד פתוח ונסו שוב למטה. הניסיון החוזר בודק את המצב בלבד ואינו מאשר התעניינות.')}</p>}
  {state==='unavailable'&&<p role="status">{copy.unusableLink}</p>}
  {(state==='available'||state==='confirming')&&<button type="button" style={actionStyle} disabled={state==='confirming'} onClick={()=>void confirm()}>{state==='confirming'?t('Confirming…','מאשרים…'):copy.button}</button>}
  {state==='confirm_unknown'&&<p role="alert">{t('We could not verify the confirmation result. Check its status below before trying to confirm again.','לא הצלחנו לאמת את תוצאת האישור. בדקו את המצב למטה לפני ניסיון אישור נוסף.')}</p>}
  {retry&&<button type="button" style={actionStyle} onClick={()=>void read()}>{state==='confirm_unknown'?t('Check confirmation status','בדיקת מצב האישור'):t('Retry link check','בדיקת הקישור שוב')}</button>}
  {(state==='confirmed'||state==='already_confirmed')&&<AcademyConfirmationOutcome locale={locale} alreadyConfirmed={state==='already_confirmed'} founderRateReserved={founderRateReserved}/>}
 </main>;
}
