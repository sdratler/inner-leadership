import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {parseLeadText} from '../../../src/features/contact-ops/core/lead-command.ts';
import {sourceCallbackTiming,taskTiming,taskPresentation,timingLabel} from '../../../src/features/calendar/task-presentation.ts';
import {orderedCalendarEntries} from '../../../src/features/calendar/entry-order.ts';
import {CalendarAgenda,CalendarBoard} from '../../../src/features/calendar/views.tsx';
import type {InternalTask} from '../../../src/features/calendar/tasks.ts';
import type {AppointmentView} from '../../../src/features/calendar/types.ts';
const task=(suffix:string,title:string,overrides:Partial<InternalTask>={}):InternalTask=>({id:`00000000-0000-4000-8000-${suffix.padStart(12,'0')}` as InternalTask['id'],caseId:null,title,note:null,sourcePath:'/he/app/clients?section=prospects&leadId=LS-LEAD-synthetic',sourceKind:'crm_followup',dueDate:'2026-10-08',dueTime:null,state:'open',version:1,createdAt:'2026-10-07T12:00:00Z',updatedAt:'2026-10-07T12:00:00Z',...overrides});
it.each(['call tomorrow between 09:00 and 10:00','call tomorrow morning','להתקשר מחר בערב'])('uses the actual quick-update callback output without invented hours: %s',input=>{
 const intent=parseLeadText(input,'2026-10-07');expect(intent?.callbackWindow).toBeDefined();
 expect(sourceCallbackTiming(intent!.nextAction!)).toEqual(intent!.callbackWindow);
});
it('keeps an explicit lower bound open ended and exact time/range distinct',()=>{
 const after=sourceCallbackTiming('Call Thursday 8 October 2026 in the evening after 19:00 (Asia/Jerusalem).');
 expect(after).toEqual({kind:'after',time:'19:00'});expect(timingLabel(after,'en')).toBe('After 19:00');expect(timingLabel(after,'he')).toBe('אחרי 19:00');
 expect(sourceCallbackTiming('Call Thursday 8 October, 09:00–10:00 (Asia/Jerusalem). Private hot lead.')).toEqual({kind:'time_range',start:'09:00',end:'10:00'});
 expect(sourceCallbackTiming('Call at 09:15')).toEqual({kind:'exact',time:'09:15'});
});
it.each(['Call — 25:00–26:00','Call — 19:00–09:00','Call — 09:00–09:00','Call 09:00–10:00 or 11:00–12:00','Call after 19:00–20:00','Do not call 09:00–10:00','Call not 09:00–10:00','Review a note from 09:00–10:00','Call — morning evening','Call — 09:00–10:00 (Europe/London)','Call — 09:00–10:00 or morning','Call about the 09:00–10:00 meeting','Call about the morning','Call about the appointment after 19:00'])('does not invent a callback window from ambiguous, invalid or unrelated text: %s',title=>{
 expect(sourceCallbackTiming(title)).toEqual({kind:'unset'});
});
it('does not parse private notes or manual task prose and does not move a source promise on snooze',()=>{
 const manual=task('1','Call — 09:00–10:00',{sourceKind:null,note:'Call after 19:00'});
 expect(taskTiming(manual)).toEqual({kind:'unset'});
 expect(taskTiming({...manual,dueTime:'12:05'})).toEqual({kind:'exact',time:'12:05'});
 expect(taskTiming(task('2','Synthetic person · Call — 09:00–10:00',{snoozedUntil:'2026-10-09'}))).toEqual({kind:'unset'});
});
it('orders actual Jerusalem times with source windows, then qualitative windows and undated times separately',()=>{
 const timed=task('1','Synthetic afternoon',{sourceKind:null,dueTime:'15:00'}),range=task('2','Synthetic morning · Call — 09:00–10:00'),after=task('3','Synthetic evening · Call after 19:00'),qualitative=task('4','Synthetic flexible · Call — morning'),unset=task('5','Synthetic no time');
 const appointment={id:'synthetic-appointment',startsAt:'2026-10-08T07:30:00Z'} as AppointmentView;
 const result=orderedCalendarEntries({items:[appointment],tasks:[unset,after,timed,qualitative,range]});
 expect(result.map(e=>e.key)).toEqual(['task-'+range.id,'appointment-synthetic-appointment','task-'+timed.id,'task-'+after.id,'task-'+qualitative.id,'task-'+unset.id]);
 expect(result[1]!.timing).toEqual({kind:'exact',time:'10:30'});
 // Jerusalem switches to UTC+2 after the October transition; no fixed offset.
 expect(orderedCalendarEntries({items:[{...appointment,startsAt:'2026-10-26T07:30:00Z'}]})[0]!.timing).toEqual({kind:'exact',time:'09:30'});
});
it.each(['en','he'] as const)('keeps %s actions and full source inside a collapsed keyboard disclosure, preserving task identity',locale=>{
 const original=task('1','LS-WAPI-abc123 · Respond to inbound WhatsApp inquiry',{note:'Synthetic retained note'}),onCompleteTask=vi.fn(),onManageTask=vi.fn();
 const common={items:[],tasks:[original],locale,names:{},onOpen:vi.fn(),onCompleteTask,onManageTask};
 for(const markup of [renderToStaticMarkup(createElement(CalendarAgenda,common)),renderToStaticMarkup(createElement(CalendarBoard,{...common,dates:['2026-10-08'],view:'month'}))]){
  const summary=markup.slice(markup.indexOf('<summary>'),markup.indexOf('</summary>'));
  expect(summary).toContain(locale==='he'?'פנייה ללא שם':'Unnamed inquiry');expect(summary).not.toContain('LS-WAPI-abc123');
  expect(summary).toContain(locale==='he'?'ללא שעה מוגדרת':'No time set');expect(summary).not.toContain('<button');expect(summary).not.toContain('<a ');
  expect(markup).toContain('LS-WAPI-abc123');expect(markup).toContain('Synthetic retained note');expect(markup).toContain(`data-task-id="${original.id}"`);
  expect(markup).not.toMatch(/<details[^>]* open/);expect(markup).toContain(`href="/${locale}/app/clients?section=prospects&amp;leadId=LS-LEAD-synthetic"`);
 }
 expect(onCompleteTask).not.toHaveBeenCalled();expect(onManageTask).not.toHaveBeenCalled();expect(original.title).toBe('LS-WAPI-abc123 · Respond to inbound WhatsApp inquiry');
});
it('summarizes the callback without discarding the full action or changing its persisted date',()=>{
 const original=task('1','Synthetic contact · Call Thursday 8 October, 09:00–10:00 (Asia/Jerusalem). Private hot lead.');
 const result=taskPresentation(original,'en',{});expect(result.title).toBe('Synthetic contact · Call back');expect(result.full).toBe(original.title);expect(original.dueTime).toBeNull();
 const html=renderToStaticMarkup(createElement(CalendarBoard,{items:[],tasks:[original],locale:'en',names:{},dates:['2026-10-08'],view:'month',onOpen:vi.fn()}));
 expect(html.slice(html.indexOf('<summary>'),html.indexOf('</summary>'))).toContain('09:00–10:00');expect(html).not.toContain('All day');
});
