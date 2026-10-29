"use client";
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import type {bnaAcknowledgmentPreview} from './acknowledgment-preview.ts';
type Preview=ReturnType<typeof bnaAcknowledgmentPreview>;

export function BnaAcknowledgmentPreviewPanel({id,locale}:{id:string;locale:Locale}){
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const active=useRef(true),locked=useRef(false);
 const t=(en:string,he:string)=>locale==='he'?he:en;
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function load(){if(locked.current)return;locked.current=true;setBusy(true);setPreview(null);setFailed(false);
  try{const response=await fetch('/api/private/bna-inquiries?'+new URLSearchParams({id,preview:'acknowledgment'}),{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw Error();if(active.current)setPreview(body.data as Preview);
  }catch{if(active.current)setFailed(true);}finally{locked.current=false;if(active.current)setBusy(false);}}
 return <details className="lsw-details"><summary>{t('Service acknowledgment preview','תצוגה מקדימה של אישור הפנייה')}</summary>
  <p>{t('Review candidate. No email has been queued by this preview. Sender and footer review remain required.','נוסח לבדיקה. תצוגה זו אינה מכניסה דוא״ל לתור. עדיין נדרשת בדיקת השולח והפרטים בתחתית ההודעה.')}</p>
  <button type="button" disabled={busy} onClick={()=>void load()}>{t('Load acknowledgment preview','טעינת תצוגת אישור הפנייה')}</button>
  {busy&&<p role="status">{t('Loading…','טוען…')}</p>}{failed&&<p role="alert">{t('Preview could not be read. Check your access and try again.','לא ניתן לקרוא את התצוגה. יש לבדוק את הגישה ולנסות שוב.')}</p>}
  {preview&&(preview.available?<article lang={preview.candidate.locale} dir={preview.candidate.locale==='he'?'rtl':'ltr'}>
   <p>{t('Reply address','כתובת לתשובה')}: <bdi dir="ltr">{preview.recipient}</bdi></p><h4>{preview.candidate.subject}</h4><p style={{whiteSpace:'pre-wrap'}}>{preview.candidate.body}</p>
  </article>:<p>{preview.reason==='phone_reply_selected'?t('The selected reply channel is phone. An email acknowledgment is not assumed.','ערוץ המענה שנבחר הוא טלפון. אין הנחה שנבחר אישור בדוא״ל.'):t('No service acknowledgment candidate is available for this inquiry program.','אין נוסח אישור פנייה זמין לתוכנית זו.')}</p>)}
 </details>;
}
