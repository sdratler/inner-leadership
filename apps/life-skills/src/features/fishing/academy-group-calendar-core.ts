import {z} from 'zod';
import {fishingCalendarTimelineSchema,fishingCivilTime,type FishingCalendarEvent} from './program-calendar-contract.ts';

export const academyCalendarViewSchema=z.enum(['day','week','four_weeks','month','year','agenda']);
export type AcademyCalendarView=z.infer<typeof academyCalendarViewSchema>;
const civil=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T12:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;});
export function academyCalendarShiftDay(date:string,delta:number):string{
 civil.parse(date);if(!Number.isSafeInteger(delta)||Math.abs(delta)>3660)throw Error('ACADEMY_CALENDAR_RANGE_INVALID');
 const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10);
}
export function academyCalendarShiftMonth(date:string,delta:number):string{
 civil.parse(date);if(!Number.isSafeInteger(delta)||Math.abs(delta)>1200)throw Error('ACADEMY_CALENDAR_RANGE_INVALID');
 const d=new Date(date.slice(0,8)+'01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);const end=new Date(d);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);d.setUTCDate(Math.min(Number(date.slice(8)),end.getUTCDate()));return d.toISOString().slice(0,10);
}
/** Twelve months from the selected month: Nov2026 opens Nov2026–Oct2027.
 * Civil date calculations are independent of host and clinical time zones.
 */
export function academyCalendarRange(anchor:string,view:AcademyCalendarView):{dates:string[];from:string;to:string;months:string[]}{
 civil.parse(anchor);academyCalendarViewSchema.parse(view);let start=anchor,count=1;const months:string[]=[];
 if(view==='week'||view==='four_weeks'){start=academyCalendarShiftDay(anchor,-new Date(anchor+'T12:00:00Z').getUTCDay());count=view==='week'?7:28;}
 if(view==='agenda')count=14;
 if(view==='month'){const first=anchor.slice(0,8)+'01';start=academyCalendarShiftDay(first,-new Date(first+'T12:00:00Z').getUTCDay());count=42;}
 if(view==='year'){start=anchor.slice(0,8)+'01';for(let n=0;n<12;n++)months.push(academyCalendarShiftMonth(start,n));count=(Date.parse(academyCalendarShiftMonth(start,12)+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000;}
 const dates=Array.from({length:count},(_,n)=>academyCalendarShiftDay(start,n));return {dates,from:start,to:dates.at(-1)!,months};
}
/** Preserve the existing native endpoint's strict <62-day span. No broad API
 * window, sample fallback, partial year or silent truncation is introduced.
 */
export function academyCalendarReadWindows(from:string,to:string):{from:string;to:string}[]{
 civil.parse(from);civil.parse(to);const count=(Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000+1;
 if(!Number.isInteger(count)||count<1||count>366)throw Error('ACADEMY_CALENDAR_RANGE_INVALID');
 const windows=[];for(let n=0;n<count;n+=62)windows.push({from:academyCalendarShiftDay(from,n),to:academyCalendarShiftDay(from,Math.min(n+61,count-1))});return windows;
}
export async function readAcademyCalendarTimeline(from:string,to:string,learnerIds:readonly string[],read:(path:string)=>Promise<unknown>):Promise<FishingCalendarEvent[]>{
 const windows=academyCalendarReadWindows(from,to),results=await Promise.allSettled(windows.map(window=>{
  const query=new URLSearchParams(window);for(const id of learnerIds)query.append('learnerId',id);return read('fishing/timeline?'+query);
 }));
 const items=new Map<string,FishingCalendarEvent>();let availability:string|undefined;
 for(let i=0;i<results.length;i++){const result=results[i]!;if(result.status==='rejected')throw Error('ACADEMY_CALENDAR_INCOMPLETE_READ');
  const value=fishingCalendarTimelineSchema.parse(result.value),window=windows[i]!;if(availability!==undefined&&availability!==value.availability)throw Error('ACADEMY_CALENDAR_CONFIGURATION_CHANGED');availability=value.availability;
  for(const item of value.items){const day=fishingCivilTime(item.startsAt).date;if(day<window.from||day>window.to||items.has(item.id))throw Error('ACADEMY_CALENDAR_EVENT_WINDOW_INVALID');items.set(item.id,item);}
 }
 return [...items.values()].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id));
}
