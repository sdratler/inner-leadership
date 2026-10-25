"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {floridaDeadline} from './academy-founder-contract.ts';
import styles from './academy-intake.module.css';

type ConfirmationState='loading'|'missing'|'invalid'|'read_failed'|'unavailable'|'available'|'confirming'|'confirm_unknown'|'confirmed';
type ConfirmationContext={available:boolean;confirmed:boolean;deadline:string|null};
const actionStyle={minHeight:44,padding:'0.5rem 1rem',font:'inherit',maxWidth:'100%'};

// A successful HTTP response alone is not confirmation or permission to confirm.
export function readConfirmationContext(value:unknown):ConfirmationContext|null{
 if(!value||typeof value!=='object')return null;
 const body=value as {ok?:unknown;data?:{available?:unknown;confirmed?:unknown;deadline?:unknown}};
 if(body.ok!==true||!body.data||typeof body.data.available!=='boolean'||typeof body.data.confirmed!=='boolean')return null;
 const {available,confirmed,deadline}=body.data;
 if(deadline!==null&&(typeof deadline!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(deadline)||!Number.isFinite(Date.parse(deadline))))return null;
 return {available,confirmed,deadline};
}

export function AcademyFounderConfirm({locale}:{locale:Locale}){
 const token=useRef(''),captured=useRef(false),mounted=useRef(false),request=useRef<AbortController|null>(null),generation=useRef(0),inFlight=useRef(false);
 const [state,setState]=useState<ConfirmationState>('loading'),[deadline,setDeadline]=useState<string|null>(null);
 const read=useCallback(async()=>{
  if(!token.current){setState('missing');return;}
  if(!/^[A-Za-z0-9_-]{43}$/.test(token.current)){setState('invalid');return;}
  request.current?.abort();const controller=new AbortController(),current=++generation.current;request.current=controller;inFlight.current=true;
  setState('loading');setDeadline(null);
  const isCurrent=()=>mounted.current&&!controller.signal.aborted&&generation.current===current;
  try{
   const response=await fetch('/api/public/academy-founder',{method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'read_confirmation',token:token.current})});
   const context=readConfirmationContext(await response.json());
   if(!response.ok||!context)throw Error();
   if(isCurrent()){setDeadline(context.deadline);setState(context.confirmed?'confirmed':context.available?'available':'unavailable');}
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
  request.current?.abort();const controller=new AbortController(),current=++generation.current;request.current=controller;inFlight.current=true;setState('confirming');
  const isCurrent=()=>mounted.current&&!controller.signal.aborted&&generation.current===current;
  try{
   const response=await fetch('/api/public/academy-founder',{method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'confirm_interest',token:token.current})}),body=await response.json();
   if(!response.ok||body?.ok!==true||body.data?.confirmed!==true)throw Error();
   if(isCurrent())setState('confirmed');
  }catch{if(isCurrent()){setDeadline(null);setState('confirm_unknown');}}
  finally{if(isCurrent())inFlight.current=false;}
 }
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const retry=state==='read_failed'||state==='confirm_unknown'||state==='unavailable';
 return <main lang={locale} dir={locale==='he'?'rtl':'ltr'} className={styles.main}>
  <h1>{t('Confirm your interest','אישור ההתעניינות שלכם')}</h1>
  <p>{t('Confirm that you are interested in a suitable Fishing Academy group. No payment is due. No start date has been set. Opening this page does not confirm anything.','אשרו שאתם מעוניינים בקבוצה מתאימה באקדמיה לדיג. אין תשלום כעת וטרם נקבע מועד פתיחה. פתיחת העמוד אינה מאשרת דבר.')}</p>
  {deadline&&<p>{t('Confirmation deadline: ','המועד האחרון לאישור: ')}{floridaDeadline(deadline,locale)}</p>}
  {state==='loading'&&<p role="status">{t('Checking your confirmation link…','בודקים את קישור האישור…')}</p>}
  {state==='missing'&&<p role="alert">{t('This page has no confirmation link. Open the complete link from your registration email.','לעמוד זה חסר קישור האישור. פתחו את הקישור המלא מתוך הודעת ההרשמה שלכם.')}</p>}
  {state==='invalid'&&<p role="alert">{t('This confirmation link is incomplete or invalid. Open the complete link from your registration email.','קישור האישור אינו מלא או אינו תקין. פתחו את הקישור המלא מתוך הודעת ההרשמה שלכם.')}</p>}
  {state==='read_failed'&&<p role="alert">{t('We could not check this link. Keep this page open and retry below. Retrying only checks your status; it does not confirm interest.','לא הצלחנו לבדוק את הקישור. השאירו את העמוד פתוח ונסו שוב למטה. הניסיון החוזר בודק את המצב בלבד ואינו מאשר התעניינות.')}</p>}
  {state==='unavailable'&&<p role="status">{t('This link is not currently available for confirmation. Contact the Academy for a delivery or deadline review. No interest confirmation has been verified.','הקישור אינו זמין כרגע לאישור. פנו לאקדמיה לבדיקת ההודעה או המועד. לא אומת אישור התעניינות.')}</p>}
  {(state==='available'||state==='confirming')&&<button type="button" style={actionStyle} disabled={state==='confirming'} onClick={()=>void confirm()}>{state==='confirming'?t('Confirming…','מאשרים…'):t('Confirm My Interest','אישור ההתעניינות שלי')}</button>}
  {state==='confirm_unknown'&&<p role="alert">{t('We could not verify the confirmation result. Check its status below before trying to confirm again.','לא הצלחנו לאמת את תוצאת האישור. בדקו את המצב למטה לפני ניסיון אישור נוסף.')}</p>}
  {retry&&<button type="button" style={actionStyle} onClick={()=>void read()}>{state==='confirm_unknown'?t('Check confirmation status','בדיקת מצב האישור'):t('Retry link check','בדיקת הקישור שוב')}</button>}
  {state==='confirmed'&&<p role="status">{t('Your interest is confirmed. Thank you. We will contact you about a suitable group and a separate offer.','ההתעניינות שלכם אושרה. תודה. ניצור איתכם קשר לגבי קבוצה מתאימה והצעה נפרדת.')}</p>}
 </main>;
}
