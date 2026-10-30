'use client';
import {useEffect,useRef,useState} from 'react';
import type {z} from 'zod';
import type {Locale} from '../../lib/locale.ts';
import {sessionInfo} from '../identity/client.ts';
import {bnaReplyOwnerPage,type BnaReplyReviewCommand} from './reply-contract.ts';
type Page=z.infer<typeof bnaReplyOwnerPage>;
class ReplyReviewError extends Error{constructor(readonly status:number){super('BNA_REPLY_REVIEW_UNAVAILABLE');}}
export function BnaReplyOwnerPanel({id,locale,disabled=false,onOperationPending}:{id:string;locale:Locale;disabled?:boolean;onOperationPending?:(pending:boolean)=>void}){
 const t=(en:string,he:string)=>locale==='he'?he:en,active=useRef(true),locked=useRef(false);
 const [data,setData]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<number|null>(null),[pending,setPending]=useState<BnaReplyReviewCommand|null>(null);
 useEffect(()=>{active.current=true;return()=>{active.current=false;onOperationPending?.(false);};},[onOperationPending]);
 useEffect(()=>{onOperationPending?.(pending!==null);},[pending,onOperationPending]);
 async function read(before?:string){
  const query=new URLSearchParams({id,...(before?{before}:{})});
  const response=await fetch('/api/private/bna-mailbox-replies?'+query,{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  const body=await response.json().catch(()=>null);if(!response.ok)throw new ReplyReviewError(response.status);const result=bnaReplyOwnerPage.safeParse(body?.data);
  if(body?.ok!==true||!result.success||result.data.inquiryId!==id)throw new ReplyReviewError(503);
  if(active.current)setData(current=>before&&current?.nextCursor===before?{...result.data,items:[...new Map([...current.items,...result.data.items].map(row=>[row.id,row])).values()]}:before?current:result.data);
 }
 async function load(before?:string){if(locked.current||disabled||pending)return;locked.current=true;setBusy(true);setError(null);
  try{await read(before);}catch(cause){if(active.current){const code=cause instanceof ReplyReviewError?cause.status:503;setError(code);if([401,403,404].includes(code))setData(null);}}
  finally{locked.current=false;if(active.current)setBusy(false);}
 }
 async function review(command:BnaReplyReviewCommand){if(locked.current||disabled)return;const wasUnknown=pending!==null;locked.current=true;setBusy(true);setPending(command);setError(null);
  try{const session=await sessionInfo();if(session.role!=='practitioner')throw new ReplyReviewError(403);
   const response=await fetch('/api/private/bna-mailbox-replies',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000),
    headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify(command)});
   const body=await response.json().catch(()=>null);if(!response.ok)throw new ReplyReviewError(response.status);
   if(body?.ok!==true||body.data?.state!=='reviewed'||body.data?.version!==2)throw new ReplyReviewError(503);
   if(active.current){setPending(null);setData(current=>current?{...current,items:current.items.map(row=>row.id===command.receiptId?{...row,state:'reviewed',version:2}:row)}:null);}
   await read();
  }catch(cause){if(active.current){const code=cause instanceof ReplyReviewError?cause.status:503;setError(code);
   if(!wasUnknown&&[400,401,403,404,409].includes(code))setPending(null);if([401,403,404].includes(code))setData(null);}}
  finally{locked.current=false;if(active.current)setBusy(false);}
 }
 const time=(value:string)=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value));
 return <details className='lsw-details'><summary>{t('Received email replies','תשובות שהתקבלו בדוא״ל')}</summary>
  <p>{t('This view shows replies already recorded in the app. Automatic inbox monitoring is not connected yet.','כאן מוצגות תשובות שכבר תועדו ביישומון. ניטור אוטומטי של תיבת הדואר עדיין אינו מחובר.')}</p>
  <p>{t('Review the reply in the Office inbox. Save any needed next action on this inquiry, then mark the reply reviewed.','יש לקרוא את התשובה בתיבת הדואר של המשרד, לשמור בפנייה את הפעולה הבאה הנדרשת ואז לסמן שהתשובה טופלה.')}</p>
  <p>{t('If the reply asks to unsubscribe, record that choice in Email preferences before marking it reviewed.','אם התשובה מבקשת להסיר את ההרשמה לעדכונים, יש לתעד זאת בהעדפות הדוא״ל לפני סימון התשובה כטופלה.')}</p>
  <button type='button' disabled={busy||disabled||!!pending} onClick={()=>void load()}>{busy?t('Loading…','טוענים…'):t('Refresh received replies','רענון תשובות שהתקבלו')}</button>
  {error!==null&&<p role='alert'>{error===409?t('This review changed. Refresh the saved replies before another action.','הטיפול בתשובה השתנה. יש לרענן את התשובות השמורות לפני פעולה נוספת.'):
   [401,403].includes(error)?t('Sign in again with the owner account to review replies.','יש להיכנס שוב בחשבון האחראי כדי לטפל בתשובות.'):t('Reply reviews could not be confirmed. Check access and refresh when available.','לא ניתן לאשר את הטיפול בתשובות. יש לבדוק את הגישה ולרענן כשהשירות זמין.')}</p>}
  {pending&&!busy&&<p role='status'>{t('Review outcome unknown. Retry the same review to check its saved result.','תוצאת הטיפול אינה ידועה. יש לנסות שוב את אותה פעולה כדי לבדוק את התוצאה השמורה.')} <button type='button' disabled={disabled} onClick={()=>void review(pending)}>{t('Retry same review','ניסיון חוזר לאותו טיפול')}</button></p>}
  {data&&<><p>{t('Dates shown in America/New_York.','התאריכים מוצגים לפי אזור הזמן America/New_York.')}</p>
   {data.items.length===0?<p>{t('No email replies recorded for this inquiry.','לא נרשמו תשובות בדוא״ל עבור פנייה זו.')}</p>:<ol>{data.items.map(row=><li key={row.id}>
    <time dateTime={row.receivedAt}>{time(row.receivedAt)}</time> · {row.sourceKind==='service'?t('Reply to an inquiry acknowledgment','תשובה לאישור הפנייה'):t('Reply to an educational email','תשובה להודעה חינוכית')} · {row.state==='pending'?t('Awaiting review','ממתינה לטיפול'):t('Reviewed','טופלה')}
    {row.state==='pending'&&<button type='button' disabled={busy||disabled||!!pending} onClick={()=>void review({action:'mark_reviewed',receiptId:row.id,operationId:crypto.randomUUID(),expectedVersion:row.version})}>{t('Mark reviewed','סימון כטופלה')}</button>}
   </li>)}</ol>}
   {data.nextCursor&&<button type='button' disabled={busy||disabled||!!pending} onClick={()=>void load(data.nextCursor!)}>{t('Load older replies','טעינת תשובות קודמות')}</button>}
  </>}
 </details>;
}
