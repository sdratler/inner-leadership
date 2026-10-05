'use client';
import {useEffect,useRef,type MouseEvent} from 'react';
import type { Locale } from '../../lib/locale.ts';
import { Button } from '../../ui/workspace/controls.tsx';
import { Card, StatusChip } from '../../ui/workspace/surfaces.tsx';
import type { AppointmentView } from './types.ts';
import type { CalendarFollowup } from './followups.ts';
import type { InternalTask } from './tasks.ts';
import type { PracticeOccurrenceItem } from '../home-practice/types.ts';
import { PracticeCalendarEntry, type OpenCalendarPractice } from '../home-practice/calendar-entry.tsx';
import { administrativeActionLabel } from '../prospects/admin-display.ts';
import {localizedTaskTitle} from './administrative-work-copy.ts';
import type {CalendarContent} from './content.ts';
import {CalendarContentEntry} from './content-entry.tsx';
import { text } from './copy.ts';
import {taskCalendarDate,taskStateLabel} from './task-state.ts';
import { civilDate, localMinute } from './time.ts';
export function formatTime(value:string,locale:Locale,full=true){return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',...(full?{dateStyle:'medium' as const}:{}),timeStyle:'short',hourCycle:'h23'}).format(new Date(value));}
export type OpenAppointment=(a:AppointmentView,e:MouseEvent<HTMLButtonElement>)=>void;
export type OpenTaskManager=(task:InternalTask,e:MouseEvent<HTMLButtonElement>)=>void;
function TaskWorkflow({task,locale,onManage}:{task:InternalTask;locale:Locale;onManage?:OpenTaskManager|undefined}){
 return <><span>{taskStateLabel(task.state,locale)}</span>{task.snoozedUntil&&<p>{locale==='he'?'נדחתה עד':'Snoozed until'} <time dateTime={task.snoozedUntil}>{task.snoozedUntil}</time> · {locale==='he'?'מועד המשימה המקורי':'Original task date'} <time dateTime={task.dueDate}>{task.dueDate}</time></p>}{onManage&&<Button variant="quiet" onClick={event=>onManage(task,event)} aria-haspopup="dialog" aria-controls="ls-cal-task-manage">{locale==='he'?'ניהול משימה':'Manage task'}</Button>}</>;
}
function followupHref(locale:Locale,leadId:string){return `/${locale}/app/clients?section=prospects&leadId=${encodeURIComponent(leadId)}`;}
function taskSourceHref(locale:Locale,path:string){return path.replace(/^\/(?:he|en)\/app\//,`/${locale}/app/`);}
function TaskDetails({note,locale}:{note:string|null;locale:Locale}){
 return note?<details><summary>{locale==='he'?'פרטים':'Details'}</summary><p>{note}</p></details>:null;
}
function taskHeading(task:InternalTask,locale:Locale,names:Record<string,string>):string{
 const title=localizedTaskTitle(task.title,task.sourceKind,locale);
 return task.sourceKind&&task.sourceKind!=='crm_followup'&&task.caseId&&names[task.caseId]?`${names[task.caseId]} · ${title}`:title;
}
export function CalendarBoard({dates,items,followups=[],tasks=[],practice=[],content=[],onOpenPractice,locale,view,names,onOpen,onCompleteTask,onManageTask}:{dates:string[];items:AppointmentView[];followups?:CalendarFollowup[];tasks?:InternalTask[];practice?:PracticeOccurrenceItem[];content?:CalendarContent[];onOpenPractice?:OpenCalendarPractice;locale:Locale;view:'day'|'week'|'month';names:Record<string,string>;onOpen:OpenAppointment;onCompleteTask?:((task:InternalTask)=>void)|undefined;onManageTask?:OpenTaskManager|undefined}){
 const t=text(locale);
 return <div className={'ls-cal-board ls-cal-board--'+view} data-ls-calendar-grid>{dates.map(date=>{
   const appointments=items.filter(a=>civilDate(a.startsAt)===date),due=followups.filter(item=>item.dueDate===date),dayTasks=tasks.filter(item=>taskCalendarDate(item)===date),dayPractice=onOpenPractice?practice.filter(item=>item.occurrence.occursOn===date):[],dayContent=content.filter(item=>item.date===date);
  const heading=new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Jerusalem'}).format(new Date(date+'T12:00:00Z'));
  return <section key={date} className="ls-cal-day" aria-labelledby={'day-'+date}><h3 id={'day-'+date}><time dateTime={date}>{heading}</time></h3>
   {appointments.map(a=><button data-appointment-id={a.id} type="button" className={'ls-cal-slot ls-cal-slot--'+a.status} key={a.id} onClick={e=>onOpen(a,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail" aria-label={`${names[a.caseId]??t.case} · ${t[a.kind]} · ${formatTime(a.startsAt,locale)} · ${t[a.status]}`}><time dateTime={a.startsAt}>{formatTime(a.startsAt,locale,false)}</time><strong>{names[a.caseId]??t.case}</strong><span>{t[a.kind]}</span><span className="ls-cal-slot-state">{t[a.status]}</span>{a.notice&&<span>{t.received}</span>}</button>)}
   {due.map(item=><a className="ls-cal-followup" href={followupHref(locale,item.leadId)} key={item.leadId} aria-label={`${locale==='he'?'המשך טיפול':'Follow-up'} · ${item.name||item.leadId} · ${administrativeActionLabel(item.nextAction||'—',locale)}`}><span>{locale==='he'?'המשך טיפול':'Follow-up'}</span><strong>{item.name||item.leadId}</strong>{item.nextAction&&<small>{administrativeActionLabel(item.nextAction,locale)}</small>}</a>)}
   {dayTasks.map(task=><article className="ls-cal-task" key={task.id}><span>{locale==='he'?'משימה':'Task'} · {task.dueTime||(locale==='he'?'כל היום':'All day')}</span><strong>{taskHeading(task,locale,names)}</strong><TaskWorkflow task={task} locale={locale} onManage={onManageTask}/><TaskDetails note={task.note} locale={locale}/>{task.sourcePath&&<a href={taskSourceHref(locale,task.sourcePath)}>{locale==='he'?'פתיחת מקור':'Open source'}</a>}{task.state!=='done'&&onCompleteTask&&<button type="button" onClick={()=>onCompleteTask(task)}>{locale==='he'?'סימון כהושלמה':'Mark done'}</button>}</article>)}
    {dayPractice.map(item=><PracticeCalendarEntry key={item.occurrence.id} item={item} locale={locale} onOpen={onOpenPractice!}/>)}
    {dayContent.map(item=><CalendarContentEntry key={item.id} item={item} locale={locale} compact/>)}
    {!appointments.length&&!due.length&&!dayTasks.length&&!dayPractice.length&&!dayContent.length&&<p className="ls-cal-day-empty" aria-label={t.empty}>—</p>}
  </section>;
 })}</div>;
}
/** Only a rendered, visible authorized task in this agenda can be selected. */
export function calendarTaskFragment(hash:string,search:string):string{
 const ids=new URLSearchParams(search).getAll('taskId'),candidate=hash||(ids.length===1?'#task-'+ids[0]:'');
 return /^#task-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)?candidate:'';
}
export function revealCalendarTaskFragment(root:Pick<HTMLElement,'querySelector'>,hash:string):boolean{
 if(!/^#task-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hash))return false;
 const target=root.querySelector<HTMLElement>(hash);if(!target||!target.getClientRects().length)return false;
 target.scrollIntoView({block:'center',behavior:'auto'});target.focus({preventScroll:true});return true;
}
export function CalendarAgenda({items,followups=[],tasks=[],practice=[],content=[],onOpenPractice,locale,names,onOpen,onCompleteTask,onManageTask}:{items:AppointmentView[];followups?:CalendarFollowup[];tasks?:InternalTask[];practice?:PracticeOccurrenceItem[];content?:CalendarContent[];onOpenPractice?:OpenCalendarPractice;locale:Locale;names:Record<string,string>;onOpen:OpenAppointment;onCompleteTask?:((task:InternalTask)=>void)|undefined;onManageTask?:OpenTaskManager|undefined}){
 const t=text(locale);
 const agenda=useRef<HTMLDivElement>(null),appliedFragment=useRef<string|null>(null);
 useEffect(()=>{
  const apply=()=>{const hash=calendarTaskFragment(window.location.hash,window.location.search);if(hash!==appliedFragment.current&&agenda.current&&revealCalendarTaskFragment(agenda.current,hash))appliedFragment.current=hash;};
  // Effects run after asynchronous task rows commit to the DOM. Keep the
  // applied fragment across ordinary task refreshes so focus is not stolen.
  apply();const changed=()=>{appliedFragment.current=null;apply();};
  window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);
 },[tasks]);
 const entries=[...items.map(item=>({kind:'appointment' as const,sortTime:localMinute(item.startsAt).slice(11),date:civilDate(item.startsAt),item})),
  ...followups.map(item=>({kind:'followup' as const,sortTime:'',date:item.dueDate,item})),
   ...tasks.map(item=>({kind:'task' as const,sortTime:item.dueTime??'',date:taskCalendarDate(item),item})),
   ...content.map(item=>({kind:'content' as const,sortTime:item.localTime,date:item.date,item})),
   ...(onOpenPractice?practice.map(item=>({kind:'practice' as const,sortTime:item.schedule?.localTime??'',date:item.occurrence.occursOn,item})):[])]
  .sort((a,b)=>a.date.localeCompare(b.date)||a.sortTime.localeCompare(b.sortTime));
  return <div ref={agenda} className="ls-cal-agenda-list">{entries.map(entry=>entry.kind==='content'?<CalendarContentEntry key={'content-'+entry.item.id} item={entry.item} locale={locale}/>:entry.kind==='practice'?<article className="ls-cal-practice-agenda" key={'practice-'+entry.item.occurrence.id}><time dateTime={entry.date}>{new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{dateStyle:'medium',timeZone:'Asia/Jerusalem'}).format(new Date(entry.date+'T12:00:00Z'))}</time><PracticeCalendarEntry item={entry.item} locale={locale} onOpen={onOpenPractice!}/></article>:entry.kind==='appointment'?<Card id={'agenda-'+entry.item.id} key={'appointment-'+entry.item.id} title={names[entry.item.caseId]??t.case}>
  <p>{t[entry.item.kind]}</p><p className="ls-cal-time"><time dateTime={entry.item.startsAt}>{formatTime(entry.item.startsAt,locale)}</time> – <time dateTime={entry.item.endsAt}>{formatTime(entry.item.endsAt,locale,false)}</time></p><StatusChip tone={entry.item.status==='scheduled'?'neutral':'warning'}>{t[entry.item.status]}</StatusChip>
  <p>{t.attendance}: {entry.item.attendance?t[entry.item.attendance.state]:t.unrecorded}</p><Button data-appointment-id={entry.item.id} variant="secondary" onClick={e=>onOpen(entry.item,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail">{t.details}</Button></Card>:entry.kind==='followup'?<Card id={'followup-'+entry.item.leadId} key={'followup-'+entry.item.leadId} title={entry.item.name||entry.item.leadId}><p><span className="ls-cal-layer-label">{locale==='he'?'המשך טיפול':'Follow-up'}</span> <time dateTime={entry.item.dueDate}>{entry.item.dueDate}</time></p>{entry.item.nextAction&&<p>{administrativeActionLabel(entry.item.nextAction,locale)}</p>}<a className="lsw-button lsw-button--secondary" href={followupHref(locale,entry.item.leadId)}>{locale==='he'?'פתיחת האדם':'Open person'}</a></Card>:<div id={'task-'+entry.item.id} key={'task-'+entry.item.id} tabIndex={-1} role="group" aria-labelledby={'task-body-'+entry.item.id+'-title'}><Card id={'task-body-'+entry.item.id} title={taskHeading(entry.item,locale,names)}><p><span className="ls-cal-layer-label">{locale==='he'?'משימה':'Task'}</span> <time dateTime={entry.date}>{entry.date}</time> · {entry.item.dueTime||(locale==='he'?'כל היום':'All day')}</p><TaskWorkflow task={entry.item} locale={locale} onManage={onManageTask}/><TaskDetails note={entry.item.note} locale={locale}/>{entry.item.sourcePath&&<p><a href={taskSourceHref(locale,entry.item.sourcePath)}>{locale==='he'?'פתיחת מקור':'Open source'}</a></p>}{entry.item.state!=='done'&&onCompleteTask&&<Button variant="secondary" onClick={()=>onCompleteTask(entry.item)}>{locale==='he'?'סימון כהושלמה':'Mark done'}</Button>}</Card></div>)}
  {!entries.length&&<p>{t.empty}</p>}</div>;
}
export function NoticeReceipt({appointment:a,locale,onReplacement}:{appointment:AppointmentView;locale:Locale;onReplacement?:()=>void}){
 const t=text(locale),n=a.notice;if(!n)return null;
 const protectedCredit=n.eligibility==='credit_preserved'||Boolean(a.creditException),replacement=a.replacementId??n.replacementId;
 return <section className="ls-cal-receipt" aria-labelledby={'receipt-'+a.id}><h3 id={'receipt-'+a.id} tabIndex={-1}>{t.received}</h3><dl className="ls-cal-facts">
 <div><dt>{t.originalStart}</dt><dd><time dateTime={n.originalStart}>{formatTime(n.originalStart,locale)}</time></dd></div>
 <div><dt>{t.receivedAt}</dt><dd><time dateTime={n.receivedAt}>{formatTime(n.receivedAt,locale)}</time></dd></div>
 <div><dt>{t.recordedAt}</dt><dd><time dateTime={n.recordedAt}>{formatTime(n.recordedAt,locale)}</time></dd></div>
 <div><dt>{t.source}</dt><dd>{t[n.source]}</dd></div><div><dt>{t.receiptId}</dt><dd><bdi>{n.id}</bdi></dd></div></dl>
 <StatusChip tone={protectedCredit?'positive':'warning'}>{a.kind==='parent_guidance'?t.included:a.creditException?t.exceptionApproved:protectedCredit?t.protected:t.lateNotice}</StatusChip>
 <p>{t.financialSeparate}</p>{n.kind==='reschedule'||replacement?<p>{replacement?t.replacementConfirmed:t.pending}</p>:null}
 {replacement&&onReplacement&&<Button variant="secondary" onClick={onReplacement}>{t.openReplacement}</Button>}</section>;
}
