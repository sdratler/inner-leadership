'use client';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import type {BnaOptionalCalendarStore} from './optional-calendar-store.ts';
type Readback=Awaited<ReturnType<BnaOptionalCalendarStore['readOwner']>>;
const states={prepared:['Prepared for review','מוכנה לבדיקה'],unknown:['Delivery unconfirmed','השליחה טרם אושרה'],sent:['Provider accepted','ההודעה התקבלה אצל ספק הדוא״ל'],failed:['Not sent','לא נשלחה'],canceled:['Canceled','בוטלה'],canceled_unknown:['Cancellation requested; delivery unconfirmed','התבקש ביטול; השליחה טרם אושרה']} as const;
const reasons:Record<string,readonly [string,string]>={no_permission:['No updates permission recorded','לא נרשמה הרשאה לעדכונים'],withdrawn:['Unsubscribed','ההרשמה בוטלה'],paused:['Paused by owner','הושהה בידי האחראי'],reply_pending:['Reply awaiting review','תשובה ממתינה לבדיקה'],closed:['Inquiry closed','הפנייה נסגרה'],invalid_recipient:['Address needs verification','הכתובת זקוקה לאימות'],complaint:['Complaint hold','השהיה בעקבות תלונה'],unknown_delivery:['Earlier delivery is unconfirmed','שליחה קודמת טרם אושרה'],already_sent:['Content already sent','התוכן כבר נשלח'],not_due:['Not due yet','מועד השליחה טרם הגיע'],spacing:['Waiting for the 48-hour interval','ממתינים למרווח של 48 שעות'],weekly_cap:['Waiting for the weekly limit','ממתינים במסגרת המגבלה השבועית'],sequence_order:['Earlier message comes first','הודעה קודמת נשלחת תחילה'],already_prepared:['Existing preparation needs review','יש הכנה קיימת לבדיקה']};
export function BnaOptionalCalendarOwnerPanel({id,locale,disabled=false}:{id:string;locale:Locale;disabled?:boolean}){
 const t=(en:string,he:string)=>locale==='he'?he:en,active=useRef(true),serial=useRef(0);
 const [data,setData]=useState<Readback|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function read(){if(busy||disabled)return;const n=++serial.current;setBusy(true);setError(false);setData(null);
  try{const response=await fetch('/api/private/bna-optional-calendar?'+new URLSearchParams({id}),{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
   const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok||!Array.isArray(body.data?.history)||body.data.sendingEnabled!==false)throw Error();
   if(active.current&&serial.current===n)setData(body.data);
  }catch{if(active.current&&serial.current===n){setData(null);setError(true);}}
  finally{if(active.current&&serial.current===n)setBusy(false);}
 }
 const next=data?.next,decision=next?.decision;
 const reason=decision&&!decision.eligible?reasons[decision.reason]:null;
 const time=(value:string)=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value));
 return <details className='lsw-details'><summary>{t('Next educational email','ההודעה החינוכית הבאה')}</summary>
  <p>{t('Co-op and supporter emails share one adult email calendar: at most two educational emails in seven days, at least 48 hours apart. Service acknowledgments and Fishing messages are separate.','הודעות הקואופרטיב והתמיכה חולקות יומן אחד לכתובת הבוגר: עד שתי הודעות חינוכיות בשבעה ימים ולפחות 48 שעות ביניהן. אישורי פנייה והודעות הדיג נפרדים.')}</p>
  <button type='button' disabled={busy||disabled} onClick={()=>void read()}>{busy?t('Loading…','טוענים…'):t('Preview next email','תצוגה מקדימה של ההודעה הבאה')}</button>
  {error&&<p role='alert'>{t('The private calendar could not be read. Check access and try again.','לא ניתן לקרוא את היומן הפרטי. בדקו את הגישה ונסו שוב.')}</p>}
  {data&&<div className='lsw-stack'><p>{t('Optional sending is off. A preview sends nothing.','שליחת עדכונים כבויה. תצוגה מקדימה אינה שולחת דבר.')}</p>
   {next?<><p>{next.locale.toUpperCase()} · {reason?t(reason[0],reason[1]):t('Timing and saved preferences allow preparation','התזמון וההעדפות השמורות מאפשרים הכנה')}</p>
    {decision&&('nextEligibleAt' in decision)&&decision.nextEligibleAt&&<p>{t('Next eligible','המועד הבא')}: {time(decision.nextEligibleAt)} (America/New_York)</p>}
    {!next.canPrepare&&<p>{t('Approved sender/footer and exact-copy activation are still required before preparing a deliverable message.','לפני הכנת הודעה לשליחה נדרשים פרטי שולח וכתובת מאושרים והפעלה של הנוסח המדויק.')}</p>}
    <h4>{next.subject}</h4><div className='lsw-stack'>{next.body.split('\n\n').map((p,i)=><p key={i}>{p}</p>)}</div>
    <p>{next.frozen?t('This is the saved message. Its private recipient link is protected in this preview.','זו ההודעה השמורה. קישור הנמען הפרטי מוגן בתצוגה זו.'):t('The personal preference link and approved postal footer are added when the message is prepared.','קישור ההעדפות האישי וכתובת הדואר המאושרת נוספים בעת הכנת ההודעה.')}</p></>:<p>{t('This program has no remaining educational messages.','לא נותרו הודעות חינוכיות בתוכנית זו.')}</p>}
   {data.history.length>0&&<><h4>{t('Saved optional-mail history','היסטוריית עדכונים שמורה')}</h4><ol>{data.history.map(row=><li key={row.id}>{row.program==='bna_learning_coop'?t('Learning Co-op','קואופרטיב הלמידה'):t('Support updates','עדכוני תמיכה')} · {row.locale.toUpperCase()} · {t(states[row.state][0],states[row.state][1])} · {time(row.recordedAt)} (America/New_York)</li>)}</ol></>}
   {data.hasMoreHistory&&<p>{t('Showing the latest 50 preparations; earlier history is retained.','מוצגות 50 ההכנות האחרונות; ההיסטוריה הקודמת נשמרת.')}</p>}
  </div>}
 </details>;
}
