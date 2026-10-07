import type {AppointmentView} from './types.ts';
import type {CalendarFollowup} from './followups.ts';
import type {InternalTask} from './tasks.ts';
import type {PracticeOccurrenceItem} from '../home-practice/types.ts';
import type {CalendarContent} from './content.ts';
import {civilDate,localMinute} from './time.ts';
import {taskCalendarDate} from './task-state.ts';
import {sourceCallbackTiming,taskTiming,timingSort,type CalendarTiming} from './task-presentation.ts';

type EntryBase={date:string;timing:CalendarTiming;key:string};
export type CalendarEntry=EntryBase&(
 {kind:'appointment';item:AppointmentView}|{kind:'followup';item:CalendarFollowup}|{kind:'task';item:InternalTask}|{kind:'content';item:CalendarContent}|{kind:'practice';item:PracticeOccurrenceItem});
export function orderedCalendarEntries({items,followups=[],tasks=[],practice=[],content=[]}:{items:AppointmentView[];followups?:CalendarFollowup[];tasks?:InternalTask[];practice?:PracticeOccurrenceItem[];content?:CalendarContent[]}):CalendarEntry[]{
 const entries:CalendarEntry[]=[
  ...items.map(item=>({kind:'appointment' as const,key:'appointment-'+item.id,date:civilDate(item.startsAt),timing:{kind:'exact' as const,time:localMinute(item.startsAt).slice(11)},item})),
  ...followups.map(item=>({kind:'followup' as const,key:'followup-'+item.leadId,date:item.dueDate,timing:sourceCallbackTiming(item.nextAction),item})),
  ...tasks.map(item=>({kind:'task' as const,key:'task-'+item.id,date:taskCalendarDate(item),timing:taskTiming(item),item})),
  ...content.map(item=>({kind:'content' as const,key:'content-'+item.id,date:item.date,timing:{kind:'exact' as const,time:item.localTime},item})),
  ...practice.map(item=>({kind:'practice' as const,key:'practice-'+item.occurrence.id,date:item.occurrence.occursOn,timing:item.occurrence.occursAt?{kind:'exact' as const,time:localMinute(item.occurrence.occursAt).slice(11)}:{kind:'unset' as const},item})),
 ];
 return entries.sort((a,b)=>a.date.localeCompare(b.date)||timingSort(a.timing).localeCompare(timingSort(b.timing))||a.key.localeCompare(b.key));
}
