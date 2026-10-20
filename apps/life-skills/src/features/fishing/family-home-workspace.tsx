'use client';
import {useEffect,useState} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import type {Locale} from '../../lib/locale.ts';
import {Button,Select} from '../../ui/workspace/controls.tsx';
import {calendarRead,CalendarClientError} from '../calendar/client.ts';
import {loginHref} from '../identity/login-return.ts';
import {AcademyEnrollmentControls} from './academy-enrollment-controls.tsx';
import {WeeklyProgressView} from '../fishing-stage/weekly-progress-view.tsx';
import {FishingFamilyPayments} from '../fishing-payments/workspace.tsx';
import {FishingParentAttendanceSummary} from '../fishing-stage/parent-attendance-summary.tsx';
import {FishingParentMakeupSummary} from '../fishing-stage/parent-makeup-summary.tsx';
import {ACADEMY_WHATSAPP} from '../group-application/academy-whatsapp.tsx';
import {fishingCalendarChoicesSchema,fishingCalendarSelectionQuery,fishingCalendarSearch,selectedFishingStage,type FishingCalendarChoices} from './program-calendar-contract.ts';
import {fishingFamilyContext,fishingFamilyHref,fishingNextTrip,type FishingFamilyHome} from './family-home-contract.ts';

type Read={key:string;choices:FishingCalendarChoices;home:FishingFamilyHome|null};
export function FishingFamilyHomeWorkspace({locale}:{locale:Locale}){
 const router=useRouter(),pathname=usePathname(),search=useSearchParams().toString(),[read,setRead]=useState<Read|null>(null),[failure,setFailure]=useState(''),[refresh,setRefresh]=useState(0),[locked,setLocked]=useState(false);
 const t=(en:string,he:string)=>locale==='he'?he:en,key=JSON.stringify([pathname,search,refresh]),value=read?.key===key?read:null;
 useEffect(()=>{
  let live=true;const timer=window.setTimeout(()=>{
   const context=fishingFamilyContext(new URLSearchParams(search));
   void(async()=>{
    if(!context)throw new CalendarClientError('INVALID_REQUEST');
    const learner=context.get('learnerId'),choices=fishingCalendarChoicesSchema.parse(await calendarRead<unknown>('fishing/context'+(learner?'?learnerId='+learner:'')));
    if(choices.role!=='parent')throw new CalendarClientError('FORBIDDEN');
    let home:FishingFamilyHome|null=null;
    if(context.has('stageId')){
     const selected=new URLSearchParams(context);selected.delete('fishing');const selection=fishingCalendarSelectionQuery(selected);
     if(!selectedFishingStage(choices,selection))throw new CalendarClientError('NOT_FOUND');
     home=await calendarRead<FishingFamilyHome>('fishing/family-home?'+fishingCalendarSearch(selection));
     if(JSON.stringify(home.selection)!==JSON.stringify(selection)||home.view.role!=='parent'||home.view.enrollmentId!==selection.enrollmentId||home.view.weeklyOperator)throw new CalendarClientError('UNAVAILABLE');
    }
    if(live){setRead({key,choices,home});setFailure('');}
   })().catch(error=>{if(!live)return;setRead(null);if(error instanceof CalendarClientError&&error.code==='UNAUTHENTICATED'){router.replace(loginHref(locale,pathname+'?'+search));return;}setFailure(key);});
  },0);return()=>{live=false;window.clearTimeout(timer);};
 },[key,locale,pathname,search,router]);
 const context=fishingFamilyContext(new URLSearchParams(search)),home=value?.home??null,choices=value?.choices??null,next=home?fishingNextTrip(home.view):null;
 const chooseChild=(id:string)=>{if(locked||!choices?.children.some(c=>c.learnerId===id))return;setRead(null);setFailure('');router.replace('/'+locale+'/family?'+new URLSearchParams({fishing:'1',learnerId:id}));};
 const chooseStage=(id:string)=>{if(locked)return;const stage=choices?.stages.find(s=>s.enrollmentId===id);if(!stage)return;setRead(null);setFailure('');router.replace('/'+locale+'/family?fishing=1&'+fishingCalendarSearch({learnerId:stage.learnerId,enrollmentId:stage.enrollmentId,reference:{cohortId:stage.cohortId,stageId:stage.stageId,stage:stage.stage}}));};
 const refreshDetails=()=>{if(locked)return;setRead(null);setRefresh(n=>n+1);};
 const format=(v:string)=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(v));
 const calendar=context?fishingFamilyHref(locale,'family/schedule',context):'/'+locale+'/family/schedule?fishing=1';
 return <main className="lsw-stack lsw-home" data-academy-family-home lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{t('South Florida Jewish Leadership Fishing Academy','האקדמיה היהודית למנהיגות ודיג בדרום פלורידה')}</p><h1>{t('Your fishing academy','האקדמיה שלכם לדיג')}</h1><p>{t('Your next trip, your child’s progress and stage payments.','הטיול הבא, התקדמות ילדכם ותשלומי השלב.')}</p></div><Button variant="secondary" disabled={locked} onClick={refreshDetails}>{t('Refresh details','רענון הפרטים')}</Button></header>
  {failure===key?<section className="lsu-state lsu-state--error" role="alert"><p>{t('Your Academy information could not be read.','לא ניתן לקרוא את פרטי האקדמיה שלכם.')}</p><Button disabled={locked} onClick={refreshDetails}>{t('Try again','ניסיון נוסף')}</Button></section>:!value?<p role="status">{t('Loading your Academy…','טוען את האקדמיה שלכם…')}</p>:choices?.availability==='not_configured'?<p>{t('Academy access is not available yet.','הגישה לאקדמיה עדיין אינה זמינה.')}</p>:<>
   <section className="lsu-panel lsw-stack" aria-label={t('Your child and stage','ילדכם והשלב שלו')}>
    <Select id="academy-home-child" disabled={locked} label={t('Choose your child','בחירת ילדכם')} value={choices?.selectedLearnerId??''} onChange={e=>chooseChild(e.target.value)}><option value="">{t('Choose a child','בחרו ילד')}</option>{choices?.children.map(c=><option key={c.learnerId} value={c.learnerId}>{c.displayName}</option>)}</Select>
    {choices?.selectedLearnerId&&<Select id="academy-home-stage" disabled={locked} label={t('Stage enrollment','רישום לשלב')} value={home?.selection.enrollmentId??''} onChange={e=>chooseStage(e.target.value)}><option value="">{t('Choose a stage','בחרו שלב')}</option>{choices.stages.map(s=><option key={s.enrollmentId} value={s.enrollmentId??''}>{s.label} · {t('Stage','שלב')} {s.stage}</option>)}</Select>}
    {choices?.selectedLearnerId&&!choices.stages.length&&<p>{t('No confirmed stage is available for this child.','אין שלב מאושר זמין לילד זה.')}</p>}
   </section>
   {choices?.selectedLearnerId&&<AcademyEnrollmentControls key={choices.selectedLearnerId} learnerId={choices.selectedLearnerId} locale={locale} onLockedChange={setLocked}/>}
   {home&&<>
    <section className="lsu-panel lsw-stack" aria-label={t('Next fishing trip','טיול הדיג הבא')}><h2>{t('Next fishing trip','טיול הדיג הבא')}</h2>{next&&next.time.kind==='scheduled'?<>
     <h3>{t('Session','מפגש')} {next.ordinal}</h3><p><time dateTime={next.time.startsAt}>{format(next.time.startsAt)}</time> – <time dateTime={next.time.endsAt}>{format(next.time.endsAt)}</time> · <bdi>America/New_York</bdi></p>
     {next.revision>1&&<p role="status">{t('Trip details updated — please check the meeting point and time below.','פרטי הטיול עודכנו — בדקו את נקודת המפגש והשעה שלהלן.')}</p>}
     <p><strong>{t('Meeting point:','נקודת מפגש:')}</strong> {next.location}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><strong>{t('Directions and arrival:','הוראות הגעה:')}</strong> {next.directions||t('Arrival details have not been published.','פרטי ההגעה טרם פורסמו.')}</p>
     {next.location&&<a href={'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(next.location)} target="_blank" rel="noreferrer">{t('Open directions in Maps','פתיחת מסלול במפות')}</a>}
     <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><strong>{t('Bring:','הביאו:')}</strong> {next.equipment||t('Gear details have not been published.','פרטי הציוד טרם פורסמו.')}</p>
     {next.logisticalNote&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{next.logisticalNote}</p>}
     <p>{t('Last changed:','עודכן לאחרונה:')} <time dateTime={next.changedAt}>{format(next.changedAt)}</time></p>
    </>:<p>{t('Your next trip will appear here when confirmed.','הטיול הבא יופיע כאן לאחר אישורו.')}</p>}<a className="lsw-button lsw-button--secondary" href={calendar}>{t('Calendar and absence notice','יומן והודעה על היעדרות')}</a></section>
    <section className="lsu-panel lsw-stack" aria-label={t('Your child’s stage and skills','השלב והמיומנויות של ילדכם')}><h2>{home.label} · {t('Stage','שלב')} {home.view.stage}</h2>{home.view.weeklyUpdates?.length?<WeeklyProgressView updates={home.view.weeklyUpdates} locale={locale}/>:<p>{t('Your instructor’s published weekly updates will appear here.','עדכונים שבועיים שיפרסם המדריך יופיעו כאן.')}</p>}<details><summary>{t('Attendance and replacement updates','נוכחות ועדכוני השלמות')}</summary><FishingParentAttendanceSummary view={home.view} locale={locale}/><FishingParentMakeupSummary view={home.view} locale={locale}/></details></section>
    <section className="lsu-panel" aria-label={t('Ask your instructor','שאלה למדריך')}><h2>{t('Notice or ask a question','הודעה או שאלה')}</h2><p><a href={ACADEMY_WHATSAPP.split('?')[0]} target="_blank" rel="noreferrer">{t('Ask your instructor on WhatsApp','פנייה למדריך בוואטסאפ')}</a></p><p>{t('This opens a private conversation. You choose whether to send.','נפתחת שיחה פרטית. אתם מחליטים אם לשלוח.')}</p></section>
    <section className="lsu-panel">{home.payment?<FishingFamilyPayments payments={[home.payment]} locale={locale}/>:<><h2>{t('Payments','תשלומים')}</h2><p>{t('Stage payment details are available to the paying parent.','פרטי תשלומי השלב זמינים להורה המשלם.')}</p></>}</section>
   </>}
  </>}
 </main>;
}
