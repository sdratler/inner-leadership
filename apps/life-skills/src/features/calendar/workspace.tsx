'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import type { Locale } from '../../lib/locale.ts';
import { accountRead } from '../identity/client.ts';
import { Button, Input, Select } from '../../ui/workspace/controls.tsx';
import { Dialog, openDialog, closeDialog } from '../../ui/workspace/dialogs.tsx';
import { ErrorState, LoadingState, PageHeader, StatusChip } from '../../ui/workspace/surfaces.tsx';
import { CalendarShell } from '../../ui/workspace/appointments.tsx';
import { UnsavedChangesGuard } from '../../ui/workspace/draft-guard.tsx';
import { calendarRead } from './client.ts';
import { text } from './copy.ts';
import { civilDate, dateRange, shiftDay, shiftMonth } from './time.ts';
import { asId } from '../../lib/ids.ts';
import type { AppointmentView, SchedulePage } from './types.ts';
import { useCalendarMutation, useDialogGuard } from './form-support.tsx';
import { AttendanceForm, BookingForm, NoticeForm, PractitionerActionForm, type CaseChoice, type SaveForm } from './forms.tsx';
import { CalendarAgenda, CalendarBoard, formatTime, NoticeReceipt } from './views.tsx';
import { IntakeSummaryCard } from '../prospects/summary-card.tsx';
import './calendar.css';
type HistoryPage={items:Array<{version:number;state:'present'|'late'|'no_show'|'canceled';recordedAt:string;reason:string|null}>;nextVersion:number|null};
import { verifiedGoogleMeetUrl } from './meeting-url.ts';
export { verifiedGoogleMeetUrl } from './meeting-url.ts';
export function CalendarWorkspace({locale,role,initialDate,initialView,initialCaseId}:{locale:Locale;role:'parent'|'adult_client'|'child'|'practitioner';initialDate:string;initialView:'day'|'week'|'month';initialCaseId:string}){
 const router=useRouter();
 const t=text(locale),practitioner=role==='practitioner';
 const [cases,setCases]=useState<CaseChoice[]>([]),[caseId,setCaseId]=useState(initialCaseId),[items,setItems]=useState<AppointmentView[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(false),[count,setCount]=useState<number|null>(null);
 const [selected,setSelected]=useState<AppointmentView|null>(null),[dirty,setDirty]=useState(false),[bookingOpen,setBookingOpen]=useState(false),[checkinFor,setCheckinFor]=useState<AppointmentView|null>(null),[bookingNonce,setBookingNonce]=useState(0);
 const [history,setHistory]=useState<HistoryPage|null>(null),[historyError,setHistoryError]=useState(false),[dateInput,setDateInput]=useState(initialDate);
 const mutation=useCalendarMutation(locale),generation=useRef(0),date=initialDate,view=initialView;
 const range=dateRange(date,view),basePath=`/${locale}/${practitioner?'app/calendar':role==='adult_client'||role==='child'?'client/calendar':'family/schedule'}`,caseKind=role==='adult_client'?'adult':'minor';
 const href=(newDate:string,newView:string=view)=>basePath+'?'+new URLSearchParams({date:newDate,view:newView,...(caseId?{caseId}:{})});
 const names=Object.fromEntries(cases.map(c=>[c.id,c.displayName]));
 const clearDirty=useCallback(()=>setDirty(false),[]);
 const closeBooking=useCallback(()=>{setBookingOpen(false);setDirty(false);},[]);
 useDialogGuard('ls-cal-detail',dirty,mutation.locked,locale,clearDirty);
 useDialogGuard('ls-cal-book',dirty,mutation.locked,locale,closeBooking);

 const load=useCallback(async (reset=true,after:string|null=null)=>{
  const current=reset?++generation.current:generation.current;setLoading(reset);setError(false);
  try{
   const currentCases=await accountRead<CaseChoice[]>('cases');if(current!==generation.current)return;setCases(currentCases);
   let selectedCase=caseId;
   if(!practitioner&&!selectedCase){selectedCase=currentCases.find(c=>c.kind===caseKind)?.id??'';if(selectedCase){setCaseId(selectedCase);return;}}
   if(!practitioner&&!selectedCase){setItems([]);setLoading(false);return;}
   const params=new URLSearchParams({from:range.from,to:range.to,...(selectedCase?{caseId:selectedCase}:{}),...(!reset&&after?{cursor:after}:{})});
   const page=await calendarRead<SchedulePage>('appointments?'+params);if(current!==generation.current)return;
   setItems(old=>reset?page.items:[...old,...page.items.filter(a=>!old.some(o=>o.id===a.id))]);setCursor(page.nextCursor);

   if(selectedCase&&role!=="adult_client"&&role!=="child"){const value=await calendarRead<{attendedChildSessions:number}>('attendance-count?'+new URLSearchParams({caseId:selectedCase}));if(current===generation.current)setCount(value.attendedChildSessions);}else setCount(null);
  }catch{if(current===generation.current){setError(true);if(reset){setItems([]);setCases([]);}}}
  finally{if(current===generation.current)setLoading(false);}
 },[caseId,caseKind,range.from,range.to,practitioner,role]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>{window.clearTimeout(timer);generation.current+=1;};},[load]); // owned query state; no global navigation registration
 async function refreshSelected(id=selected?.id){if(!id)return;try{setSelected(await calendarRead<AppointmentView>('appointments/'+id));}catch{setSelected(null);setError(true);}}
 const save:SaveForm=(path,body,done,method='POST')=>mutation.run(path,body,async value=>{
  done?.();setDirty(false);setHistory(null);
  if(value&&typeof value==='object'){
   const result=value as {id?:string;caseId?:string;original?:AppointmentView};
   if(result.original)await refreshSelected(result.original.id);
   else if(result.id&&result.caseId)await refreshSelected(asId(result.id,'appointment'));
  }
  await load();setTimeout(()=>{if(selected)document.getElementById('receipt-'+selected.id)?.focus();},0);
 },method);
 function selectCase(nextCaseId:string){setCaseId(nextCaseId);const query=new URLSearchParams({date,view,...(nextCaseId?{caseId:nextCaseId}:{})});router.replace(basePath+'?'+query.toString(),{scroll:false});}
 function showAppointment(a:AppointmentView,e:MouseEvent<HTMLButtonElement>){if(mutation.locked)return;setSelected(a);setHistory(null);setHistoryError(false);setDirty(false);openDialog('ls-cal-detail',e);}
 function openBook(e:MouseEvent<HTMLButtonElement>,child:AppointmentView|null=null){if(mutation.locked)return;if(dirty&&!window.confirm(t.dirty))return;closeDialog('ls-cal-detail');setCheckinFor(child);setBookingNonce(v=>v+1);setBookingOpen(true);setDirty(false);openDialog('ls-cal-book',e);}
 async function loadHistory(next=false){if(!selected)return;setHistoryError(false);try{const p=await calendarRead<HistoryPage>(`appointments/${selected.id}/attendance-history`+(next&&history?.nextVersion?'?beforeVersion='+history.nextVersion:''));setHistory(old=>next&&old?{items:[...old.items,...p.items],nextVersion:p.nextVersion}:p);}catch{setHistoryError(true);}}
 return <main className="ls-cal lsw" dir={locale==='he'?'rtl':'ltr'} lang={locale}>
 <UnsavedChangesGuard dirty={dirty||mutation.uncertain} message={t.dirty}/>
 <PageHeader title={practitioner?t.title:t.familyTitle} context={practitioner?t.context:t.familyContext}/>
 {practitioner&&<IntakeSummaryCard locale={locale}/>}
 {practitioner&&<nav className="lsu-attention-links" aria-label={locale==='he'?'לעבודה הקרובה':'Immediate work'}><a href={`/${locale}/app/prospects`}>{locale==='he'?'קליטת מתעניינים':'Prospect intake'}</a><a href={`/${locale}/app/feedback${caseId?'?caseId='+encodeURIComponent(caseId):''}`}>{locale==='he'?'משוב לבדיקה':'Review feedback'}</a><a href={`/${locale}/app/clients${caseId?'?caseId='+encodeURIComponent(caseId):''}`}>{locale==='he'?'פתיחת תיק':'Open a case'}</a><a href={`/${locale}/app/reports${caseId?'?caseId='+encodeURIComponent(caseId):''}`}>{locale==='he'?'דוחות חודשיים':'Monthly reports'}</a></nav>}
 <div className="ls-cal-toolbar"><Select id="calendar-case" label={t.case} value={caseId} onChange={e=>selectCase(e.target.value)} disabled={mutation.locked}>{practitioner&&<option value="">{t.allCases}</option>}{cases.filter(c=>practitioner||c.kind===caseKind).map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</Select>
 <form className="ls-cal-period" action={basePath}><Input id="calendar-date" label={t.period} type="date" name="date" required value={dateInput} onChange={e=>setDateInput(e.target.value)}/><input type="hidden" name="view" value={view}/><input type="hidden" name="caseId" value={caseId}/><Button type="submit">{t.go}</Button></form>
 {practitioner&&<div className="ls-cal-actions"><Button disabled={mutation.locked||!cases.length} onClick={e=>openBook(e)}>{t.newBooking}</Button><a className="lsw-button lsw-button--secondary" href={`/${locale}/app/settings/availability?date=${date}`}>{t.availability}</a></div>}</div>
 {count!==null&&<aside className="ls-cal-count"><strong>{t.attendedCount}: {new Intl.NumberFormat(locale).format(count)}</strong><p>{t.attendanceOnly}</p></aside>}
 {loading?<LoadingState locale={locale}/>:error?<ErrorState locale={locale} onRetry={()=>void load()}/>:!cases.length?<p>{t.noCases}</p>:<CalendarShell locale={locale} period={new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',month:'long',year:'numeric'}).format(new Date(date+'T12:00Z'))} view={view}
 viewHrefs={{day:href(date,'day'),week:href(date,'week'),month:href(date,'month')}} todayHref={href(civilDate(new Date().toISOString()))} previousHref={href(view==='month'?shiftMonth(date,-1):shiftDay(date,view==='day'?-1:-7))} nextHref={href(view==='month'?shiftMonth(date,1):shiftDay(date,view==='day'?1:7))}
 desktop={<CalendarBoard dates={range.dates} items={items} locale={locale} view={view} names={names} onOpen={showAppointment}/>}
 agenda={<CalendarAgenda items={items} locale={locale} names={names} onOpen={showAppointment}/>}/>}
 {cursor&&<div className="ls-cal-pagination"><p>{t.partial}</p><Button onClick={()=>void load(false,cursor)} disabled={loading}>{t.loadMore}</Button></div>}
 <p className="ls-cal-muted">{t.remaining}</p>

 <div className="ls-cal-page-feedback">{mutation.feedback}</div>
 <Dialog id="ls-cal-detail" title={t.details} locale={locale} busy={mutation.locked}>
 {selected&&<div className="ls-cal-detail" key={selected.id}><h3>{names[selected.caseId]??t.case}</h3><p>{t[selected.kind]}</p><p className="ls-cal-time">{formatTime(selected.startsAt,locale)} — {formatTime(selected.endsAt,locale,false)}</p>{selected.location&&<p>{selected.location}</p>}{selected.kind==='parent_guidance'&&(verifiedGoogleMeetUrl(selected.conferenceUri)?<p><a className="lsw-button lsw-button--secondary" href={verifiedGoogleMeetUrl(selected.conferenceUri) as string} target="_blank" rel="noreferrer">{t.meet}</a></p>:<p className="ls-cal-muted">{t.meetUnavailable}</p>)}
 <StatusChip>{t[selected.status]}</StatusChip><p>{t.attendance}: {selected.attendance?t[selected.attendance.state]:t.unrecorded}</p>
 {selected.checkinNeedsReview&&<p className="ls-cal-policy">{t.checkinReview}</p>}
 {selected.creditException&&!selected.notice&&<p className="ls-cal-policy">{t.exceptionApproved} {t.financialSeparate}</p>}
 <NoticeReceipt appointment={selected} locale={locale} onReplacement={()=>void refreshSelected(selected.replacementId??selected.notice?.replacementId??undefined)}/>
 <Button variant="quiet" disabled={mutation.locked} onClick={()=>{if(!dirty||window.confirm(t.dirty)){setDirty(false);void refreshSelected();}}}>{t.refresh}</Button>
 {practitioner?<>
 <details className="ls-cal-section" open><summary>{t.attendance}</summary><AttendanceForm locale={locale} appointment={selected} locked={mutation.locked} onDirty={setDirty} save={save}/></details>
 {selected.kind==='individual'&&<Button variant="secondary" disabled={mutation.locked} onClick={e=>openBook(e,selected)}>{t.parent_guidance}</Button>}
 <details className="ls-cal-section"><summary>{t.manual}</summary><NoticeForm locale={locale} appointment={selected} manual locked={mutation.locked} onDirty={setDirty} save={save}/></details>
 {selected.notice?.kind==='reschedule'&&selected.notice.state==='pending'&&!selected.replacementId&&<details className="ls-cal-section"><summary>{t.confirmReplacement}</summary><p>{t.replacementHelp}</p><BookingForm locale={locale} cases={cases} appointments={items} initialCaseId={selected.caseId} original={selected} locked={mutation.locked} onDirty={setDirty} onSave={(booking,done)=>save(`appointments/${selected.id}/replacement`,{expectedVersion:selected.version,booking},done)}/></details>}
 <details className="ls-cal-section"><summary>{t.action}</summary><PractitionerActionForm locale={locale} appointment={selected} locked={mutation.locked} onDirty={setDirty} save={save}/></details>
 <details className="ls-cal-section"><summary>{t.history}</summary><Button variant="secondary" onClick={()=>void loadHistory()}>{t.loadHistory}</Button>{historyError&&<p role="status">{t.saveFailed}</p>}{history?.items.map(h=><article key={h.version} className="ls-cal-history"><h4>{t.version} {h.version} · {t[h.state]}</h4><p>{formatTime(h.recordedAt,locale)}</p>{h.reason&&<p>{h.reason}</p>}</article>)}{history&&!history.items.length&&<p>{t.noHistory}</p>}{history?.nextVersion&&<Button variant="quiet" onClick={()=>void loadHistory(true)}>{t.loadMore}</Button>}</details>
 </>:role==='parent'&&!selected.notice&&!selected.replacementId?<details className="ls-cal-section" open><summary>{t.noticeTitle}</summary><NoticeForm locale={locale} appointment={selected} manual={false} locked={mutation.locked} onDirty={setDirty} save={save}/></details>:role==='adult_client'||role==='child'?<p className="ls-cal-muted">{locale==='he'?'לשינוי או ביטול יש לפנות למטפל/ת.':'Contact the practitioner to change or cancel this appointment.'}</p>:null}
 {mutation.feedback}</div>}
 </Dialog>
 {practitioner&&<><Dialog id="ls-cal-book" title={t.newBooking} locale={locale} busy={mutation.locked}>{bookingOpen&&<BookingForm key={bookingNonce} locale={locale} cases={cases} appointments={items} initialCaseId={caseId||cases.find(c=>c.kind==='minor')?.id||''} checkinFor={checkinFor} locked={mutation.locked} onDirty={setDirty} onSave={(value,done)=>save('appointments',value,()=>{done();closeDialog('ls-cal-book');setBookingOpen(false);})}/>} {mutation.feedback}</Dialog>
</>}
 </main>;
}
