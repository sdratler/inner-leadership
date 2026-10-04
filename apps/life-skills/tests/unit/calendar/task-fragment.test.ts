import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {CalendarAgenda,calendarTaskFragment,revealCalendarTaskFragment} from '../../../src/features/calendar/views.tsx';
import type {InternalTask} from '../../../src/features/calendar/tasks.ts';

const id='123e4567-e89b-42d3-a456-426614174000';
it('restores the task target from a validated single query after login drops the fragment',()=>{
 expect(calendarTaskFragment('','?date=2026-10-02&view=agenda&taskId='+id)).toBe('#task-'+id);
 expect(calendarTaskFragment('#task-'+id,'')).toBe('#task-'+id);
 for(const query of ['?taskId=invalid',`?taskId=${id}&taskId=${id}`,'?taskId=constructor'])expect(calendarTaskFragment('',query)).toBe('');
 expect(calendarTaskFragment('#unrelated','?taskId='+id)).toBe('');
});
const task:InternalTask={id:id as InternalTask['id'],caseId:null,title:'DEMO captured response',note:null,sourcePath:null,sourceKind:null,dueDate:'2026-10-02',dueTime:null,state:'open',version:1,createdAt:'2026-10-02T06:00:00Z',updatedAt:'2026-10-02T06:00:00Z'};
it.each(['he','en'] as const)('renders a real keyboard-focusable %s task fragment only for supplied authorized tasks',locale=>{
 const props={items:[],tasks:[task],locale,names:{},onOpen:()=>{}};
 const html=renderToStaticMarkup(createElement(CalendarAgenda,props));
 expect(html).toContain(`id="task-${id}"`);expect(html).toContain('tabindex="-1"');
 expect(html).toContain(`aria-labelledby="task-${id}-title"`);
 expect(renderToStaticMarkup(createElement(CalendarAgenda,{...props,tasks:[]}))).not.toContain(`id="task-${id}"`);
});
it('can resolve a cold-load fragment after its task arrives without selecting a missing or hidden row',()=>{
 const focus=vi.fn(),scrollIntoView=vi.fn(),target={focus,scrollIntoView,getClientRects:()=>[{}]},querySelector=vi.fn().mockReturnValue(null),root={querySelector} as unknown as HTMLElement;
 expect(revealCalendarTaskFragment(root,'#task-'+id)).toBe(false);expect(focus).not.toHaveBeenCalled();
 querySelector.mockReturnValue(target);expect(revealCalendarTaskFragment(root,'#task-'+id)).toBe(true);
 expect(scrollIntoView).toHaveBeenCalledWith({block:'center',behavior:'auto'});expect(focus).toHaveBeenCalledWith({preventScroll:true});
 expect(querySelector).toHaveBeenLastCalledWith('#task-'+id);
 querySelector.mockReturnValue({...target,getClientRects:()=>[]});expect(revealCalendarTaskFragment(root,'#task-'+id)).toBe(false);expect(focus).toHaveBeenCalledTimes(1);
});
it.each(['','#task-invalid','#task-123e4567-e89b-42d3-a456-426614174000, input','#followup-private'])('does not query or focus unrelated or malformed targets: %s',hash=>{
 const querySelector=vi.fn();expect(revealCalendarTaskFragment({querySelector} as unknown as HTMLElement,hash)).toBe(false);expect(querySelector).not.toHaveBeenCalled();
});
