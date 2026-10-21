'use client';
import {useEffect,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {Button,Input,Select,RadioGroup,submitValid} from '../../ui/workspace/controls.tsx';
import {CalendarClientError,calendarRead} from '../calendar/client.ts';
import type {FishingCalendarPlan} from './program-calendar-contract.ts';
import {travelCreditFrameSchema,travelChangeCommandSchema,travelDeclarationCommandSchema,type TravelCreditFrame} from './academy-travel-credit-contract.ts';

type Props={plan:FishingCalendarPlan;locale:Locale;role:'practitioner'|'parent';locked:boolean;onDirty:(dirty:boolean)=>void;
 onDenied:()=>void;onSave:(path:'travel-change'|'travel-declaration',command:ReturnType<typeof travelChangeCommandSchema.parse>|ReturnType<typeof travelDeclarationCommandSchema.parse>)=>void};
/** Existing Calendar composition and shared pending-operation recovery. Public
 * allowlisted context only; no private source/payment objects or role switch. */
export function AcademyTravelCreditControls({plan,locale,role,locked,onDirty,onDenied,onSave}:Props){
 const t=(en:string,he:string)=>locale==='he'?he:en,[enrollment,setEnrollment]=useState(plan.selection.enrollmentId??''),[occurrence,setOccurrence]=useState(''),[frame,setFrame]=useState<TravelCreditFrame|null>(null),[failure,setFailure]=useState(''),[retry,setRetry]=useState(0),[minutes,setMinutes]=useState(''),[reference,setReference]=useState(''),[answer,setAnswer]=useState(''),[edited,setEdited]=useState(false);
 const selection={selectedEnrollmentId:enrollment,originalOccurrenceId:occurrence},key=JSON.stringify(selection),ready=Boolean(enrollment&&occurrence);
 useEffect(()=>{
  let live=true;if(!ready)return;const timer=window.setTimeout(()=>{void calendarRead<unknown>('fishing/travel-credit?'+new URLSearchParams(selection)).then(value=>{
   if(!live)return;const current=travelCreditFrameSchema.parse(value);if(JSON.stringify(current.selection)!==key)throw new CalendarClientError('UNAVAILABLE');setFrame(current);setFailure('');
  }).catch(error=>{if(!live)return;const code=error instanceof CalendarClientError?error.code:'UNAVAILABLE';setFrame(null);setFailure(code);if(['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'].includes(code))onDenied();});},0);
  return()=>{live=false;window.clearTimeout(timer);};
 // Selection identity controls cancellation; callbacks are supplied by the
 // current Calendar render and must not restart a read on every key stroke.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,ready,retry]);
 const changeSelection=(kind:'enrollment'|'occurrence',value:string)=>{
  if(locked||edited&&!window.confirm(t('Leave this unsaved response?','לצאת מהתגובה שלא נשמרה?')))return;setFrame(null);setFailure('');setMinutes('');setReference('');setAnswer('');setEdited(false);onDirty(false);if(kind==='enrollment')setEnrollment(value);else setOccurrence(value);
 };
 const dirty=()=>{setEdited(true);onDirty(true);};
 const time=(value:string)=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 const previous=frame?.change?.before??frame?.candidateChange?.before,changed=frame?.change?.changed??frame?.candidateChange?.changed;
 return <details className="lsw-card" data-academy-travel-credit><summary>{t('Academy changes and original-session credits','שינויים של האקדמיה וזכאות להשלמת מפגש')}</summary><div className="lsw-stack" lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <p>{t('A replacement keeps the original lesson entitlement. A date or seat still needs separate confirmation.','ההשלמה שומרת על הזכאות למפגש המקורי. תאריך או מקום עדיין דורשים אישור נפרד.')}</p>
  {role==='practitioner'&&<Select id="travel-enrollment" label={t('Participant','משתתף')} value={enrollment} disabled={locked} onChange={e=>changeSelection('enrollment',e.target.value)}><option value="">{t('Select a participant','בחירת משתתף')}</option>{plan.operator.roster.map(r=><option key={r.enrollmentId} value={r.enrollmentId}>{r.displayName}</option>)}</Select>}
  <Select id="travel-original" label={t('Original session','המפגש המקורי')} value={occurrence} disabled={locked} onChange={e=>changeSelection('occurrence',e.target.value)}><option value="">{t('Select an original session','בחירת מפגש מקורי')}</option>{plan.view?.occurrences.filter(o=>o.time.kind==='scheduled').map(o=><option key={o.id} value={o.id}>{t('Session','מפגש')} {o.ordinal}</option>)}</Select>
  {ready&&!frame&&!failure&&<p role="status">{t('Checking current access and records…','בודק גישה ורישומים עדכניים…')}</p>}
  {failure&&<div role="status"><p>{t('The current record could not be verified. No response or credit is assumed saved.','לא ניתן היה לאמת את הרישום העדכני. אין להניח שתגובה או זכאות נשמרו.')}</p><Button variant="secondary" disabled={locked} onClick={()=>setRetry(n=>n+1)}>{t('Check again','בדיקה חוזרת')}</Button></div>}
  {frame&&<>
   {previous&&changed&&<dl><dt>{t('Previously published','פורסם קודם')}</dt><dd data-travel-change-before><time dateTime={previous.time.startsAt}>{time(previous.time.startsAt)}</time> – <time dateTime={previous.time.endsAt}>{time(previous.time.endsAt)}</time> · {previous.location}</dd><dt>{t('Academy change','השינוי של האקדמיה')}</dt><dd data-travel-change-after><time dateTime={changed.time.startsAt}>{time(changed.time.startsAt)}</time> – <time dateTime={changed.time.endsAt}>{time(changed.time.endsAt)}</time> · {changed.location}</dd></dl>}
   {frame.credit&&<div role="status" data-travel-credit-state={frame.credit.state}><p>{frame.credit.state==='delivered'?t('The original activity has been fulfilled.','הפעילות המקורית סופקה.'):frame.credit.state==='replacement_reserved'?t('A replacement is reserved. The original lesson remains undelivered.','נשמר מקום להשלמה. המפגש המקורי טרם סופק.'):frame.credit.state==='outstanding'?t('The original-session credit is preserved and available for the existing makeup review.','הזכאות להשלמת המפגש המקורי נשמרת וזמינה לבדיקת ההשלמות הקיימת.'):t('The saved entitlement is preserved; its current fulfillment needs review.','הזכאות השמורה נשמרת; המצב העדכני של אספקתה דורש בדיקה.')}</p><p>{t('Credit reference','אסמכתת זכאות')}: {frame.credit.id}</p></div>}
   {frame.replacement&&<dl data-travel-replacement><dt>{t('Confirmed replacement session','מפגש ההשלמה שאושר')}</dt><dd><time dateTime={frame.replacement.logistics.time.startsAt}>{time(frame.replacement.logistics.time.startsAt)}</time> – <time dateTime={frame.replacement.logistics.time.endsAt}>{time(frame.replacement.logistics.time.endsAt)}</time> · America/New_York</dd><dt>{t('Current replacement location','המקום העדכני למפגש ההשלמה')}</dt><dd>{frame.replacement.logistics.location}</dd></dl>}
   {role==='practitioner'&&frame.mayRecordChange&&frame.candidateChange&&<form onSubmit={event=>submitValid(event,()=>{const c=frame.candidateChange!;onSave('travel-change',travelChangeCommandSchema.parse({operationId:crypto.randomUUID(),selection:frame.selection,beforeStageRevision:c.before.stageRevision,changedStageRevision:c.changed.stageRevision,expectedStageRevision:frame.stageRevision,revisedOneWayMinutes:Number(minutes),estimateReference:reference}));})}>
    <fieldset disabled={locked}><legend>{t('Record this family’s revised journey','תיעוד הנסיעה המעודכנת של המשפחה')}</legend><Input id="travel-minutes" label={t('Estimated one-way minutes after the change','אומדן דקות לכיוון אחד לאחר השינוי')} type="number" min={0} max={1440} step={1} required value={minutes} onChange={e=>{setMinutes(e.target.value);dirty();}}/><Input id="travel-reference" label={t('Basis for the estimate','הבסיס לאומדן')} maxLength={1200} required value={reference} onChange={e=>{setReference(e.target.value);dirty();}}/><Button type="submit">{t('Save change for this family','שמירת השינוי למשפחה זו')}</Button></fieldset>
   </form>}
   {role==='parent'&&frame.change&&<><p>{t('Your recorded maximum one-way journey','הנסיעה המרבית לכיוון אחד שנרשמה')}: {frame.recordedMaximumOneWayMinutes??t('needs review','דורש בדיקה')} {t('minutes','דקות')}. {t('Revised estimate','האומדן המעודכן')}: {frame.change.revisedOneWayMinutes} {t('minutes','דקות')}.</p>
    {frame.declaration&&<p role="status">{frame.declaration.familyCannotAttend?t('Saved response: we cannot attend this changed session.','תגובה שמורה: איננו יכולים להגיע למפגש ששונה.'):t('Saved response: we can attend this changed session.','תגובה שמורה: נוכל להגיע למפגש ששונה.')}</p>}
    {frame.responseOutcome==='no_credit'&&<p role="status" data-travel-response-outcome="no_credit">{t('Your response is saved. It did not create a new credit. Any existing lesson entitlement is shown separately.','תגובתכם נשמרה. היא לא יצרה זכאות חדשה להשלמה. זכאות קיימת למפגש מוצגת בנפרד.')}</p>}
    {frame.responseOutcome==='facts_required'&&<p role="status" data-travel-response-outcome="facts_required">{t('Your response is saved. Credit eligibility still needs review; no new credit is confirmed. Existing lesson rights are preserved.','תגובתכם נשמרה. הזכאות להשלמה עדיין דורשת בדיקה; לא אושרה זכאות חדשה. הזכויות הקיימות למפגשים נשמרות.')}</p>}
    {frame.mayRespond&&<form onSubmit={event=>submitValid(event,()=>{if(!answer||!frame.change)return;onSave('travel-declaration',travelDeclarationCommandSchema.parse({operationId:crypto.randomUUID(),selection:frame.selection,changeId:frame.change.id,changeSha256:frame.change.sha256,familyCannotAttend:answer==='cannot'}));})}><fieldset disabled={locked}><RadioGroup id="travel-attendance" legend={t('Can your family attend the changed session?','האם המשפחה יכולה להגיע למפגש ששונה?')} value={answer} options={[{value:'cannot',label:t('We cannot attend this changed session','איננו יכולים להגיע למפגש ששונה')},{value:'can',label:t('We can attend this changed session','נוכל להגיע למפגש ששונה')}]} onChange={value=>{setAnswer(value);dirty();}}/><Button type="submit" disabled={!answer}>{t('Save my response','שמירת התגובה שלי')}</Button></fieldset></form>}
   </>}
   {!frame.mayRespond&&role==='parent'&&frame.availability!=='ready'&&<p>{t('This change or its supporting records still needs review. Existing lesson rights are preserved.','השינוי או המסמכים התומכים בו עדיין דורשים בדיקה. הזכויות הקיימות למפגשים נשמרות.')}</p>}
  </>}
 </div></details>;
}
