'use client';
import type { MouseEvent } from 'react';
import type { Locale } from '../../lib/locale.ts';
import { Button } from '../../ui/workspace/controls.tsx';
import { Card, StatusChip } from '../../ui/workspace/surfaces.tsx';
import type { AppointmentView } from './types.ts';
import { text } from './copy.ts';
import { civilDate } from './time.ts';
export function formatTime(value:string,locale:Locale,full=true){return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',...(full?{dateStyle:'medium' as const}:{}),timeStyle:'short',hourCycle:'h23'}).format(new Date(value));}
export type OpenAppointment=(a:AppointmentView,e:MouseEvent<HTMLButtonElement>)=>void;
export function CalendarBoard({dates,items,locale,view,names,onOpen}:{dates:string[];items:AppointmentView[];locale:Locale;view:'day'|'week'|'month';names:Record<string,string>;onOpen:OpenAppointment}){
 const t=text(locale);
 return <div className={'ls-cal-board ls-cal-board--'+view}>{dates.map(date=>{
  const appointments=items.filter(a=>civilDate(a.startsAt)===date);
  const heading=new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Jerusalem'}).format(new Date(date+'T12:00:00Z'));
  return <section key={date} className="ls-cal-day" aria-labelledby={'day-'+date}><h3 id={'day-'+date}><time dateTime={date}>{heading}</time></h3>
   {appointments.map(a=><button data-appointment-id={a.id} type="button" className={'ls-cal-slot ls-cal-slot--'+a.status} key={a.id} onClick={e=>onOpen(a,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail" aria-label={`${names[a.caseId]??t.case} · ${t[a.kind]} · ${formatTime(a.startsAt,locale)} · ${t[a.status]}`}><time dateTime={a.startsAt}>{formatTime(a.startsAt,locale,false)}</time><strong>{names[a.caseId]??t.case}</strong><span>{t[a.kind]}</span><span className="ls-cal-slot-state">{t[a.status]}</span>{a.notice&&<span>{t.received}</span>}</button>)}
   {!appointments.length&&<p className="ls-cal-day-empty" aria-label={t.empty}>—</p>}
  </section>;
 })}</div>;
}
export function CalendarAgenda({items,locale,names,onOpen}:{items:AppointmentView[];locale:Locale;names:Record<string,string>;onOpen:OpenAppointment}){
 const t=text(locale);
 return <div className="ls-cal-agenda-list">{items.length?items.map(a=><Card id={'agenda-'+a.id} key={a.id} title={names[a.caseId]??t.case}>
  <p>{t[a.kind]}</p><p className="ls-cal-time"><time dateTime={a.startsAt}>{formatTime(a.startsAt,locale)}</time> – <time dateTime={a.endsAt}>{formatTime(a.endsAt,locale,false)}</time></p><StatusChip tone={a.status==='scheduled'?'neutral':'warning'}>{t[a.status]}</StatusChip>
  <p>{t.attendance}: {a.attendance?t[a.attendance.state]:t.unrecorded}</p><Button data-appointment-id={a.id} variant="secondary" onClick={e=>onOpen(a,e)} aria-haspopup="dialog" aria-controls="ls-cal-detail">{t.details}</Button></Card>):<p>{t.empty}</p>}</div>;
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
