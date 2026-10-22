import {z} from 'zod';
import {floridaWallTimeCandidates} from '../fishing-stage/time.ts';

const eventSchema=z.strictObject({id:z.string().min(1).max(160),kind:z.enum(['ordinary','keys']),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true})})
 .refine(e=>Date.parse(e.endsAt)>Date.parse(e.startsAt)&&Date.parse(e.endsAt)-Date.parse(e.startsAt)<=48*3600000);
export type AcademyTeachingEvent=z.infer<typeof eventSchema>;
export type AcademyOperatorDay={date:string;ordinaryEventIds:string[];keysEventIds:string[];ordinaryMilliseconds:number};
export type AcademyOperatorDayViolation={date:string;reason:'ordinary_session_limit'|'ordinary_hours_limit'|'keys_day_exclusive'|'ordinary_saturday'};
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export function academyFloridaDay(instant:string):string{
 if(!z.iso.datetime({offset:true}).safeParse(instant).success)throw Error('ACADEMY_OPERATOR_TIME_INVALID');
 const parts=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;
}
/** Split at actual Florida midnights, not host-local dates or fixed 24h days.
 * Midnight end is exclusive. A pooled physical event is counted once even if
 * several group/original-occurrence participation links refer to it.
 */
export function academyOperatorDays(input:readonly AcademyTeachingEvent[]):AcademyOperatorDay[]{
 const events=new Map<string,AcademyTeachingEvent>(),days=new Map<string,AcademyOperatorDay>();
 for(const raw of input){const e=eventSchema.parse(raw),old=events.get(e.id);
  if(old){if(old.kind!==e.kind||Date.parse(old.startsAt)!==Date.parse(e.startsAt)||Date.parse(old.endsAt)!==Date.parse(e.endsAt))throw Error('ACADEMY_PHYSICAL_EVENT_ID_CONFLICT');continue;}events.set(e.id,e);
  const end=Date.parse(e.endsAt);let cursor=Date.parse(e.startsAt);
  while(cursor<end){const date=academyFloridaDay(new Date(cursor).toISOString()),nextDate=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
   const midnight=floridaWallTimeCandidates(nextDate+'T00:00');if(midnight.length!==1)throw Error('ACADEMY_OPERATOR_MIDNIGHT_INVALID');
   const boundary=Math.min(end,Date.parse(midnight[0]!));if(boundary<=cursor)throw Error('ACADEMY_OPERATOR_RANGE_INVALID');
   const day=days.get(date)??{date,ordinaryEventIds:[],keysEventIds:[],ordinaryMilliseconds:0};
   if(e.kind==='ordinary'){day.ordinaryEventIds.push(e.id);day.ordinaryMilliseconds+=boundary-cursor;}else day.keysEventIds.push(e.id);
   days.set(date,day);cursor=boundary;
  }
 }
 return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,ordinaryEventIds:d.ordinaryEventIds.sort(),keysEventIds:d.keysEventIds.sort()}));
}
/** Operational limits only. This does not approve a venue, Sunday exception,
 * readiness, religious calendar, group size, purchase, activity or Keys trip.
 */
export function academyOperatorDayViolations(events:readonly AcademyTeachingEvent[],selectedDays?:ReadonlySet<string>):AcademyOperatorDayViolation[]{
 const result:AcademyOperatorDayViolation[]=[];
 for(const day of academyOperatorDays(events)){
  if(selectedDays&&!selectedDays.has(day.date))continue;
  if(day.ordinaryEventIds.length>2)result.push({date:day.date,reason:'ordinary_session_limit'});
  if(day.ordinaryMilliseconds>6*3600000)result.push({date:day.date,reason:'ordinary_hours_limit'});
  if(day.keysEventIds.length>1||day.keysEventIds.length===1&&day.ordinaryEventIds.length>0)result.push({date:day.date,reason:'keys_day_exclusive'});
  if(day.ordinaryEventIds.length&&new Date(day.date+'T12:00:00Z').getUTCDay()===6)result.push({date:day.date,reason:'ordinary_saturday'});
 }
 return result;
}
