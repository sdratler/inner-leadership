'use client';
import { useEffect, useState, useId } from 'react';
import type { FormEvent } from 'react';
import type { Locale } from '../../lib/locale.ts';
import { asId } from '../../lib/ids.ts';
import type { AccountId } from '../identity/types.ts';
import { Button, Input, Select, Textarea, Checkbox } from '../../ui/workspace/controls.tsx';
import { calendarRead } from './client.ts';
import type { AppointmentView, AttendanceInput, CreateBooking, ManualNoticeInput, NoticeInput } from './types.ts';
import type { BookingCatalog } from './service.ts';
import { text } from './copy.ts';
import { ZonedInput, resolveWall, wallTime } from './form-support.tsx';
export type CaseChoice={id:string;displayName:string;kind:'minor'|'adult';state:string};
export type SaveForm=(path:string,body:unknown,done?:()=>void,method?:'POST'|'PATCH')=>void;
function valid(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;if(!form.checkValidity()){form.reportValidity();form.querySelector<HTMLElement>(':invalid')?.focus();return false;}return true;}
function useCatalog(caseId:string){
 const [state,setState]=useState<{caseId:string;catalog:BookingCatalog|null;error:boolean}>({caseId:'',catalog:null,error:false});
 useEffect(()=>{let current=true;if(caseId)void calendarRead<BookingCatalog>('catalog?'+new URLSearchParams({caseId})).then(catalog=>{if(current)setState({caseId,catalog,error:false});}).catch(()=>{if(current)setState({caseId,catalog:null,error:true});});return()=>{current=false;};},[caseId]);
 return state.caseId===caseId?{catalog:state.catalog,error:state.error}:{catalog:null,error:false};
}
export function BookingForm({locale,cases,appointments,initialCaseId,original,checkinFor,locked,onDirty,onSave}:{locale:Locale;cases:CaseChoice[];appointments:AppointmentView[];initialCaseId:string;original?:AppointmentView|null;checkinFor?:AppointmentView|null;locked:boolean;onDirty:(dirty:boolean)=>void;onSave:(value:CreateBooking,done:()=>void)=>void}){
 const prefix=useId();
 const t=text(locale),[caseId,setCaseId]=useState(original?.caseId??checkinFor?.caseId??initialCaseId),[kind,setKind]=useState<CreateBooking['kind']>(original?.kind??(checkinFor?'parent_guidance':'individual'));
 const [start,setStart]=useState(wallTime()),[audienceId,setAudienceId]=useState(original?.audienceId??''),[parentForId,setParentForId]=useState(original?.parentForId??checkinFor?.id??''),[parents,setParents]=useState<AccountId[]>(original?.parentIds??[]);
 const [location,setLocation]=useState(original?.location??''),[before,setBefore]=useState(original?.bufferBefore??0),[after,setAfter]=useState(original?.bufferAfter??0),[exception,setException]=useState(''),[error,setError]=useState('');
 const {catalog,error:catalogError}=useCatalog(caseId);
 const chosen=catalog?.audiences.find(a=>a.id===audienceId)??(catalog?.audiences.length===1?catalog.audiences[0]:undefined);
 const linked=appointments.filter(a=>a.caseId===caseId&&a.kind==='individual');
 if(checkinFor&&!linked.some(a=>a.id===checkinFor.id))linked.push(checkinFor);
 return <form className="ls-cal-form" onChangeCapture={()=>onDirty(true)} onSubmit={e=>{
  if(!valid(e))return;const startsAt=resolveWall(start);
  if(!startsAt||!chosen||!catalog?.engagement||(kind==='parent_guidance'&&(!parentForId||parents.length<1))){setError(t.invalid);return;}
  const value:CreateBooking={caseId:asId(caseId,'case'),audienceId:chosen.id,kind,startsAt,parentForId:kind==='parent_guidance'?asId(parentForId,'appointment'):null,
   parentIds:kind==='parent_guidance'?parents:[],bufferBefore:before,bufferAfter:after,location,checkinExceptionReason:exception.trim()||null};
  setError('');onSave(value,()=>onDirty(false));
 }}><p>{t.bookHelp}</p><fieldset disabled={locked}>
 <Select id={prefix+"-case"} label={t.case} value={caseId} required disabled={Boolean(original||checkinFor)} onChange={e=>{setCaseId(e.target.value);setAudienceId('');setParents([]);setParentForId('');}}><option value="">{t.selectCase}</option>{cases.filter(c=>c.kind==='minor').map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</Select>
 <Select id={prefix+"-kind"} label={t.kind} value={kind} disabled={Boolean(original||checkinFor)} onChange={e=>{setKind(e.target.value as CreateBooking['kind']);setParents([]);}}><option value="individual">{t.individual}</option><option value="parent_guidance">{t.parent_guidance}</option></Select>
 <ZonedInput id={prefix+"-start"} label={t.startsAt} value={start} onChange={setStart} locale={locale} required/>
 <Select id={prefix+"-audience"} label={t.audience} value={chosen?.id??''} required onChange={e=>{setAudienceId(e.target.value);setParents([]);}}><option value="">{t.audience}</option>{catalog?.audiences.map((a,i)=><option value={a.id} key={a.id}>{t.audience} {i+1} · {a.parentIds.length}</option>)}</Select>
 {kind==='parent_guidance'&&<><Select id={prefix+"-child"} label={t.parentFor} value={parentForId} required onChange={e=>setParentForId(e.target.value)}><option value="">{t.parentFor}</option>{linked.map(a=><option key={a.id} value={a.id}>{new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',dateStyle:'medium',timeStyle:'short'}).format(new Date(a.startsAt))}</option>)}</Select>
 {!linked.length&&<p>{t.noLinked}</p>}<div role="group" aria-label={t.parent}>{chosen?.parentIds.map((id,i)=><Checkbox key={id} id={prefix+'-parent-'+id} label={`${t.parent} ${i+1} · ${id.slice(-4)}`} checked={parents.includes(id)} onChange={e=>setParents(e.target.checked?[...parents,id]:parents.filter(p=>p!==id))}/>)}</div>
 <Textarea id={prefix+"-checkin-reason"} label={t.checkinReason} help={t.reasonHelp} value={exception} onChange={e=>setException(e.target.value)} maxLength={500}/></>}
 <Input id={prefix+"-location"} label={t.location} help={t.locationHelp} value={location} onChange={e=>setLocation(e.target.value)} maxLength={280}/>
 <div className="ls-cal-two"><Input id={prefix+"-before"} label={t.before} type="number" min={0} max={120} step={1} value={before} onChange={e=>setBefore(Number(e.target.value))}/><Input id={prefix+"-after"} label={t.after} type="number" min={0} max={120} step={1} value={after} onChange={e=>setAfter(Number(e.target.value))}/></div>
 {(catalogError||(catalog&&(!catalog.engagement||!catalog.audiences.length)))&&<p role="status">{t.noAudience}</p>}
 {error&&<p role="alert">{error}</p>}<Button type="submit" disabled={!chosen||!catalog?.engagement||!resolveWall(start)}>{original?t.confirmReplacement:t.save}</Button>
 </fieldset></form>;
}
export function NoticeForm({locale,appointment,manual,locked,onDirty,save}:{locale:Locale;appointment:AppointmentView;manual:boolean;locked:boolean;onDirty:(dirty:boolean)=>void;save:SaveForm}){
 const t=text(locale),[kind,setKind]=useState<NoticeInput['kind']>('reschedule'),[suggestStart,setSuggestStart]=useState(wallTime()),[suggestEnd,setSuggestEnd]=useState(wallTime()),[checked,setChecked]=useState(false),[source,setSource]=useState<ManualNoticeInput['source']>('whatsapp_manual'),[received,setReceived]=useState(wallTime()),[requestedBy,setRequestedBy]=useState(''),[error,setError]=useState('');
 const {catalog}=useCatalog(manual?appointment.caseId:'');const parentIds=catalog?.audiences.find(a=>a.id===appointment.audienceId)?.parentIds??[];
 return <form className="ls-cal-form" onChangeCapture={()=>onDirty(true)} onSubmit={e=>{
  if(!valid(e))return;const start=resolveWall(suggestStart),end=resolveWall(suggestEnd);
  if(!checked||(kind==='reschedule'&&(suggestStart.wall||suggestEnd.wall)&&(!start||!end))||(manual&&(!resolveWall(received)||!requestedBy))){setError(t.invalid);return;}
  const input:NoticeInput={kind,proposedWindows:kind==='reschedule'&&start&&end?[{startsAt:start,endsAt:end}]:[]};
  const body=manual?{...input,source,receivedAt:resolveWall(received),requestedBy}:input;
  setError('');save(`appointments/${appointment.id}/${manual?'manual-notice':'notice'}`,body,()=>{setChecked(false);onDirty(false);});
 }}><p>{manual?t.manualHelp:t.noticeExplain}</p><p className="ls-cal-policy">{appointment.kind==='individual'?(appointment.creditException?t.exceptionApproved:t.noticeRule):t.included}</p><fieldset disabled={locked}>
 <Select id="notice-kind" label={t.action} value={kind} onChange={e=>setKind(e.target.value as NoticeInput['kind'])}><option value="reschedule">{t.reschedule}</option><option value="cancel">{t.cancel}</option></Select>
 {manual&&<><Select id="notice-source" label={t.source} value={source} onChange={e=>setSource(e.target.value as ManualNoticeInput['source'])}><option value="whatsapp_manual">{t.whatsapp_manual}</option><option value="phone">{t.phone}</option></Select><ZonedInput id="notice-received" label={t.actualReceipt} value={received} onChange={setReceived} locale={locale} required/><Select id="notice-parent" label={t.requestedBy} value={requestedBy} required onChange={e=>setRequestedBy(e.target.value)}><option value="">{t.requestedBy}</option>{parentIds.map((id,i)=><option value={id} key={id}>{t.parent} {i+1} · {id.slice(-4)}</option>)}</Select></>}
 {kind==='reschedule'&&<section><h4>{t.suggestion}</h4><div className="ls-cal-two"><ZonedInput id="notice-from" label={t.startsAt} value={suggestStart} onChange={setSuggestStart} locale={locale}/><ZonedInput id="notice-to" label={t.endsAt} value={suggestEnd} onChange={setSuggestEnd} locale={locale}/></div></section>}
 <Checkbox id="notice-consent" label={t.noticeCheck} checked={checked} onChange={e=>setChecked(e.target.checked)} required/>
 {error&&<p role="alert">{error}</p>}<Button type="submit" variant="danger" disabled={!checked}>{t.sendNotice}</Button></fieldset></form>;
}
export function AttendanceForm({locale,appointment,locked,onDirty,save}:{locale:Locale;appointment:AppointmentView;locked:boolean;onDirty:(dirty:boolean)=>void;save:SaveForm}){
 const t=text(locale),[state,setState]=useState<AttendanceInput['state']>(appointment.attendance?.state??'present'),[arrival,setArrival]=useState(wallTime(appointment.attendance?.arrivedAt??appointment.startsAt)),[reason,setReason]=useState(''),[error,setError]=useState('');
 const observed=state==='present'||state==='late';
 return <form className="ls-cal-form" onChangeCapture={()=>onDirty(true)} onSubmit={e=>{
  if(!valid(e))return;const arrivedAt=observed?resolveWall(arrival):null;if(observed&&!arrivedAt){setError(t.invalid);return;}
  save(`appointments/${appointment.id}/attendance`,{state,arrivedAt,expectedVersion:appointment.attendance?.version??0,correctionReason:reason.trim()||null},()=>{setReason('');onDirty(false);});
 }}><p>{t.attendanceHelp}</p><fieldset disabled={locked}><Select id="attendance-state" label={t.attendance} value={state} onChange={e=>setState(e.target.value as AttendanceInput['state'])}>{(['present','late','no_show','canceled'] as const).map(s=><option value={s} key={s}>{t[s]}</option>)}</Select>
 {observed&&<ZonedInput id="attendance-arrival" label={t.arrivedAt} value={arrival} onChange={setArrival} locale={locale} required/>}
 <Textarea id="attendance-reason" label={t.correctionReason} help={t.reasonHelp} value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} required={Boolean(appointment.attendance||appointment.status.startsWith('canceled')||appointment.status==='rescheduled')}/>
 {error&&<p role="alert">{error}</p>}<Button type="submit">{t.recordAttendance}</Button></fieldset></form>;
}
export function PractitionerActionForm({locale,appointment,locked,onDirty,save}:{locale:Locale;appointment:AppointmentView;locked:boolean;onDirty:(dirty:boolean)=>void;save:SaveForm}){
 const t=text(locale),[action,setAction]=useState('logistics'),[reason,setReason]=useState(''),[location,setLocation]=useState(appointment.location),[confirmed,setConfirmed]=useState(false);
 return <form className="ls-cal-form" onChangeCapture={()=>onDirty(true)} onSubmit={e=>{
  if(!valid(e)||!confirmed)return;
  const body=action==='logistics'?{expectedVersion:appointment.version,location}:action==='close-request'?{expectedVersion:appointment.version}:{expectedVersion:appointment.version,reason};
  save(`appointments/${appointment.id}/${action}`,body,()=>{setConfirmed(false);setReason('');onDirty(false);},action==='logistics'?'PATCH':'POST');
 }}><fieldset disabled={locked}><Select id="practitioner-action" label={t.action} value={action} onChange={e=>{setAction(e.target.value);setConfirmed(false);}}><option value="logistics">{t.updateLocation}</option><option value="provider-cancel">{t.providerCancel}</option>{appointment.kind==='individual'&&<option value="exception">{t.exception}</option>}{appointment.notice?.state==='pending'&&!appointment.replacementId&&<option value="close-request">{t.closeRequest}</option>}</Select>
 {action==='logistics'?<Input id="practitioner-location" label={t.location} help={t.locationHelp} value={location} onChange={e=>setLocation(e.target.value)} maxLength={280}/>:action!=='close-request'?<Textarea id="practitioner-reason" label={t.reason} help={t.reasonHelp} value={reason} onChange={e=>setReason(e.target.value)} required maxLength={500}/>:<p>{t.financialSeparate}</p>}
 <Checkbox id="practitioner-confirm" label={t.confirmAction} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/><Button type="submit" variant={action==='provider-cancel'?'danger':'primary'} disabled={!confirmed}>{t.applyAction}</Button></fieldset></form>;
}
export function AvailabilityForm({locale,locked,onDirty,save}:{locale:Locale;locked:boolean;onDirty:(dirty:boolean)=>void;save:SaveForm}){
 const t=text(locale),[from,setFrom]=useState(wallTime()),[to,setTo]=useState(wallTime()),[kind,setKind]=useState<'open'|'blocked'>('open');
 return <form className="ls-cal-form" onChangeCapture={()=>onDirty(true)} onSubmit={e=>{if(!valid(e)||!resolveWall(from)||!resolveWall(to))return;save('availability',{startsAt:resolveWall(from),endsAt:resolveWall(to),kind},()=>onDirty(false));}}><fieldset disabled={locked}>
 <Select id="availability-kind" label={t.availability} value={kind} onChange={e=>setKind(e.target.value as 'open'|'blocked')}><option value="open">{t.open}</option><option value="blocked">{t.blocked}</option></Select>
 <ZonedInput id="availability-from" label={t.startsAt} value={from} onChange={setFrom} locale={locale} required/><ZonedInput id="availability-to" label={t.endsAt} value={to} onChange={setTo} locale={locale} required/>
 <Button type="submit" disabled={!resolveWall(from)||!resolveWall(to)}>{t.save}</Button></fieldset></form>;
}
