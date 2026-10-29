"use client";
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import type {bnaAcknowledgmentPreview} from './acknowledgment-preview.ts';
import {sessionInfo} from '../identity/client.ts';
import type {BnaAcknowledgmentCommand} from './acknowledgment-command.ts';
type Preview=ReturnType<typeof bnaAcknowledgmentPreview>;
const deliveryLabels={not_queued:['Not queued','לא הוכנס לתור'],queued:['Queued','בתור'],unknown:['Outcome unknown — check before another send','התוצאה לא ידועה — יש לבדוק לפני משלוח נוסף'],sent:['Accepted by email provider','התקבל אצל ספק הדוא״ל'],failed:['Not sent','לא נשלח'],canceled:['Canceled','בוטל']} as const;

class ActionError extends Error{constructor(readonly status:number){super('BNA_ACKNOWLEDGMENT_ACTION_FAILED');}}
export function BnaAcknowledgmentPreviewPanel({id,locale,disabled=false,onOperationPending}:{id:string;locale:Locale;disabled?:boolean;onOperationPending?:(pending:boolean)=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const [pending,setPending]=useState<BnaAcknowledgmentCommand|null>(null),[actionFailed,setActionFailed]=useState(false);
 const active=useRef(true),locked=useRef(false);
 const t=(en:string,he:string)=>locale==='he'?he:en;
 useEffect(()=>{active.current=true;return()=>{active.current=false;onOperationPending?.(false);};},[onOperationPending]);
 useEffect(()=>{onOperationPending?.(pending!==null);},[pending,onOperationPending]);
 async function change(command:BnaAcknowledgmentCommand){if(locked.current||disabled)return;
  const previouslyUnknown=pending!==null;locked.current=true;setBusy(true);setPending(command);setActionFailed(false);
  try{const session=await sessionInfo();if(session.role!=='practitioner')throw new ActionError(403);
   const response=await fetch('/api/private/bna-inquiries',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30_000),
    headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify(command)});
   const body=await response.json().catch(()=>null);if(!response.ok)throw new ActionError(response.status);
   if(!body?.ok||!body.data?.acknowledgment)throw Error();
   if(active.current){setPreview(body.data.acknowledgment as Preview);setPending(null);}
  }catch(error){if(active.current){setActionFailed(true);
   const code=error instanceof ActionError?error.status:503;
   if(!previouslyUnknown&&[400,401,403,404,409].includes(code)){setPending(null);setPreview(null);}
   if([401,403,404].includes(code))setPreview(null);
  }}finally{locked.current=false;if(active.current)setBusy(false);}
 }
 function start(action:BnaAcknowledgmentCommand['action']){
  if(!preview?.available||!('deliveryVersion' in preview)||typeof preview.deliveryVersion!=='number'||typeof preview.messageId!=='string'||pending)return;
  void change({action,inquiryId:id,messageId:preview.messageId,expectedVersion:preview.deliveryVersion,operationId:crypto.randomUUID()});
 }
 async function load(){if(locked.current||pending||disabled)return;locked.current=true;setBusy(true);setPreview(null);setFailed(false);setActionFailed(false);
  try{const response=await fetch('/api/private/bna-inquiries?'+new URLSearchParams({id,preview:'acknowledgment'}),{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw Error();if(active.current)setPreview(body.data as Preview);
  }catch{if(active.current)setFailed(true);}finally{locked.current=false;if(active.current)setBusy(false);}}
 return <details className="lsw-details"><summary>{t('Service acknowledgment preview','תצוגה מקדימה של אישור הפנייה')}</summary>
  <p>{t('Review the exact acknowledgment and its recorded delivery state. Opening this preview does not send email.','אפשר לבדוק את נוסח אישור הפנייה ואת מצב המשלוח המתועד. פתיחת התצוגה אינה שולחת דוא״ל.')}</p>
  <button type="button" disabled={busy||disabled||!!pending} onClick={()=>void load()}>{t('Load acknowledgment preview','טעינת תצוגת אישור הפנייה')}</button>
  {actionFailed&&<p role="alert">{pending?t('The action is unconfirmed. Retry the same action to recover its saved result before doing anything else.','תוצאת הפעולה לא אושרה. יש לנסות שוב את אותה פעולה כדי לקרוא את התוצאה השמורה לפני פעולה נוספת.'):t('The action was not accepted. Reload the acknowledgment and check your access and its current state.','הפעולה לא התקבלה. יש לטעון שוב את האישור ולבדוק את הגישה ואת המצב הנוכחי.')}</p>}
  {pending&&<button type="button" disabled={busy||disabled} onClick={()=>void change(pending)}>{t('Retry the same action','ניסיון חוזר של אותה פעולה')}</button>}
  {busy&&<p role="status">{t('Loading…','טוען…')}</p>}{failed&&<p role="alert">{t('Preview could not be read. Check your access and try again.','לא ניתן לקרוא את התצוגה. יש לבדוק את הגישה ולנסות שוב.')}</p>}
  {preview&&(preview.available?<article lang={preview.candidate.locale} dir={preview.candidate.locale==='he'?'rtl':'ltr'}>
   <p>{t('Delivery','משלוח')}: {deliveryLabels[preview.deliveryState][locale==='he'?1:0]}</p>
   {'deliveryCode' in preview&&preview.deliveryCode==='OWNER_CANCELED_UNCONFIRMED'&&<p>{t('An earlier delivery remains unconfirmed. Cancellation does not recall an email.','משלוח קודם עדיין לא אושר. ביטול אינו מחזיר הודעה שכבר נשלחה.')}</p>}
   <p>{t('Recipient','נמען')}: <bdi dir="ltr">{preview.recipient}</bdi></p><h4>{preview.candidate.subject}</h4><p style={{whiteSpace:'pre-wrap'}}>{preview.candidate.body}</p>
   {'deliveryVersion' in preview&&<div>
    {['queued','unknown','failed'].includes(preview.deliveryState)&&<><p>{t('Cancellation stops future attempts. An email already sent cannot be recalled.','ביטול עוצר ניסיונות עתידיים. אי אפשר להחזיר דוא״ל שכבר נשלח.')}</p><button type="button" disabled={busy||disabled||!!pending} onClick={()=>start('cancel_acknowledgment')}>{t('Cancel acknowledgment','ביטול אישור הפנייה')}</button></>}
    {preview.deliveryState==='failed'&&preview.deliveryCode==='PROVIDER_NOT_ATTEMPTED'&&<><p>{t('Retry is available because delivery was never attempted.','אפשר לנסות שוב כי לא נעשה ניסיון משלוח.')}</p><button type="button" disabled={busy||disabled||!!pending} onClick={()=>start('retry_acknowledgment')}>{t('Retry unsent acknowledgment','ניסיון חוזר של אישור שלא נשלח')}</button></>}
   </div>}
  </article>:<p>{preview.reason==='phone_reply_selected'?t('The selected reply channel is phone. An email acknowledgment is not assumed.','ערוץ המענה שנבחר הוא טלפון. אין הנחה שנבחר אישור בדוא״ל.'):t('No service acknowledgment candidate is available for this inquiry program.','אין נוסח אישור פנייה זמין לתוכנית זו.')}</p>)}
 </details>;
}
