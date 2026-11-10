import {z} from 'zod';
import {billingId,billingInstant,createFamilyOfferSchema,servicePeriodSchema,type PublishedOffer} from './contracts.ts';
import {newYorkDate} from './contracts-v2.ts';
import {createFamilyOffer} from './domain.ts';
import {requireBilling} from './billing-errors.ts';

export const CHILD_PERIOD_VERSION='JLFA-FISHING-CHILD-PERIOD-v3' as const;
const lessonSchema=z.object({id:billingId,startsAt:billingInstant}).strict();
const periodInputSchema=z.object({
 childId:billingId,periodId:billingId,firstEligibleLesson:lessonSchema,
 cycle:z.number().int().min(0).max(1200),
}).strict();
type WallTime={year:number;month:number;day:number;hour:number;minute:number;second:number;millisecond:number};
const clock=new Intl.DateTimeFormat('en-GB',{
 timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit',
});
function wallTime(at:number):WallTime{
 const iso=new Date(at).toISOString(),date=newYorkDate(iso).split('-').map(Number);
 const parts=clock.formatToParts(new Date(at));
 const get=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
 return {year:date[0]!,month:date[1]!,day:date[2]!,hour:get('hour'),minute:get('minute'),second:get('second'),millisecond:new Date(at).getUTCMilliseconds()};
}
function utc(w:WallTime):number{
 const date=new Date(0);
 date.setUTCFullYear(w.year,w.month-1,w.day);
 date.setUTCHours(w.hour,w.minute,w.second,w.millisecond);
 return date.valueOf();
}
function anniversary(anchor:WallTime,cycle:number):WallTime{
 const total=anchor.year*12+anchor.month-1+cycle,year=Math.floor(total/12),month=total%12+1;
 requireBilling(year>=1&&year<=9999);
 const last=new Date(0);last.setUTCFullYear(year,month,0);
 return {...anchor,year,month,day:Math.min(anchor.day,last.getUTCDate())};
}
function resolve(w:WallTime):string{
 const target=utc(w),offsets=new Set<number>();
 // Observe the zone on both sides of a possible transition. No fixed UTC
 // offset or 30-day duration defines a child's calendar anniversary.
 for(const hours of [-36,0,36]){
  const sample=target+hours*3_600_000;offsets.add(utc(wallTime(sample))-sample);
 }
 const candidates=[...offsets].map(offset=>target-offset).filter(at=>utc(wallTime(at))===target);
 // A nonexistent or ambiguous local anniversary needs an explicit owner
 // resolution before a payable period can be issued. Never guess a charge time.
 requireBilling(candidates.length===1,'UNAVAILABLE');
 return new Date(candidates[0]!).toISOString();
}

/** Pure prospective planning. The authenticated caller must establish the
 * child's actual first eligible lesson and persist this provenance together
 * with the draft. This does not authorize a seat, charge, renewal or delivery. */
export function calendarMonthlyChildPeriodV3(raw:z.input<typeof periodInputSchema>){
 const input=periodInputSchema.parse(raw),start=Date.parse(input.firstEligibleLesson.startsAt),anchor=wallTime(start);
 const startsAt=input.cycle===0?new Date(start).toISOString():resolve(anniversary(anchor,input.cycle));
 const endsAt=resolve(anniversary(anchor,input.cycle+1));
 return {
  version:CHILD_PERIOD_VERSION,childId:input.childId,firstEligibleLesson:input.firstEligibleLesson,cycle:input.cycle,
  period:servicePeriodSchema.parse({id:input.periodId,startsAt,endsAt,timeZone:'America/New_York'}),
 };
}
export type CalendarMonthlyChildPeriodV3=ReturnType<typeof calendarMonthlyChildPeriodV3>;

const offerInputSchema=createFamilyOfferSchema.omit({children:true}).extend({
 children:z.array(z.object({
  lineId:billingId,childId:billingId,periodId:billingId,firstEligibleLesson:lessonSchema,
  groupId:billingId.nullable(),dueAt:billingInstant.nullable(),
 }).strict()).min(1).max(10),
}).strict();
/** Compose the existing family-offer draft with each child's own first period.
 * Existing accepted offers are never converted or rewritten by this function. */
export function createChildAnchoredFamilyOfferV3(
 definition:PublishedOffer,raw:z.input<typeof offerInputSchema>,context:Parameters<typeof createFamilyOffer>[2],
){
 const input=offerInputSchema.parse(raw);
 requireBilling(new Set(input.children.map(c=>c.childId)).size===input.children.length);
 requireBilling(new Set(input.children.map(c=>c.periodId)).size===input.children.length);
 const periods=input.children.map(c=>calendarMonthlyChildPeriodV3({
  childId:c.childId,periodId:c.periodId,firstEligibleLesson:c.firstEligibleLesson,cycle:0,
 }));
 const quote=createFamilyOffer(definition,{...input,children:input.children.map((child,index)=>({
  lineId:child.lineId,childId:child.childId,period:periods[index]!.period,groupId:child.groupId,dueAt:child.dueAt,
 }))},context);
 return {quote,periods};
}
