import type {Locale} from '../../lib/locale.ts';
export const taskStates=['open','in_progress','done'] as const;
export type TaskState=typeof taskStates[number];
export type TaskSchedule={dueDate:string;snoozedUntil?:string|null};
/** Snooze changes internal work placement, never its authoritative source date. */
export function taskCalendarDate(task:TaskSchedule):string{return task.snoozedUntil&&task.snoozedUntil>task.dueDate?task.snoozedUntil:task.dueDate;}
export function taskStateLabel(state:TaskState,locale:Locale):string{
 return locale==='he'?{open:'לביצוע',in_progress:'בטיפול',done:'הושלמה'}[state]:{open:'To do',in_progress:'In progress',done:'Done'}[state];
}
