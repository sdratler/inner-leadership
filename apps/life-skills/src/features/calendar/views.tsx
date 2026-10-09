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
import {CalendarTaskCard,type OpenTaskManager} from './task-card.tsx';
export type {OpenTaskManager} from './task-card.tsx';
import {orderedCalendarEntries,type CalendarEntry} from './entry-order.ts';
import {timingGroup,timingGroupLabel,timingLabel} from './task-presentation.ts';
import type {CalendarContent} from './content.ts';
import {CalendarContentEntry} from './content-entry.tsx';
import { text } from './copy.ts';
export function formatTime(value:string,locale:Locale,full=true){return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',...(full?{dateStyle:'medium' as const}:{}),timeStyle:'short',hourCycle:'h23'}).format(new Date(value));}
export type OpenAppointment=(a:AppointmentView,e:MouseEvent<HTMLButtonElement>)=>void;
function followupHref(locale:Locale,leadId:string){return '/'+locale+'/app/clients?section=prospects&leadId='+encodeURIComponent(leadId);}
type CalendarEntryProps={locale:Locale;names:Record<string,string>;onOpen:OpenAppointment;onCompleteTask?:((task:InternalTask)=>void)|undefined;onManageTask?:OpenTaskManager|undefined;onOpenPractice?:OpenCalendarPractice|undefined};
function CalendarEntryView({entry,compact,...props}:CalendarEntryProps&{entry:CalendarEntry;compact:boolean}){
 const {locale,names,onOpen,onOpenPractice,onCompleteTask,onManageTask}=props,t=text(locale);
 if(entry.kind==='task')return <CalendarTaskCard task={entry.item} locale={locale} names={names} agenda={!compact} onCompleteTask={onCompleteTask} onManageTask={onManageTask}/>;
 if(entry.kind==='content')return <CalendarContentEntry item={entry.item} locale={locale} compact={compact}/>;
 if(entry.kind==='practice')return <article className="ls-cal-practice-agenda"><PracticeCalendarEntry item={entry.item} locale={locale} onOpen={onOpenPractice!}/></article>;
 if(entry.kind==='followup'){
  const item=entry.item,person=item.name&&!/^LS-(?:LEAD|WAPI)-/.test(item.name)?item.name:(locale==='he'?'פנייה ללא שם':'Unnamed inquiry');
  return <a className="ls-cal-followup" href={followupHref(locale,item.leadId)}><span>{locale==='he'?'המשך טיפול':'Follow-up'} · <bdi>{timingLabel(entry.timing,locale)}</bdi></span><strong>{person}</strong>{item.nextAction&&<small>{administrativeActionLabel(item.nextAction,locale)}</small>}</a>;
 }
 const a=entry.item;
 if(compact)return <button data-appointment-id={a.id} type="button" className={'ls-cal-slot ls-cal-slot--'+a.status} onClick={e=>onOpen(a,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail" aria-label={`${names[a.caseId]??t.case} · ${t[a.kind]} · ${formatTime(a.startsAt,locale)} · ${t[a.status]}`}><time dateTime={a.startsAt}>{formatTime(a.startsAt,locale,false)}</time><strong>{names[a.caseId]??t.case}</strong><span>{t[a.kind]}</span><span className="ls-cal-slot-state">{t[a.status]}</span>{a.notice&&<span>{t.received}</span>}</button>;
 return <Card id={'agenda-'+a.id} title={names[a.caseId]??t.case}><p>{t[a.kind]}</p><p className="ls-cal-time"><time dateTime={a.startsAt}>{formatTime(a.startsAt,locale)}</time> – <time dateTime={a.endsAt}>{formatTime(a.endsAt,locale,false)}</time></p><StatusChip tone={a.status==='scheduled'?'neutral':'warning'}>{t[a.status]}</StatusChip><p>{t.attendance}: {a.attendance?t[a.attendance.state]:t.unrecorded}</p><Button data-appointment-id={a.id} variant="secondary" onClick={e=>onOpen(a,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail">{t.details}</Button></Card>;
}
function CalendarEntryGroups({entries,compact,...props}:CalendarEntryProps&{entries:CalendarEntry[];compact:boolean}){
 return <>{(['timed','part_of_day','unset'] as const).map(group=>{const visible=entries.filter(entry=>timingGroup(entry.timing)===group);return visible.length?<section className="ls-cal-entry-group" key={group} aria-label={timingGroupLabel(group,props.locale)}><h4 className="ls-cal-group-label">{timingGroupLabel(group,props.locale)}</h4>{visible.map(entry=><CalendarEntryView {...props} entry={entry} compact={compact} key={entry.key}/>)}</section>:null;})}</>;
}
export function CalendarBoard({dates,items,followups=[],tasks=[],practice=[],content=[],onOpenPractice,locale,view,names,onOpen,onCompleteTask,onManageTask}:{dates:string[];items:AppointmentView[];followups?:CalendarFollowup[];tasks?:InternalTask[];practice?:PracticeOccurrenceItem[];content?:CalendarContent[];onOpenPractice?:OpenCalendarPractice;locale:Locale;view:'day'|'week'|'month';names:Record<string,string>;onOpen:OpenAppointment;onCompleteTask?:((task:InternalTask)=>void)|undefined;onManageTask?:OpenTaskManager|undefined}){
 const t=text(locale),entries=orderedCalendarEntries({items,followups,tasks,content,practice:onOpenPractice?practice:[]});
 return <div className={'ls-cal-board ls-cal-board--'+view} data-ls-calendar-grid>{dates.map(date=>{
  const dayEntries=entries.filter(entry=>entry.date===date),heading=new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Jerusalem'}).format(new Date(date+'T12:00:00Z'));
  return <section key={date} className="ls-cal-day" aria-labelledby={'day-'+date}><h3 id={'day-'+date}><time dateTime={date}>{heading}</time></h3><CalendarEntryGroups entries={dayEntries} compact locale={locale} names={names} onOpen={onOpen} onOpenPractice={onOpenPractice} onCompleteTask={onCompleteTask} onManageTask={onManageTask}/>{!dayEntries.length&&<p className="ls-cal-day-empty" aria-label={t.empty}>—</p>}</section>;
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
 const disclosure=target.querySelector<HTMLDetailsElement>(':scope > details.ls-cal-task');
 if(disclosure)disclosure.open=true;
 target.scrollIntoView({block:'center',behavior:'auto'});
 (disclosure?.querySelector<HTMLElement>(':scope > summary')??target).focus({preventScroll:true});return true;
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
 const entries=orderedCalendarEntries({items,followups,tasks,content,practice:onOpenPractice?practice:[]}),dates=[...new Set(entries.map(entry=>entry.date))];
 return <div ref={agenda} className="ls-cal-agenda-list">{dates.map(date=><section className="ls-cal-agenda-day" key={date} aria-labelledby={'agenda-day-'+date}><h3 id={'agenda-day-'+date}><time dateTime={date}>{new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{dateStyle:'full',timeZone:'Asia/Jerusalem'}).format(new Date(date+'T12:00:00Z'))}</time></h3><CalendarEntryGroups entries={entries.filter(entry=>entry.date===date)} compact={false} locale={locale} names={names} onOpen={onOpen} onOpenPractice={onOpenPractice} onCompleteTask={onCompleteTask} onManageTask={onManageTask}/></section>)}{!entries.length&&<p>{t.empty}</p>}</div>;
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
