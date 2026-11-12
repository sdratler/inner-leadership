'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {accountExitDestination} from '../../ui/workspace/account-exit.ts';
import {Button} from '../../ui/workspace/controls.tsx';
import {createFishingOwnerSignOut,fishingOwnerSettings,type FishingOwnerSettingsInput,type FishingOwnerSettingsModel,
 type FishingOwnerSignOutController,type FishingOwnerSignOutState} from './fishing-owner-settings-model.ts';
import styles from './fishing-owner-settings.module.css';

export function FishingOwnerSettings(props:FishingOwnerSettingsInput){
 const model=fishingOwnerSettings(props);return model?<SelectedSettings key={model.contextKey} model={model}/>:null;
}
function SelectedSettings({model}:{model:FishingOwnerSettingsModel}){
 const {locale,contacts}=model,he=locale==='he',text=(en:string,hebrew:string)=>he?hebrew:en;
 const [state,setState]=useState<FishingOwnerSignOutState>('ready'),controller=useRef<FishingOwnerSignOutController|null>(null);
 useEffect(()=>{
  const current=createFishingOwnerSignOut({onState:setState,onSignedOut:()=>{
   try{window.location.assign(accountExitDestination(locale));}catch{/* The real sign-in link remains available. */}
  }});controller.current=current;
  return()=>{current.dispose();if(controller.current===current)controller.current=null;};
 },[locale]);
 const unavailable=contacts.state==='unavailable'?(contacts.reason==='UNAUTHENTICATED'?
  text('Your sign-in could not be confirmed. Reload account status.','לא ניתן לאמת את החיבור. יש לרענן את מצב החשבון.'):
  contacts.reason==='FORBIDDEN'?text('This account cannot read these contact details.','לחשבון הזה אין גישה לפרטי הקשר האלה.'):
  contacts.reason==='RATE_LIMITED'?text('Too many requests. Wait before reloading account status.','בוצעו בקשות רבות מדי. יש להמתין לפני רענון מצב החשבון.'):
  text('Account contact details could not be verified. Reload account status.','לא ניתן לאמת את פרטי הקשר של החשבון. יש לרענן את מצב החשבון.')):null;
 return <main className={'lsw-main '+styles.root} lang={locale} dir={he?'rtl':'ltr'}>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{text('Fishing Academy','אקדמיית הדיג')}</p><h1>{text('Settings','הגדרות')}</h1></div></header>
  <section className={'lsw-card '+styles.section}><h2>{text('Page language','שפת העמוד')}</h2>
   <p>{text('These links change the page language. They do not save an account preference.','הקישורים משנים את שפת העמוד. הם אינם שומרים העדפת שפה בחשבון.')}</p>
   <nav className="lsw-actions" aria-label={text('Page language','שפת העמוד')}>
    <Link href="/en/app/settings" prefetch={false} hrefLang="en" lang="en" aria-current={!he?'page':undefined}>English</Link>
    <Link href="/he/app/settings" prefetch={false} hrefLang="he" lang="he" aria-current={he?'page':undefined}>עברית</Link>
   </nav>
  </section>
  {state==='ready'&&<section className={'lsw-card '+styles.section}><h2>{text('Account contacts','פרטי הקשר של החשבון')}</h2>
   <p>{text('These are the sign-in contact details of the current owner account.','אלה פרטי הקשר של חשבון המנהל המחובר.')}</p>
   {contacts.state==='available'?<dl className={styles.contacts}>
    <div><dt>{text('Email','דוא״ל')}</dt><dd><bdi dir="ltr">{contacts.value.email}</bdi><span className={styles.verification}>{contacts.value.emailVerified?text('Verified for this account','אומת עבור החשבון הזה'):text('Not verified for this account','לא אומת עבור החשבון הזה')}</span></dd></div>
    <div><dt>{text('Phone','טלפון')}</dt><dd>{contacts.value.phone===null?text('Not provided','לא נמסר'):<><bdi dir="ltr">{contacts.value.phone}</bdi><span className={styles.verification}>{contacts.value.phoneVerified?text('Verified for this account','אומת עבור החשבון הזה'):text('Not verified for this account','לא אומת עבור החשבון הזה')}</span></>}</dd></div>
   </dl>:<p role="status" className="lsw-alert">{unavailable}</p>}
   <p className="lsw-help">{text('Contact changes are not available on this page.','שינוי פרטי הקשר אינו זמין בעמוד הזה.')}</p>
   {contacts.state==='unavailable'&&<a href={`/${locale}/app/settings`}>{text('Reload account status','רענון מצב החשבון')}</a>}
  </section>}
  <section className={'lsw-card '+styles.section}><h2>{text('Session','החיבור לחשבון')}</h2>
   {state==='ready'?<Button onClick={()=>void controller.current?.start()}>{text('Sign out','יציאה מהחשבון')}</Button>:
    state==='busy'?<><p role="status">{text('Signing out…','מתנתק מהחשבון…')}</p><Button busy disabled>{text('Sign out','יציאה מהחשבון')}</Button></>:
    state==='signed_out'?<><p role="status">{text('Signed out.','יצאת מהחשבון.')}</p><a href={accountExitDestination(locale)}>{text('Open sign in','פתיחת עמוד הכניסה')}</a></>:
    <><p role="alert">{text('Sign-out could not be confirmed. Account details are hidden. Reload account status before trying again.','לא ניתן לאמת את היציאה מהחשבון. פרטי החשבון הוסתרו. יש לרענן את מצב החשבון לפני ניסיון נוסף.')}</p>
     <a href={`/${locale}/app/settings`}>{text('Reload account status','רענון מצב החשבון')}</a></>}
  </section>
 </main>;
}
