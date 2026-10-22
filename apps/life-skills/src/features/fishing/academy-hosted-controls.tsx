'use client';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import type {FamilyPaymentView} from '../fishing-payments/domain.ts';
import {IdentityClientError,sessionInfo} from '../identity/client.ts';
import {UnsavedChangesGuard} from '../../ui/workspace/draft-guard.tsx';
import {academyHostedVersion,readAcademyHostedResult,type AcademyHostedCommand} from './academy-hosted-contract.ts';
type Props={locale:Locale;learnerId:string;stageId:string;payments:readonly FamilyPaymentView[];onLockedChange:(value:boolean)=>void;onBack:()=>void;onAccessDenied:()=>void};
class HostedRequestError extends Error{constructor(readonly status:number){super('HOSTED_REQUEST_FAILED');}}
export function AcademyHostedControls({locale,learnerId,stageId,payments,onLockedChange,onBack,onAccessDenied}:Props){
 const t=(en:string,he:string)=>locale==='he'?he:en,[pending,setPending]=useState<{command:AcademyHostedCommand;body:string}|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[review,setReview]=useState(false),[blocked,setBlocked]=useState(false),[destination,setDestination]=useState<string|null>(null),flight=useRef(false);
 useEffect(()=>{onLockedChange(busy||pending!==null||destination!==null);return()=>onLockedChange(false);},[busy,pending,destination,onLockedChange]);
 useEffect(()=>{if(!destination)return;const id=window.setTimeout(()=>window.location.assign(destination),0);return()=>window.clearTimeout(id);},[destination]);
 const send=async(value:NonNullable<typeof pending>)=>{
  if(flight.current||destination)return;flight.current=true;setBusy(true);setFailed(false);setReview(false);
  try{const session=await sessionInfo(),response=await fetch('/api/private/group-applications/hosted',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'idempotency-key':value.command.operationId},body:value.body});if(!response.ok)throw new HostedRequestError(response.status);const body=await response.json() as {ok?:boolean;data?:unknown};if(body.ok!==true)throw new HostedRequestError(503);const result=readAcademyHostedResult(body.data,value.command);
   if(result.state==='review_required'){setReview(true);return;}
   // Clear the navigation warning before a later browser task navigates. No
   // provider URL is cached in storage, rendered as a stale link or reused.
   setPending(null);setDestination(result.action.url);
  }catch(error){setFailed(true);if(error instanceof IdentityClientError&&['UNAUTHENTICATED','FORBIDDEN'].includes(error.code)||error instanceof HostedRequestError&&[401,403,404].includes(error.status)){setPending(null);onAccessDenied();}else if(error instanceof HostedRequestError&&[400,409].includes(error.status)){setPending(null);setBlocked(true);}}
  finally{flight.current=false;setBusy(false);}
 };
 const request=(purchaseId:string,dueIndex:number)=>{if(busy||pending||blocked||destination)return;const command:AcademyHostedCommand={version:academyHostedVersion,action:'request',operationId:crypto.randomUUID(),learnerId,stageId,purchaseId,dueIndex},next={command,body:JSON.stringify(command)};setPending(next);void send(next);};
 const money=(value:number)=>new Intl.NumberFormat(locale==='he'?'he-IL':'en-US',{style:'currency',currency:'USD'}).format(value/100);
 if(!pending&&!blocked&&!destination&&!payments.some(p=>{const due=p.dues.find(d=>d.paidCents<d.amountCents);return due?.paidCents===0;}))return null;
 return <section data-academy-hosted aria-label={t('Secure Academy payment','תשלום מאובטח לאקדמיה')}>
  <UnsavedChangesGuard dirty={pending!==null} message={t('Leave this payment request? Leaving does not undo an invoice already requested.','לצאת מבקשת תשלום זו? יציאה אינה מבטלת חשבונית שכבר התבקשה.')}/>
  <p>{t('Continue to secure payment. Payment and enrollment are confirmed separately.','המשך לתשלום מאובטח. התשלום וההרשמה מאושרים בנפרד.')}</p>
  {!pending&&!blocked&&!destination&&payments.map(p=>{const due=p.dues.find(d=>d.paidCents<d.amountCents);return due&&due.paidCents===0?<button key={p.purchaseId} type="button" className="lsw-button" disabled={busy} onClick={()=>request(p.purchaseId,due.index)}>{p.dues.length===1?t(`Pay stage — ${money(due.amountCents)}`,`תשלום לשלב — ${money(due.amountCents)}`):t(`Pay payment ${due.index} — ${money(due.amountCents)}`,`לתשלום ${due.index} — ${money(due.amountCents)}`)}</button>:null;})}
  {(busy||destination)&&<p role="status">{t('Preparing secure payment…','מכין תשלום מאובטח…')}</p>}
  {review&&<p role="alert">{t('The payment link needs review. Retry the same request or contact the Academy.','קישור התשלום דורש בדיקה. נסו שוב את אותה בקשה או פנו לאקדמיה.')}</p>}
  {failed&&<p role="alert">{blocked?t('Your access or bill changed. Read current payment details.','הגישה שלכם או החשבון השתנו. קראו את פרטי התשלום העדכניים.'):t('The payment request could not be confirmed. Retry the same request.','לא ניתן לאשר את בקשת התשלום. נסו שוב את אותה בקשה.')}</p>}
  {pending&&!busy&&<button type="button" className="lsw-button" onClick={()=>void send(pending)}>{t('Retry the same payment request','ניסיון חוזר לאותה בקשת תשלום')}</button>}
  {!busy&&!destination&&(pending||blocked)&&<button type="button" className="lsw-button lsw-button--secondary" onClick={()=>{setPending(null);onBack();}}>{t('Back to payment details','חזרה לפרטי התשלום')}</button>}
 </section>;
}
