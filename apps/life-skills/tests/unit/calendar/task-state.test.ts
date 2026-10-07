import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {taskCalendarDate,taskStateLabel,taskStates} from '../../../src/features/calendar/task-state.ts';
import {taskManageSchema} from '../../../src/features/calendar/validation.ts';
import {CalendarAgenda,CalendarBoard} from '../../../src/features/calendar/views.tsx';
import type {InternalTask} from '../../../src/features/calendar/tasks.ts';
const task:InternalTask={id:'123e4567-e89b-42d3-a456-426614174000' as InternalTask['id'],caseId:null,title:'Synthetic retained task',note:null,sourcePath:null,sourceKind:null,dueDate:'2026-10-05',dueTime:null,state:'in_progress',snoozedUntil:'2026-10-07',version:2,createdAt:'2026-10-05T06:00:00Z',updatedAt:'2026-10-05T06:00:00Z'};
it('keeps source dates while placing work on the later snooze date',()=>{
 expect(taskCalendarDate(task)).toBe('2026-10-07');expect(task.dueDate).toBe('2026-10-05');
 expect(taskCalendarDate({...task,snoozedUntil:null})).toBe('2026-10-05');
 expect(taskCalendarDate({...task,dueDate:'2026-10-08'})).toBe('2026-10-08');
 expect(taskCalendarDate({dueDate:'2026-10-05'})).toBe('2026-10-05');
});
it.each(['en','he'] as const)('shows all admitted %s states without changing stored keys',locale=>{
 expect(taskStates).toEqual(['open','in_progress','done']);
 expect(taskStates.map(x=>taskStateLabel(x,locale))).toEqual(locale==='he'?['לביצוע','בטיפול','הושלמה']:['To do','In progress','Done']);
});
it('rejects partial, invalid and caller-owned identity/source/side-effect fields',()=>{
 const valid={expectedVersion:2,state:'in_progress',snoozedUntil:'2026-10-07',mode:'demo'};
 expect(taskManageSchema.safeParse(valid).success).toBe(true);
 for(const bad of [{...valid,state:'constructor'},{...valid,snoozedUntil:'2026-02-30'},{...valid,snoozedUntil:'2026-10-07T20:00:00Z'},{...valid,expectedVersion:0},{...valid,state:'done'},{...valid,send:true},{...valid,accountId:task.id},{...valid,sourcePath:'/en/app/payments'}])expect(taskManageSchema.safeParse(bad).success).toBe(false);
 expect(taskManageSchema.safeParse({...valid,state:'done',snoozedUntil:null}).success).toBe(true);
});
it.each(['en','he'] as const)('places the same %s snoozed task in board and agenda with its original date, no invented time or effects',locale=>{
 const manage=vi.fn(),complete=vi.fn(),common={items:[],tasks:[task],locale,names:{},onOpen:vi.fn(),onManageTask:manage,onCompleteTask:complete};
 const board=renderToStaticMarkup(createElement(CalendarBoard,{...common,dates:['2026-10-05','2026-10-07'],view:'week'})),agenda=renderToStaticMarkup(createElement(CalendarAgenda,common));
 expect(board.split('id="day-2026-10-07"')[0]).not.toContain(task.title);
 for(const html of [board,agenda]){expect(html.match(/Synthetic retained task/g)).toHaveLength(1);expect(html).toContain(taskStateLabel('in_progress',locale));expect(html).toContain(locale==='he'?'נדחתה עד':'Snoozed until');expect(html).toContain('2026-10-05');expect(html).toContain('2026-10-07');expect(html).toContain(locale==='he'?'ללא שעה מוגדרת':'No time set');expect(html).toContain('aria-controls="ls-cal-task-manage"');expect(html).not.toContain('19:00');}
 expect(manage).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
});
