'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import type { Locale } from '../../lib/locale.ts';
import { accountRead } from '../identity/client.ts';
import { loginHref } from '../identity/login-return.ts';
import { Button, Input, Select, Textarea } from '../../ui/workspace/controls.tsx';
import { Dialog, openDialog, closeDialog } from '../../ui/workspace/dialogs.tsx';
import { ErrorState, LoadingState, PageHeader, StatusChip } from '../../ui/workspace/surfaces.tsx';
import { CalendarShell } from '../../ui/workspace/appointments.tsx';
import { UnsavedChangesGuard } from '../../ui/workspace/draft-guard.tsx';
import { calendarRead } from './client.ts';
import { calendarLoadFailure, type CalendarLoadFailure } from './error-state.ts';
import { text } from './copy.ts';
import { civilDate, dateRange, shiftDay, shiftMonth } from './time.ts';
import { asId } from '../../lib/ids.ts';
import type { AppointmentView, SchedulePage } from './types.ts';
import { useCalendarMutation, useDialogGuard } from './form-support.tsx';
import { AttendanceForm, BookingForm, NoticeForm, PractitionerActionForm, type CaseChoice, type SaveForm } from './forms.tsx';
import { CalendarAgenda, CalendarBoard, formatTime, NoticeReceipt } from './views.tsx';
import { projectCalendarFollowups, type FollowupSource } from './followups.ts';
import type { InternalTask } from './tasks.ts';
import { IntakeSummaryCard } from '../prospects/summary-card.tsx';
import { CalendarAttentionSummary } from './attention-summary.tsx';
import { readPractitionerCalendar } from './practitioner-load.ts';
import { showCalendarViewTabsInContent } from './view-tabs.ts';
import './calendar.css';
type HistoryPage={items:Array<{version:number;state:'present'|'late'|'no_show'|'canceled';recordedAt:string;reason:string|null}>;nextVersion:number|null};
import { verifiedGoogleMeetUrl } from './meeting-url.ts';
export { verifiedGoogleMeetUrl } from './meeting-url.ts';
export function CalendarWorkspace({locale,role,initialDate,initialView,initialCaseId,selectedClientContext=false}:{locale:Locale;role:'parent'|'adult_client'|'child'|'practitioner';initialDate:string;initialView:'day'|'week'|'month'|'agenda';initialCaseId:string;selectedClientContext?:boolean}){
 const router=useRouter();
 const t=text(locale),practitioner=role==='practitioner';
 const [cases,setCases]=useState<CaseChoice[]>([]),[caseId,setCaseId]=useState(initialCaseId),[items,setItems]=useState<AppointmentView[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState<CalendarLoadFailure|null>(null),[caseError,setCaseError]=useState(false),[countError,setCountError]=useState(false),[count,setCount]=useState<number|null>(null);
 const [selected,setSelected]=useState<AppointmentView|null>(null),[dirty,setDirty]=useState(false),[bookingOpen,setBookingOpen]=useState(false),[checkinFor,setCheckinFor]=useState<AppointmentView|null>(null),[bookingNonce,setBookingNonce]=useState(0);
 const [history,setHistory]=useState<HistoryPage|null>(null),[historyError,setHistoryError]=useState(false),[dateInput,setDateInput]=useState(initialDate);
 const [followupRows,setFollowupRows]=useState<FollowupSource[]|null>(null),[followupFailed,setFollowupFailed]=useState(false),[followupRetry,setFollowupRetry]=useState(0),[showFollowups,setShowFollowups]=useState(true);
 const [taskRows,setTaskRows]=useState<InternalTask[]|null>(null),[taskLoadedFor,setTaskLoadedFor]=useState(''),[taskFailed,setTaskFailed]=useState(false),[taskRefresh,setTaskRefresh]=useState(0),[showTasks,setShowTasks]=useState(true);
 const [taskDraft,setTaskDraft]=useState({title:'',dueDate:initialDate,dueTime:'',note:'',sourcePath:'',caseId:initialCaseId}),[taskDirty,setTaskDirty]=useState(false);
 const mutation=useCalendarMutation(locale),generation=useRef(0),date=initialDate,view=initialView;
 const range=dateRange(date,view),basePath=`/${locale}/${practitioner?'app/calendar':role==='adult_client'||role==='child'?'client/calendar':'family/schedule'}`,caseKind=role==='adult_client'?'adult':'minor';
 const followups=practitioner&&showFollowups&&followupRows?projectCalendarFollowups(followupRows,range.dates,caseId):[];
 const taskQueryKey=`${range.from}|${range.to}|${caseId}`;
 const tasks=practitioner&&showTasks&&taskLoadedFor===taskQueryKey&&taskRows?taskRows:[];
 const href=(newDate:string,newView:string=view)=>basePath+'?'+new URLSearchParams({date:newDate,view:newView,...(caseId?{caseId}:{}),...(selectedClientContext&&caseId?{context:'client'}:{})});
 const names=Object.fromEntries(cases.map(c=>[c.id,c.displayName]));
 const clearDirty=useCallback(()=>setDirty(false),[]);
 const closeBooking=useCallback(()=>{setBookingOpen(false);setDirty(false);},[]);
 const closeTask=useCallback(()=>{setTaskDirty(false);setTaskDraft({title:'',dueDate:date,dueTime:'',note:'',sourcePath:'',caseId});},[date,caseId]);
 useDialogGuard('ls-cal-detail',dirty,mutation.locked,locale,clearDirty);
 useDialogGuard('ls-cal-book',dirty,mutation.locked,locale,closeBooking);
 useDialogGuard('ls-cal-task',taskDirty,mutation.locked,locale,closeTask);

 const load=useCallback(async (reset=true,after:string|null=null)=>{
  const current=reset?++generation.current:generation.current;setLoading(reset);setError(null);
  try{
   let selectedCase=caseId;
   let page:SchedulePage;
   if(practitioner){
    const params=new URLSearchParams({from:range.from,to:range.to,...(selectedCase?{caseId:selectedCase}:{}),...(!reset&&after?{cursor:after}:{})});
    const result=await readPractitionerCalendar(()=>accountRead<CaseChoice[]>('cases'),()=>calendarRead<SchedulePage>('appointments?'+params));
    if(current!==generation.current)return;
    setCases(result.cases);setCaseError(result.casesUnavailable);page=result.page;
   }else{
    const currentCases=await accountRead<CaseChoice[]>('cases');if(current!==generation.current)return;setCases(currentCases);setCaseError(false);
    if(!selectedCase){selectedCase=currentCases.find(c=>c.kind===caseKind)?.id??'';if(selectedCase){setCaseId(selectedCase);return;}}
    if(!selectedCase){setItems([]);setLoading(false);return;}
    const params=new URLSearchParams({from:range.from,to:range.to,caseId:selectedCase,...(!reset&&after?{cursor:after}:{})});
    page=await calendarRead<SchedulePage>('appointments?'+params);if(current!==generation.current)return;
   }
   setItems(old=>reset?page.items:[...old,...page.items.filter(a=>!old.some(o=>o.id===a.id))]);setCursor(page.nextCursor);
   if(selectedCase&&role!=="adult_client"&&role!=="child"){
    try{const value=await calendarRead<{attendedChildSessions:number}>('attendance-count?'+new URLSearchParams({caseId:selectedCase}));if(current===generation.current){setCount(value.attendedChildSessions);setCountError(false);}}
    catch{if(current===generation.current){setCount(null);setCountError(true);}}
   }else{setCount(null);setCountError(false);}
  }catch(cause){if(current===generation.current){setError(calendarLoadFailure(cause));if(reset){setItems([]);setCases([]);setCursor(null);setCount(null);}}}
  finally{if(current===generation.current)setLoading(false);}
 },[caseId,caseKind,range.from,range.to,practitioner,role]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>{window.clearTimeout(timer);generation.current+=1;};},[load]); // owned query state; no global navigation registration
 useEffect(()=>{
  if(!practitioner)return;
  const controller=new AbortController();
  void fetch('/api/prospects',{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal})
   .then(async response=>{const body=await response.json() as {ok?:boolean;data?:FollowupSource[]};if(!response.ok||body.ok!==true||!Array.isArray(body.data))throw new Error('FOLLOWUPS_UNAVAILABLE');return body.data;})
   .then(rows=>{if(!controller.signal.aborted){setFollowupRows(rows);setFollowupFailed(false);}})
   .catch(()=>{if(!controller.signal.aborted){setFollowupRows(null);setFollowupFailed(true);}});
  return()=>controller.abort();
 },[practitioner,followupRetry]);
 useEffect(()=>{
  if(!practitioner)return;
  const controller=new AbortController();
  const params=new URLSearchParams({from:range.from,to:range.to,...(caseId?{caseId}:{})});
  queueMicrotask(()=>{if(!controller.signal.aborted){setTaskRows(null);setTaskLoadedFor('');setTaskFailed(false);}});
  void fetch('/api/calendar/tasks?'+params,{credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal})
   .then(async response=>{const body=await response.json() as {ok?:boolean;data?:InternalTask[]};if(!response.ok||body.ok!==true||!Array.isArray(body.data))throw new Error('TASKS_UNAVAILABLE');return body.data;})
   .then(rows=>{if(!controller.signal.aborted){setTaskRows(rows);setTaskLoadedFor(`${range.from}|${range.to}|${caseId}`);setTaskFailed(false);}})
   .catch(()=>{if(!controller.signal.aborted){setTaskRows(null);setTaskLoadedFor('');setTaskFailed(true);}});
  return()=>controller.abort();
 },[practitioner,range.from,range.to,caseId,taskRefresh]);
 async function refreshSelected(id=selected?.id){if(!id)return;try{setSelected(await calendarRead<AppointmentView>('appointments/'+id));}catch(cause){setSelected(null);setError(calendarLoadFailure(cause));}}
 const save:SaveForm=(path,body,done,method='POST')=>mutation.run(path,body,async value=>{
  done?.();setDirty(false);setHistory(null);
  if(value&&typeof value==='object'){
   const result=value as {id?:string;caseId?:string;original?:AppointmentView};
   if(result.original)await refreshSelected(result.original.id);
   else if(result.id&&result.caseId)await refreshSelected(asId(result.id,'appointment'));
  }
  await load();setTimeout(()=>{if(selected)document.getElementById('receipt-'+selected.id)?.focus();},0);
 },method);
 function selectCase(nextCaseId:string){setCaseId(nextCaseId);const query=new URLSearchParams({date,view,...(nextCaseId?{caseId:nextCaseId}:{}),...(selectedClientContext&&nextCaseId?{context:'client'}:{})});router.replace(basePath+'?'+query.toString(),{scroll:false});}
 function showAppointment(a:AppointmentView,e:MouseEvent<HTMLButtonElement>){if(mutation.locked)return;setSelected(a);setHistory(null);setHistoryError(false);setDirty(false);openDialog('ls-cal-detail',e);}
 function openBook(e:MouseEvent<HTMLButtonElement>,child:AppointmentView|null=null){if(mutation.locked)return;if(dirty&&!window.confirm(t.dirty))return;closeDialog('ls-cal-detail');setCheckinFor(child);setBookingNonce(v=>v+1);setBookingOpen(true);setDirty(false);openDialog('ls-cal-book',e);}
 function openTask(e:MouseEvent<HTMLButtonElement>){if(mutation.locked)return;setTaskDraft(current=>({...current,caseId:taskDirty?current.caseId:caseId,dueDate:taskDirty?current.dueDate:date}));openDialog('ls-cal-task',e);}
 function saveTask(){const body={title:taskDraft.title,dueDate:taskDraft.dueDate,dueTime:taskDraft.dueTime||null,note:taskDraft.note||null,sourcePath:taskDraft.sourcePath||null,caseId:taskDraft.caseId||null};mutation.run('tasks',body,async()=>{setTaskDirty(false);setTaskDraft({title:'',dueDate:date,dueTime:'',note:'',sourcePath:'',caseId});closeDialog('ls-cal-task');setTaskRefresh(value=>value+1);});}
 function completeTask(task:InternalTask){mutation.run(`tasks/${task.id}/complete`,{expectedVersion:task.version},async()=>{setTaskRefresh(value=>value+1);});}
 async function loadHistory(next=false){if(!selected)return;setHistoryError(false);try{const p=await calendarRead<HistoryPage>(`appointments/${selected.id}/attendance-history`+(next&&history?.nextVersion?'?beforeVersion='+history.nextVersion:''));setHistory(old=>next&&old?{items:[...old.items,...p.items],nextVersion:p.nextVersion}:p);}catch{setHistoryError(true);}}
 return <main className="ls-cal lsw" dir={locale==='he'?'rtl':'ltr'} lang={locale} data-has-appointments={items.length+followups.length+tasks.length>0}>
 <UnsavedChangesGuard dirty={dirty||taskDirty||mutation.uncertain} message={t.dirty}/>
 <PageHeader title={practitioner?t.title:t.familyTitle} context={practitioner?t.context:t.familyContext}/>
 <div className="ls-cal-toolbar"><Select id="calendar-case" label={t.case} value={caseId} onChange={e=>selectCase(e.target.value)} disabled={mutation.locked||caseError}>{practitioner&&<option value="">{t.allCases}</option>}{caseError&&caseId&&<option value={caseId}>{locale==='he'?'לקוח נבחר — הרשימה אינה זמינה':'Selected client — list unavailable'}</option>}{cases.filter(c=>practitioner||c.kind===caseKind).map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</Select>
 <form className="ls-cal-period" action={basePath}><Input id="calendar-date" label={t.period} type="date" name="date" required value={dateInput} onChange={e=>setDateInput(e.target.value)}/><input type="hidden" name="view" value={view}/><input type="hidden" name="caseId" value={caseId}/>{selectedClientContext&&caseId&&<input type="hidden" name="context" value="client"/>}<Button type="submit">{t.go}</Button></form>
 {practitioner&&<div className="ls-cal-actions"><Button disabled={mutation.locked||!cases.length} onClick={e=>openBook(e)}>{t.newBooking}</Button><Button variant="secondary" disabled={mutation.locked} onClick={openTask}>{locale==='he'?'+ משימה':'+ Task'}</Button><a className="lsw-button lsw-button--secondary" href={`/${locale}/app/settings/availability?date=${date}`}>{t.availability}</a></div>}</div>
 {practitioner&&<div className="ls-cal-operational"><IntakeSummaryCard locale={locale}/><CalendarAttentionSummary locale={locale} caseId={caseId}/></div>}
 {practitioner&&<div className="ls-cal-layers"><label><input type="checkbox" checked={showTasks} onChange={event=>setShowTasks(event.target.checked)}/> {locale==='he'?'משימות':'Tasks'}</label><label><input type="checkbox" checked={showFollowups} onChange={event=>setShowFollowups(event.target.checked)}/> {locale==='he'?'המשך טיפול בפניות':'Prospect follow-ups'}</label>{taskFailed&&<p role="status">{locale==='he'?'המשימות לא נטענו. הפגישות עדיין מוצגות.':'Tasks could not load. Appointments are still shown.'} <Button variant="quiet" onClick={()=>{setTaskFailed(false);setTaskRefresh(value=>value+1)}}>{locale==='he'?'ניסיון חוזר':'Retry tasks'}</Button></p>}{followupFailed&&<p role="status">{locale==='he'?'המשך הטיפול בפניות לא נטען. הפגישות עדיין מוצגות.':'Prospect follow-ups could not load. Appointments are still shown.'} <Button variant="quiet" onClick={()=>{setFollowupFailed(false);setFollowupRetry(value=>value+1)}}>{locale==='he'?'ניסיון חוזר':'Retry follow-ups'}</Button></p>}</div>}
 {loading?<LoadingState locale={locale}/>:error==='auth'?<div className="lsw-alert" role="alert"><p>{locale==='he'?'פג תוקף החיבור שלך. יש להיכנס מחדש כדי לפתוח את היומן הפרטי.':'Your session has ended. Sign in to reopen the private calendar.'}</p><a className="lsw-button lsw-button--secondary" href={loginHref(locale,href(date))}>{locale==='he'?'כניסה':'Sign in'}</a></div>:error==='forbidden'?<div className="lsw-alert" role="alert"><p>{locale==='he'?'לחשבון הזה אין הרשאה לצפות ביומן הזה.':'This account is not authorized to view this calendar.'}</p></div>:error?<ErrorState locale={locale} onRetry={()=>void load()}/>:<>{caseError&&<p className="ls-cal-partial" role="status">{locale==='he'?'רשימת הלקוחות אינה זמינה כרגע. המפגשים המורשים עדיין מוצגים; שמות ותיאום חדש עשויים להיות חסרים.':'The client list is unavailable right now. Authorized appointments still appear; names and new booking may be unavailable.'} <Button variant="quiet" onClick={()=>void load()}>{locale==='he'?'ניסיון חוזר':'Retry client list'}</Button></p>}{countError&&<p className="ls-cal-partial" role="status">{locale==='he'?'ספירת המפגשים אינה זמינה כרגע. היומן עדיין מוצג.':'Attendance count is unavailable right now. The calendar is still shown.'}</p>}{!caseError&&!cases.length&&<p role="status">{t.noCases}</p>}<CalendarShell locale={locale} period={new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',month:'long',year:'numeric'}).format(new Date(date+'T12:00Z'))} view={view}
 viewHrefs={{day:href(date,'day'),week:href(date,'week'),month:href(date,'month'),agenda:href(date,'agenda')}} showViewTabs={showCalendarViewTabsInContent(role,selectedClientContext)} todayHref={href(civilDate(new Date().toISOString()))} previousHref={href(view==='month'?shiftMonth(date,-1):shiftDay(date,view==='day'?-1:view==='agenda'?-14:-7))} nextHref={href(view==='month'?shiftMonth(date,1):shiftDay(date,view==='day'?1:view==='agenda'?14:7))}
 desktop={<CalendarBoard dates={range.dates} items={items} followups={followups} tasks={tasks} locale={locale} view={view==='agenda'?'week':view} names={names} onOpen={showAppointment} onCompleteTask={practitioner?completeTask:undefined}/>}
 agenda={<CalendarAgenda items={items} followups={followups} tasks={tasks} locale={locale} names={names} onOpen={showAppointment} onCompleteTask={practitioner?completeTask:undefined}/>}/></>}
 {count!==null&&<aside className="ls-cal-count"><strong>{t.attendedCount}: {new Intl.NumberFormat(locale).format(count)}</strong><p>{t.attendanceOnly}</p></aside>}
 {practitioner&&<nav className="lsu-attention-links ls-cal-related-links" aria-label={locale==='he'?'לעבודה הקרובה':'Immediate work'}><a href={`/${locale}/app/prospects`}>{locale==='he'?'קליטת מתעניינים':'Prospect intake'}</a><a href={`/${locale}/app/feedback${caseId?'?caseId='+encodeURIComponent(caseId):''}`}>{locale==='he'?'משוב לבדיקה':'Review feedback'}</a><a href={`/${locale}/app/clients${caseId?'?caseId='+encodeURIComponent(caseId):''}`}>{locale==='he'?'פתיחת תיק':'Open a case'}</a><a href={`/${locale}/app/reports${caseId?'?caseId='+encodeURIComponent(caseId):''}`}>{locale==='he'?'דוחות חודשיים':'Monthly reports'}</a></nav>}
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
 {practitioner&&<><Dialog id="ls-cal-task" title={locale==='he'?'משימה חדשה':'New task'} locale={locale} busy={mutation.locked}><form className="ls-cal-form" onChangeCapture={()=>setTaskDirty(true)} onSubmit={event=>{event.preventDefault();if(!event.currentTarget.checkValidity()){event.currentTarget.reportValidity();return;}saveTask();}}><p>{locale==='he'?'משימה פנימית בלבד. יצירתה או השלמתה אינן שולחות הודעה, גובות תשלום או משנות פגישה.':'Internal work only. Creating or completing a task does not send a message, take payment or change an appointment.'}</p><fieldset disabled={mutation.locked}>
 <Input id="task-title" label={locale==='he'?'כותרת':'Title'} value={taskDraft.title} onChange={event=>setTaskDraft(current=>({...current,title:event.target.value}))} maxLength={140} required/>
 <div className="ls-cal-two"><Input id="task-date" label={locale==='he'?'תאריך יעד':'Due date'} type="date" value={taskDraft.dueDate} onChange={event=>setTaskDraft(current=>({...current,dueDate:event.target.value}))} required/><Input id="task-time" label={locale==='he'?'שעה (רשות)':'Time (optional)'} help={locale==='he'?'ללא שעה המשימה מוצגת לכל היום · Asia/Jerusalem':'Leave blank for all day · Asia/Jerusalem'} type="time" value={taskDraft.dueTime} onChange={event=>setTaskDraft(current=>({...current,dueTime:event.target.value}))}/></div>
 <Select id="task-case" label={locale==='he'?'תיק קשור (רשות)':'Related case (optional)'} value={taskDraft.caseId} onChange={event=>setTaskDraft(current=>({...current,caseId:event.target.value}))}><option value="">{locale==='he'?'ללא תיק':'No case'}</option>{cases.map(item=><option value={item.id} key={item.id}>{item.displayName}</option>)}</Select>
 <Input id="task-source" label={locale==='he'?'קישור מקור פרטי (רשות)':'Private source link (optional)'} help={locale==='he'?'נתיב פנימי בלבד, לדוגמה /he/app/clients':'Internal app path only, for example /en/app/clients'} value={taskDraft.sourcePath} onChange={event=>setTaskDraft(current=>({...current,sourcePath:event.target.value}))} maxLength={280}/>
 <Textarea id="task-note" label={locale==='he'?'פרטים (רשות)':'Details (optional)'} value={taskDraft.note} onChange={event=>setTaskDraft(current=>({...current,note:event.target.value}))} maxLength={1000}/>
 <Button type="submit" disabled={mutation.locked}>{locale==='he'?'שמירת משימה':'Save task'}</Button></fieldset></form>{mutation.feedback}</Dialog>
 <Dialog id="ls-cal-book" title={t.newBooking} locale={locale} busy={mutation.locked}>{bookingOpen&&<BookingForm key={bookingNonce} locale={locale} cases={cases} appointments={items} initialCaseId={caseId||cases.find(c=>c.kind==='minor')?.id||''} checkinFor={checkinFor} locked={mutation.locked} onDirty={setDirty} onSave={(value,done)=>save('appointments',value,()=>{done();closeDialog('ls-cal-book');setBookingOpen(false);})}/>} {mutation.feedback}</Dialog>
</>}
 </main>;
}
