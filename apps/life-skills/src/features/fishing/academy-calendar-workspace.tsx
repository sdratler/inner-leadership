'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import type {Locale} from '../../lib/locale.ts';
import {Button,Select} from '../../ui/workspace/controls.tsx';
import {UnsavedChangesGuard} from '../../ui/workspace/draft-guard.tsx';
import {academyCalendarRange,academyCalendarShiftDay,academyCalendarShiftMonth,academyCalendarViewSchema,type AcademyCalendarView} from './academy-group-calendar-core.ts';
import styles from './program-calendar.module.css';
import type {CalendarMode} from '../calendar/mode.ts';
import {FishingCalendarEntry,FishingCalendarWorkspace,useFishingCalendarTimeline} from './program-calendar-workspace.tsx';
import {fishingCalendarSearch,fishingCivilTime,type FishingCalendarEvent,type FishingCalendarSelection} from './program-calendar-contract.ts';
import {AcademyGroupCalendarControls} from './academy-group-calendar-controls.tsx';

const contextKeys=['learnerId','enrollmentId','cohortId','stageId','stage'] as const;
/** A context hint chooses presentation only. Existing native HTTP services still
 * authorize every child, enrollment, cohort, occurrence and mutation. */
export function academyCalendarRequested(params:URLSearchParams){return params.has('fishing')||contextKeys.some(key=>params.has(key));}
export function AcademyCalendarWorkspace({locale,role,initialDate,initialView,initialMode='live'}:{locale:Locale;role:'parent'|'adult_client'|'child'|'practitioner';initialDate:string;initialView:'day'|'week'|'month'|'agenda';initialMode?:CalendarMode}){
 const router=useRouter(),search=useSearchParams().toString(),params=new URLSearchParams(search),t=(en:string,he:string)=>locale==='he'?he:en;
 const [stageDirty,setStageDirty]=useState(false),[groupDirty,setGroupDirty]=useState(false),[refresh,setRefresh]=useState(0),[picker,setPicker]=useState<{key:string;item:FishingCalendarEvent}|null>(null),[choice,setChoice]=useState('');
 const dirty=stageDirty||groupDirty,lastHref=useRef('');
 const today=fishingCivilTime(new Date().toISOString()).date,date=params.getAll('date').length===1?initialDate:today;
 const requestedView=params.getAll('academyView'),parsedView=academyCalendarViewSchema.safeParse(requestedView[0]);
 const view:AcademyCalendarView=requestedView.length===1&&parsedView.success?parsedView.data:!params.has('view')&&role==='practitioner'?'year':initialView;
 const enabled=initialMode!=='demo'&&role!=='adult_client'&&(!params.has('fishing')||params.getAll('fishing').length===1&&params.get('fishing')==='1')&&(!requestedView.length||requestedView.length===1&&parsedView.success);
 const range=academyCalendarRange(date,view),timeline=useFishingCalendarTimeline({enabled,role,from:range.from,to:range.to,search,refresh});
 const base=`/${locale}/${role==='practitioner'?'app/calendar':role==='child'?'client/calendar':'family/schedule'}`;
 const changed=useCallback(()=>setRefresh(n=>n+1),[]),leave=t('Leave unsaved fishing work? Leaving does not undo a submitted operation.','לצאת מעבודת דיג שלא נשמרה? יציאה אינה מבטלת פעולה שנשלחה.');
 useEffect(()=>{const pop=()=>{if(groupDirty&&!window.confirm(leave)&&lastHref.current)router.replace(lastHref.current,{scroll:false});};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[groupDirty,leave,router]);
 useEffect(()=>{lastHref.current=base+'?'+search;},[base,search]);
 function href(nextDate:string,nextView:AcademyCalendarView=view){const query=new URLSearchParams({fishing:'1',date:nextDate,view:nextView==='year'||nextView==='four_weeks'?'month':nextView,academyView:nextView});for(const key of contextKeys)for(const v of params.getAll(key))query.append(key,v);return base+'?'+query;}
 function navigate(nextDate:string,nextView:AcademyCalendarView){if(dirty&&!window.confirm(leave))return;router.push(href(nextDate,nextView),{scroll:false});}
 function openSelection(selection:FishingCalendarSelection){
  const selectedParams=new URLSearchParams(fishingCalendarSearch(selection));
  if(contextKeys.every(key=>JSON.stringify(params.getAll(key))===JSON.stringify(selectedParams.getAll(key)))){
   // Opening the displayed context must not remount it after an instructor has
   // started an edit. Keep the current draft and focus its existing plan.
   setPicker(null);setChoice('');const heading=document.getElementById('fishing-calendar-heading');heading?.scrollIntoView({block:'start'});heading?.focus({preventScroll:true});return;
  }
  if(dirty&&!window.confirm(leave))return;
  setPicker(null);setChoice('');router.push(base+'?'+new URLSearchParams({fishing:'1',date,view:view==='year'||view==='four_weeks'?'month':view,academyView:view,...Object.fromEntries(new URLSearchParams(fishingCalendarSearch(selection)))}),{scroll:false});
 }
 function open(item:FishingCalendarEvent){if(item.selections.length===1)openSelection(item.selections[0]!);else{setChoice('');setPicker({key:search,item});}}
 const selected=picker?.key===search?picker.item:null;
 const monthLabel=(day:string)=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',month:'long',year:'numeric'}).format(new Date(day+'T12:00Z'));
 const dayLabel=(day:string)=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric'}).format(new Date(day+'T12:00Z'));
 const period=view==='year'?monthLabel(range.from)+' – '+monthLabel(range.to):view==='four_weeks'?dayLabel(range.from)+' – '+dayLabel(range.to):monthLabel(date);
 const itemsOn=(day:string)=>timeline.items.filter(item=>fishingCivilTime(item.startsAt).date===day);
 const schedule=<div className="lsw-stack" data-academy-calendar-timeline data-academy-view={view}>
  {timeline.loading?<p role="status">{t('Loading the complete fishing calendar…','טוען את יומן הדיג המלא…')}</p>:timeline.failure?<div role="alert"><p>{t('The complete date range could not load. No partial calendar is shown. Check your current access and try again.','לא ניתן לטעון את מלוא טווח התאריכים. לא מוצג יומן חלקי. בדקו את ההרשאה הנוכחית ונסו שוב.')}</p><Button variant="secondary" onClick={timeline.retry}>{t('Retry sessions','ניסיון טעינה נוסף')}</Button></div>:view==='year'?<div className={styles.calendarYear}>{range.months.map(month=>{
   const items=timeline.items.filter(item=>fishingCivilTime(item.startsAt).date.startsWith(month.slice(0,7)));
   return <section key={month} className={styles.calendarMonth} data-academy-month={month}><h3><button type="button" onClick={()=>navigate(month,'month')} aria-label={t('Open month: ','פתיחת חודש: ')+monthLabel(month)}>{monthLabel(month)}</button></h3><p>{items.length} {t('listed sessions','מפגשים רשומים')}</p>{items.slice(0,3).map(item=><p key={item.id} data-academy-stage={item.selections[0]!.reference.stage}><time dateTime={item.startsAt}>{dayLabel(fishingCivilTime(item.startsAt).date)}</time> · {item.label}{!item.shared&&<> · {t('Session','מפגש')} {item.ordinal}</>}</p>)}{items.length>3&&<p>{t('Open this month to see every session.','פתחו את החודש כדי לראות את כל המפגשים.')}</p>}</section>;
  })}</div>:<div className={view==='month'||view==='four_weeks'||view==='week'?styles.calendarGrid:'lsw-stack'}>{range.dates.map(day=>{
   const items=itemsOn(day);if(view==='agenda'&&!items.length)return null;
   return <section key={day} className={styles.calendarDay} data-academy-date={day} aria-label={dayLabel(day)}><h3><button type="button" onClick={()=>navigate(day,'day')} aria-current={day===today?'date':undefined}><time dateTime={day}>{dayLabel(day)}</time></button></h3>{items.map(item=><div key={item.id} data-academy-stage={item.selections[0]!.reference.stage}><FishingCalendarEntry item={item} locale={locale} compact={view!=='day'&&view!=='agenda'} onOpen={open}/></div>)}{!items.length&&<p className={styles.note}>{t('No published session','אין מפגש שפורסם')}</p>}</section>;
  })}</div>}
  {!timeline.loading&&!timeline.failure&&!timeline.items.length&&<p>{t('No fishing sessions are published in this date range. Undated plans remain available below; no booking or delivery is inferred.','אין מפגשי דיג שפורסמו בטווח התאריכים הזה. תוכניות ללא מועד זמינות להלן; אין בכך אישור להזמנה או לקיום שיעור.')}</p>}
 </div>;
 const step=(delta:number)=>view==='year'?academyCalendarShiftMonth(date,delta*12):view==='month'?academyCalendarShiftMonth(date,delta):academyCalendarShiftDay(date,delta*(view==='day'?1:view==='four_weeks'?28:view==='agenda'?14:7));
 return <main className="ls-cal lsw lsw-stack" data-academy-calendar lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <UnsavedChangesGuard dirty={dirty} message={leave}/>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{t('South Florida Jewish Leadership Fishing Academy','האקדמיה היהודית למנהיגות ודיג בדרום פלורידה')}</p><h1>{t('Fishing calendar','יומן הדיג')}</h1><p>{t('Group sessions, trip details, attendance and weekly progress.','מפגשים קבוצתיים, פרטי טיולים, נוכחות והתקדמות שבועית.')} · <bdi>America/New_York</bdi></p></div></header>
  {!enabled?<p role="alert">{t('Academy Calendar is unavailable in this context. Open your authorized Academy account.','יומן האקדמיה אינו זמין בהקשר זה. פתחו את חשבון האקדמיה המורשה שלכם.')}</p>:<>
   <section className="lsw-stack" aria-label={t('Fishing session dates','מועדי מפגשי הדיג')}><header className="lsw-calendar-toolbar"><h2>{period}</h2><nav aria-label={t('Calendar views','תצוגות יומן')}>{(['day','week','four_weeks','month','year','agenda'] as const).map(value=><a key={value} href={href(date,value)} aria-current={view===value?'page':undefined}>{({day:t('Day','יום'),week:t('Week','שבוע'),four_weeks:t('Four weeks','ארבעה שבועות'),month:t('Month','חודש'),year:t('Full year','שנה מלאה'),agenda:t('Agenda','סדר יום')})[value]}</a>)}</nav><nav aria-label={t('Calendar dates','תאריכי היומן')}><a href={href(step(-1))}>{t('Previous','הקודם')}</a><a href={href(today)}>{t('Today','היום')}</a><a href={href(step(1))}>{t('Next','הבא')}</a></nav><span className="lsw-help" dir="ltr">America/New_York</span></header>{schedule}</section>
   {selected&&<section className="lsu-panel lsw-stack"><Select id="academy-calendar-occurrence-context" label={t('Choose the child and stage for this session','בחירת הילד והשלב למפגש זה')} value={choice} onChange={e=>setChoice(e.target.value)}><option value="">{t('Choose an authorized context','בחירת הקשר מורשה')}</option>{selected.selections.map((s,i)=><option key={fishingCalendarSearch(s)} value={String(i)}>{selected.label} · {t('Enrollment','רישום')} {i+1}</option>)}</Select><Button disabled={choice===''} onClick={()=>{const selection=selected.selections[Number(choice)];if(choice!==''&&selection)openSelection(selection);}}>{t('Open session','פתיחת המפגש')}</Button></section>}
   {role==='practitioner'&&<AcademyGroupCalendarControls key={date.slice(0,7)} locale={locale} month={date.slice(0,7)} blocked={stageDirty} onDirtyChange={setGroupDirty}/>}
   <fieldset disabled={groupDirty} className="lsw-stack"><FishingCalendarWorkspace locale={locale} role={role} enabled onDirtyChange={setStageDirty} onSaved={changed}/></fieldset>
  </>}
 </main>;
}
