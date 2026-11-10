import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {calendarMonthlyChildPeriodV3,childPeriodLessonWeeksV3} from '../../src/features/fishing-billing/service-periods-v3.ts';
const month=(startsAt:string)=>calendarMonthlyChildPeriodV3({childId:randomUUID(),periodId:randomUUID(),firstEligibleLesson:{id:randomUUID(),startsAt},cycle:0}).period;
it('uses four weekly windows for a 28-day child month and five for a 31-day month',()=>{
 const feb=childPeriodLessonWeeksV3(month('2035-02-15T21:00:00Z')),jan=childPeriodLessonWeeksV3(month('2035-01-15T21:00:00Z'));
 expect(feb).toHaveLength(4);expect(jan).toHaveLength(5);
 expect(jan[4]).toEqual({startsAt:'2035-02-12T21:00:00.000Z',endsAt:'2035-02-15T21:00:00.000Z'});
});
it('preserves the Florida weekly wall clock across spring and fall daylight saving transitions',()=>{
 const spring=childPeriodLessonWeeksV3(month('2035-02-15T21:00:00Z')),fall=childPeriodLessonWeeksV3(month('2035-10-15T20:00:00Z'));
 expect((Date.parse(spring[3]!.endsAt)-Date.parse(spring[3]!.startsAt))/3600000).toBe(167);
 expect(fall.some(week=>(Date.parse(week.endsAt)-Date.parse(week.startsAt))/3600000===169)).toBe(true);
 expect(spring[3]!.endsAt).toBe('2035-03-15T20:00:00.000Z');
});
it('clamps the last week to the original month-end anniversary without adding an unpaid lesson window',()=>{
 const period=month('2035-01-31T21:30:00.007Z'),weeks=childPeriodLessonWeeksV3(period);
 expect(weeks).toHaveLength(4);expect(weeks[0]!.startsAt).toBe(period.startsAt);expect(weeks[3]!.endsAt).toBe(period.endsAt);
 expect(weeks.every((week,index)=>index===0||weeks[index-1]!.endsAt===week.startsAt)).toBe(true);
});
it('does not resolve a nonexistent weekly local time by guessing an elapsed-hour offset',()=>{
 expect(()=>childPeriodLessonWeeksV3(month('2035-02-25T07:30:00Z'))).toThrow('UNAVAILABLE');
});
