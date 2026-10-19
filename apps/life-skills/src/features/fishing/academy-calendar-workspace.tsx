'use client';
import {useCallback,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import type {Locale} from '../../lib/locale.ts';
import {Button,Select} from '../../ui/workspace/controls.tsx';
import {UnsavedChangesGuard} from '../../ui/workspace/draft-guard.tsx';
import {dateRange,shiftDay,shiftMonth} from '../calendar/time.ts';
import type {CalendarMode} from '../calendar/mode.ts';
import {FishingCalendarEntry,FishingCalendarWorkspace,useFishingCalendarTimeline} from './program-calendar-workspace.tsx';
import {fishingCalendarSearch,fishingCivilTime,type FishingCalendarEvent,type FishingCalendarSelection} from './program-calendar-contract.ts';

const contextKeys=['learnerId','enrollmentId','cohortId','stageId','stage'] as const;
/** A context hint chooses presentation only. Existing native HTTP services still
 * authorize every child, enrollment, cohort, occurrence and mutation. */
export function academyCalendarRequested(params:URLSearchParams){return params.has('fishing')||contextKeys.some(key=>params.has(key));}
export function AcademyCalendarWorkspace({locale,role,initialDate,initialView:view,initialMode='live'}:{locale:Locale;role:'parent'|'adult_client'|'child'|'practitioner';initialDate:string;initialView:'day'|'week'|'month'|'agenda';initialMode?:CalendarMode}){
 const router=useRouter(),search=useSearchParams().toString(),params=new URLSearchParams(search),t=(en:string,he:string)=>locale==='he'?he:en;
 const [dirty,setDirty]=useState(false),[refresh,setRefresh]=useState(0),[picker,setPicker]=useState<{key:string;item:FishingCalendarEvent}|null>(null),[choice,setChoice]=useState('');
 const today=fishingCivilTime(new Date().toISOString()).date,date=params.getAll('date').length===1?initialDate:today;
 const enabled=initialMode!=='demo'&&role!=='adult_client'&&(!params.has('fishing')||params.getAll('fishing').length===1&&params.get('fishing')==='1');
 const range=dateRange(date,view),timeline=useFishingCalendarTimeline({enabled,role,from:range.dates[0]!,to:range.dates.at(-1)!,search,refresh});
 const base=`/${locale}/${role==='practitioner'?'app/calendar':role==='child'?'client/calendar':'family/schedule'}`;
 const changed=useCallback(()=>setRefresh(n=>n+1),[]),leave=t('Leave unsaved fishing work? Leaving does not undo a submitted operation.','לצאת מעבודת דיג שלא נשמרה? יציאה אינה מבטלת פעולה שנשלחה.');
 function href(nextDate:string,nextView:string=view){const query=new URLSearchParams({fishing:'1',date:nextDate,view:nextView});for(const key of contextKeys)for(const v of params.getAll(key))query.append(key,v);return base+'?'+query;}
 function openSelection(selection:FishingCalendarSelection){
  if(dirty&&!window.confirm(leave))return;
  setPicker(null);setChoice('');router.push(base+'?'+new URLSearchParams({fishing:'1',date,view,...Object.fromEntries(new URLSearchParams(fishingCalendarSearch(selection)))}),{scroll:false});
 }
 function open(item:FishingCalendarEvent){if(item.selections.length===1)openSelection(item.selections[0]!);else{setChoice('');setPicker({key:search,item});}}
 const selected=picker?.key===search?picker.item:null;
 const period=new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',month:'long',year:'numeric'}).format(new Date(date+'T12:00Z'));
 const schedule=<div className="lsw-stack" data-academy-calendar-timeline>
  {timeline.loading?<p role="status">{t('Loading fishing sessions…','טוען מפגשי דיג…')}</p>:timeline.failure?<div role="alert"><p>{t('Fishing sessions could not load. Check your current access and try again.','לא ניתן לטעון את מפגשי הדיג. בדקו את ההרשאה הנוכחית ונסו שוב.')}</p><Button variant="secondary" onClick={timeline.retry}>{t('Retry sessions','ניסיון טעינה נוסף')}</Button></div>:timeline.items.length?range.dates.map(day=>{
   const items=timeline.items.filter(item=>fishingCivilTime(item.startsAt).date===day);return items.length?<section key={day} className="lsu-panel lsw-stack"><h3><time dateTime={day}>{new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',weekday:'long',month:'short',day:'numeric'}).format(new Date(day+'T12:00Z'))}</time></h3>{items.map(item=><FishingCalendarEntry key={item.id} item={item} locale={locale} compact={false} onOpen={open}/>)}</section>:null;
  }):<p>{t('No fishing sessions are published in this date range. Choose your child and stage below to see the full plan.','אין מפגשי דיג שפורסמו בטווח התאריכים הזה. בחרו את ילדכם ואת השלב להלן להצגת התוכנית המלאה.')}</p>}
 </div>;
 return <main className="ls-cal lsw lsw-stack" data-academy-calendar lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <UnsavedChangesGuard dirty={dirty} message={leave}/>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{t('South Florida Jewish Leadership Fishing Academy','האקדמיה היהודית למנהיגות ודיג בדרום פלורידה')}</p><h1>{t('Fishing calendar','יומן הדיג')}</h1><p>{t('Group sessions, trip details, attendance and weekly progress.','מפגשים קבוצתיים, פרטי טיולים, נוכחות והתקדמות שבועית.')} · <bdi>America/New_York</bdi></p></div></header>
  {!enabled?<p role="alert">{t('Academy Calendar is unavailable in this context. Open your authorized Academy account.','יומן האקדמיה אינו זמין בהקשר זה. פתחו את חשבון האקדמיה המורשה שלכם.')}</p>:<>
   <section className="lsw-stack" aria-label={t('Fishing session dates','מועדי מפגשי הדיג')}><header className="lsw-calendar-toolbar"><h2>{period}</h2><nav aria-label={t('Calendar views','תצוגות יומן')}>{(['day','week','month','agenda'] as const).map(value=><a key={value} href={href(date,value)} aria-current={view===value?'page':undefined}>{({day:t('Day','יום'),week:t('Week','שבוע'),month:t('Month','חודש'),agenda:t('Agenda','סדר יום')})[value]}</a>)}</nav><nav aria-label={t('Calendar dates','תאריכי היומן')}><a href={href(view==='month'?shiftMonth(date,-1):shiftDay(date,view==='day'?-1:view==='agenda'?-14:-7))}>{t('Previous','הקודם')}</a><a href={href(today)}>{t('Today','היום')}</a><a href={href(view==='month'?shiftMonth(date,1):shiftDay(date,view==='day'?1:view==='agenda'?14:7))}>{t('Next','הבא')}</a></nav><span className="lsw-help" dir="ltr">America/New_York</span></header>{schedule}</section>
   {selected&&<section className="lsu-panel lsw-stack"><Select id="academy-calendar-occurrence-context" label={t('Choose the child and stage for this session','בחירת הילד והשלב למפגש זה')} value={choice} onChange={e=>setChoice(e.target.value)}><option value="">{t('Choose an authorized context','בחירת הקשר מורשה')}</option>{selected.selections.map((s,i)=><option key={fishingCalendarSearch(s)} value={String(i)}>{selected.label} · {t('Enrollment','רישום')} {i+1}</option>)}</Select><Button disabled={choice===''} onClick={()=>{const selection=selected.selections[Number(choice)];if(choice!==''&&selection)openSelection(selection);}}>{t('Open session','פתיחת המפגש')}</Button></section>}
   <FishingCalendarWorkspace locale={locale} role={role} enabled onDirtyChange={setDirty} onSaved={changed}/>
  </>}
 </main>;
}
