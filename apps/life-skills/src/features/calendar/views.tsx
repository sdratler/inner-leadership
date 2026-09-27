'use client';
import type { MouseEvent } from 'react';
import type { Locale } from '../../lib/locale.ts';
import { Button } from '../../ui/workspace/controls.tsx';
import { Card, StatusChip } from '../../ui/workspace/surfaces.tsx';
import type { AppointmentView } from './types.ts';
import type { CalendarFollowup } from './followups.ts';
import type { InternalTask } from './tasks.ts';
import { text } from './copy.ts';
import { civilDate, localMinute } from './time.ts';
export function formatTime(value:string,locale:Locale,full=true){return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',...(full?{dateStyle:'medium' as const}:{}),timeStyle:'short',hourCycle:'h23'}).format(new Date(value));}
export type OpenAppointment=(a:AppointmentView,e:MouseEvent<HTMLButtonElement>)=>void;
function followupHref(locale:Locale,leadId:string){return `/${locale}/app/clients?section=prospects&leadId=${encodeURIComponent(leadId)}`;}
export function CalendarBoard({dates,items,followups=[],tasks=[],locale,view,names,onOpen,onCompleteTask}:{dates:string[];items:AppointmentView[];followups?:CalendarFollowup[];tasks?:InternalTask[];locale:Locale;view:'day'|'week'|'month';names:Record<string,string>;onOpen:OpenAppointment;onCompleteTask?:((task:InternalTask)=>void)|undefined}){
 const t=text(locale);
 return <div className={'ls-cal-board ls-cal-board--'+view} data-ls-calendar-grid>{dates.map(date=>{
  const appointments=items.filter(a=>civilDate(a.startsAt)===date),due=followups.filter(item=>item.dueDate===date),dayTasks=tasks.filter(item=>item.dueDate===date);
  const heading=new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Jerusalem'}).format(new Date(date+'T12:00:00Z'));
  return <section key={date} className="ls-cal-day" aria-labelledby={'day-'+date}><h3 id={'day-'+date}><time dateTime={date}>{heading}</time></h3>
   {appointments.map(a=><button data-appointment-id={a.id} type="button" className={'ls-cal-slot ls-cal-slot--'+a.status} key={a.id} onClick={e=>onOpen(a,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail" aria-label={`${names[a.caseId]??t.case} · ${t[a.kind]} · ${formatTime(a.startsAt,locale)} · ${t[a.status]}`}><time dateTime={a.startsAt}>{formatTime(a.startsAt,locale,false)}</time><strong>{names[a.caseId]??t.case}</strong><span>{t[a.kind]}</span><span className="ls-cal-slot-state">{t[a.status]}</span>{a.notice&&<span>{t.received}</span>}</button>)}
   {due.map(item=><a className="ls-cal-followup" href={followupHref(locale,item.leadId)} key={item.leadId} aria-label={`${locale==='he'?'המשך טיפול':'Follow-up'} · ${item.name||item.leadId} · ${item.nextAction||'—'}`}><span>{locale==='he'?'המשך טיפול':'Follow-up'}</span><strong>{item.name||item.leadId}</strong>{item.nextAction&&<small>{item.nextAction}</small>}</a>)}
   {dayTasks.map(task=><article className="ls-cal-task" key={task.id}><span>{locale==='he'?'משימה':'Task'} · {task.dueTime||(locale==='he'?'כל היום':'All day')}</span><strong>{task.title}</strong><span>{task.state==='done'?(locale==='he'?'הושלמה':'Done'):(locale==='he'?'פתוחה':'Open')}</span>{task.sourcePath&&<a href={task.sourcePath}>{locale==='he'?'פתיחת מקור':'Open source'}</a>}{task.state==='open'&&onCompleteTask&&<button type="button" onClick={()=>onCompleteTask(task)}>{locale==='he'?'סימון כהושלמה':'Mark done'}</button>}</article>)}
   {!appointments.length&&!due.length&&!dayTasks.length&&<p className="ls-cal-day-empty" aria-label={t.empty}>—</p>}
  </section>;
 })}</div>;
}
export function CalendarAgenda({items,followups=[],tasks=[],locale,names,onOpen,onCompleteTask}:{items:AppointmentView[];followups?:CalendarFollowup[];tasks?:InternalTask[];locale:Locale;names:Record<string,string>;onOpen:OpenAppointment;onCompleteTask?:((task:InternalTask)=>void)|undefined}){
 const t=text(locale);
 const entries=[...items.map(item=>({kind:'appointment' as const,sortTime:localMinute(item.startsAt).slice(11),date:civilDate(item.startsAt),item})),
  ...followups.map(item=>({kind:'followup' as const,sortTime:'',date:item.dueDate,item})),
  ...tasks.map(item=>({kind:'task' as const,sortTime:item.dueTime??'',date:item.dueDate,item}))]
  .sort((a,b)=>a.date.localeCompare(b.date)||a.sortTime.localeCompare(b.sortTime));
 return <div className="ls-cal-agenda-list">{entries.map(entry=>entry.kind==='appointment'?<Card id={'agenda-'+entry.item.id} key={'appointment-'+entry.item.id} title={names[entry.item.caseId]??t.case}>
  <p>{t[entry.item.kind]}</p><p className="ls-cal-time"><time dateTime={entry.item.startsAt}>{formatTime(entry.item.startsAt,locale)}</time> – <time dateTime={entry.item.endsAt}>{formatTime(entry.item.endsAt,locale,false)}</time></p><StatusChip tone={entry.item.status==='scheduled'?'neutral':'warning'}>{t[entry.item.status]}</StatusChip>
  <p>{t.attendance}: {entry.item.attendance?t[entry.item.attendance.state]:t.unrecorded}</p><Button data-appointment-id={entry.item.id} variant="secondary" onClick={e=>onOpen(entry.item,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail">{t.details}</Button></Card>:entry.kind==='followup'?<Card id={'followup-'+entry.item.leadId} key={'followup-'+entry.item.leadId} title={entry.item.name||entry.item.leadId}><p><span className="ls-cal-layer-label">{locale==='he'?'המשך טיפול':'Follow-up'}</span> <time dateTime={entry.item.dueDate}>{entry.item.dueDate}</time></p>{entry.item.nextAction&&<p>{entry.item.nextAction}</p>}<a className="lsw-button lsw-button--secondary" href={followupHref(locale,entry.item.leadId)}>{locale==='he'?'פתיחת האדם':'Open person'}</a></Card>:<Card id={'task-'+entry.item.id} key={'task-'+entry.item.id} title={entry.item.title}><p><span className="ls-cal-layer-label">{locale==='he'?'משימה':'Task'}</span> <time dateTime={entry.item.dueDate}>{entry.item.dueDate}</time> · {entry.item.dueTime||(locale==='he'?'כל היום':'All day')}</p>{entry.item.note&&<details><summary>{locale==='he'?'פרטים':'Details'}</summary><p>{entry.item.note}</p></details>}{entry.item.sourcePath&&<p><a href={entry.item.sourcePath}>{locale==='he'?'פתיחת מקור':'Open source'}</a></p>}{entry.item.state==='done'?<p>{locale==='he'?'הושלמה':'Done'}</p>:onCompleteTask&&<Button variant="secondary" onClick={()=>onCompleteTask(entry.item)}>{locale==='he'?'סימון כהושלמה':'Mark done'}</Button>}</Card>)}
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
