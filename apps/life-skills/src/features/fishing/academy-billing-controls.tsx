'use client';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {sessionInfo,IdentityClientError} from '../identity/client.ts';
import {FishingFamilyPayments} from '../fishing-payments/workspace.tsx';
import {UnsavedChangesGuard} from '../../ui/workspace/draft-guard.tsx';
import {academyBillingVersion,type AcademyBillingCommand,type AcademyBillingContext} from './academy-billing-contract.ts';
type Props={locale:Locale;stageId:string;onLockedChange:(value:boolean)=>void;onIssued?:()=>Promise<void>}&({applicationId:string;learnerIndex:number;learnerId?:never}|{learnerId:string;applicationId?:never;learnerIndex?:never});
const endpoint='/api/private/group-applications/billing';
class BillingRequestError extends Error{constructor(readonly status:number){super('ACADEMY_BILLING_REQUEST_FAILED');}}
async function request<T>(url:string,init:RequestInit={}){const r=await fetch(url,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'}),body=await r.json() as {ok:boolean;data:T};if(!r.ok||body.ok!==true)throw new BillingRequestError(r.status);return body.data;}
export function AcademyBillingControls(props:Props){
 const {locale,stageId,onLockedChange}=props,t=(en:string,he:string)=>locale==='he'?he:en,[context,setContext]=useState<AcademyBillingContext|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[conflict,setConflict]=useState(false),[pending,setPending]=useState<{command:AcademyBillingCommand;body:string}|null>(null),flight=useRef(false);
 useEffect(()=>{onLockedChange(busy||pending!==null);return()=>onLockedChange(false);},[busy,pending,onLockedChange]);
 const read=async()=>{setBusy(true);setFailed(false);try{const query=new URLSearchParams(props.applicationId?{view:'owner',applicationId:props.applicationId,learnerIndex:String(props.learnerIndex),stageId}:{view:'parent',learnerId:props.learnerId!,stageId});setContext(await request<AcademyBillingContext>(endpoint+'?'+query));setPending(null);setConflict(false);}catch{setContext(null);setFailed(true);}finally{setBusy(false);}};
 const send=async(value:NonNullable<typeof pending>)=>{if(flight.current)return;flight.current=true;setBusy(true);setFailed(false);try{const session=await sessionInfo();await request(endpoint,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'idempotency-key':value.command.operationId},body:value.body});setPending(null);await read();await props.onIssued?.();}catch(e){setFailed(true);if(e instanceof IdentityClientError&&['UNAUTHENTICATED','FORBIDDEN'].includes(e.code)||e instanceof BillingRequestError&&[401,403,404].includes(e.status)){setContext(null);setPending(null);}else if(e instanceof BillingRequestError&&e.status===409){setPending(null);setConflict(true);}}finally{flight.current=false;setBusy(false);}};
 const ready=context?.state==='ready'?context:null,owner=ready?.role==='practitioner'?ready:null;
 const issue=()=>{if(!owner||!owner.offer||owner.offer.state!=='prepared'||owner.issuance!=='ready'||busy||pending||conflict)return;const command:AcademyBillingCommand={version:academyBillingVersion,action:'issue',operationId:crypto.randomUUID(),binding:owner.binding,learnerIndex:owner.learnerIndex,stageId,offerId:owner.offer.id,expectedOfferRevision:1},next={command,body:JSON.stringify(command)};setPending(next);void send(next);};
 return <section data-academy-billing aria-label={t('Academy stage payments','תשלומי השלב באקדמיה')}>
  <UnsavedChangesGuard dirty={pending!==null} message={t('Leave this payment request? Leaving does not undo a submitted request.','לצאת מבקשת תשלום זו? יציאה אינה מבטלת בקשה שכבר נשלחה.')}/>
  <h4>{t('Stage payments','תשלומי השלב')}</h4>
  {!pending&&<button type="button" className="lsw-button lsw-button--secondary" disabled={busy} onClick={()=>void read()}>{t('Read current stage payments','קריאת תשלומי השלב העדכניים')}</button>}
  {busy&&<p role="status">{t('Reading or saving payment details…','קורא או שומר את פרטי התשלום…')}</p>}
  {failed&&<p role="alert">{conflict?t('The family or offer changed. Read current payment details.','המשפחה או ההצעה השתנו. קראו את פרטי התשלום העדכניים.'):t('The result could not be confirmed. Read current details or retry the same request.','לא ניתן לאשר את התוצאה. קראו פרטים עדכניים או נסו שוב את אותה בקשה.')}</p>}
  {context?.state==='not_ready'&&<p>{t('Prepare verified family access first.','יש להכין תחילה גישה מאומתת למשפחה.')}</p>}
  {owner?.issuance==='not_admitted'&&<p>{t('Payment setup is awaiting approval. This screen cannot issue a new bill yet.','הגדרת התשלום ממתינה לאישור. עדיין לא ניתן ליצור דרישת תשלום חדשה במסך זה.')}</p>}
  {owner?.issuance==='ready'&&owner.offer?.state==='prepared'&&owner.payments.length===0&&<><p>{t('Issue this approved offer to the family payment ledger. This does not take payment or confirm enrollment.','העברת ההצעה המאושרת לרישום התשלומים של המשפחה. פעולה זו אינה גובה תשלום או מאשרת הרשמה.')}</p><button type="button" className="lsw-button" disabled={busy||pending!==null||conflict} onClick={issue}>{t('Issue this approved offer','יצירת דרישת תשלום להצעה מאושרת זו')}</button></>}
  {ready&&<><FishingFamilyPayments payments={ready.payments} actions={ready.role==='parent'?ready.actions:[]} locale={locale}/>{ready.role==='parent'&&ready.payments.some(p=>p.dues.some(d=>d.paidCents<d.amountCents))&&ready.links!=='ready'&&<p>{ready.links==='review_required'?t('The payment link needs review. Contact the Academy before paying.','קישור התשלום דורש בדיקה. יש לפנות לאקדמיה לפני התשלום.'):t('Online payment is not available yet. Your payment record is saved.','התשלום המקוון עדיין אינו זמין. רשומת התשלום שלכם שמורה.')}</p>}</>}
  {pending&&!busy&&<button type="button" className="lsw-button" onClick={()=>void send(pending)}>{t('Retry the same bill issuance','ניסיון חוזר לאותה דרישת תשלום')}</button>}
 </section>;
}
