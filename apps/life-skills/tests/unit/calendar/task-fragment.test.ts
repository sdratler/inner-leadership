import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {CalendarAgenda,CalendarBoard,calendarTaskFragment,revealCalendarTaskFragment} from '../../../src/features/calendar/views.tsx';
import type {InternalTask} from '../../../src/features/calendar/tasks.ts';

const id='123e4567-e89b-42d3-a456-426614174000';
it('restores the task target from a validated single query after login drops the fragment',()=>{
 expect(calendarTaskFragment('','?date=2026-10-02&view=agenda&taskId='+id)).toBe('#task-'+id);
 expect(calendarTaskFragment('#task-'+id,'')).toBe('#task-'+id);
 for(const query of ['?taskId=invalid',`?taskId=${id}&taskId=${id}`,'?taskId=constructor'])expect(calendarTaskFragment('',query)).toBe('');
 expect(calendarTaskFragment('#unrelated','?taskId='+id)).toBe('');
});
const task:InternalTask={id:id as InternalTask['id'],caseId:null,title:'DEMO captured response',note:null,sourcePath:null,sourceKind:null,dueDate:'2026-10-02',dueTime:null,state:'open',version:1,createdAt:'2026-10-02T06:00:00Z',updatedAt:'2026-10-02T06:00:00Z'};
it.each(['he','en'] as const)('preserves a saved %s task note in collapsed details in every Calendar view',locale=>{
 const saved={...task,note:'DEMO <script>not executable</script>\nKeep this exact saved note.',sourcePath:'/en/app/clients?mode=demo'};
 const complete=vi.fn(),common={items:[],tasks:[saved],locale,names:{},onOpen:()=>{},onCompleteTask:complete};
 const views=[renderToStaticMarkup(createElement(CalendarAgenda,common)),...(['day','week','month'] as const).map(view=>renderToStaticMarkup(createElement(CalendarBoard,{...common,dates:[saved.dueDate],view})))];
 for(const html of views){
  expect(html).toContain(`<details class="ls-cal-task" data-task-id="${id}"><summary>`);
  expect(html).toContain('DEMO &lt;script&gt;not executable&lt;/script&gt;\nKeep this exact saved note.');
  expect(html).not.toMatch(/<details[^>]*\sopen(?:[=>\s])/);
  expect(html).not.toContain('<script>');
  expect(html).toContain(`href="/${locale}/app/clients?mode=demo"`);
 }
 expect(complete).not.toHaveBeenCalled();expect(saved.note).toBe('DEMO <script>not executable</script>\nKeep this exact saved note.');
});
it.each(['he','en'] as const)('does not invent empty %s task details or a completion action for an already done task',locale=>{
 const saved={...task,state:'done' as const},common={items:[],tasks:[saved],locale,names:{},onOpen:()=>{},onCompleteTask:vi.fn()};
 for(const html of [renderToStaticMarkup(createElement(CalendarAgenda,common)),renderToStaticMarkup(createElement(CalendarBoard,{...common,dates:[saved.dueDate],view:'week'}))]){
  expect(html).toContain('<details class="ls-cal-task"');expect(html).not.toContain('ls-cal-task-note');expect(html).not.toContain(locale==='he'?'סימון כהושלמה':'Mark done');
  expect(html).toContain(locale==='he'?'הושלמה':'Done');
 }
});
it.each(['he','en'] as const)('renders a real keyboard-focusable %s task fragment only for supplied authorized tasks',locale=>{
 const props={items:[],tasks:[task],locale,names:{},onOpen:()=>{}};
 const html=renderToStaticMarkup(createElement(CalendarAgenda,props));
 expect(html).toContain(`id="task-${id}"`);expect(html).toContain('tabindex="-1"');
 expect(html).toContain(`aria-labelledby="task-body-${id}-title"`);
 expect(html.match(new RegExp(`id="task-${id}"`,'g'))).toHaveLength(1);
 expect(renderToStaticMarkup(createElement(CalendarAgenda,{...props,tasks:[]}))).not.toContain(`id="task-${id}"`);
});
it('can resolve a cold-load fragment after its task arrives without selecting a missing or hidden row',()=>{
 const focus=vi.fn(),scrollIntoView=vi.fn(),target={focus,scrollIntoView,getClientRects:()=>[{}],querySelector:vi.fn().mockReturnValue(null)},querySelector=vi.fn().mockReturnValue(null),root={querySelector} as unknown as HTMLElement;
 expect(revealCalendarTaskFragment(root,'#task-'+id)).toBe(false);expect(focus).not.toHaveBeenCalled();
 querySelector.mockReturnValue(target);expect(revealCalendarTaskFragment(root,'#task-'+id)).toBe(true);
 expect(scrollIntoView).toHaveBeenCalledWith({block:'center',behavior:'auto'});expect(focus).toHaveBeenCalledWith({preventScroll:true});
 expect(querySelector).toHaveBeenLastCalledWith('#task-'+id);
 querySelector.mockReturnValue({...target,getClientRects:()=>[]});expect(revealCalendarTaskFragment(root,'#task-'+id)).toBe(false);expect(focus).toHaveBeenCalledTimes(1);
});
it('opens and focuses only the addressed authorized task disclosure, leaving other tasks collapsed',()=>{
 const summary={focus:vi.fn()},disclosure={open:false,querySelector:vi.fn().mockReturnValue(summary)},other={open:false};
 const target={getClientRects:()=>[{}],scrollIntoView:vi.fn(),focus:vi.fn(),querySelector:vi.fn().mockReturnValue(disclosure)};
 const root={querySelector:vi.fn().mockReturnValue(target)} as unknown as HTMLElement;
 expect(revealCalendarTaskFragment(root,'#task-'+id)).toBe(true);expect(disclosure.open).toBe(true);expect(other.open).toBe(false);
 expect(target.querySelector).toHaveBeenCalledExactlyOnceWith(':scope > details.ls-cal-task');
 expect(disclosure.querySelector).toHaveBeenCalledExactlyOnceWith(':scope > summary');
 expect(summary.focus).toHaveBeenCalledExactlyOnceWith({preventScroll:true});expect(target.focus).not.toHaveBeenCalled();
});
it.each(['','#task-invalid','#task-123e4567-e89b-42d3-a456-426614174000, input','#followup-private'])('does not query or focus unrelated or malformed targets: %s',hash=>{
 const querySelector=vi.fn();expect(revealCalendarTaskFragment({querySelector} as unknown as HTMLElement,hash)).toBe(false);expect(querySelector).not.toHaveBeenCalled();
});
