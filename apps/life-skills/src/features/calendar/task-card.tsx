'use client';
import type {MouseEvent} from 'react';
import type {Locale} from '../../lib/locale.ts';
import type {InternalTask} from './tasks.ts';
import {Button} from '../../ui/workspace/controls.tsx';
import {taskCalendarDate,taskStateLabel} from './task-state.ts';
import {taskPresentation,timingLabel} from './task-presentation.ts';
export type OpenTaskManager=(task:InternalTask,event:MouseEvent<HTMLButtonElement>)=>void;
export function CalendarTaskCard({task,locale,names,agenda=false,onCompleteTask,onManageTask}:{task:InternalTask;locale:Locale;names:Record<string,string>;agenda?:boolean;onCompleteTask?:((task:InternalTask)=>void)|undefined;onManageTask?:OpenTaskManager|undefined}){
 const {title,full,timing}=taskPresentation(task,locale,names),prefix=agenda?'task-':'board-task-',titleId=(agenda?'task-body-':'board-task-body-')+task.id+'-title';
 const snoozed=taskCalendarDate(task)!==task.dueDate;
 return <div id={prefix+task.id} tabIndex={-1} role="group" aria-labelledby={titleId} className="ls-cal-task-target">
  <details className="ls-cal-task" data-task-id={task.id}>
   <summary><span className="ls-cal-task-summary"><span className="ls-cal-task-meta"><bdi className="ls-cal-task-time">{timingLabel(timing,locale)}</bdi><span className="ls-cal-task-state">{taskStateLabel(task.state,locale)}</span></span><strong id={titleId}>{title}</strong></span></summary>
   <div className="ls-cal-task-expanded">
    {full!==title&&<p>{full}</p>}
    <p><span>{locale==='he'?'משימה':'Task'}</span> · <time dateTime={taskCalendarDate(task)}>{taskCalendarDate(task)}</time> · <bdi>Asia/Jerusalem</bdi></p>
    {snoozed&&<p>{locale==='he'?'נדחתה עד':'Snoozed until'} <time dateTime={task.snoozedUntil!}>{task.snoozedUntil}</time> · {locale==='he'?'מועד המשימה המקורי':'Original task date'} <time dateTime={task.dueDate}>{task.dueDate}</time>{task.dueTime&&<> · <bdi>{task.dueTime}</bdi></>}</p>}
    {task.note&&<p className="ls-cal-task-note">{task.note}</p>}
    <div className="ls-cal-task-actions">{task.sourcePath&&<a href={task.sourcePath.replace(/^\/(?:he|en)\/app\//,`/${locale}/app/`)}>{locale==='he'?'פתיחת מקור':'Open source'}</a>}
    {onManageTask&&<Button variant="quiet" onClick={event=>onManageTask(task,event)} aria-haspopup="dialog" aria-controls="ls-cal-task-manage">{locale==='he'?'ניהול משימה':'Manage task'}</Button>}
    {task.state!=='done'&&onCompleteTask&&<Button variant="secondary" onClick={()=>onCompleteTask(task)}>{locale==='he'?'סימון כהושלמה':'Mark done'}</Button>}</div>
   </div>
  </details>
 </div>;
}
