import type {Locale} from '../../lib/locale.ts';
import {callbackWindowLabel,type CallbackWindow} from '../contact-ops/core/lead-command.ts';
import {localizedTaskTitle} from './administrative-work-copy.ts';
import type {InternalTask} from './tasks.ts';
import {taskCalendarDate} from './task-state.ts';

/** Read-only presentation of existing source text. No new persisted schedule or
 * callback contract: quick updates currently retain their window in nextAction.
 * An open-ended "after" constraint is never converted into a booked interval. */
export type CalendarTiming=CallbackWindow|{kind:'exact';time:string}|{kind:'after';time:string}|{kind:'unset'};
const clock='(?:[01]\\d|2[0-3]):[0-5]\\d';
function callbackPrefix(value:string):boolean{
 const rest=value.replace(/^(?:call(?: him| her)?|follow up|להתקשר(?: אליו| אליה)?|המשך טיפול)\s*/iu,'').replace(/^[—–-]\s*/u,'').trim();
 // Recognize the quick-update suffix and the legacy dated callback wording.
 // Arbitrary prose about another event's time is not a scheduling contract.
 return !rest||/^(?:(?:today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+\d{1,2})?(?:\s+(?:january|february|march|april|may|june|july|august|september|october|november|december))?(?:\s+\d{4})?)(?:\s+in the (?:morning|evening))?\s*,?$/iu.test(rest)||/^(?:היום|מחר)$/u.test(rest);
}
function callbackSuffix(value:string):boolean{return /^\s*(?:\(Asia\/Jerusalem\))?\s*(?:[.!][\s\S]*)?$/u.test(value);}
export function sourceCallbackTiming(action:string):CalendarTiming{
 if(!/^(?:call\b|follow up\b|להתקשר(?:\s|$)|המשך טיפול(?:\s|$))/iu.test(action)||/\b(?:not|don't|do not|instead|or)\b|לא להתקשר|במקום|\sאו\s/iu.test(action))return {kind:'unset'};
 const zones=action.match(/\b[A-Za-z_]+\/[A-Za-z_]+\b/g)??[];
 if(zones.some(zone=>zone!=='Asia/Jerusalem'))return {kind:'unset'};
 const clocks=[...action.matchAll(new RegExp(`(?<![\\d:])(${clock})(?![\\d:])`,'g'))];
 const range=new RegExp(`(?<![\\d:])(${clock})\\s*[–—-]\\s*(${clock})(?![\\d:])`,'u').exec(action);
 if(range&&clocks.length===2&&range[1]!<range[2]!&&callbackPrefix(action.slice(0,range.index))&&callbackSuffix(action.slice(range.index+range[0].length)))return {kind:'time_range',start:range[1]!,end:range[2]!};
 const after=new RegExp(`(?:\\bafter\\s+|אחרי\\s*|לאחר\\s*)(${clock})(?![\\d:])`,'iu').exec(action);
 if(after&&clocks.length===1&&callbackPrefix(action.slice(0,after.index))&&callbackSuffix(action.slice(after.index+after[0].length)))return {kind:'after',time:after[1]!};
 const at=new RegExp(`(?:\\bat\\s+|בשעה\\s*)(${clock})(?![\\d:])`,'iu').exec(action);
 if(at&&clocks.length===1&&callbackPrefix(action.slice(0,at.index))&&callbackSuffix(action.slice(at.index+at[0].length)))return {kind:'exact',time:at[1]!};
 // Words do not imply invented hours. Accept only the existing trailing label,
 // not arbitrary prose or contradictory/multiple timing clauses.
 if(clocks.length)return {kind:'unset'};
 const parts=[...action.matchAll(/\b(?:morning|evening)\b|בבוקר|בערב|בוקר|ערב/giu)];
 const part=parts[0];
 if(parts.length===1&&part&&callbackPrefix(action.slice(0,part.index))&&callbackSuffix(action.slice(part.index+part[0].length)))return {kind:'part_of_day',value:/morning|בוקר/iu.test(part[0])?'morning':'evening'};
 return {kind:'unset'};
}
export function taskTiming(task:Pick<InternalTask,'dueTime'|'sourceKind'|'title'|'dueDate'|'snoozedUntil'>):CalendarTiming{
 // Snoozing does not move the original callback promise to a new date.
 if(taskCalendarDate(task)!==task.dueDate)return {kind:'unset'};
 if(task.dueTime&&new RegExp(`^${clock}$`).test(task.dueTime))return {kind:'exact',time:task.dueTime};
 if(task.sourceKind!=='crm_followup')return {kind:'unset'};
 const split=task.title.indexOf(' · ');
 return sourceCallbackTiming(split<0?task.title:task.title.slice(split+3));
}
export function timingLabel(timing:CalendarTiming,locale:Locale):string{
 if(timing.kind==='unset')return locale==='he'?'ללא שעה מוגדרת':'No time set';
 if(timing.kind==='exact')return timing.time;
 if(timing.kind==='after')return `${locale==='he'?'אחרי':'After'} ${timing.time}`;
 return callbackWindowLabel(timing,locale);
}
export type TimingGroup='timed'|'part_of_day'|'unset';
export function timingGroup(timing:CalendarTiming):TimingGroup{return timing.kind==='unset'?'unset':timing.kind==='part_of_day'?'part_of_day':'timed';}
export function timingSort(timing:CalendarTiming):string{
 if(timing.kind==='unset')return '2';
 if(timing.kind==='part_of_day')return '1'+(timing.value==='morning'?'0':'1');
 return '0'+(timing.kind==='time_range'?timing.start:timing.time)+(timing.kind==='after'?'1':'0');
}
export function timingGroupLabel(group:TimingGroup,locale:Locale):string{
 return locale==='he'?{timed:'שעות וחלונות זמן',part_of_day:'חלק מהיום · ללא שעה מדויקת',unset:'ללא שעה מוגדרת'}[group]:{timed:'Times & windows',part_of_day:'Part of day · no exact time',unset:'No time set'}[group];
}
export function taskPresentation(task:InternalTask,locale:Locale,names:Record<string,string>){
 const localized=localizedTaskTitle(task.title,task.sourceKind,locale),timing=taskTiming(task);
 const full=task.sourceKind&&task.sourceKind!=='crm_followup'&&task.caseId&&names[task.caseId]?`${names[task.caseId]} · ${localized}`:localized;
 if(task.sourceKind!=='crm_followup')return {title:full,full,timing};
 const split=localized.indexOf(' · '),identity=split<0?'':localized.slice(0,split),action=split<0?localized:localized.slice(split+3);
 const person=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(identity)?(locale==='he'?'פנייה ללא שם':'Unnamed inquiry'):identity;
 const shortAction=timing.kind!=='unset'&&/^(?:call\b|להתקשר)/iu.test(action)?(locale==='he'?'לחזור בשיחה':'Call back'):action;
 return {title:person?`${person} · ${shortAction}`:shortAction,full,timing};
}
